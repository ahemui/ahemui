// "Review this page": an outline of what's on the page (with source locations, for Claude's UX review) and the
// automatic checks that need no judgement (axe: contrast, tap targets, names, labels, alt text…).
import axe from "axe-core";
import type { PageAgent } from "./agent.js";
import { cssPath, PRIVATE, sourceOf, textOf } from "./inspect.js";

export interface ScanElement {
  n: number;
  kind: "heading" | "action" | "field" | "media" | "text" | "landmark";
  tag: string;
  level?: number;
  text?: string;
  source?: string;
  selector: string;
  rect: { x: number; y: number; w: number; h: number };
  fontSize?: number;
}

export interface ScanCheck {
  rule: string;
  severity: "high" | "medium" | "low";
  help: string;
  why: string;
  fix?: string;
  selector: string;
  n?: number;
}

const KINDS: [ScanElement["kind"], string][] = [
  ["heading", "h1, h2, h3, h4, h5, h6, [role=heading]"],
  ["action", "a[href], button, [role=button], [role=link], input[type=submit], input[type=button], summary"],
  ["field", "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, [contenteditable=true]"],
  ["media", "img, video, svg[role=img], picture, canvas"],
  ["landmark", "header, nav, main, footer, aside, form, [role=banner], [role=navigation], [role=main], [role=contentinfo], dialog"],
];
const MAX = 300;

/** Visible, meaningful elements in document order, numbered, with where they are in the page and the code. */
export function outlinePage(isOwn: (el: Element) => boolean, agent: PageAgent): ScanElement[] {
  const kindOf = new Map<Element, ScanElement["kind"]>();
  for (const [kind, sel] of KINDS) for (const el of document.querySelectorAll(sel)) if (!kindOf.has(el)) kindOf.set(el, kind);
  // Text blocks: paragraphs and list items that carry their own words.
  for (const el of document.querySelectorAll("p, li, blockquote, figcaption, label, td, th, dd, dt, span")) {
    if (kindOf.has(el) || el.closest("a, button, [role=button]")) continue;
    const own = [...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent!.trim()).join(" ");
    if (own.length >= (el.localName === "span" ? 30 : 12)) kindOf.set(el, "text");
  }
  const els = [...kindOf.keys()]
    .filter((el) => !isOwn(el) && !el.closest(PRIVATE))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
    })
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .slice(0, MAX);
  const info = agent.elements(els);
  return els.map((el, i) => {
    const r = el.getBoundingClientRect();
    const kind = kindOf.get(el)!;
    const level = kind === "heading" ? Number(/^h(\d)$/.exec(el.localName)?.[1] ?? el.getAttribute("aria-level") ?? 0) || undefined : undefined;
    return {
      n: i + 1,
      kind,
      tag: el.localName,
      level,
      text: kind === "field" ? fieldLabel(el) : textOf(el, 120),
      source: sourceOf(el, info[i]),
      selector: cssPath(el),
      rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      fontSize: kind === "heading" || kind === "text" || kind === "action" ? Math.round(parseFloat(getComputedStyle(el).fontSize)) : undefined,
    };
  });
}

/** A field's label or placeholder, never its value. */
function fieldLabel(el: Element): string | undefined {
  const id = el.getAttribute("id");
  const label = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent) || el.closest("label")?.textContent;
  return (label || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || undefined)?.trim().slice(0, 120);
}

const SEVERITY: Record<string, ScanCheck["severity"]> = { critical: "high", serious: "high", moderate: "medium", minor: "low" };

/**
 * axe over the whole page (WCAG 2.2 A/AA plus best practices), outside AhemUI's own UI. At most three findings
 * per rule, worst first, each matched to an outline element when one covers it.
 */
export async function runChecks(outline: ScanElement[]): Promise<ScanCheck[]> {
  const result = await axe.run(
    { include: [document.documentElement], exclude: [["ahemui-overlay"]] } as axe.ElementContext,
    { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] }, resultTypes: ["violations"] },
  );
  const order = ["critical", "serious", "moderate", "minor"];
  const checks: ScanCheck[] = [];
  for (const v of [...result.violations].sort((a, b) => order.indexOf(a.impact ?? "minor") - order.indexOf(b.impact ?? "minor"))) {
    for (const node of v.nodes.slice(0, 3)) {
      const target = node.target.map(String).at(-1);
      if (!target) continue;
      let el: Element | null = null;
      try {
        el = document.querySelector(target);
      } catch {
        /* a selector axe built that this document can't parse */
      }
      const selector = el ? cssPath(el) : target;
      const match = el ? outline.find((o) => o.selector === selector) ?? outline.find((o) => el!.contains(document.querySelector(o.selector))) : undefined;
      checks.push({
        rule: v.id,
        severity: SEVERITY[node.impact ?? v.impact ?? "minor"] ?? "low",
        help: v.help.slice(0, 300),
        why: v.description.slice(0, 800),
        fix: node.failureSummary?.replace(/^Fix (any|all) of the following:\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 800) || undefined,
        selector: selector.slice(0, 600),
        n: match?.n,
      });
    }
    if (checks.length >= 60) break;
  }
  return checks;
}
