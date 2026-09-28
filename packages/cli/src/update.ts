import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AhemStore } from "@ahemui/core";

const TARBALL = "ahemui.tgz";
const SKIP_DIRS = new Set(["node_modules", ".git", ".ahemui", "dist", "build", ".next", ".nuxt", ".output", "coverage"]);

/**
 * The newest ahemui.tgz shipped with the Claude Code plugin. When this CLI runs from the plugin
 * (`<cache>/ahemui/ahemui/<version>/scripts/ahemui.mjs`), sibling version folders may hold a newer one after
 * `claude plugin update`, so the most recently built tarball wins.
 */
export function newestPluginTarball(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const versions = join(here, "..", "..");
  const candidates = [join(here, "..", "vendor", TARBALL)];
  try {
    for (const v of readdirSync(versions)) candidates.push(join(versions, v, "vendor", TARBALL));
  } catch {
    /* not inside the plugin cache */
  }
  const found = candidates.filter((f) => existsSync(f));
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] ?? null;
}

/** package.json files in the repo that depend on ahemui (repo root, or an app folder in a monorepo). */
export function ahemuiDependents(root: string, depth = 3): string[] {
  const out: string[] = [];
  const visit = (dir: string, level: number) => {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      const json = JSON.parse(readFileSync(pkg, "utf8"));
      if (json.dependencies?.["ahemui"] || json.devDependencies?.["ahemui"]) out.push(dir);
    }
    if (level >= depth) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) visit(join(dir, entry.name), level + 1);
    }
  };
  visit(root, 0);
  return out;
}

/**
 * The version of the Claude Code plugin this CLI ships with (…/scripts/ahemui.mjs → …/.claude-plugin/plugin.json),
 * or null outside the plugin. A release plugin (0.4.0) installs the same version from npm; a local build
 * (0.4.0-dev.<id>) isn't on npm, so projects get its bundled tarball instead.
 */
export function pluginVersion(): string | null {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json");
  try {
    return JSON.parse(readFileSync(file, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

export const isRelease = (version: string | null): version is string => !!version && /^\d+\.\d+\.\d+$/.test(version);

/** How an app depends on ahemui: a vendored tarball (file:…tgz) or a registry version. */
function dependencySpec(appDir: string): string | undefined {
  const json = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
  return json.devDependencies?.["ahemui"] ?? json.dependencies?.["ahemui"];
}

/** The build id baked into an installed ahemui, or null if it isn't installed there. */
export function installedBuild(appDir: string): string | null {
  const file = join(appDir, "node_modules", "ahemui", "dist", "index.js");
  if (!existsSync(file)) return null;
  return /"(\d{14})"/.exec(readFileSync(file, "utf8"))?.[1] ?? "dev";
}

function hash(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function packageManager(dir: string, root: string): { cmd: string; args: (spec: string) => string[] } {
  for (const d of [dir, root]) {
    if (existsSync(join(d, "pnpm-lock.yaml"))) return { cmd: "pnpm", args: (s) => ["add", "-D", s] };
    if (existsSync(join(d, "yarn.lock"))) return { cmd: "yarn", args: (s) => ["add", "-D", s] };
    if (existsSync(join(d, "bun.lockb")) || existsSync(join(d, "bun.lock"))) return { cmd: "bun", args: (s) => ["add", "-d", s] };
  }
  return { cmd: "npm", args: (s) => ["install", "-D", s] };
}

export interface UpdateResult {
  /** Where the new version came from: the vendored tarball, or "npm:ahemui@<version>". */
  tarball: string;
  changed: boolean;
  apps: { dir: string; before: string | null; after: string | null; ok: boolean }[];
}

/**
 * Updates ahemui in every app that uses it. Apps installed from npm get the plugin's release version from npm
 * (or the latest one); apps on a vendored tarball get the newest tarball copied into .ahemui/vendor/ first.
 */
export function updateProject(store: AhemStore, opts: { from?: string; force?: boolean; log?: (m: string) => void } = {}): UpdateResult {
  const log = opts.log ?? ((m) => console.log(m));
  const dependents = ahemuiDependents(store.root);
  const fromNpm = !opts.from && dependents.length > 0 && dependents.every((d) => !/\.tgz$|^file:/.test(dependencySpec(d) ?? ""));
  if (fromNpm) {
    const version = pluginVersion();
    const spec = `ahemui@${isRelease(version) ? version : "latest"}`;
    const apps = dependents.map((dir) => {
      const before = installedBuild(dir);
      const pm = packageManager(dir, store.root);
      log(`installing in ${relative(store.root, dir) || "."}: ${pm.cmd} ${pm.args(spec).join(" ")}`);
      const run = spawnSync(pm.cmd, pm.args(spec), { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
      return { dir, before, after: installedBuild(dir), ok: run.status === 0 };
    });
    return { tarball: `npm:${spec}`, changed: apps.some((a) => a.before !== a.after), apps };
  }
  const tarball = opts.from ?? newestPluginTarball();
  if (!tarball || !existsSync(tarball)) {
    throw new Error("no AhemUI package found to update from. Run this via /ahemui:update in Claude Code, or pass --from <ahemui.tgz>");
  }
  const dest = join(store.dir, "vendor", TARBALL);
  const changed = !existsSync(dest) || hash(dest) !== hash(tarball);
  if (changed) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(tarball, dest);
    log(`copied ${tarball} → ${relative(store.root, dest)}`);
  }

  const apps = dependents.map((dir) => {
    const before = installedBuild(dir);
    if (!changed && !opts.force && before) return { dir, before, after: before, ok: true };
    const rel = relative(dir, dest).split("\\").join("/");
    const spec = rel.startsWith("./") || rel.startsWith("../") ? rel : `./${rel}`; // a bare path could be read as a package name
    const pm = packageManager(dir, store.root);
    log(`installing in ${relative(store.root, dir) || "."}: ${pm.cmd} ${pm.args(spec).join(" ")}`);
    const run = spawnSync(pm.cmd, pm.args(spec), {
      cwd: dir,
      stdio: "inherit",
      shell: process.platform === "win32", // npm/pnpm/yarn are .cmd shims on Windows
    });
    return { dir, before, after: installedBuild(dir), ok: run.status === 0 };
  });
  return { tarball, changed, apps };
}
