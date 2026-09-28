/** Personal overlay settings; mirrors PrefsSchema in @ahemui/core. */
export interface Prefs {
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  notifications: "off" | "page" | "desktop";
  enter: "now" | "backlog";
  markers: "all" | "active" | "none";
  /** ask: choose or name a batch when starting to capture; off: never ask. */
  batches: "ask" | "off";
  name?: string;
}

/** A named round of feedback; mirrors BatchSchema in @ahemui/core. */
export interface Batch {
  id: string;
  name: string;
  intent: "action" | "review";
  author: string;
  created: string;
}

export const DEFAULT_PREFS: Prefs = { position: "bottom-right", notifications: "desktop", enter: "now", markers: "all", batches: "ask" };

const CACHE_KEY = "ahemui:prefs";
const LEGACY_MARKER_KEY = "ahemui:markers";

/**
 * The last settings this browser saw, so the toolbar paints in the right corner before the server answers.
 * The server's copy (~/.ahemui/prefs.json) wins once connected.
 */
export function cachedPrefs(): Prefs {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (cached) return { ...DEFAULT_PREFS, ...cached };
    const markers = localStorage.getItem(LEGACY_MARKER_KEY);
    return markers === "active" || markers === "none" ? { ...DEFAULT_PREFS, markers } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function cachePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage blocked; the server copy still applies after connecting */
  }
}
