import { watch } from "node:fs";
import { join } from "node:path";
import { type Item, type SnapStore, workOrder } from "@snap/core";

const pendingNow = async (store: SnapStore) =>
  workOrder(await store.list({ status: ["open"], start: "now", needsReply: false })).filter((it) => !it.claimed_by);

/**
 * Blocks until someone presses "Start now" in the browser, then returns those items (oldest first).
 * While waiting it advertises itself in .snap/.watcher.json so the overlay can tell the person Claude is listening.
 * Resolves with [] on timeout.
 */
export async function waitForStartNow(store: SnapStore, by: string, timeoutMs = 0): Promise<Item[]> {
  const ready = await pendingNow(store);
  if (ready.length) return claimWatch(store, by, ready);

  await store.setWatcher({ state: "waiting", pid: process.pid, by });
  const stop = () => store.setWatcher(null).finally(() => process.exit(130));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const items = await new Promise<Item[]>((resolve) => {
    let debounce: NodeJS.Timeout | undefined;
    const check = async () => {
      const found = await pendingNow(store).catch(() => []);
      if (found.length) finish(found);
    };
    const fsWatcher = watch(join(store.dir, "items"), { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(check, 150);
    });
    const poll = setInterval(check, 5_000); // belt and braces: fs events can be missed on network drives
    const timer = timeoutMs ? setTimeout(() => finish([]), timeoutMs) : undefined;
    function finish(found: Item[]) {
      fsWatcher.close();
      clearInterval(poll);
      clearTimeout(timer);
      clearTimeout(debounce);
      resolve(found);
    }
  });

  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  if (!items.length) {
    await store.setWatcher(null);
    return [];
  }
  return claimWatch(store, by, items);
}

/** Flip presence to "working" so the overlay says Claude is busy rather than gone. */
async function claimWatch(store: SnapStore, by: string, items: Item[]): Promise<Item[]> {
  await store.setWatcher({ state: "working", pid: process.pid, by, item: items[0].id });
  return items;
}
