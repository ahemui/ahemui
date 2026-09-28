import { z } from "zod";

/** review: Claude finished; waiting for the person who asked to approve it in the browser. */
export const STATUSES = ["open", "in-progress", "review", "done", "wontfix"] as const;
export const StatusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof StatusSchema>;

export const TYPES = ["bug", "style", "layout", "copy", "feature", "a11y", "other"] as const;
export const TypeSchema = z.enum(TYPES);
export type ItemType = z.infer<typeof TypeSchema>;

export const PRIORITIES = ["high", "normal", "low"] as const;
export const PrioritySchema = z.enum(PRIORITIES);
export type Priority = z.infer<typeof PrioritySchema>;

const short = (max: number) => z.string().max(max);

/** "now": the person pressed Start now and a watching Claude session should pick it up immediately. */
export const StartSchema = z.enum(["now", "later"]);
export type Start = z.infer<typeof StartSchema>;

/** What page the feedback was captured on, collected automatically so items can be classified and grouped. */
export const PageSchema = z.object({
  title: short(200).optional(), // document.title
  heading: short(200).optional(), // main <h1>
  description: short(300).optional(), // <meta name="description">
  // Vue Router, when present (works in production builds too).
  routeName: short(120).optional(),
  routePattern: short(200).optional(), // "/products/:id"
  params: z.record(short(200)).optional(),
  routeMeta: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  pageComponent: short(120).optional(),
  pageFile: short(300).optional(),
  // Storybook, when captured in a story.
  storyId: short(200).optional(),
  storyTitle: short(200).optional(),
  storyFile: short(300).optional(),
  // Where on the page the target sits.
  section: short(200).optional(), // nearest heading above the target
  landmark: short(80).optional(), // header / nav / main / footer / aside / dialog / form
  // Environment.
  env: z.enum(["local", "deployed"]).optional(),
  framework: z.enum(["vue", "react", "svelte"]).optional(),
  browser: short(80).optional(),
  dpr: z.number().optional(),
  colorScheme: z.enum(["light", "dark"]).optional(),
  lang: short(20).optional(),
});
export type Page = z.infer<typeof PageSchema>;

/** Classification, set at capture time (type) or by triage. */
export const TriageSchema = z.object({
  type: TypeSchema.optional(),
  priority: PrioritySchema.optional(),
  area: short(120).optional(), // "Pricing › Plan cards"
  labels: z.array(short(40)).max(12).optional(),
});
export type Triage = z.infer<typeof TriageSchema>;

export const TRACKERS = ["linear", "jira", "notion", "github", "other"] as const;

/** The ticket an item is mirrored to in an external tracker (created by Claude through the tracker's MCP). */
export const ExternalSchema = z.object({
  tracker: z.enum(TRACKERS),
  key: short(80), // "ENG-123", "WEB-42", a Notion page id, "#57"
  url: short(500).optional(),
  status: short(80).optional(), // last known status in the tracker
  synced: z.string().optional(), // ISO time of the last sync
});
export type External = z.infer<typeof ExternalSchema>;

/**
 * Optional external tracker. AhemUI never calls tracker APIs itself: Claude mirrors items using whatever MCP
 * server the team already has enabled (Linear, Atlassian/Jira, Notion, GitHub…). The repo stays the source of truth
 * for anchors, screenshots and page metadata.
 */
export const TrackerSchema = z.object({
  kind: z.enum(TRACKERS),
  /** Where tickets go, in the tracker's own terms: "Linear team ENG, project Website", "Jira project WEB", a Notion database URL. */
  target: short(300),
  /** manual: only /ahemui:sync. auto: triage/work/watch also create and update tickets as they touch items. */
  sync: z.enum(["manual", "auto"]).default("manual"),
  /** Labels added to every ticket, e.g. ["ahemui", "ui-feedback"]. */
  labels: z.array(short(40)).max(10).default([]),
  /** Free-form conventions, e.g. "issue type Bug for bugs, Task otherwise; component Web; move to In Review when done". */
  instructions: short(1000).optional(),
});
export type Tracker = z.infer<typeof TrackerSchema>;

/** Ways to find the element again, tried in order: source → selector → text. */
export const AnchorSchema = z.object({
  source: z.string().optional(), // "src/components/PricingCard.vue:42"
  components: z.array(z.string()).optional(), // outermost → innermost
  selector: z.string().optional(),
  text: z.string().optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

/** Other elements inside the selection, so Claude sees everything that was highlighted. */
export const ElementRefSchema = z.object({
  tag: z.string(),
  source: z.string().optional(),
  component: z.string().optional(),
  text: z.string().optional(),
});
export type ElementRef = z.infer<typeof ElementRefSchema>;

const RectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

/** Computed styles of the highlighted element and the design tokens (CSS variables) they match. */
export const StylesSchema = z.object({
  computed: z.record(short(300)).optional(),
  tokens: z.record(short(300)).optional(), // property → "var(--space-4)" / "var(--brand-600)"
  classes: z.array(short(120)).max(40).optional(),
});
export type Styles = z.infer<typeof StylesSchema>;

/** Additional highlighted areas: more places the change applies to ("also"), or an example to match ("reference"). */
export const ExtraSchema = z.object({
  role: z.enum(["also", "reference"]),
  rect: RectSchema.optional(),
  anchor: AnchorSchema.default({}),
  elements: z.array(ElementRefSchema).max(20).optional(),
  styles: StylesSchema.optional(),
  shot: z.string().optional(), // file name inside the item folder
});
export type Extra = z.infer<typeof ExtraSchema>;

/** Recent console errors and failed requests on the page at capture time. */
export const EvidenceSchema = z.object({
  console: z.array(z.object({ level: short(10), message: short(600), ago: z.number() })).max(30).optional(),
  network: z.array(z.object({ method: short(10), url: short(500), status: z.number(), ms: z.number().optional(), ago: z.number() })).max(30).optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** Props/state of the component that renders the highlighted element (dev builds; sensitive keys masked). */
export const StateSchema = z.object({
  component: short(120).optional(),
  props: z.unknown().optional(),
  state: z.unknown().optional(),
  truncated: z.boolean().optional(),
});
export type ComponentState = z.infer<typeof StateSchema>;


export const A11yIssueSchema = z.object({
  id: short(80),
  impact: short(20).optional(),
  help: short(300),
  nodes: z.number(),
  targets: z.array(short(300)).max(5).optional(),
});

/** What the person did right before capturing (values never recorded). */
export const StepSchema = z.object({
  kind: z.enum(["click", "input", "submit", "key", "navigate"]),
  target: short(200).optional(),
  detail: short(200).optional(),
  ago: z.number(), // ms before capture
});
export type Step = z.infer<typeof StepSchema>;

export const ReviewSchema = z.object({
  verdict: z.enum(["approved", "changes"]),
  by: short(120),
  at: z.string(),
});

export const ItemMetaSchema = z.object({
  id: z.string(),
  status: StatusSchema,
  start: StartSchema.optional(),
  /** Claude asked a question and is waiting for the person to answer (from the browser popover). */
  needs_reply: z.boolean().optional(),
  ...TriageSchema.shape,
  author: z.string(),
  created: z.string(),
  route: z.string().optional(),
  url: z.string().optional(),
  viewport: z.string().optional(), // "1440x900"
  page: PageSchema.optional(),
  design: short(500).optional(), // Figma or other design reference URL
  rect: RectSchema.optional(),
  anchor: AnchorSchema.default({}),
  elements: z.array(ElementRefSchema).optional(),
  extras: z.array(ExtraSchema).max(8).optional(),
  styles: StylesSchema.optional(),
  state: StateSchema.optional(),
  evidence: EvidenceSchema.optional(),
  a11y: z.array(A11yIssueSchema).max(30).optional(),
  steps: z.array(StepSchema).max(30).optional(),
  redacted: z.boolean().optional(), // sensitive parts of the screenshot were masked
  shot: z.string().optional(), // file name inside the item folder
  after: z.string().optional(), // screenshot of the same spot after the change, for review
  claimed_by: z.string().nullable().default(null),
  resolved_by: z.string().nullable().default(null),
  review: ReviewSchema.optional(),
  external: ExternalSchema.optional(),
});
export type ItemMeta = z.infer<typeof ItemMetaSchema>;

export interface Item extends ItemMeta {
  /** Prompt text, followed by any appended notes, questions, replies and feedback. */
  body: string;
  /** Where the item lives: active backlog or the done archive. */
  location: "items" | "done";
}

/** Presence of a Claude session running /ahemui:watch, so the browser can say whether "Start now" will be picked up. */
export const WatcherSchema = z.object({
  state: z.enum(["waiting", "working"]),
  pid: z.number().int(),
  since: z.string(),
  item: z.string().optional(),
  by: z.string().optional(),
  /** Set by the browser (from .watch-control.json when read): hold Start-now items until resumed. */
  paused: z.boolean().optional(),
  /** Set by the browser: the watch ends when the current item is done (or right away when waiting). */
  stopping: z.boolean().optional(),
});
export type Watcher = z.infer<typeof WatcherSchema>;

/** What the person asked the watching Claude session to do from the browser. Local-only, like .watcher.json. */
export const WatchControlSchema = z.object({
  mode: z.enum(["paused", "stop"]),
  at: z.string(),
  by: z.string().optional(),
});
export type WatchControl = z.infer<typeof WatchControlSchema>;

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  port: z.number().int().default(4777),
  devOrigins: z.array(z.string()).default(["http://localhost:5173"]),
  screenshot: z
    .object({ format: z.enum(["webp", "png"]).default("webp"), maxBytes: z.number().int().default(300_000) })
    .default({}),
  /** Finished items wait for the requester's approval in the browser before counting as done. */
  review: z.boolean().default(true),
  tracker: TrackerSchema.optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

/** Payload accepted when creating an item (from the extension or CLI). Screenshots travel separately. */
export const NewItemSchema = z.object({
  prompt: z.string().min(1),
  author: z.string().optional(),
  route: z.string().optional(),
  url: z.string().optional(),
  viewport: z.string().optional(),
  page: PageSchema.optional(),
  type: TypeSchema.optional(),
  start: StartSchema.optional(),
  design: short(500).optional(),
  rect: RectSchema.optional(),
  anchor: AnchorSchema.default({}),
  elements: z.array(ElementRefSchema).max(50).optional(),
  extras: z.array(ExtraSchema.omit({ shot: true })).max(8).optional(),
  styles: StylesSchema.optional(),
  state: StateSchema.optional(),
  evidence: EvidenceSchema.optional(),
  a11y: z.array(A11yIssueSchema).max(30).optional(),
  steps: z.array(StepSchema).max(30).optional(),
  redacted: z.boolean().optional(),
});
export type NewItem = z.infer<typeof NewItemSchema>;
