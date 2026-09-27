import { textOf } from "./inspect.js";
import type { Step } from "./types.js";

// Records what the person did right before capturing, so "only happens after you open the menu" bugs come with
// their repro steps. Values typed into fields are never recorded.
const log: (Omit<Step, "ago"> & { t: number })[] = [];
const MAX = 30;

const INTERACTIVE = "button, a, input, select, textarea, summary, label, [role=button], [role=tab], [role=menuitem], [role=link], [role=checkbox], [role=switch]";

export function recordSteps(isOwn: (el: Element) => boolean, scrubText: (s: string) => string) {
  const rec = (kind: Step["kind"], target?: string, detail?: string) => {
    log.push({ kind, target: target && scrubText(target).slice(0, 200), detail: detail?.slice(0, 200), t: Date.now() });
    if (log.length > MAX) log.shift();
  };
  const describe = (raw: EventTarget | null): string | undefined => {
    if (!(raw instanceof Element) || isOwn(raw)) return undefined;
    const el = raw.closest(INTERACTIVE) ?? raw;
    const label =
      el.getAttribute("aria-label") ||
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.placeholder || el.name : "") ||
      textOf(el, 40) ||
      "";
    return `<${el.localName}${el instanceof HTMLInputElement ? ` type=${el.type}` : ""}>${label ? ` "${label}"` : ""}`;
  };

  addEventListener("click", (e) => { const d = describe(e.target); if (d) rec("click", d); }, true);
  addEventListener(
    "change",
    (e) => {
      const d = describe(e.target);
      if (!d) return;
      const el = e.target as HTMLInputElement;
      rec("input", d, el.type === "checkbox" || el.type === "radio" ? (el.checked ? "checked" : "unchecked") : "changed");
    },
    true,
  );
  addEventListener("submit", (e) => { const d = describe(e.target); if (d) rec("submit", d); }, true);
  addEventListener(
    "keydown",
    (e) => {
      if (!["Enter", "Escape", "Tab"].includes(e.key)) return;
      const d = describe(e.target);
      if (d) rec("key", d, e.key);
    },
    true,
  );
  let path = location.pathname + location.search;
  setInterval(() => {
    const now = location.pathname + location.search;
    if (now !== path) {
      path = now;
      rec("navigate", undefined, location.pathname);
    }
  }, 300);
}

/** The last few steps within `windowMs` before now, newest last. */
export function recentSteps(windowMs = 120_000, max = 15): Step[] | undefined {
  const now = Date.now();
  const steps = log.filter((s) => now - s.t < windowMs).slice(-max).map(({ t, ...s }) => ({ ...s, ago: now - t }));
  return steps.length ? steps : undefined;
}
