import { watch } from "node:fs";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type Config, defaultAuthor, type Item, NewItemSchema, type Shot, AhemError, type AhemStore } from "@ahemui/core";
import { WebSocket, WebSocketServer } from "ws";
import { boardHtml, exportBoard } from "./board.js";
import { gitBranch } from "./git.js";
import { readPrefs, updatePrefs } from "./prefs.js";

const MIME: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg" };

declare const __AHEMUI_BUILD__: string | undefined;
/** Which `npm run build` this server came from; the overlay compares it with its own. */
export const BUILD = typeof __AHEMUI_BUILD__ === "string" ? __AHEMUI_BUILD__ : "dev";

export interface ServeOptions {
  port?: number;
  host?: string;
  /** Extra origins allowed on top of config.devOrigins (e.g. the Vite dev server's actual URL). */
  origins?: string[];
  log?: (msg: string) => void;
}

export async function serve(store: AhemStore, opts: ServeOptions = {}) {
  const config = await store.config();
  // Mutable copy: the Vite plugin registers its real origin at runtime via POST /api/origins.
  config.devOrigins = [...new Set([...config.devOrigins, ...(opts.origins ?? [])])];
  const port = opts.port ?? config.port;
  const host = opts.host ?? "127.0.0.1";
  const log = opts.log ?? ((m) => console.log(m));
  // The board page is served by this server, so its own origin is allowed too (filled in once the port is known).
  const self: string[] = [];

  const server = createServer((req, res) => {
    handle(store, config, self, req, res).catch((err) => {
      const status =
        err instanceof HttpError ? err.status : err instanceof AhemError ? 404 : err?.name === "ZodError" ? 400 : 500;
      if (status === 500) log(`error: ${err?.stack ?? err}`);
      send(res, status, { error: String(err?.message ?? err) });
    });
  });

  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: ({ origin, req }: { origin?: string; req: IncomingMessage }) => hostAllowed(req.headers.host) && originAllowed(origin, config, self),
  });
  // The WebSocket server re-emits the HTTP server's errors (e.g. EADDRINUSE). The listen() below already reports
  // those to the caller; without this listener the re-emitted copy would crash the host process (Vite).
  wss.on("error", () => {});

  const snapshot = async () =>
    JSON.stringify({ type: "items", items: await store.list({ includeDone: true }), watcher: await store.watcher() });
  wss.on("connection", async (ws) => ws.send(await snapshot()));

  // Files are the bus: any change — from Claude, the CLI, or a git checkout — is pushed to the overlay.
  const broadcast = async () => {
    if (wss.clients.size === 0) return;
    const msg = await snapshot();
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
  };
  // .ahemui/backlog.html is kept in step with the files for anyone who just wants to open the backlog.
  let exportTimer: NodeJS.Timeout | undefined;
  const exportSoon = () => {
    clearTimeout(exportTimer);
    exportTimer = setTimeout(() => exportBoard(store).catch((err) => log(`board export failed: ${err?.message ?? err}`)), 1500);
  };
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(store.dir, { recursive: true }, (_event, file) => {
    if (file?.endsWith(".tmp") || file?.endsWith("backlog.html")) return;
    clearTimeout(timer);
    timer = setTimeout(broadcast, 150);
    if (!file?.endsWith(".watcher.json") && !file?.endsWith(".watch-control.json")) exportSoon();
  });
  exportSoon();
  // A watching Claude session can vanish without touching any file (process killed), so re-check presence.
  let lastWatcher = "";
  const presence = setInterval(async () => {
    const now = JSON.stringify(await store.watcher());
    if (now !== lastWatcher) {
      lastWatcher = now;
      broadcast();
    }
  }, 5_000);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
  } catch (err) {
    // Port taken: undo everything started above so the caller can try the next port cleanly.
    clearTimeout(timer);
    clearTimeout(exportTimer);
    clearInterval(presence);
    watcher.close();
    wss.close();
    throw err;
  }
  const bound = (server.address() as { port: number }).port; // differs from `port` when 0 was requested
  self.push(`http://127.0.0.1:${bound}`, `http://localhost:${bound}`);
  log(`ahemui serving ${store.root} on http://${host}:${bound} (board: http://127.0.0.1:${bound}/)`);

  return {
    port: bound,
    close: async () => {
      clearTimeout(timer);
      clearTimeout(exportTimer);
      clearInterval(presence);
      watcher.close();
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise((r) => server.close(r));
    },
  };
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Only the extension, configured dev origins, the board page this server serves, and non-browser clients
 * (no Origin) may talk to the server.
 */
export function originAllowed(origin: string | undefined, config: Config, self: string[] = []): boolean {
  if (!origin) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  return config.devOrigins.includes(origin) || self.includes(origin);
}

/** Blocks DNS rebinding: a hostile site pointing its own hostname at 127.0.0.1 still sends its own Host header. */
export function hostAllowed(host: string | undefined): boolean {
  return !host || /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
}

async function handle(store: AhemStore, config: Config, self: string[], req: IncomingMessage, res: ServerResponse) {
  if (!hostAllowed(req.headers.host)) throw new HttpError(403, "unexpected Host header");
  const origin = req.headers.origin;
  if (!originAllowed(origin, config, self)) throw new HttpError(403, `origin ${origin} not allowed`);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return void res.writeHead(204).end();

  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "items", id, action]
  if (req.method === "GET" && (parts.length === 0 || parts[0] === "board")) {
    const html = boardHtml({ mode: "live" });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return void res.end(html);
  }
  if (parts[0] !== "api") throw new HttpError(404, "not found");

  if (req.method === "GET" && parts[1] === "health") {
    return send(res, 200, {
      name: "ahemui",
      build: BUILD,
      project: basename(store.root),
      branch: gitBranch(store.root),
      root: store.root,
      devOrigins: config.devOrigins,
      maxBytes: config.screenshot.maxBytes,
      watcher: await store.watcher(),
    });
  }
  if (req.method === "POST" && parts[1] === "origins") {
    // Only local non-browser processes (no Origin header) may widen the allowlist.
    if (origin) throw new HttpError(403, "origins can only be registered by local tools");
    const body = await readJson(req, 16_000);
    const added = (Array.isArray(body.origins) ? body.origins : []).filter((o: unknown) => typeof o === "string");
    config.devOrigins = [...new Set([...config.devOrigins, ...added])];
    return send(res, 200, { devOrigins: config.devOrigins });
  }

  // Named rounds of feedback ("Home changes · 28 Sep"), picked in the overlay when someone starts capturing.
  if (parts[1] === "batches" && !parts[2]) {
    if (req.method === "GET") return send(res, 200, await store.listBatches());
    if (req.method === "POST") {
      const body = await readJson(req, 16_000);
      if (typeof body.name !== "string" || !body.name.trim()) throw new HttpError(400, "name is required");
      if (body.intent !== "action" && body.intent !== "review") throw new HttpError(400, "intent must be action or review");
      return send(res, 201, await store.createBatch({ name: body.name.slice(0, 120), intent: body.intent, author: body.author ?? defaultAuthor() }));
    }
  }
  // Personal overlay settings (~/.ahemui/prefs.json) plus the project's defaults from config.json.
  if (parts[1] === "prefs" && (req.method === "GET" || req.method === "POST")) {
    if (req.method === "POST") {
      const body = await readJson(req, 16_000);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "expected an object of settings");
      await updatePrefs(body).catch((err) => {
        throw new HttpError(400, `invalid setting: ${err?.issues?.[0]?.message ?? err?.message ?? err}`);
      });
    }
    return send(res, 200, { prefs: await readPrefs(), defaults: config.overlay?.defaults ?? {} });
  }
  // Pause, resume or stop the Claude session running /ahemui:watch. Starting one is only possible from Claude Code.
  if (req.method === "POST" && parts[1] === "watch") {
    const body = await readJson(req, 16_000);
    const action = body.action;
    if (action !== "pause" && action !== "resume" && action !== "stop") throw new HttpError(400, "action must be pause, resume or stop");
    if (action !== "resume" && !(await store.watcher())) throw new HttpError(409, "no Claude session is watching; run /ahemui:watch in Claude Code");
    await store.setWatchControl(action === "pause" ? "paused" : action === "stop" ? "stop" : null, body.author ?? defaultAuthor());
    return send(res, 200, { watcher: await store.watcher() });
  }
  if (req.method === "POST" && parts[1] === "prune") {
    const { moved } = await store.prune();
    return send(res, 200, { archived: moved.map((i) => i.id) });
  }
  if (parts[1] !== "items") throw new HttpError(404, "not found");
  const [, , id, action] = parts;

  if (req.method === "GET" && !id) {
    return send(res, 200, await store.list({ includeDone: url.searchParams.has("all") }));
  }
  const maxShot = config.screenshot.maxBytes;
  if (req.method === "POST" && !id) {
    // Main screenshot plus one per extra area (at most 8).
    const body = await readJson(req, maxShot * 1.4 * 9 + 256_000);
    const shot = body.shot ? decodeShot(body.shot, maxShot) : undefined;
    const extraShots = Array.isArray(body.extraShots)
      ? body.extraShots.slice(0, 8).map((s: unknown) => (typeof s === "string" ? decodeShot(s, maxShot) : undefined))
      : [];
    return send(res, 201, await store.create(NewItemSchema.parse(body), shot, extraShots));
  }
  if (req.method === "GET" && id && !action) return send(res, 200, await store.get(id));
  if (req.method === "GET" && (action === "shot" || action === "file")) {
    const item = await store.get(id);
    const name = action === "shot" ? item.shot : parts[4];
    if (!name) throw new HttpError(404, "item has no screenshot");
    const path = store.filePath(item, decodeURIComponent(name));
    const ext = path.split(".").pop()!;
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    return void res.end(await readFile(path));
  }
  if (req.method === "POST" && action === "resolve") {
    const body = await readJson(req, 64_000);
    const status = body.status;
    if (status !== undefined && !["review", "done", "wontfix"].includes(status)) throw new HttpError(400, "status must be review, done or wontfix");
    return send(res, 200, await store.resolve(id, { status, note: body.note, author: body.author }));
  }
  if (req.method === "POST" && action === "reopen") return send(res, 200, await store.reopen(id));
  if (req.method === "POST" && action === "archive") return send(res, 200, await store.archive(id));
  if (req.method === "POST" && action === "triage") {
    const body = await readJson(req, 16_000);
    const pick = (k: string) => (body[k] === undefined ? undefined : body[k]);
    return send(res, 200, await store.triage(id, { type: pick("type"), priority: pick("priority"), area: pick("area"), labels: pick("labels") }));
  }
  if (req.method === "POST" && action === "start") {
    const body = await readJson(req, 16_000);
    const start = body.start ?? "now";
    if (start !== "now" && start !== "later") throw new HttpError(400, "start must be now or later");
    return send(res, 200, await store.setStart(id, start));
  }
  if (req.method === "POST" && action === "reply") {
    const body = await readJson(req, 64_000);
    if (typeof body.text !== "string" || !body.text.trim()) throw new HttpError(400, "text is required");
    return send(res, 200, await store.reply(id, body.author ?? defaultAuthor(), body.text.slice(0, 4000)));
  }
  if (req.method === "POST" && action === "review") {
    const body = await readJson(req, 64_000);
    if (body.verdict !== "approved" && body.verdict !== "changes") throw new HttpError(400, "verdict must be approved or changes");
    if (body.verdict === "changes" && !body.comment?.trim()) throw new HttpError(400, "say what should change");
    return send(res, 200, await store.review(id, body.author ?? defaultAuthor(), body.verdict, body.comment?.slice(0, 4000)));
  }
  if (req.method === "POST" && action === "after") {
    const body = await readJson(req, maxShot * 1.4 + 16_000);
    if (!body.shot) throw new HttpError(400, "shot is required");
    return send(res, 200, await store.setAfter(id, decodeShot(body.shot, maxShot)));
  }

  throw new HttpError(404, "not found");
}

function decodeShot(dataUrl: string, maxBytes: number): Shot {
  const m = /^data:image\/(webp|png|jpeg);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, "shot must be a base64 image data URL");
  const data = Buffer.from(m[2], "base64");
  if (data.length > maxBytes) throw new HttpError(413, `screenshot is ${data.length} bytes, limit ${maxBytes}`);
  return { data, ext: m[1] === "jpeg" ? "jpg" : (m[1] as Shot["ext"]) };
}

async function readJson(req: IncomingMessage, limit: number): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "request body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export type { Item };
