import { watch } from "node:fs";
import { join } from "node:path";
import { type Item, type AhemStore, workOrder } from "@ahemui/core";

const pendingNow = async (store: AhemStore) =>
  workOrder(await store.list({ status: ["open"], start: "now", needsReply: false })).filter((it) => !it.claimed_by);

/**
 * Blocks until someone presses "Start now" in the browser, then returns those items (oldest first).
 * While waiting it advertises itself in .ahemui/.watcher.json so the overlay can tell the person the agent is listening.
 * The browser can pause (Start-now items wait until resumed) or stop the watch through .ahemui/.watch-control.json.
 * Resolves with [] on timeout and "stopped" when the person stopped the watch.
 */
export async function waitForStartNow(store: AhemStore, by: string, timeoutMs = 0, agent?: string): Promise<Item[] | "stopped"> {
  const control = await store.watchControl();
  if (control?.mode === "stop") return stopped(store);
  const ready = control?.mode === "paused" ? [] : await pendingNow(store);
  if (ready.length) return claimWatch(store, by, ready, agent);

  await store.setWatcher({ state: "waiting", pid: process.pid, by, agent });
  const stop = () => store.setWatcher(null).finally(() => process.exit(130));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const result = await new Promise<Item[] | "stopped">((resolve) => {
    let debounce: NodeJS.Timeout | undefined;
    const check = async () => {
      const c = await store.watchControl();
      if (c?.mode === "stop") return finish("stopped");
      if (c?.mode === "paused") return;
      const found = await pendingNow(store).catch(() => []);
      if (found.length) finish(found);
    };
    const soon = () => {
      clearTimeout(debounce);
      debounce = setTimeout(check, 150);
    };
    const itemsWatcher = watch(join(store.dir, "items"), { recursive: true }, soon);
    const controlWatcher = watch(store.dir, (_event, file) => file === ".watch-control.json" && soon());
    const poll = setInterval(check, 5_000); // belt and braces: fs events can be missed on network drives
    const beat = setInterval(() => store.heartbeat().catch(() => {}), 30_000);
    const timer = timeoutMs ? setTimeout(() => finish([]), timeoutMs) : undefined;
    function finish(found: Item[] | "stopped") {
      itemsWatcher.close();
      controlWatcher.close();
      clearInterval(poll);
      clearInterval(beat);
      clearTimeout(timer);
      clearTimeout(debounce);
      resolve(found);
    }
  });

  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  if (result === "stopped") return stopped(store);
  if (!result.length) {
    await store.setWatcher(null);
    return [];
  }
  return claimWatch(store, by, result, agent);
}

/** The stop request is used up: presence and the request are cleared so the next /ahemui:watch starts fresh. */
async function stopped(store: AhemStore): Promise<"stopped"> {
  await store.setWatcher(null);
  await store.setWatchControl(null);
  return "stopped";
}

/** Flip presence to "working" so the overlay says the agent is busy rather than gone. */
async function claimWatch(store: AhemStore, by: string, items: Item[], agent?: string): Promise<Item[]> {
  await store.setWatcher({ state: "working", pid: process.pid, by, agent, item: items[0].id });
  return items;
}
