import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SnapStore } from "@snap/core";

const SERVER = resolve(import.meta.dirname, "../server/snap-mcp.mjs");
let dir: string;
let client: Client;
let store: SnapStore;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "snap-ctx-"));
  store = await SnapStore.init(dir);
  client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, CLAUDE_PROJECT_DIR: dir, SNAP_AUTHOR: "tester" } }),
  );
});
after(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as any;
const text = (r: any) => r.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");

test("snap_get shows design, reference areas, tokens, state, errors, steps, a11y and redaction", async () => {
  const it = await store.create({
    prompt: "Match the header button",
    anchor: { source: "src/Nav.vue:4:3" },
    design: "https://figma.com/file/abc",
    styles: { computed: { padding: "8px 12px" }, tokens: { padding: "var(--space-2) var(--space-3)" }, classes: ["btn"] },
    state: { component: "NavBar", props: { user: "[masked]" } },
    evidence: { network: [{ method: "GET", url: "/api/me", status: 500, ms: 30, ago: 4000 }] },
    steps: [{ kind: "click", target: '<button> "Menu"', ago: 3000 }],
    a11y: [{ id: "color-contrast", impact: "serious", help: "Elements must meet contrast", nodes: 1 }],
    extras: [{ role: "reference", anchor: { source: "src/Hero.vue:9:5" } }],
    redacted: true,
  });
  const got = text(await call("snap_get", { id: it.id }));
  for (const re of [
    /Design reference: https:\/\/figma\.com\/file\/abc/,
    /## Example to match \(area 2\)[\s\S]*Source: src\/Hero\.vue:9:5/,
    /Design tokens in use: padding: var\(--space-2\) var\(--space-3\)/,
    /## Component state \(NavBar\)/,
    /GET \/api\/me → 500 in 30ms \(4s before\)/,
    /3s before: click <button> "Menu"/,
    /\[serious\] color-contrast/,
    /blacked out/,
  ]) {
    assert.match(got, re);
  }
});

test("questions release the item; snap_next skips it until the reply", async () => {
  const it = await store.create({ prompt: "Make it pop", anchor: {} });
  const asked = text(await call("snap_note", { id: it.id, text: "Pop how?", question: true }));
  assert.match(asked, /\?awaiting-reply/);
  const next = text(await call("snap_next"));
  assert.doesNotMatch(next, new RegExp(it.id)); // the other open item (or none) comes first
  await store.reply(it.id, "pietari", "Bigger");
  const listed = text(await call("snap_list", { status: ["open"], group_by: "none" }));
  assert.match(listed, new RegExp(`${it.id}  open  `));
});

test("resolve defaults to review", async () => {
  const it = await store.create({ prompt: "x", anchor: {} });
  assert.match(text(await call("snap_resolve", { id: it.id, note: "done it" })), /◎ .* review[\s\S]*approve it in the browser/);
  assert.match(text(await call("snap_resolve", { id: it.id, status: "done" })), /✓ .* done/);
});
