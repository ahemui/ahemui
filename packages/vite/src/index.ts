import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { SnapError, SnapStore } from "@snap/core";
import { serve } from "@snap/cli/server";
import type { Plugin, ResolvedConfig } from "vite";

export interface SnapOptions {
  /** Inject the capture overlay into pages (turn off if you only use the browser extension). Default true. */
  overlay?: boolean;
  /** Add `data-snap-src="file:line:col"` to every element in Vue templates. Default true. */
  sourceAttrs?: boolean;
  /** Start `snap serve` inside the Vite process if it isn't already running. Default true. */
  serve?: boolean;
}

const OVERLAY_PATH = "/@snap/overlay.js";
const AGENT_PATH = "/@snap/agent.js";
const PORT_RANGE = 10;

export default function snap(options: SnapOptions = {}): Plugin {
  const { overlay = true, sourceAttrs = true, serve: startServe = true } = options;
  let config: ResolvedConfig;
  let store: SnapStore | null = null;
  let serverUrl: Promise<string | null> = Promise.resolve(null);

  return {
    name: "snap",
    apply: "serve",

    // The backlog lives in .snap/ and changes constantly (items, screenshots, the backlog.html snapshot). None of it is
    // app code, and an .html file changing there would otherwise make Vite reload the page.
    config: () => ({ server: { watch: { ignored: ["**/.snap/**"] } } }),

    configResolved(resolved) {
      config = resolved;
      if (sourceAttrs) injectVueTransform(resolved);
    },

    configureServer(server) {
      try {
        store = SnapStore.find(config.root);
      } catch (err) {
        if (!(err instanceof SnapError)) throw err;
        config.logger.warn(`[snap] no .snap/ found above ${config.root} — run \`npx snap init\` in your repo root`);
        return;
      }

      let resolveUrl!: (url: string | null) => void;
      serverUrl = new Promise((r) => (resolveUrl = r));
      server.httpServer?.once("listening", async () => {
        const origins = devOrigins(server.resolvedUrls, server.httpServer?.address());
        try {
          if (!startServe) return resolveUrl(null);
          const { base, close } = await ensureServer(store!, origins, (m) => config.logger.info(m));
          if (close) server.httpServer?.once("close", close);
          resolveUrl(base);
        } catch (err) {
          config.logger.error(`[snap] could not start snap serve: ${(err as Error).message}`);
          resolveUrl(null);
        }
      });

      // Both bundles are built next to this file (see build.mjs), so the package needs no other @snap/* deps.
      for (const [path, file] of [
        [OVERLAY_PATH, "./overlay-inject.js"],
        [AGENT_PATH, "./agent.js"],
      ]) {
        server.middlewares.use(path, async (_req, res) => {
          res.setHeader("Content-Type", "text/javascript");
          res.setHeader("Cache-Control", "no-cache");
          res.end(await readFile(fileURLToPath(new URL(file, import.meta.url))));
        });
      }
    },

    async transformIndexHtml() {
      if (!overlay || !store) return;
      const url = await serverUrl;
      if (!url) return;
      return [
        // Classic script first in <head>: hooks console/network before the app runs, reads framework internals.
        { tag: "script", attrs: { src: AGENT_PATH }, injectTo: "head-prepend" },
        { tag: "script", children: `window.__SNAP__ = ${JSON.stringify({ server: url })};`, injectTo: "head" },
        { tag: "script", attrs: { src: OVERLAY_PATH, defer: true }, injectTo: "head" },
      ];
    },
  };
}

/**
 * Adds a Vue compiler node transform through @vitejs/plugin-vue's public `api.options`,
 * so users don't have to touch their `vue()` config.
 */
function injectVueTransform(config: ResolvedConfig) {
  const vue = config.plugins.find((p) => p.name === "vite:vue") as (Plugin & { api?: { options: any } }) | undefined;
  if (!vue?.api) {
    config.logger.warn("[snap] @vitejs/plugin-vue not found — elements won't carry source locations");
    return;
  }
  const opts = vue.api.options;
  const compilerOptions = opts.template?.compilerOptions ?? {};
  vue.api.options = {
    ...opts,
    template: {
      ...opts.template,
      compilerOptions: {
        ...compilerOptions,
        nodeTransforms: [...(compilerOptions.nodeTransforms ?? []), snapNodeTransform(config.root)],
      },
    },
  };
}

// Vue compiler-core enums (stable since Vue 3.0).
const ELEMENT = 1;
const TAG_ELEMENT = 0;
const ATTRIBUTE = 6;
const TEXT = 2;

/** Vue template node transform adding `data-snap-src="src/File.vue:line:col"` to plain elements. */
export function snapNodeTransform(root: string) {
  return (node: any, context: any) => {
    // Only real elements: attrs on components would fall through and overwrite the child's own location.
    if (node.type !== ELEMENT || node.tagType !== TAG_ELEMENT || !context.filename) return;
    if (node.props.some((p: any) => p.type === ATTRIBUTE && p.name === "data-snap-src")) return;
    const file = relative(root, context.filename.split("?")[0]).split("\\").join("/");
    const { line, column } = node.loc.start;
    node.props.push({
      type: ATTRIBUTE,
      name: "data-snap-src",
      nameLoc: node.loc,
      value: { type: TEXT, content: `${file}:${line}:${column}`, loc: node.loc },
      loc: node.loc,
    });
  };
}

function devOrigins(urls: { local: string[]; network: string[] } | null | undefined, address: unknown): string[] {
  const origins = new Set<string>();
  for (const u of [...(urls?.local ?? []), ...(urls?.network ?? [])]) origins.add(new URL(u).origin);
  const port = typeof address === "object" && address ? (address as { port: number }).port : undefined;
  if (port) for (const host of ["localhost", "127.0.0.1"]) origins.add(`http://${host}:${port}`);
  return [...origins];
}

/** Reuses a running `snap serve` for this repo (registering our origins), or starts one in-process. */
async function ensureServer(
  store: SnapStore,
  origins: string[],
  log: (m: string) => void,
): Promise<{ base: string; close?: () => Promise<void> }> {
  const { port } = await store.config();
  for (let p = port; p < port + PORT_RANGE; p++) {
    const base = `http://127.0.0.1:${p}`;
    const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })
      .then((r) => r.json())
      .catch(() => null);
    if (health?.name === "snap") {
      if (health.root !== store.root) continue; // another repo's server
      await fetch(`${base}/api/origins`, { method: "POST", body: JSON.stringify({ origins }) });
      log(`[snap] using running snap serve at ${base}`);
      return { base };
    }
    try {
      const s = await serve(store, { port: p, origins, log: () => {} });
      log(`[snap] backlog server on ${base} (${relative(process.cwd(), store.dir) || store.dir})`);
      return { base, close: s.close };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  throw new Error(`no free port in ${port}–${port + PORT_RANGE - 1}`);
}
