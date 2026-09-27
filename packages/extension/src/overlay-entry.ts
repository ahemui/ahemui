// Isolated-world content script. Page scripts can't see or call into this world, so a site you enable AhemUI on
// (including production) can't read your backlog or talk to your local ahemui serve.
import type { Health, Transport, Watcher } from "../../overlay/src/api.js";
import { cropToDataUrl, loadImage } from "../../overlay/src/crop.js";
import { startOverlay } from "../../overlay/src/overlay.js";
import type { Item } from "../../overlay/src/types.js";
import { agent } from "../../overlay/src/agent.js";
import type { Reply } from "./messages.js";

declare const __AHEMUI_BUILD__: string | undefined;
const BUILD = typeof __AHEMUI_BUILD__ === "string" ? __AHEMUI_BUILD__ : "dev";

// Announce this extension and its build before any page script runs. A Vite-injected overlay from the same build
// stands down in favour of this one (real screenshots, notifications); from a different build it takes over, so a
// stale unpacked extension can never shadow the project's current AhemUI.
document.documentElement.setAttribute("data-ahemui-ext", BUILD);

async function send<T = any>(msg: Record<string, unknown>): Promise<T> {
  const reply: Reply<T> = await chrome.runtime.sendMessage(msg);
  if (!reply) throw new Error("AhemUI extension did not answer");
  if ("error" in reply) throw new Error(reply.error);
  return reply.data;
}

/** All traffic goes through the service worker, which owns the connection to the chosen project's server. */
class ExtensionTransport implements Transport {
  private onItems!: (items: Item[], watcher?: Watcher | null) => void;
  private onState!: (health: Health | null) => void;

  start(onItems: (items: Item[], watcher?: Watcher | null) => void, onState: (health: Health | null) => void) {
    this.onItems = onItems;
    this.onState = onState;
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "items") onItems(msg.items, msg.watcher);
      else if (msg?.type === "disconnected") onState(null);
      else if (msg?.type === "project-changed") this.subscribe();
    });
    this.subscribe();
    // Re-subscribing periodically recovers from service worker restarts and servers coming and going.
    setInterval(() => this.subscribe(), 15_000);
  }

  private async subscribe() {
    try {
      const { health, items } = await send<{ health: Health | null; items?: Item[] }>({ type: "subscribe" });
      this.onState(health);
      if (items) this.onItems(items);
    } catch {
      this.onState(null);
    }
  }

  request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return send<T>({ type: "api", method, path, body });
  }

  fileSrc(id: string, name: string): Promise<string> {
    return send<string>({ type: "file", id, name });
  }
}

// Claim the page only once the document has parsed, i.e. after any injected overlay has had its say.
const start = () => startOverlay({
  mode: "ext",
  transport: new ExtensionTransport(),
  agent,
  disconnectedHint: "No AhemUI project for this site. Click the AhemUI toolbar icon to pick one (and check ahemui serve is running).",
  capture: async (rect, strokes, masks, maxBytes, hide) => {
    const show = await hide();
    let dataUrl: string;
    try {
      dataUrl = await send<string>({ type: "capture" });
    } finally {
      show();
    }
    const img = await loadImage(dataUrl);
    return cropToDataUrl(img, img.naturalWidth / innerWidth, rect, strokes, maxBytes, [0, 0], masks);
  },
  // The service worker shows the notification, so several open tabs don't each pop one.
  notify: (title, body, tag) => void send({ type: "notify", title, body, tag, url: location.href }).catch(() => {}),
  onToggle: (toggle) =>
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "toggle") toggle();
    }),
});
if (document.readyState === "loading") addEventListener("DOMContentLoaded", start, { once: true });
else start();
