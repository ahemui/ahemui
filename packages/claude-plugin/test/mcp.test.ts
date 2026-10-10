import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AhemStore } from "@ahemui/core";

const SERVER = resolve(import.meta.dirname, "../server/ahemui-mcp.mjs");
let dir: string;
let client: Client;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "ahemui-mcp-"));
  client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, CLAUDE_PROJECT_DIR: dir, AHEMUI_AUTHOR: "tester" } }),
  );
});
after(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as any;
const text = (r: any) => r.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");

test("exposes the ahemui tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["ahemui_batches", "ahemui_board", "ahemui_claim", "ahemui_dismiss", "ahemui_get", "ahemui_init", "ahemui_link", "ahemui_list", "ahemui_next", "ahemui_note", "ahemui_prune", "ahemui_reopen", "ahemui_resolve", "ahemui_scan", "ahemui_scans", "ahemui_set_tracker", "ahemui_suggest", "ahemui_ticket", "ahemui_tracker", "ahemui_triage"],
  );
});

test("errors helpfully before init", async () => {
  const r = await call("ahemui_list");
  assert.equal(r.isError, true);
  assert.match(text(r), /ahemui init/);
});

test("init vendors the vite tarball", async () => {
  const r = await call("ahemui_init", { dev_origins: ["http://localhost:5173"], vendor: true });
  assert.match(text(r), /\.\/\.ahemui\/vendor\/ahemui\.tgz when the app is at the repo root/);
  assert.deepEqual(await readdir(join(dir, ".ahemui/vendor")), ["ahemui.tgz"]);
});

test("next → note → resolve → prune lifecycle with screenshot", async () => {
  const store = new AhemStore(dir);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const a = await store.create(
    { prompt: "Make the CTA full width", route: "/pricing", anchor: { source: "src/components/PricingCard.vue:12:5", components: ["App", "PricingCard"] } },
    { data: png, ext: "png" },
  );
  await store.create({ prompt: "second", anchor: {} });

  const next = await call("ahemui_next");
  assert.match(text(next), new RegExp(`AhemUI item ${a.id} — in-progress`));
  assert.match(text(next), /Source: src\/components\/PricingCard.vue:12:5/);
  const img = next.content.find((c: any) => c.type === "image");
  assert.equal(img.mimeType, "image/png");
  assert.equal((await store.get(a.id)).claimed_by, "Claude (tester)");

  await call("ahemui_note", { id: a.id.slice(0, 12), text: "Using w-full" });
  const done = await call("ahemui_resolve", { id: a.id, note: "Made it full width" });
  assert.match(text(done), /◎ .* review/); // review is the default
  assert.match(text(done), /approve it in the browser/);
  await store.review(a.id, "tester", "approved");

  const listed = text(await call("ahemui_list", { status: ["open"] }));
  assert.match(listed, /second/);
  assert.doesNotMatch(listed, /CTA/);

  const prod = await store.create({ prompt: "Typo in footer", route: "/", url: "https://app.example.com/", anchor: { text: "© 2026 Acme Inc." } });
  assert.match(text(await call("ahemui_get", { id: prod.id })), /Captured on a deployed site \(app\.example\.com\).*no source mapping/);

  assert.match(text(await call("ahemui_prune")), /Archived 1 item/);
  assert.match(text(await call("ahemui_get", { id: a.id })), /\(archived\)/);
});

test("page metadata, triage, grouping and filtered next", async () => {
  const store = new AhemStore(dir);
  const a = await store.create({
    prompt: "Team card should say Contact sales",
    route: "/pricing",
    page: { title: "Acme", heading: "Pricing", routeName: "pricing", routePattern: "/pricing", pageFile: join(dir, "src/pages/Pricing.vue"), section: "Team", landmark: "main", env: "local", browser: "Chrome 140" },
    anchor: {},
  });
  const b = await store.create({ prompt: "Logo too big", route: "/", page: { heading: "Ship faster", landmark: "header" }, anchor: {} });

  const got = text(await call("ahemui_get", { id: a.id }));
  assert.match(got, /Classification: not triaged yet/);
  assert.match(got, /Vue Router: name "pricing", pattern \/pricing/);
  assert.match(got, /Page component: src\/pages\/Pricing.vue/);
  assert.match(got, /Section: Team/);

  assert.match(text(await call("ahemui_triage", { id: a.id, type: "copy", area: "Pricing › Plan cards" })), /\[copy · Pricing › Plan cards\]/);
  await call("ahemui_triage", { id: b.id, type: "style", area: "Global › Header", priority: "high" });

  const byArea = text(await call("ahemui_list", { status: ["open"], group_by: "area" }));
  assert.match(byArea, /## Global › Header \(1\)[\s\S]*## Pricing › Plan cards \(1\)/);
  assert.match(text(await call("ahemui_list", { status: ["open"] })), /## Pricing \(\/pricing\) \(1\)/);

  const next = text(await call("ahemui_next", { area: "pricing" }));
  assert.match(next, new RegExp(`AhemUI item ${a.id}`));
  assert.match(text(await call("ahemui_next", { type: "copy" })), /No open AhemUI items match/);
});

test("tracker: configure, render a ticket, link, and start-now ordering", async () => {
  const store = new AhemStore(dir);
  assert.match(text(await call("ahemui_tracker")), /No tracker configured/);
  assert.match(text(await call("ahemui_set_tracker", { kind: "jira", target: "Jira project WEB", labels: ["ahemui"], sync: "auto" })), /"kind":"jira"/);
  assert.match(text(await call("ahemui_tracker")), /Tracker: jira[\s\S]*Sync: auto[\s\S]*Atlassian/);

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const it = await store.create(
    { prompt: "Checkout button overlaps footer on mobile", route: "/checkout", start: "now", type: "layout", url: "https://shop.example.com/checkout",
      page: { heading: "Checkout", routePattern: "/checkout", section: "Payment", env: "deployed" }, anchor: { text: "Pay now" } },
    { data: png, ext: "png" },
  );
  const ticket = await call("ahemui_ticket", { id: it.id });
  const t = text(ticket);
  assert.match(t, /Title: Checkout button overlaps footer on mobile/);
  assert.match(t, /Labels: ahemui, layout/);
  assert.match(t, /sent with Start now/);
  assert.match(t, /- Page: Checkout \/checkout › Payment/);
  assert.match(t, /- URL: https:\/\/shop\.example\.com\/checkout \(deployed\)/);
  assert.match(t, new RegExp(`AhemUI-Item: \`${it.id}\``));
  assert.ok(ticket.content.some((c: any) => c.type === "image"));

  assert.match(text(await call("ahemui_link", { id: it.id, key: "WEB-12", url: "https://x.atlassian.net/browse/WEB-12", status: "To Do" })), /→ WEB-12/);
  assert.match(text(await call("ahemui_get", { id: it.id })), /Tracker ticket: jira WEB-12/);
  assert.match(text(await call("ahemui_list", { linked: false, status: ["open"] })), /^(?![\s\S]*WEB-12)/);

  // Start now beats everything else in ahemui_next.
  const next = text(await call("ahemui_next"));
  assert.match(next, new RegExp(`AhemUI item ${it.id}`));
  assert.match(next, /Requested: ⚡ Start now/);
});
