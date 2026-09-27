import { PRIVATE } from "./inspect.js";
import type { Rect } from "./types.js";

// Form fields and anything marked private are masked in screenshots. On deployed sites (real user data) that
// covers every text field plus visible emails and long numbers; locally only passwords and explicit opt-ins.
const DEPLOYED_FIELDS =
  'input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=hidden]), textarea, select, [contenteditable=""], [contenteditable=true]';
const LOCAL_FIELDS = "input[type=password]";

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const LONG_NUMBER = /\+?\d[\d ().-]{8,}\d/g; // cards, phone numbers, account numbers

/** Viewport rects inside `sel` that must be masked before the screenshot leaves the page. */
export function sensitiveRects(sel: Rect, deployed: boolean, isOwn: (el: Element) => boolean): Rect[] {
  const rects: Rect[] = [];
  const add = (r: DOMRect) => {
    if (r.width && r.height && intersects(sel, r)) rects.push({ x: r.left - 2, y: r.top - 2, w: r.width + 4, h: r.height + 4 });
  };
  for (const el of document.querySelectorAll(`${PRIVATE}, ${deployed ? DEPLOYED_FIELDS : LOCAL_FIELDS}`)) {
    if (!isOwn(el)) add(el.getBoundingClientRect());
  }
  if (deployed) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let scanned = 0;
    for (let node = walker.nextNode(); node && scanned < 2000; node = walker.nextNode(), scanned++) {
      const text = node.nodeValue ?? "";
      if (text.length < 6 || !node.parentElement || isOwn(node.parentElement)) continue;
      if (!intersects(sel, node.parentElement.getBoundingClientRect())) continue;
      for (const re of [EMAIL, LONG_NUMBER]) {
        re.lastIndex = 0;
        for (let m = re.exec(text); m; m = re.exec(text)) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          for (const r of range.getClientRects()) add(r);
        }
      }
    }
  }
  return rects;
}

/** Scrubs personal data out of captured text on deployed sites. */
export function scrub(s: string): string {
  return s.replace(EMAIL, "[email]").replace(LONG_NUMBER, "[number]");
}

/** Applies `scrub` to every string in a JSON-like value; URLs lose their query strings (tokens hide there). */
export function scrubDeep<T>(v: T): T {
  if (typeof v === "string") return (/^https?:\/\//.test(v) ? v.replace(/\?.*$/, "?…") : scrub(v)) as T;
  if (Array.isArray(v)) return v.map(scrubDeep) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)])) as T;
  return v;
}

function intersects(a: Rect, b: DOMRect): boolean {
  return b.right > a.x && b.left < a.x + a.w && b.bottom > a.y && b.top < a.y + a.h;
}
