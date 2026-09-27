// Injected by the Vite plugin; works in any browser, including the Claude desktop app's built-in one.
import { domToCanvas } from "modern-screenshot";
import { agent, installAgent } from "./agent.js";
import { DirectTransport } from "./api.js";
import { cropToDataUrl } from "./crop.js";
import { startOverlay } from "./overlay.js";

// Normally already running from the early <head> script the Vite plugin adds; installing twice is a no-op.
installAgent();

declare global {
  interface Window {
    __AHEMUI__?: { server: string };
  }
}

// The extension, when installed, marks the page at document_start and brings its own overlay (real screenshots,
// project picker, notifications), so the injected one stands down.
declare const __AHEMUI_BUILD__: string | undefined;
const BUILD = typeof __AHEMUI_BUILD__ === "string" ? __AHEMUI_BUILD__ : "dev";
const extBuild = document.documentElement.getAttribute("data-ahemui-ext");

// Defer to the extension only when it's the same AhemUI build as this project; otherwise this overlay runs, and a
// newer extension (or an older one that already claimed the page) is told apart by the build check in the toolbar.
if (extBuild === null || extBuild !== BUILD) {
  startOverlay({
    mode: "inject",
    transport: new DirectTransport(() => (window.__AHEMUI__?.server ? [window.__AHEMUI__.server] : [])),
    agent,
    disconnectedHint: "Not connected to ahemui serve. Is the Vite dev server still running?",
    capture: async (rect, strokes, masks, maxBytes) => {
      const scale = devicePixelRatio || 1;
      const canvas = await domToCanvas(document.documentElement, {
        scale,
        filter: (node) => (node as Element).localName !== "ahemui-overlay",
      });
      // The canvas covers the whole document, so shift the viewport-relative rect by the scroll offset.
      return cropToDataUrl(canvas, scale, rect, strokes, maxBytes, [-scrollX, -scrollY], masks);
    },
    prepareNotifications: () => {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    },
    notify: (title, body, tag) => {
      if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, tag, icon: "/favicon.ico" });
    },
  });
}
