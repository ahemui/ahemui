import assert from "node:assert/strict";
import { request } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { SnapStore } from "@snap/core";
import { exportBoard } from "../src/board.js";
import { serve } from "../src/server.js";

let root: string;
let store: SnapStore;
let srv: Awaited<ReturnType<typeof serve>>;
let base: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "snap-board-"));
  store = await SnapStore.init(root);
  srv = await serve(store, { port: 0, log: () => {} });
  base = `http://127.0.0.1:${srv.port}`;
});
after(async () => {
  await srv.close();
  await rm(root, { recursive: true, force: true });
});

/** fetch() can't set Host, so use http.request for the rebinding check. */
function withHost(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv.port, path: "/api/health", headers: { Host: host } }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on("error", reject);
    req.end();
  });
}

test("serves the live board and lets it call the API from its own origin", async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /window\.__SNAP_BOARD__ = \{"mode":"live"\}/);
  assert.match(html, /<title>Snap backlog/);
  const ok = await fetch(`${base}/api/items`, { headers: { Origin: base } });
  assert.equal(ok.status, 200);
  const other = await fetch(`${base}/api/items`, { headers: { Origin: "http://127.0.0.1:9" } });
  assert.equal(other.status, 403);
});

test("rejects requests whose Host isn't loopback (DNS rebinding)", async () => {
  assert.equal(await withHost(`127.0.0.1:${srv.port}`), 200);
  assert.equal(await withHost(`localhost:${srv.port}`), 200);
  assert.equal(await withHost("evil.example:4777"), 403);
});

test("triage endpoint sets and clears classification", async () => {
  const it = await store.create({ prompt: "x", anchor: {} });
  const post = (body: unknown) =>
    fetch(`${base}/api/items/${it.id}/triage`, { method: "POST", headers: { Origin: base }, body: JSON.stringify(body) }).then((r) => r.json());
  const set = await post({ type: "copy", priority: "high", area: "Home › Hero", labels: ["mobile"] });
  assert.deepEqual([set.type, set.priority, set.area, set.labels], ["copy", "high", "Home › Hero", ["mobile"]]);
  const cleared = await post({ priority: null, labels: null });
  assert.equal(cleared.priority, undefined);
  assert.equal(cleared.labels, undefined);
  assert.equal(cleared.type, "copy");
});

test("snapshot export: self-contained, relative screenshots, git-ignored, kept up to date by serve", async () => {
  const png = { data: Buffer.from("png"), ext: "png" as const };
  const it = await store.create({ prompt: "Snapshot </script><script>alert(1)</script>", anchor: {} }, png);

  const file = await exportBoard(store);
  assert.equal(file, join(root, ".snap", "backlog.html"));
  const html = await readFile(file, "utf8");
  assert.match(html, /"mode":"static"/);
  assert.match(html, /"base":""/);
  assert.ok(html.includes(it.id));
  assert.ok(!html.includes("</script><script>alert(1)"), "item text must not be able to close the script tag");

  const elsewhere = await exportBoard(store, join(root, "docs", "..", "backlog-copy.html"));
  assert.match(await readFile(elsewhere, "utf8"), /"base":".snap"/);

  assert.match(await readFile(join(root, ".snap", ".gitignore"), "utf8"), /^backlog\.html$/m);

  // serve re-exports shortly after a change on disk
  const { rm: remove } = await import("node:fs/promises");
  await remove(file);
  await store.create({ prompt: "trigger export", anchor: {} });
  for (let i = 0; i < 40 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(existsSync(file));
});
