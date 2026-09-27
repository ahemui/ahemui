import type { FrameworkInfo, PageAgent } from "./agent.js";
import type { Anchor, ElementRef, Rect } from "./types.js";

const SKIP = new Set(["script", "style", "template", "link", "meta", "noscript", "br"]);
const MAX_ELEMENTS = 20;

export interface Inspection {
  primary: Element;
  anchor: Anchor;
  elements: ElementRef[];
  framework?: FrameworkInfo["framework"];
}

/** Works out what was highlighted: the element that best represents the selection, plus everything inside it. */
export function inspectRect(r: Rect, isOwn: (el: Element) => boolean, agent: PageAgent): Inspection {
  const contained = new Set<Element>();
  for (const el of document.body.querySelectorAll("*")) {
    if (SKIP.has(el.localName) || isOwn(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if (b.left >= r.x - 2 && b.top >= r.y - 2 && b.right <= r.x + r.w + 2 && b.bottom <= r.y + r.h + 2) contained.add(el);
  }
  // Keep only outermost contained elements; their children are implied.
  const tops = [...contained].filter((el) => !el.parentElement || !contained.has(el.parentElement));

  let primary: Element;
  if (tops.length === 0) primary = elementAt(r.x + r.w / 2, r.y + r.h / 2, isOwn) ?? document.body;
  else if (tops.length === 1) primary = tops[0];
  else primary = commonAncestor(tops);

  const described = (tops.length ? tops : [primary]).slice(0, MAX_ELEMENTS);
  const [primaryVue, ...describedVue] = agent.elements([primary, ...described]);
  return {
    primary,
    framework: primaryVue.framework,
    anchor: {
      source: sourceOf(primary, primaryVue),
      components: primaryVue.components?.length ? primaryVue.components : undefined,
      selector: cssPath(primary),
      text: textOf(primary),
    },
    elements: described.map((el, i) => ({
      tag: el.localName,
      source: sourceOf(el, describedVue[i]),
      component: describedVue[i]?.components?.at(-1),
      text: textOf(el, 60),
    })),
  };
}

export function elementAt(x: number, y: number, isOwn: (el: Element) => boolean): Element | undefined {
  return document.elementsFromPoint(x, y).find((el) => !isOwn(el) && el !== document.documentElement);
}

function commonAncestor(els: Element[]): Element {
  let node: Element | null = els[0];
  while (node && !els.every((el) => node!.contains(el))) node = node.parentElement;
  return node ?? document.body;
}

/**
 * Source location: `data-snap-src` from the Vite plugin (Vue), else what the framework exposes at runtime
 * (React ≤18 _debugSource, Svelte __svelte_meta), else the Vue component's `__file` (dev builds).
 */
export function sourceOf(el: Element, fw?: FrameworkInfo): string | undefined {
  return el.closest("[data-snap-src]")?.getAttribute("data-snap-src") ?? fw?.source ?? fw?.file;
}

/** Elements whose content must never leave the page as text (the screenshot masks them too). */
export const PRIVATE = "[data-private], [data-snap-private], .snap-private";

export function textOf(el: Element, max = 80): string | undefined {
  if (el.closest(PRIVATE)) return "[private]";
  let raw: string;
  if (el.querySelector(PRIVATE)) {
    // innerText needs a rendered element, so walk the text nodes instead, skipping private subtrees.
    const parts: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n instanceof Element && n.matches(PRIVATE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeType === Node.TEXT_NODE) parts.push(n.nodeValue ?? "");
    raw = `${parts.join(" ")} [private]`;
  } else raw = (el as HTMLElement).innerText ?? el.textContent ?? "";
  const text = raw.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
}

/** A short CSS path, anchored at the nearest unique id. */
export function cssPath(el: Element): string {
  const parts: string[] = [];
  let e: Element | null = el;
  while (e && e !== document.body && e !== document.documentElement && parts.length < 8) {
    if (e.id && document.querySelectorAll(`#${CSS.escape(e.id)}`).length === 1) {
      parts.unshift(`#${CSS.escape(e.id)}`);
      return parts.join(" > ");
    }
    let part = e.localName;
    const parent: Element | null = e.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.localName === e!.localName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(e) + 1})`;
    }
    parts.unshift(part);
    e = parent;
  }
  if (e === document.body) parts.unshift("body");
  return parts.join(" > ");
}

/** Finds the element an item was anchored to, trying source → selector → text. */
export function locate(anchor: Anchor, isOwn: (el: Element) => boolean): Element | undefined {
  const pick = (els: Element[]) => {
    const visible = els.filter((el) => !isOwn(el) && el.getClientRects().length > 0);
    if (visible.length <= 1) return visible[0];
    return (
      (anchor.selector && visible.find((el) => safeMatches(el, anchor.selector!))) ||
      (anchor.text && visible.find((el) => textOf(el) === anchor.text)) ||
      visible[0]
    );
  };

  if (anchor.source && anchor.source.includes(":")) {
    const hit = pick([...document.querySelectorAll(`[data-snap-src="${CSS.escape(anchor.source)}"]`)]);
    if (hit) return refineByText(hit, anchor);
  }
  if (anchor.selector) {
    try {
      const hit = pick([...document.querySelectorAll(anchor.selector)]);
      if (hit && (!anchor.text || textOf(hit) === anchor.text)) return hit;
    } catch {
      /* stale or invalid selector */
    }
  }
  if (anchor.text && anchor.text.length >= 3) {
    let best: Element | undefined;
    for (const el of document.body.querySelectorAll("*")) {
      if (SKIP.has(el.localName) || isOwn(el)) continue;
      if (textOf(el) === anchor.text) best = el; // later matches are deeper
    }
    if (best) return best;
  }
  return undefined;
}

/** `data-snap-src` may sit on an ancestor of what was picked; narrow down by text when possible. */
function refineByText(el: Element, anchor: Anchor): Element {
  if (!anchor.selector) return el;
  if (safeMatches(el, anchor.selector)) return el;
  const inner = [...el.querySelectorAll("*")].find((c) => safeMatches(c, anchor.selector!));
  return inner ?? el;
}

function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}
