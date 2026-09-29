/** Personal overlay settings; mirrors PrefsSchema in @ahemui/core. */
export interface Prefs {
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  notifications: "off" | "page" | "desktop";
  enter: "now" | "backlog";
  markers: "all" | "active" | "none";
  /** ask: choose or name a batch when starting to capture; off: never ask. */
  batches: "ask" | "off";
  /** Modifiers + KeyboardEvent.code, e.g. "Alt+Shift+KeyS". */
  shortcut: string;
  theme: "auto" | "dark" | "light";
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

export const DEFAULT_PREFS: Prefs = { position: "bottom-right", notifications: "desktop", enter: "now", markers: "all", batches: "ask", shortcut: "Alt+Shift+KeyS", theme: "dark" };

const CACHE_KEY = "ahemui:prefs";

/** True when the key event is the given shortcut ("Alt+Shift+KeyS"): exactly those modifiers, that key. */
export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+");
  const code = parts.pop();
  const mods = new Set(parts);
  return (
    e.code === code && e.ctrlKey === mods.has("Ctrl") && e.altKey === mods.has("Alt") && e.shiftKey === mods.has("Shift") && e.metaKey === mods.has("Meta")
  );
}

/** A key event as a shortcut string, or null for a lone modifier or a key without Ctrl/Alt/Meta. */
export function shortcutFromEvent(e: KeyboardEvent): string | null {
  if (/^(Control|Alt|Shift|Meta)/.test(e.code) || !(e.ctrlKey || e.altKey || e.metaKey)) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta"].filter(Boolean);
  return [...mods, e.code].join("+");
}

/** "Alt+Shift+KeyS" → "Alt+Shift+S" for people. */
export function shortcutLabel(shortcut: string): string {
  return shortcut.replace(/Key([A-Z])$/, "$1").replace(/Digit(\d)$/, "$1").replace(/Period$/, ".").replace(/Comma$/, ",").replace(/Slash$/, "/").replace(/Backquote$/, "`");
}
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
