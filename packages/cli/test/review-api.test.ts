import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { AhemStore } from "@ahemui/core";
import { serve } from "../src/server.js";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let root: string;
let store: AhemStore;
let srv: Awaited<ReturnType<typeof serve>>;
let base: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "ahemui-rv-"));
  store = await AhemStore.init(root);
  srv = await serve(store, { port: 0, log: () => {} });
  base = `http://127.0.0.1:${srv.port}`;
});
after(async () => {
  await srv.close();
  await rm(root, { recursive: true, force: true });
});

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { Origin: "chrome-extension://lfgapjkopjhahhdeeaodfnmodkjahhpl", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("browser review endpoints: extra areas, files, reply, after-shot, review", async () => {
  const created = await (
    await post("/api/items", {
      prompt: "two places",
      anchor: {},
      shot: PNG_1PX,
      extras: [{ role: "also", anchor: { text: "x" } }],
      extraShots: [PNG_1PX],
      evidence: { console: [{ level: "error", message: "boom", ago: 10 }] },
      steps: [{ kind: "click", target: '<button> "Open"', ago: 500 }],
    })
  ).json();
  assert.equal(created.extras[0].shot, "shot-2.png");
  assert.equal(created.evidence.console[0].message, "boom");
  assert.equal((await fetch(`${base}/api/items/${created.id}/file/shot-2.png`)).status, 200);
  assert.equal((await fetch(`${base}/api/items/${created.id}/file/..%2Fconfig.json`)).status, 404);

  await store.ask(created.id, "Claude", "Which one?");
  assert.equal((await post(`/api/items/${created.id}/reply`, { text: "" })).status, 400);
  const replied = await (await post(`/api/items/${created.id}/reply`, { text: "Both", author: "me" })).json();
  assert.equal(replied.needs_reply, undefined);

  await store.resolve(created.id, {});
  const withAfter = await (await post(`/api/items/${created.id}/after`, { shot: PNG_1PX })).json();
  assert.equal(withAfter.after, "after.png");
  assert.equal((await fetch(`${base}/api/items/${created.id}/file/after.png`)).status, 200);

  assert.equal((await post(`/api/items/${created.id}/review`, { verdict: "changes" })).status, 400); // needs a comment
  const back = await (await post(`/api/items/${created.id}/review`, { verdict: "changes", comment: "Not yet" })).json();
  assert.equal(back.status, "open");
  await store.resolve(created.id, {});
  const approved = await (await post(`/api/items/${created.id}/review`, { verdict: "approved" })).json();
  assert.equal(approved.status, "done");
});

test("start moves a backlog item into the queue and back", async () => {
  const item = await store.create({ prompt: "later please", anchor: {} });
  const queued = await (await post(`/api/items/${item.id}/start`, {})).json();
  assert.equal(queued.start, "now");
  const back = await (await post(`/api/items/${item.id}/start`, { start: "later" })).json();
  assert.equal(back.start, "later");
  assert.equal((await post(`/api/items/${item.id}/start`, { start: "soon" })).status, 400);
  await store.resolve(item.id, { status: "done" });
  assert.equal((await post(`/api/items/${item.id}/start`, {})).status, 404); // only open items can be queued
});

test("archive one finished item, or clear all finished ones", async () => {
  const a = await store.create({ prompt: "done one", anchor: {} });
  const b = await store.create({ prompt: "done two", anchor: {} });
  const open = await store.create({ prompt: "still open", anchor: {} });
  await store.resolve(a.id, { status: "done" });
  await store.resolve(b.id, { status: "wontfix" });
  assert.equal((await post(`/api/items/${open.id}/archive`, {})).status, 404); // only finished items
  assert.equal((await (await post(`/api/items/${a.id}/archive`, {})).json()).location, "done");
  const { archived } = await (await post("/api/prune", {})).json();
  assert.ok(archived.includes(b.id));
  assert.ok(!archived.includes(open.id));
  assert.equal((await store.get(open.id)).location, "items");
});
