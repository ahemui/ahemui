// Service worker: owns every connection to local `ahemui serve` instances, remembers which project each site
// sends feedback to, takes screenshots, and injects AhemUI into sites you enable (deployed dev, staging, prod).
import type { PopupState, Reply, Server } from "./messages.js";

const PORTS = Array.from({ length: 10 }, (_, i) => 4777 + i);
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost|.+\.test)$/;

// ——— storage: { projects: { [origin]: root | "none" }, sites: string[] } ———

async function getProjects(): Promise<Record<string, string>> {
  return ((await chrome.storage.local.get("projects")).projects as Record<string, string>) ?? {};
}
async function getSites(): Promise<string[]> {
  return ((await chrome.storage.local.get("sites")).sites as string[]) ?? [];
}

// ——— discovery ———

let scanCache: { at: number; servers: Promise<Server[]> } | undefined;

/** All running ahemui servers on 4777–4786 (cached for a few seconds). */
function scan(): Promise<Server[]> {
  if (scanCache && Date.now() - scanCache.at < 3000) return scanCache.servers;
  const servers = Promise.all(
    PORTS.map(async (port): Promise<Server | null> => {
      const base = `http://127.0.0.1:${port}`;
      try {
        const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(700) });
        const h = await res.json();
        return h?.name === "ahemui" ? { base, project: h.project, branch: h.branch, root: h.root, devOrigins: h.devOrigins ?? [], maxBytes: h.maxBytes, watcher: h.watcher ?? null } : null;
      } catch {
        return null;
      }
    }),
  ).then((list) => list.filter((s): s is Server => !!s));
  scanCache = { at: Date.now(), servers };
  return servers;
}

/** The project a site's feedback goes to: the explicit choice, else a server whose config lists the origin. */
async function resolveServer(origin: string): Promise<Server | null> {
  const choice = (await getProjects())[origin];
  if (choice === "none") return null;
  const servers = await scan();
  if (choice) return servers.find((s) => s.root === choice) ?? null;
  return servers.find((s) => s.devOrigins.includes(origin)) ?? null;
}

// ——— live updates: one WebSocket per server, fanned out to subscribed tabs ———

const tabServer = new Map<number, string>(); // tabId → base
const sockets = new Map<string, WebSocket>();

function ensureSocket(base: string) {
  if (sockets.has(base)) return;
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws");
  sockets.set(base, ws);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "items") notifyTabs(base, { type: "items", items: msg.items, watcher: msg.watcher });
  };
  ws.onclose = () => {
    sockets.delete(base);
    scanCache = undefined;
    notifyTabs(base, { type: "disconnected" });
  };
}

function notifyTabs(base: string, msg: unknown) {
  for (const [tabId, b] of tabServer) {
    if (b === base) chrome.tabs.sendMessage(tabId, msg).catch(() => tabServer.delete(tabId));
  }
}

chrome.tabs.onRemoved.addListener((tabId) => tabServer.delete(tabId));

// ——— messages from content scripts and the popup ———

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only our own extension pages and content scripts can reach this listener; web pages cannot.
  if (sender.id !== chrome.runtime.id) return;
  handle(msg, sender).then(
    (data) => sendResponse({ data } satisfies Reply<unknown>),
    (err) => sendResponse({ error: String(err?.message ?? err) } satisfies Reply<unknown>),
  );
  return true; // async response
});

async function handle(msg: any, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tabId = sender.tab?.id;
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined);

  switch (msg?.type) {
    case "subscribe": {
      if (tabId === undefined || !origin) throw new Error("not a tab");
      const server = await resolveServer(origin);
      if (!server) {
        tabServer.delete(tabId);
        return { health: null };
      }
      tabServer.set(tabId, server.base);
      ensureSocket(server.base);
      const items = await (await fetch(`${server.base}/api/items?all`)).json();
      return { health: server, items };
    }
    case "api": {
      const base = await serverForTab(tabId, origin);
      if (typeof msg.path !== "string" || !/^\/api\/(items|watch|prune|prefs)(\/|\?|$)/.test(msg.path)) throw new Error("bad path");
      const res = await fetch(base + msg.path, {
        method: msg.method,
        headers: { "Content-Type": "application/json" },
        body: msg.body === undefined ? undefined : JSON.stringify(msg.body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data;
    }
    case "file": {
      const base = await serverForTab(tabId, origin);
      const res = await fetch(`${base}/api/items/${encodeURIComponent(msg.id)}/file/${encodeURIComponent(msg.name)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return toDataUrl(await res.arrayBuffer(), res.headers.get("content-type") ?? "image/png");
    }
    case "notify": {
      // Same tag from several tabs → one notification (Chrome replaces by id).
      const id = `ahemui:${String(msg.tag).slice(0, 100)}`;
      notificationUrls.set(id, String(msg.url ?? ""));
      await chrome.notifications.create(id, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/128.png"),
        title: String(msg.title).slice(0, 100),
        message: String(msg.body).slice(0, 300),
      });
      return null;
    }
    case "capture": {
      if (!sender.tab) throw new Error("not a tab");
      return chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
    }
    case "popup-state":
      return popupState(msg.tabId);
    case "set-project": {
      const projects = await getProjects();
      if (msg.root === null) delete projects[msg.origin];
      else projects[msg.origin] = msg.root;
      await chrome.storage.local.set({ projects });
      await broadcastToOrigin(msg.origin, { type: "project-changed" });
      return popupState(msg.tabId);
    }
    case "set-enabled":
      await setEnabled(msg.origin, msg.enabled, msg.tabId);
      return popupState(msg.tabId);
    case "toggle":
      await chrome.tabs.sendMessage(msg.tabId, { type: "toggle" });
      return null;
    // Personal settings live in ~/.ahemui/prefs.json, which every server on this machine shares.
    case "get-prefs": {
      const base = await prefsServer(msg.tabId);
      if (!base) return null;
      return (await fetch(`${base}/api/prefs`)).json();
    }
    case "set-prefs": {
      const base = await prefsServer(msg.tabId);
      if (!base) throw new Error("start an AhemUI project to change settings");
      const res = await fetch(`${base}/api/prefs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg.patch ?? {}) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      for (const id of tabServer.keys()) chrome.tabs.sendMessage(id, { type: "prefs-changed" }).catch(() => {});
      return data;
    }
  }
  throw new Error(`unknown message ${msg?.type}`);
}

/** The server for the tab's site, else any running one: they all read the same prefs file. */
async function prefsServer(tabId: number | undefined): Promise<string | null> {
  const tab = tabId !== undefined ? await chrome.tabs.get(tabId).catch(() => undefined) : undefined;
  const origin = tab?.url && /^https?:/.test(tab.url) ? new URL(tab.url).origin : undefined;
  const server = (origin ? await resolveServer(origin) : null) ?? (await scan())[0];
  return server?.base ?? null;
}

async function serverForTab(tabId: number | undefined, origin: string | undefined): Promise<string> {
  const known = tabId !== undefined ? tabServer.get(tabId) : undefined;
  if (known) return known;
  const server = origin ? await resolveServer(origin) : null;
  if (!server) throw new Error("no AhemUI project selected for this site");
  return server.base;
}

// ——— popup ———

async function popupState(tabId: number): Promise<PopupState> {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ? new URL(tab.url) : null;
  const servers = await scan();
  if (!url || !/^https?:$/.test(url.protocol)) {
    return { origin: null, servers, choice: null, active: null, builtIn: false, enabled: false };
  }
  const origin = url.origin;
  const builtIn = LOCAL.test(url.hostname);
  return {
    origin,
    servers,
    choice: (await getProjects())[origin] ?? null,
    active: await resolveServer(origin),
    builtIn,
    enabled: builtIn || (await getSites()).includes(origin),
  };
}

async function broadcastToOrigin(origin: string, msg: unknown) {
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id !== undefined && tab.url && new URL(tab.url).origin === origin) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

// ——— enabling AhemUI on non-local sites ———

function scriptIds(origin: string) {
  const key = origin.replace(/[^a-z0-9]/gi, "_");
  return { overlay: `ahemui-overlay-${key}`, probe: `ahemui-agent-${key}` };
}

async function setEnabled(origin: string, enabled: boolean, tabId: number) {
  const sites = new Set(await getSites());
  const ids = scriptIds(origin);
  const matches = [`${new URL(origin).protocol}//${new URL(origin).hostname}/*`];
  await chrome.scripting.unregisterContentScripts({ ids: [ids.overlay, ids.probe] }).catch(() => {});
  if (enabled) {
    sites.add(origin);
    await chrome.scripting.registerContentScripts([
      { id: ids.overlay, matches, js: ["overlay.js"], runAt: "document_start", persistAcrossSessions: true },
      { id: ids.probe, matches, js: ["page-agent.js"], runAt: "document_start", world: "MAIN", persistAcrossSessions: true },
    ]);
    // Start right away on the open tab; the overlay ignores a second injection.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["overlay.js"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["page-agent.js"], world: "MAIN" });
  } else {
    sites.delete(origin);
    chrome.tabs.reload(tabId);
  }
  await chrome.storage.local.set({ sites: [...sites] });
}

const notificationUrls = new Map<string, string>();

/** Clicking a notification brings the page (or a new tab with it) to the front. */
chrome.notifications.onClicked.addListener(async (id) => {
  const url = notificationUrls.get(id);
  chrome.notifications.clear(id);
  if (!url) return;
  const key = (u: string) => new URL(u).origin + new URL(u).pathname;
  const tab = (await chrome.tabs.query({})).find((t) => t.url && key(t.url) === key(url));
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "toggle-capture" && tab?.id !== undefined) chrome.tabs.sendMessage(tab.id, { type: "toggle" }).catch(() => {});
});

function toDataUrl(buf: ArrayBuffer, type: string): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}
