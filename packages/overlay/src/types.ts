import type { PageAgent } from "./agent.js";
import type { Transport } from "./api.js";

// Mirrors @ahemui/core's schema; kept dependency-free so the overlay bundle stays small.
export type Status = "open" | "in-progress" | "review" | "done" | "wontfix";
export const TYPES = ["bug", "style", "layout", "copy", "feature", "a11y", "other"] as const;
export type ItemType = (typeof TYPES)[number];

export interface Page {
  title?: string;
  heading?: string;
  description?: string;
  routeName?: string;
  routePattern?: string;
  params?: Record<string, string>;
  routeMeta?: Record<string, string | number | boolean>;
  pageComponent?: string;
  pageFile?: string;
  storyId?: string;
  storyTitle?: string;
  storyFile?: string;
  section?: string;
  landmark?: string;
  env?: "local" | "deployed";
  framework?: "vue" | "react" | "svelte";
  browser?: string;
  dpr?: number;
  colorScheme?: "light" | "dark";
  lang?: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Anchor {
  source?: string;
  components?: string[];
  selector?: string;
  text?: string;
}

export interface ElementRef {
  tag: string;
  source?: string;
  component?: string;
  text?: string;
}

export interface Styles {
  computed?: Record<string, string>;
  tokens?: Record<string, string>;
  classes?: string[];
}

export interface Step {
  kind: "click" | "input" | "submit" | "key" | "navigate";
  target?: string;
  detail?: string;
  ago: number;
}

export interface Extra {
  role: "also" | "reference";
  rect?: Rect;
  anchor: Anchor;
  elements?: ElementRef[];
  styles?: Styles;
  shot?: string;
}

export interface Item {
  id: string;
  status: Status;
  start?: "now" | "later";
  batch?: string;
  intent?: "action" | "review";
  needs_reply?: boolean;
  type?: ItemType;
  priority?: "high" | "normal" | "low";
  area?: string;
  labels?: string[];
  author: string;
  created: string;
  route?: string;
  url?: string;
  viewport?: string;
  page?: Page;
  design?: string;
  rect?: Rect;
  anchor: Anchor;
  elements?: ElementRef[];
  extras?: Extra[];
  shot?: string;
  after?: string;
  redacted?: boolean;
  claimed_by: string | null;
  review?: { verdict: "approved" | "changes"; by: string; at: string };
  external?: { tracker: string; key: string; url?: string; status?: string };
  body: string;
  location: "items" | "done";
}

export type Point = [number, number];

/** What differs between running as an extension content script and being injected by the Vite plugin. */
export interface Host {
  mode: "ext" | "inject";
  transport: Transport;
  agent: PageAgent;
  /**
   * Screenshot of `rect` (viewport coords) as a data URL, with freehand strokes drawn in and `masks`
   * (viewport rects with sensitive content) blacked out.
   */
  capture(rect: Rect, strokes: Point[][], masks: Rect[], maxBytes: number, hide: () => Promise<() => void>): Promise<string | undefined>;
  /** Lets the host wire up extra triggers (toolbar icon, keyboard command). */
  onToggle?(toggle: () => void): void;
  /** Settings were changed elsewhere (the extension popup); reload them. */
  onPrefsChanged?(reload: () => void): void;
  /** Shown when capture is requested but no server is connected. */
  disconnectedHint: string;
  /** Desktop notification; `tag` de-duplicates across tabs. */
  notify?(title: string, body: string, tag: string): void;
  /** Called from a user gesture so the host can ask for notification permission if it needs to. */
  prepareNotifications?(): void;
}
