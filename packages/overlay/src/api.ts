import type { Item } from "./types.js";

/** A coding-agent session running /ahemui:watch, ready to pick up "Start now" items. */
export interface Watcher {
  state: "waiting" | "working";
  since: string;
  item?: string;
  by?: string;
  /** Which coding agent is watching ("claude-code", "codex"…). */
  agent?: string;
  /** Paused from the browser: Start-now items wait until resumed. */
  paused?: boolean;
  /** Stop requested from the browser: the watch ends after the current item. */
  stopping?: boolean;
}

export interface Health {
  build?: string;
  /** Base URL of this ahemui serve; its board lives at `${base}/`. */
  base?: string;
  watcher?: Watcher | null;
  /** The project's configured coding agent, when set. */
  agent?: string;
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
    if (!res.ok) throw new Error(explainError(res.status, data.error));
    return data;
  }

  async fileSrc(id: string, name: string): Promise<string> {
    return `${this.base}/api/items/${id}/file/${encodeURIComponent(name)}?v=${Date.now()}`;
  }
}

/**
 * A server's own "not found" (as opposed to "no item matching …") means the endpoint doesn't exist: the page's
 * AhemUI is newer than the dev server's, which happens until the dev server is restarted after an update.
 */
export function explainError(status: number, error: string | undefined): string {
  if (status === 404 && error === "not found") return "This dev server runs an older AhemUI than the page. Restart the dev server, then reload.";
  return error ?? `HTTP ${status}`;
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
