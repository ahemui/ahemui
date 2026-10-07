import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { AhemStore, Batch, Item } from "@ahemui/core";
import { BOARD_JS } from "./board-assets.generated.js";
import { gitBranch } from "./git.js";

interface Boot {
  mode: "live" | "static";
  project?: string;
  branch?: string | null;
  generated?: string;
  items?: Item[];
  batches?: Batch[];
  /** Static mode: path from the HTML file to the .ahemui directory, for screenshot links. */
  base?: string;
}

const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#e8694f"/><circle cx="16" cy="16" r="8" fill="none" stroke="#fff" stroke-width="3"/><circle cx="20" cy="12" r="3" fill="#fff"/></svg>`);

/** The board page: data (static mode) and the bundled script inlined, so it is one self-contained file. */
export function boardHtml(boot: Boot): string {
  const data = JSON.stringify(boot).replace(/</g, "\\u003c"); // no "</script>" can break out of the tag
  const js = BOARD_JS.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AhemUI backlog${boot.project ? ` — ${escapeHtml(boot.project)}` : ""}</title>
<link rel="icon" href="${ICON}">
</head>
<body>
<script>window.__AHEMUI_BOARD__ = ${data};</script>
<script>${js}</script>
</body>
</html>
`;
}

/**
 * Writes a read-only snapshot of the backlog (including archived items). Screenshots are linked relative to the
 * file, so it works when opened straight from the repo. Default location: .ahemui/backlog.html (git-ignored).
 */
export async function exportBoard(store: AhemStore, out = join(store.dir, "backlog.html")): Promise<string> {
  const file = resolve(out);
  const base = relative(dirname(file), store.dir).split("\\").join("/");
  const html = boardHtml({
    mode: "static",
    project: basename(store.root),
    branch: gitBranch(store.root),
    generated: new Date().toISOString(),
    items: await store.list({ includeDone: true }),
    batches: await store.listBatches(),
    base,
  });
  await writeFile(file, html);
  return file;
}

/** Opens a URL in the default browser. */
export function openInBrowser(url: string) {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", '""', url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd, args as string[], { stdio: "ignore", detached: true, shell: false, windowsVerbatimArguments: true }).unref();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
