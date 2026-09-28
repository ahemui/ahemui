import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, before, test } from "node:test";
import { AhemStore } from "@ahemui/core";
import { WebSocket } from "ws";
import { serve } from "../src/server.js";

let root: string;
let store: AhemStore;
let srv: Awaited<ReturnType<typeof serve>>;
let base: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "ahemui-srv-"));
  store = await AhemStore.init(root, { devOrigins: ["http://localhost:5173"] });
  srv = await serve(store, { port: 0, log: () => {} });
  base = `http://127.0.0.1:${srv.port}`;
});
after(async () => {
  await srv.close();
  await rm(root, { recursive: true, force: true });
});

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("rejects unknown origins, allows dev origin and extensions", async () => {
  const bad = await fetch(`${base}/api/health`, { headers: { Origin: "https://evil.example" } });
  assert.equal(bad.status, 403);
  const dev = await fetch(`${base}/api/health`, { headers: { Origin: "http://localhost:5173" } });
  assert.equal(dev.status, 200);
  assert.equal(dev.headers.get("access-control-allow-origin"), "http://localhost:5173");
  const ext = await fetch(`${base}/api/health`, { headers: { Origin: "chrome-extension://abc" } });
  assert.equal(ext.status, 200);
  const health = await ext.json();
  assert.equal(health.project, basename(root));
  assert.ok("branch" in health);
});

test("local tools can register extra origins, browsers cannot", async () => {
  const denied = await fetch(`${base}/api/origins`, {
    method: "POST",
    headers: { Origin: "http://localhost:5173" },
    body: JSON.stringify({ origins: ["https://evil.example"] }),
  });
  assert.equal(denied.status, 403);
  await fetch(`${base}/api/origins`, { method: "POST", body: JSON.stringify({ origins: ["http://localhost:5174"] }) });
  const ok = await fetch(`${base}/api/health`, { headers: { Origin: "http://localhost:5174" } });
  assert.equal(ok.status, 200);
});

test("creates an item with a screenshot and serves it back", async () => {
  const res = await fetch(`${base}/api/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "chrome-extension://abc" },
    body: JSON.stringify({ prompt: "Fix padding", route: "/", anchor: { source: "src/App.vue:3" }, shot: PNG_1PX }),
  });
  assert.equal(res.status, 201);
  const item = await res.json();
  assert.equal(item.shot, "shot.png");

  const shot = await fetch(`${base}/api/items/${item.id}/shot`);
  assert.equal(shot.headers.get("content-type"), "image/png");

  const invalid = await fetch(`${base}/api/items`, { method: "POST", body: JSON.stringify({ prompt: "" }) });
  assert.equal(invalid.status, 400);
});

test("pushes status changes made on disk to websocket clients", async () => {
  const item = await store.create({ prompt: "live", anchor: {} });
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { origin: "http://localhost:5173" });
  const messages: any[] = [];
  ws.on("message", (m) => messages.push(JSON.parse(String(m))));
  await new Promise((r) => ws.once("open", r));

  await waitFor(() => messages.length >= 1);
  await store.resolve(item.id, { status: "done" }); // as Claude / the CLI would
  await waitFor(() => messages.some((m) => m.items.find((i: any) => i.id === item.id)?.status === "done"));
  ws.close();
});

test("websocket rejects unknown origins", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { origin: "https://evil.example" });
  const err = await new Promise((r) => ws.once("error", r));
  assert.match(String(err), /401|403/);
});

async function waitFor(cond: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("a taken port rejects cleanly instead of crashing the process", async () => {
  // srv already holds its port; a second server on the same port must throw EADDRINUSE, not emit an unhandled error.
  await assert.rejects(serve(store, { port: srv.port, log: () => {} }), /EADDRINUSE/);
});

test("personal settings live in AHEMUI_HOME/prefs.json; invalid values are refused", async () => {
  process.env.AHEMUI_HOME = join(root, "home");
  const post = (body: unknown) =>
    fetch(`${base}/api/prefs`, { method: "POST", headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const empty = await (await fetch(`${base}/api/prefs`)).json();
  assert.deepEqual(empty, { prefs: {}, defaults: {} });

  const saved = await (await post({ position: "top-left", name: "Anna", ignored: 1 })).json();
  assert.deepEqual(saved.prefs, { position: "top-left", name: "Anna" });
  assert.equal((await post({ position: "middle" })).status, 400);

  const cleared = await (await post({ name: null })).json();
  assert.deepEqual(cleared.prefs, { position: "top-left" });
  delete process.env.AHEMUI_HOME;
});
