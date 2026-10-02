import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { AhemStore } from "../src/store.js";

let root: string;
let store: AhemStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ahemui-"));
  store = await AhemStore.init(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

test("create writes a readable markdown item with screenshot", async () => {
  const it = await store.create(
    { prompt: "Make the CTA full width", route: "/pricing", anchor: { source: "src/Pricing.vue:42", text: "Start" } },
    { data: Buffer.from("fake"), ext: "webp" },
  );
  assert.equal(it.status, "open");
  const md = await readFile(join(root, ".ahemui/items", it.id, "item.md"), "utf8");
  assert.match(md, /^---\nid: /);
  assert.match(md, /source: src\/Pricing.vue:42/);
  assert.match(md, /\n---\n\nMake the CTA full width\n$/);
  assert.ok(existsSync(store.shotPath(it)!));

  const again = await store.get(it.id.slice(0, 12));
  assert.deepEqual(again, it);
});

test("claim, note, resolve, prune, reopen lifecycle", async () => {
  const a = await store.create({ prompt: "a", anchor: {} });
  const b = await store.create({ prompt: "b", anchor: {} });

  await store.claim(a.id, "alice");
  await assert.rejects(store.claim(a.id, "bob"), /already claimed by alice/);

  await store.addNote(a.id, "alice", "used flex instead");
  const done = await store.resolve(a.id, { sha: "abc123", status: "done" });
  assert.equal(done.status, "done");
  assert.equal(done.resolved_by, "abc123");
  assert.match(done.body, /### Note — alice.*\n\nused flex instead$/);

  const { moved } = await store.prune();
  assert.deepEqual(moved.map((m) => m.id), [a.id]);
  assert.deepEqual((await store.list()).map((m) => m.id), [b.id]);
  assert.equal((await store.list({ includeDone: true })).length, 2);
  assert.equal((await store.get(a.id)).location, "done");

  const back = await store.reopen(a.id);
  assert.equal(back.location, "items");
  assert.equal(back.status, "open");
  assert.equal(back.claimed_by, null);
});

test("ids sort by creation and prefixes must be unique", async () => {
  const a = await store.create({ prompt: "a", anchor: {} });
  await new Promise((r) => setTimeout(r, 2));
  const b = await store.create({ prompt: "b", anchor: {} });
  assert.deepEqual((await store.list()).map((i) => i.id), [a.id, b.id]);
  await assert.rejects(store.get(""), /ambiguous/);
  await assert.rejects(store.get("ZZZZ"), /no item/);
});

test("find walks up to the repo root", async () => {
  const { mkdir } = await import("node:fs/promises");
  const nested = join(root, "src", "deep");
  await mkdir(nested, { recursive: true });
  assert.equal(AhemStore.find(nested).root, root);
});

test("absolute source paths become repo-relative", async () => {
  const abs = join(root, "src", "components", "Card.vue").split("\\").join("/");
  const it = await store.create({
    prompt: "x",
    anchor: { source: `${abs}:12` },
    elements: [{ tag: "button", source: `/@fs/${abs.replace(/^\//, "")}:3:5` }, { tag: "p", source: "/elsewhere/x.vue" }],
  });
  assert.equal(it.anchor.source, "src/components/Card.vue:12");
  assert.equal(it.elements![0].source, "src/components/Card.vue:3:5");
  assert.equal(it.elements![1].source, "/elsewhere/x.vue");

  const withPage = await store.create({ prompt: "y", page: { pageFile: `${abs}` }, anchor: {} });
  assert.equal(withPage.page?.pageFile, "src/components/Card.vue");
});

test("triage sets and clears classification; filters and work order use it", async () => {
  const { workOrder } = await import("../src/store.js");
  const nav = await store.create({ prompt: "nav spacing", route: "/", page: { routePattern: "/", landmark: "nav" }, anchor: {} });
  const card = await store.create({ prompt: "card copy", route: "/pricing", type: "copy", page: { routeName: "pricing", routePattern: "/pricing", section: "Pro" }, anchor: {} });
  const prod = await store.create({ prompt: "broken price", route: "/pricing", url: "https://app.example.com/pricing", anchor: {} });

  assert.equal(card.type, "copy");
  assert.equal(card.page?.section, "Pro");
  assert.deepEqual((await store.list({ untriaged: true })).map((i) => i.id), [nav.id, card.id, prod.id]);

  await store.triage(nav.id, { type: "layout", area: "Global › Nav bar", labels: ["mobile"] });
  await store.triage(card.id, { area: "Pricing › Plan cards" });
  await store.triage(prod.id, { type: "bug", area: "Pricing › Plan cards", priority: "high", labels: ["prod"] });
  await assert.rejects(store.triage(nav.id, { type: "nonsense" as any }));

  assert.deepEqual((await store.list({ untriaged: true })).length, 0);
  assert.deepEqual((await store.list({ area: "pricing" })).map((i) => i.id), [card.id, prod.id]);
  assert.deepEqual((await store.list({ label: "mobile" })).map((i) => i.id), [nav.id]);
  assert.deepEqual((await store.list({ route: "/pricing" })).map((i) => i.id), [card.id, prod.id]);
  assert.deepEqual((await store.list({ type: "bug" })).map((i) => i.id), [prod.id]);

  // high priority first, then grouped by page
  assert.deepEqual(workOrder(await store.list()).map((i) => i.id), [prod.id, nav.id, card.id]);

  const cleared = await store.triage(prod.id, { priority: null, labels: null });
  assert.equal(cleared.priority, undefined);
  assert.equal(cleared.labels, undefined);
  assert.doesNotMatch(await readFile(join(root, ".ahemui/items", prod.id, "item.md"), "utf8"), /priority:/);
});

test("start-now items jump the queue", async () => {
  const { workOrder } = await import("../src/store.js");
  const high = await store.create({ prompt: "high", route: "/a", anchor: {} });
  await store.triage(high.id, { priority: "high" });
  const now = await store.create({ prompt: "now", route: "/b", start: "now", anchor: {} });
  assert.deepEqual(workOrder(await store.list()).map((i) => i.id), [now.id, high.id]);
  assert.deepEqual((await store.list({ start: "now" })).map((i) => i.id), [now.id]);
});

test("watcher presence: waiting needs a live process, working expires", async () => {
  assert.equal(await store.watcher(), null);
  await store.setWatcher({ state: "waiting", pid: process.pid, by: "me" });
  assert.equal((await store.watcher())?.state, "waiting");
  assert.match(await readFile(join(root, ".ahemui/.gitignore"), "utf8"), /\.watcher\.json/);
  await store.setWatcher({ state: "waiting", pid: 999_999_999, by: "gone" });
  assert.equal(await store.watcher(), null);
  await store.setWatcher({ state: "working", pid: 999_999_999, item: "X" });
  assert.equal((await store.watcher())?.state, "working");
  await store.setWatcher(null);
  assert.equal(await store.watcher(), null);
});

test("tracker config and item links", async () => {
  const cfg = await store.setTracker({ kind: "linear", target: "Linear team ENG", labels: ["ahemui"] });
  assert.equal(cfg.tracker?.sync, "manual");
  assert.equal((await store.config()).tracker?.target, "Linear team ENG");
  const it = await store.create({ prompt: "x", anchor: {} });
  const linked = await store.link(it.id, { tracker: "linear", key: "ENG-7", url: "https://linear.app/x/ENG-7" });
  assert.equal(linked.external?.key, "ENG-7");
  assert.ok(linked.external?.synced);
  assert.deepEqual((await store.list({ linked: true })).map((i) => i.id), [it.id]);
  assert.equal((await store.link(it.id, null)).external, undefined);
  await store.setTracker(null);
  assert.equal((await store.config()).tracker, undefined);
});

test("batches: review items never start now and are left out of the action queue", async () => {
  const review = await store.createBatch({ name: "Home review · 28 Sep", intent: "review", author: "anna" });
  const changes = await store.createBatch({ name: "Home changes · 28 Sep", intent: "action", author: "me" });
  const flagged = await store.create({ prompt: "is this copy right?", start: "now", batch: review.id, anchor: {} });
  assert.equal(flagged.intent, "review");
  assert.equal(flagged.start, "later");
  const todo = await store.create({ prompt: "make it bigger", batch: changes.name, anchor: {} });
  assert.equal(todo.batch, changes.id);
  assert.equal(todo.intent, undefined);
  const ghost = await store.create({ prompt: "no such batch", batch: "nope", anchor: {} });
  assert.equal(ghost.batch, undefined);

  const actionable = (await store.list({ status: ["open"], intent: "action" })).map((i) => i.id);
  assert.ok(actionable.includes(todo.id) && !actionable.includes(flagged.id));
  assert.deepEqual((await store.list({ batch: review.id })).map((i) => i.id), [flagged.id]);
  assert.equal((await store.findBatch("home REVIEW · 28 sep"))?.id, review.id);
  assert.equal((await store.listBatches()).length, 2);
});

test("watcher heartbeat: a waiting watcher that stopped beating is gone", async () => {
  await store.setWatcher({ state: "waiting", pid: process.pid, by: "me" });
  await store.heartbeat();
  assert.equal((await store.watcher())?.state, "waiting");
  const file = join(root, ".ahemui/.watcher.json");
  const w = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...w, beat: new Date(Date.now() - 5 * 60_000).toISOString() }));
  assert.equal(await store.watcher(), null);
  // Legacy records without a beat still count while recent, but not after 6 hours.
  await writeFile(file, JSON.stringify({ state: "waiting", pid: process.pid, since: new Date(Date.now() - 7 * 3600_000).toISOString() }));
  assert.equal(await store.watcher(), null);
  await store.setWatcher(null);
});

test("restore undoes an archive and a resolve", async () => {
  const it = await store.create({ prompt: "tidy the footer", anchor: {} });
  await store.resolve(it.id, { status: "wontfix", note: "not now" });
  await store.archive(it.id);
  assert.equal((await store.get(it.id)).location, "done");
  const back = await store.restore(it.id, "open");
  assert.equal(back.location, "items");
  assert.equal(back.status, "open");
});

test("keepArchivedDays in config drops old archived screenshots when archiving", async () => {
  const file = join(root, ".ahemui", "config.json");
  const cfg = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...cfg, screenshot: { ...cfg.screenshot, keepArchivedDays: 0 } }));
  const it = await store.create({ prompt: "old one", anchor: {} }, { data: Buffer.from("RIFF0000WEBP"), ext: "webp" });
  await store.resolve(it.id, { status: "done" });
  const { shotsDropped } = await store.prune();
  assert.equal(shotsDropped, 1);
  assert.equal((await store.get(it.id)).shot, undefined);
  assert.deepEqual(await store.screenshotBytes(), { items: 0, done: 0 });
});

test("dismiss takes an item off the backlog into the archive, and restore brings it back", async () => {
  const it = await store.create({ prompt: "obsolete idea", start: "now", anchor: {} });
  const gone = await store.dismiss(it.id, "me");
  assert.equal(gone.status, "wontfix");
  assert.equal(gone.location, "done");
  assert.match(gone.body, /Dismissed from the backlog/);
  assert.equal((await store.list()).some((i) => i.id === it.id), false);
  const back = await store.restore(it.id, "open");
  assert.equal(back.location, "items");
  assert.equal(back.status, "open");
});
