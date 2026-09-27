import { textOf } from "./inspect.js";
import type { Page } from "./types.js";
import type { PageAgent } from "./agent.js";

export const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost|.+\.test)$/;

const HEADINGS = "h1, h2, h3, h4, [role=heading]";
const LANDMARKS =
  "header, nav, main, footer, aside, dialog, form, [role=dialog], [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=search]";

/** Everything about the page that helps classify an item and find its code, gathered at capture time. */
export async function collectPage(target: Element, agent: PageAgent, framework?: Page["framework"]): Promise<Page> {
  const h1 = document.querySelector("h1");
  const page: Page = {
    title: document.title.trim().slice(0, 200) || undefined,
    heading: h1 ? textOf(h1, 200) : undefined,
    description: document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim().slice(0, 300) || undefined,
    ...agent.route(),
    ...(await storyInfo()),
    framework,
    section: sectionOf(target),
    landmark: landmarkOf(target),
    env: LOCAL_HOST.test(location.hostname) ? "local" : "deployed",
    browser: browserName(),
    dpr: Math.round(devicePixelRatio * 100) / 100,
    colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    lang: (document.documentElement.lang || navigator.language || "").slice(0, 20) || undefined,
  };
  return Object.fromEntries(Object.entries(page).filter(([, v]) => v !== undefined && v !== "")) as Page;
}

/** Storybook: the story being viewed (canvas iframe or manager URL) and, via index.json, its file. */
async function storyInfo(): Promise<Partial<Page>> {
  const u = new URL(location.href);
  let id: string | null = null;
  if (u.pathname.endsWith("/iframe.html")) id = u.searchParams.get("id");
  else id = /^\/(?:story|docs)\/(.+)$/.exec(u.searchParams.get("path") ?? "")?.[1] ?? null;
  if (!id) return {};
  try {
    const res = await fetch(new URL("index.json", u.origin + u.pathname.replace(/[^/]*$/, "")), { signal: AbortSignal.timeout(1500) });
    const entry = (await res.json()).entries?.[id];
    return {
      storyId: id,
      storyTitle: entry ? `${entry.title} › ${entry.name}`.slice(0, 200) : undefined,
      storyFile: entry?.importPath?.replace(/^\.\//, ""),
    };
  } catch {
    return { storyId: id };
  }
}

/** The nearest heading above the target within its closest ancestor that has one, e.g. the card's title. */
function sectionOf(target: Element): string | undefined {
  // A selection that contains its own heading (a whole section or card) is named by that heading.
  const own = target.matches(HEADINGS) ? target : target.querySelector(HEADINGS);
  if (own) return textOf(own, 120);
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    const before = [...el.querySelectorAll(HEADINGS)].filter(
      (h) => h === target || h.contains(target) || h.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    if (before.length) return textOf(before.at(-1)!, 120);
    const label = el !== target ? el.getAttribute("aria-label") : null;
    if (label) return label.slice(0, 120);
  }
  return undefined;
}

function landmarkOf(target: Element): string | undefined {
  const lm = target.closest(LANDMARKS);
  if (!lm) return undefined;
  const kind = lm.getAttribute("role") ?? lm.localName;
  const label = lm.getAttribute("aria-label");
  return (label ? `${kind} (${label})` : kind).slice(0, 80);
}

function browserName(): string {
  const brands: { brand: string; version: string }[] = (navigator as any).userAgentData?.brands ?? [];
  const named = brands.find((b) => !/not.?a.?brand|chromium/i.test(b.brand)) ?? brands.find((b) => /chromium/i.test(b.brand));
  if (named) return `${named.brand} ${named.version}`;
  const ua = navigator.userAgent;
  const m = /(Firefox|Edg|Chrome)\/(\d+)/.exec(ua) ?? /Version\/(\d+).*(Safari)/.exec(ua);
  return m ? (m[2] === "Safari" ? `Safari ${m[1]}` : `${m[1]} ${m[2]}`) : "unknown";
}
