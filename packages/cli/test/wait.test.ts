import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { SnapStore } from "@snap/core";

const CLI = resolve(import.meta.dirname, "../dist/index.js"); // built by `npm run build`
let root: string;
let store: SnapStore;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "snap-wait-"));
  store = await SnapStore.init(root);
});
after(() => rm(root, { recursive: true, force: true }));

function runWait(args: string[] = []) {
  const child = spawn(process.execPath, [CLI, "wait", ...args], { cwd: root, env: { ...process.env, SNAP_AUTHOR: "tester" } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const done = new Promise<{ code: number | null; out: string }>((r) => child.on("exit", (code) => r({ code, out })));
  return { child, done };
}

async function until(cond: () => Promise<boolean>, ms = 10_000) {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("wait advertises presence, ignores queued items and wakes on Start now", async () => {
  const { done } = runWait();
  await until(async () => (await store.watcher())?.state === "waiting");

  await store.create({ prompt: "just queue this", anchor: {} });
  await new Promise((r) => setTimeout(r, 600));
  const now = await store.create({ prompt: "do it now", route: "/pricing", start: "now", anchor: {} });

  const { code, out } = await done;
  assert.equal(code, 0);
  assert.match(out, new RegExp(`^START ${now.id} /pricing — do it now`, "m"));
  assert.doesNotMatch(out, /just queue this/);
  assert.equal((await store.watcher())?.state, "working");
});

test("wait returns immediately when start-now items are pending, and times out otherwise", async () => {
  const first = await runWait().done;
  assert.equal(first.code, 0); // the unclaimed start-now item from the previous test is still open
  const all = await store.list({ start: "now" });
  for (const it of all) await store.claim(it.id, "someone");
  const timed = await runWait(["--timeout", "1"]).done;
  assert.equal(timed.code, 3);
  assert.equal(await store.watcher(), null);
});
