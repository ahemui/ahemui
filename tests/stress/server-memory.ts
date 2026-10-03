// Memory check for ahemui serve, which runs inside the Vite dev server for as long as it's up. Churns items,
// WebSocket clients and board exports, and prints heap and RSS after forced GCs. Run:
//   node --expose-gc --import tsx tests/stress/server-memory.ts [rounds]
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { AhemStore } from "../../packages/core/src/store.js";
import { serve } from "../../packages/cli/src/server.js";

const rounds = Number(process.argv[2] ?? 1500);
const root = await mkdtemp(join(tmpdir(), "ahemui-mem-"));
const store = await AhemStore.init(root);
const srv = await serve(store, { port: 0, log: () => {} });
const base = `http://127.0.0.1:${srv.port}`;
const SHOT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const post = (path: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

const sample = () => {
  for (let i = 0; i < 4; i++) (globalThis as any).gc();
  const m = process.memoryUsage();
  return { heapMB: m.heapUsed / 1_048_576, rssMB: m.rss / 1_048_576 };
};

async function round(i: number) {
  // A browser tab connects, gets the snapshot, and goes away (page reloads, HMR, tab closes).
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { Origin: "http://localhost:5173" } });
  await new Promise((r) => ws.once("message", r));
  const item = await post("/api/items", { prompt: `memory check ${i}`, route: "/", anchor: {}, shot: SHOT });
  await post(`/api/items/${item.id}/resolve`, { status: "review" });
  await post(`/api/items/${item.id}/review`, { verdict: "approved" });
  if (i % 3 === 0) await post(`/api/items/${item.id}/dismiss`, {});
  await fetch(`${base}/api/health`);
  ws.close();
  await new Promise((r) => ws.once("close", r));
  if (i % 50 === 49) await post("/api/prune", {}); // archive, as Clear finished does
}

for (let i = 0; i < 100; i++) await round(i); // warm up
const start = sample();
console.log(`start: heap ${start.heapMB.toFixed(1)} MB, rss ${start.rssMB.toFixed(0)} MB`);
for (let i = 100; i < 100 + rounds; i++) {
  await round(i);
  if ((i - 99) % 500 === 0) {
    const s = sample();
    console.log(`${i - 99} rounds: heap ${s.heapMB.toFixed(1)} MB, rss ${s.rssMB.toFixed(0)} MB`);
  }
}
await new Promise((r) => setTimeout(r, 2000)); // let the debounced backlog.html export settle
const end = sample();
console.log(`end: heap ${end.heapMB.toFixed(1)} MB (${(end.heapMB - start.heapMB).toFixed(1)} MB), rss ${end.rssMB.toFixed(0)} MB`);
await srv.close();
await rm(root, { recursive: true, force: true });
