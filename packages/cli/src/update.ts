import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { SnapStore } from "@snap/core";

const TARBALL = "snap-vite.tgz";
const SKIP_DIRS = new Set(["node_modules", ".git", ".snap", "dist", "build", ".next", ".nuxt", ".output", "coverage"]);

/**
 * The newest snap-vite.tgz shipped with the Claude Code plugin. When this CLI runs from the plugin
 * (`<cache>/snap/snap/<version>/bin/snap.mjs`), sibling version folders may hold a newer one after
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

/** package.json files in the repo that depend on @snap/vite (repo root, or an app folder in a monorepo). */
export function snapDependents(root: string, depth = 3): string[] {
  const out: string[] = [];
  const visit = (dir: string, level: number) => {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      const json = JSON.parse(readFileSync(pkg, "utf8"));
      if (json.dependencies?.["@snap/vite"] || json.devDependencies?.["@snap/vite"]) out.push(dir);
    }
    if (level >= depth) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) visit(join(dir, entry.name), level + 1);
    }
  };
  visit(root, 0);
  return out;
}

/** The build id baked into an installed @snap/vite, or null if it isn't installed there. */
export function installedBuild(appDir: string): string | null {
  const file = join(appDir, "node_modules", "@snap", "vite", "dist", "index.js");
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
  tarball: string;
  changed: boolean;
  apps: { dir: string; before: string | null; after: string | null; ok: boolean }[];
}

/** Copies the newest Snap package into .snap/vendor/ and reinstalls it in every app that uses it. */
export function updateProject(store: SnapStore, opts: { from?: string; force?: boolean; log?: (m: string) => void } = {}): UpdateResult {
  const log = opts.log ?? ((m) => console.log(m));
  const tarball = opts.from ?? newestPluginTarball();
  if (!tarball || !existsSync(tarball)) {
    throw new Error("no Snap package found to update from. Run this via /snap:update in Claude Code, or pass --from <snap-vite.tgz>");
  }
  const dest = join(store.dir, "vendor", TARBALL);
  const changed = !existsSync(dest) || hash(dest) !== hash(tarball);
  if (changed) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(tarball, dest);
    log(`copied ${tarball} → ${relative(store.root, dest)}`);
  }

  const apps = snapDependents(store.root).map((dir) => {
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
