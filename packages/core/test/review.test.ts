import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { SnapStore, workOrder } from "../src/store.js";

let root: string;
let store: SnapStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "snap-review-"));
  store = await SnapStore.init(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

test("review loop: resolve → review, approve → done, changes → open with feedback", async () => {
  const it = await store.create({ prompt: "tighten padding", anchor: {} });
  await store.claim(it.id, "Claude");
  const inReview = await store.resolve(it.id, { note: "Reduced padding to --space-3" });
  assert.equal(inReview.status, "review");

  const back = await store.review(it.id, "pietari", "changes", "Still too loose on mobile");
  assert.equal(back.status, "open");
  assert.equal(back.claimed_by, null);
  assert.equal(back.review?.verdict, "changes");
  assert.match(back.body, /### Feedback — pietari.*\n\nStill too loose on mobile$/);

  await store.resolve(it.id, { note: "Mobile too" });
  const ok = await store.review(it.id, "pietari", "approved");
  assert.equal(ok.status, "done");
  assert.equal(ok.review?.verdict, "approved");

  // With review turned off, resolving goes straight to done.
  const raw = JSON.parse(await readFile(join(root, ".snap/config.json"), "utf8"));
  await writeFile(join(root, ".snap/config.json"), JSON.stringify({ ...raw, review: false }));
  const it2 = await store.create({ prompt: "x", anchor: {} });
  assert.equal((await store.resolve(it2.id)).status, "done");
});

test("questions: ask releases the item until the requester replies", async () => {
  const it = await store.create({ prompt: "make it pop", start: "now", anchor: {} });
  await store.claim(it.id, "Claude");
  const asked = await store.ask(it.id, "Claude", "Pop how: colour, size or animation?");
  assert.equal(asked.status, "open");
  assert.equal(asked.needs_reply, true);
  assert.equal(asked.claimed_by, null);
  assert.equal((await store.list({ status: ["open"], needsReply: false })).length, 0);

  const replied = await store.reply(it.id, "pietari", "Colour: use the brand accent");
  assert.equal(replied.needs_reply, undefined);
  assert.match(replied.body, /### Question — Claude.*\n\nPop how.*\n\n### Reply — pietari.*\n\nColour: use the brand accent$/s);
  assert.deepEqual(workOrder(await store.list({ status: ["open"], needsReply: false })).map((i) => i.id), [it.id]);
});

test("extra areas, after-shot, file access and screenshot housekeeping", async () => {
  const png = { data: Buffer.from("png"), ext: "png" as const };
  const it = await store.create(
    {
      prompt: "make these match",
      anchor: { source: "src/A.vue:1:1" },
      extras: [
        { role: "also", anchor: { source: "src/B.vue:2:1" } },
        { role: "reference", anchor: { text: "Nice button" }, styles: { computed: { color: "rgb(0, 0, 0)" } } },
      ],
    },
    png,
    [png, undefined],
  );
  assert.equal(it.extras?.[0].shot, "shot-2.png");
  assert.equal(it.extras?.[1].shot, undefined);
  assert.equal(it.extras?.[1].role, "reference");
  assert.deepEqual(store.files(it), ["shot.png", "shot-2.png"]);
  assert.throws(() => store.filePath(it, "../config.json"), /no file/);

  const withAfter = await store.setAfter(it.id, png);
  assert.equal(withAfter.after, "after.png");
  assert.ok(existsSync(store.filePath(withAfter, "after.png")));

  await store.resolve(it.id, { status: "done" });
  const { moved, shotsDropped } = await store.prune({ dropShotsOlderThanDays: 0 });
  assert.equal(moved.length, 1);
  assert.equal(shotsDropped, 3);
  const archived = await store.get(it.id);
  assert.equal(archived.shot, undefined);
  assert.equal(archived.after, undefined);
  assert.match(archived.body, /Screenshots removed when archiving/);

  await store.enableLfs();
  assert.match(await readFile(join(root, ".snap/.gitattributes"), "utf8"), /\*\.webp filter=lfs/);
});

test("clear empties the backlog (optionally the archive) but keeps the setup", async () => {
  const a = await store.create({ prompt: "a", anchor: {} });
  const b = await store.create({ prompt: "b", anchor: {} });
  await store.resolve(b.id, { status: "done" });
  await store.prune();
  assert.deepEqual(await store.clear(), [a.id]);
  assert.equal((await store.list({ includeDone: true })).length, 1); // archived b survives
  assert.deepEqual(await store.clear({ archive: true }), [b.id]);
  assert.equal((await store.list({ includeDone: true })).length, 0);
  assert.ok(existsSync(join(root, ".snap", "config.json")));
  assert.ok(existsSync(join(root, ".snap", ".gitignore")));
});
