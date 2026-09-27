import type { Item } from "./types.js";

/** A Claude session running /ahemui:watch, ready to pick up "Start now" items. */
export interface Watcher {
  state: "waiting" | "working";
  since: string;
  item?: string;
  by?: string;
}

export interface Health {
  build?: string;
  /** Base URL of this ahemui serve; its board lives at `${base}/`. */
  base?: string;
  watcher?: Watcher | null;
  project?: string;
  branch?: string | null;
  root: string;
  maxBytes: number;
}

/** How the overlay reaches `ahemui serve`: directly (Vite-injected) or through the extension's service worker. */
export interface Transport {
  /** Starts connecting and keeps delivering item snapshots; `onState(null)` means disconnected. */
  start(onItems: (items: Item[], watcher?: Watcher | null) => void, onState: (health: Health | null) => void): void;
  request<T = any>(method: string, path: string, body?: unknown): Promise<T>;
  /** Something an <img> can load for one of the item's image files (screenshot, extra areas, after-shot). */
  fileSrc(id: string, name: string): Promise<string>;
}

/** Talks to ahemui serve from the page itself. Used by the Vite-injected overlay, whose origin the server allows. */
export class DirectTransport implements Transport {
  private base: string | null = null;
  private retry = 0;
  private onItems!: (items: Item[], watcher?: Watcher | null) => void;
  private onState!: (health: Health | null) => void;

  constructor(private candidates: () => string[]) {}

  start(onItems: (items: Item[], watcher?: Watcher | null) => void, onState: (health: Health | null) => void) {
    this.onItems = onItems;
    this.onState = onState;
    this.connect();
  }

  private async connect() {
    for (const base of this.candidates()) {
      const health = await probe(base);
      if (health) {
        this.base = base;
        return this.openSocket(health);
      }
    }
    this.onState(null);
    setTimeout(() => this.connect(), Math.min(15_000, 2_000 * ++this.retry));
  }

  private openSocket(health: Health) {
    const ws = new WebSocket(this.base!.replace(/^http/, "ws") + "/ws");
    ws.onopen = () => {
      this.retry = 0;
      this.onState(health);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "items") this.onItems(msg.items, msg.watcher);
    };
    ws.onclose = () => {
      this.onState(null);
      setTimeout(() => this.connect(), 1_000);
    };
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.base) throw new Error("not connected to ahemui serve");
    const res = await fetch(this.base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }

  async fileSrc(id: string, name: string): Promise<string> {
    return `${this.base}/api/items/${id}/file/${encodeURIComponent(name)}?v=${Date.now()}`;
  }
}

async function probe(base: string): Promise<Health | null> {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.name === "ahemui" ? { ...data, base } : null;
  } catch {
    return null;
  }
}
