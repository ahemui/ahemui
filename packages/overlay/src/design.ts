import type { Styles } from "./types.js";

// Properties that matter for style/layout requests, with values that mean "nothing set" so they can be skipped.
const PROPS: [string, RegExp?][] = [
  ["color"],
  ["background-color", /^rgba\(0, 0, 0, 0\)$|^transparent$/],
  ["font-family"],
  ["font-size"],
  ["font-weight"],
  ["line-height"],
  ["letter-spacing", /^normal$/],
  ["padding", /^0px$/],
  ["margin", /^0px$/],
  ["gap", /^normal$/],
  ["border-radius", /^0px$/],
  ["border", /^0px none/],
  ["box-shadow", /^none$/],
  ["width"],
  ["height"],
  ["display"],
  ["text-align", /^start$/],
  ["opacity", /^1$/],
];

// A length token only counts for a property when its name fits (so --space-4 isn't reported for a 16px font size).
// Colours are distinctive enough to accept any colour token, preferring colour-sounding names.
const LENGTH_HINTS: Record<string, RegExp> = {
  "font-size": /font|text|size|type|fs/i,
  "line-height": /leading|line|lh/i,
  "letter-spacing": /tracking|letter/i,
  padding: /space|spacing|gap|pad|gutter|inset/i,
  margin: /space|spacing|gap|margin|gutter/i,
  gap: /space|spacing|gap|gutter/i,
  "border-radius": /radius|round|corner/i,
  border: /border|stroke|width/i,
  "box-shadow": /shadow|elev/i,
  width: /width|size|container/i,
  height: /height|size/i,
};
const COLOR_HINT = /colou?r|brand|ink|gray|grey|neutral|primary|accent|bg|surface|fg|text/i;
const COLOR_VALUE = /^(rgba?|oklch|hsla?)\(/;

let tokenCache: { at: number; map: Map<string, string[]> } | undefined;

/** Computed styles of `el`, which CSS variables (design tokens) produce them, and its classes. */
export function stylesOf(el: Element): Styles {
  const cs = getComputedStyle(el);
  const computed: Record<string, string> = {};
  for (const [prop, skip] of PROPS) {
    const v = cs.getPropertyValue(prop).trim();
    if (v && !skip?.test(v)) computed[prop] = v.slice(0, 300);
  }
  const tokens: Record<string, string> = {};
  const byValue = tokenMap();
  for (const [prop, value] of Object.entries(computed)) {
    let matched = false;
    const replaced = value.replace(/rgba?\([^)]*\)|oklch\([^)]*\)|hsla?\([^)]*\)|-?[\d.]+px/g, (part) => {
      const names = byValue.get(part);
      if (!names) return part;
      const name = COLOR_VALUE.test(part)
        ? (names.find((n) => COLOR_HINT.test(n)) ?? names[0])
        : names.find((n) => LENGTH_HINTS[prop]?.test(n));
      if (!name) return part;
      matched = true;
      return `var(${name})`;
    });
    if (matched) tokens[prop] = replaced.slice(0, 300);
  }
  const classes = [...el.classList].slice(0, 40);
  return {
    computed,
    tokens: Object.keys(tokens).length ? tokens : undefined,
    classes: classes.length ? classes : undefined,
  };
}

/** Normalised value → CSS custom property names defined on :root/html, e.g. "rgb(79, 70, 229)" → ["--brand-600"]. */
function tokenMap(): Map<string, string[]> {
  if (tokenCache && Date.now() - tokenCache.at < 10_000) return tokenCache.map;
  const names = new Set<string>();
  const rootStyle = getComputedStyle(document.documentElement);
  for (let i = 0; i < rootStyle.length; i++) if (rootStyle[i].startsWith("--")) names.add(rootStyle[i]);
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule && /(^|,)\s*(:root|html)\b/.test(rule.selectorText)) {
        for (let i = 0; i < rule.style.length; i++) if (rule.style[i].startsWith("--")) names.add(rule.style[i]);
      }
      if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      /* cross-origin stylesheet */
    }
  }

  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.documentElement.appendChild(probe);
  const map = new Map<string, string[]>();
  for (const name of [...names].slice(0, 600)) {
    const raw = rootStyle.getPropertyValue(name).trim();
    if (!raw) continue;
    for (const value of normalise(raw, probe)) map.set(value, [...(map.get(value) ?? []), name]);
  }
  probe.remove();
  tokenCache = { at: Date.now(), map };
  return map;
}

/** Resolve a token value the way computed styles report it: colours to rgb()/oklch(), lengths to px. */
function normalise(raw: string, probe: HTMLElement): string[] {
  const out: string[] = [];
  probe.style.color = "";
  probe.style.color = raw;
  if (probe.style.color) out.push(getComputedStyle(probe).color);
  probe.style.width = "";
  probe.style.width = raw;
  if (probe.style.width && /px|rem|em/.test(raw)) out.push(getComputedStyle(probe).width);
  return out;
}
