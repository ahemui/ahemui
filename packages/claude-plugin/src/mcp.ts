import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { exportBoard } from "../../cli/src/board.js";
import { isRelease, pluginVersion } from "../../cli/src/update.js";
import { defaultAuthor, type Item, type ListFilter, PRIORITIES, AhemError, AhemStore, STATUSES, type Tracker, TRACKERS, TYPES, workOrder } from "@ahemui/core";
import { z } from "zod";

const projectDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();
const here = dirname(fileURLToPath(import.meta.url));
const VENDOR_TARBALL = "ahemui.tgz";

const server = new McpServer({ name: "ahemui", version: "0.1.0" });

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** Wraps a handler so AhemErrors come back as readable tool errors instead of crashes. */
function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  run: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<Content[] | string>,
) {
  server.registerTool(name, { description, inputSchema: shape }, (async (args: any) => {
    try {
      const out = await run(args);
      return { content: typeof out === "string" ? [{ type: "text", text: out }] : out };
    } catch (err) {
      const msg = err instanceof AhemError ? err.message : String((err as Error)?.stack ?? err);
      return { isError: true, content: [{ type: "text", text: msg }] };
    }
  }) as any);
}

const store = () => AhemStore.find(projectDir());
const idArg = { id: z.string().describe("Item id or unique prefix (from ahemui_list)") };

const filterArgs = {
  route: z.string().optional().describe('Route or route-pattern prefix, e.g. "/pricing" or "/products/:id"'),
  area: z.string().optional().describe("Case-insensitive substring of the triaged area"),
  type: z.enum(TYPES).optional(),
  label: z.string().optional(),
  start_now: z.boolean().optional().describe('Only items the person sent with "Start now"'),
  linked: z.boolean().optional().describe("true: only items mirrored to a tracker ticket; false: only unlinked ones"),
  batch: z.string().optional().describe("Batch id, id prefix or name (see ahemui_batches)"),
};

const toFilter = ({ start_now, ...f }: { start_now?: boolean } & Omit<ListFilter, "start">): ListFilter => ({
  ...f,
  ...(start_now && { start: "now" as const }),
});

tool(
  "ahemui_list",
  "List AhemUI backlog items (visual UI feedback captured in the browser), grouped by page by default. Each line shows id, status, classification, section and the request.",
  {
    status: z.array(z.enum(STATUSES)).optional().describe("Only these statuses"),
    include_archived: z.boolean().optional().describe("Also list items archived in .ahemui/done/"),
    untriaged: z.boolean().optional().describe("Only items missing a type or area"),
    group_by: z.enum(["page", "area", "type", "none"]).default("page"),
    ...filterArgs,
  },
  async ({ status, include_archived, untriaged, group_by, ...f }) => {
    const s = store();
    const batch = f.batch ? await s.findBatch(f.batch) : null;
    if (f.batch && !batch) return `No batch matches "${f.batch}". ahemui_batches lists them.`;
    const items = await s.list({ status, includeDone: include_archived, untriaged, ...toFilter({ ...f, batch: batch?.id }) });
    if (!items.length) return "No matching AhemUI items.";
    if (group_by === "none") return items.map(summary).join("\n");
    const key = (it: Item) =>
      group_by === "page" ? pageName(it) : group_by === "area" ? (it.area ?? "(no area yet)") : (it.type ?? "(no type yet)");
    const groups = new Map<string, Item[]>();
    for (const it of workOrder(items)) groups.set(key(it), [...(groups.get(key(it)) ?? []), it]);
    return [...groups].map(([k, list]) => `## ${k} (${list.length})\n${list.map(summary).join("\n")}`).join("\n\n");
  },
);

tool(
  "ahemui_batches",
  "List AhemUI batches: named rounds of feedback someone started in the browser. Intent \"action\" means changes to make; \"review\" means things flagged for a person to look at and decide on, which ahemui_next skips unless that batch is asked for.",
  {},
  async () => {
    const s = store();
    const [batches, items] = await Promise.all([s.listBatches(), s.list()]);
    if (!batches.length) return "No batches yet. Items captured without one work as usual.";
    return batches
      .map((b) => {
        const mine = items.filter((i) => i.batch === b.id);
        const open = mine.filter((i) => i.status === "open" || i.status === "in-progress").length;
        return `${b.id.slice(0, 10)}  ${b.intent === "review" ? "for review" : "changes"}  "${b.name}"  by ${b.author}  ${mine.length} item(s), ${open} open`;
      })
      .join("\n");
  },
);

tool("ahemui_get", "Get one AhemUI item in full: request, anchors, highlighted elements, notes, and its screenshot.", idArg, async ({ id }) => {
  const s = store();
  return describe(s, await s.get(id));
});

tool(
  "ahemui_next",
  "Claim the next open AhemUI item (status → in-progress, so the browser marker turns blue) and return it in full with its screenshot. Order: \"Start now\" items first, then high priority, then page by page, then oldest. Optional filters narrow it to one page, area, type or label.",
  filterArgs,
  async (f) => {
    const s = store();
    // Items flagged for review are for a person to decide on; only work them when their batch is asked for by name.
    const batch = f.batch ? await s.findBatch(f.batch) : null;
    if (f.batch && !batch) return `No batch matches "${f.batch}". ahemui_batches lists them.`;
    const [next] = workOrder(
      await s.list({ status: ["open"], needsReply: false, ...toFilter({ ...f, batch: batch?.id }), ...(batch ? {} : { intent: "action" as const }) }),
    );
    if (!next) return "No open AhemUI items match.";
    return describe(s, await s.claim(next.id, claimant()));
  },
);

tool(
  "ahemui_triage",
  "Classify a AhemUI item: type, priority, area (a human-readable 'Page › Section' name, reused across items so they group) and labels. Pass null to clear a field.",
  {
    ...idArg,
    type: z.enum(TYPES).nullable().optional(),
    priority: z.enum(PRIORITIES).nullable().optional(),
    area: z.string().max(120).nullable().optional().describe('e.g. "Pricing › Plan cards"'),
    labels: z.array(z.string().max(40)).max(12).nullable().optional().describe("Replaces the label list"),
  },
  async ({ id, ...patch }) => summary(await store().triage(id, patch)),
);

tool("ahemui_claim", "Mark a AhemUI item in-progress for this session.", { ...idArg, force: z.boolean().optional() }, async ({ id, force }) =>
  summary(await store().claim(id, claimant(), force)),
);

tool(
  "ahemui_resolve",
  "Finish a AhemUI item. By default (config.review) it goes to \"review\": the requester sees a before/after in the browser and approves it (→ done) or sends it back with feedback (→ open). Use \"done\" to skip review, \"wontfix\" to decline. Always add a note on what changed or why not.",
  {
    ...idArg,
    status: z.enum(["review", "done", "wontfix"]).optional().describe("Default: review if enabled in config, else done"),
    note: z.string().optional().describe("What changed (or why it won't be done), for whoever reads the item later"),
    commit: z.string().optional().describe("Commit SHA that resolved it, if already known"),
  },
  async ({ id, status, note, commit }) => {
    const it = await store().resolve(id, { status, note, sha: commit, author: claimant() });
    const hint = it.status === "review" ? "\nWaiting for the requester to approve it in the browser (the marker shows ◎)." : "";
    return summary(it) + hint;
  },
);

tool(
  "ahemui_note",
  "Append a note to a AhemUI item. With question: true it asks the requester: the item is released (open, unclaimed) and its browser marker shows \"?\" with a reply box; it's skipped by ahemui_next until they answer.",
  { ...idArg, text: z.string(), question: z.boolean().optional() },
  async ({ id, text, question }) => {
    const s = store();
    return summary(question ? await s.ask(id, claimant(), text) : await s.addNote(id, claimant(), text));
  },
);

tool("ahemui_reopen", "Set a AhemUI item back to open and release its claim (also restores archived items).", idArg, async ({ id }) =>
  summary(await store().reopen(id)),
);

tool(
  "ahemui_prune",
  "Archive all done/wontfix items by moving them from .ahemui/items/ to .ahemui/done/. Optionally drop screenshots from archived items older than N days to keep the repo small (item.md is kept).",
  { drop_shots_older_than_days: z.number().int().min(0).optional() },
  async ({ drop_shots_older_than_days }) => {
    const s = store();
    const { moved, shotsDropped } = await s.prune({ dropShotsOlderThanDays: drop_shots_older_than_days });
    const lines = [moved.length ? `Archived ${moved.length} item(s) to .ahemui/done/:\n${moved.map(summary).join("\n")}` : "Nothing to archive."];
    if (shotsDropped) lines.push(`Removed ${shotsDropped} old screenshot file(s) from archived items.`);
    const size = await s.screenshotBytes();
    const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;
    lines.push(`Screenshots in git: ${mb(size.items)} in the backlog, ${mb(size.done)} archived.`);
    return lines.join("\n");
  },
);

tool(
  "ahemui_init",
  "Set up AhemUI in the current project: create .ahemui/ and say how to install the ahemui package (from npm, or from a tarball vendored into .ahemui/vendor/ for offline use and local plugin builds).",
  {
    dev_origins: z.array(z.string()).optional().describe('Dev server origins, e.g. ["http://localhost:5173"]'),
    port: z.number().int().optional().describe("Port for ahemui serve (default 4777)"),
    lfs: z.boolean().optional().describe("Track .ahemui screenshots with Git LFS (each machine needs `git lfs install`)"),
    vendor: z.boolean().optional().describe("Vendor the package tarball into .ahemui/vendor/ instead of installing from npm (offline, or no registry access)"),
    keep_archived_days: z.number().int().min(0).optional().describe("Drop screenshots of archived items older than this many days when archiving (item.md stays)"),
  },
  async ({ dev_origins, port, lfs, vendor, keep_archived_days }) => {
    const root = projectDir();
    const s = await AhemStore.init(root, {
      ...(dev_origins && { devOrigins: dev_origins }),
      ...(port && { port }),
      ...(keep_archived_days !== undefined && { screenshot: { format: "webp", maxBytes: 300_000, keepArchivedDays: keep_archived_days } }),
    });
    if (lfs) await s.enableLfs();
    const lines = [`AhemUI initialised in ${s.dir}`, `config: ${JSON.stringify(await s.config())}`];
    const tarball = join(here, "..", "vendor", VENDOR_TARBALL);
    const version = pluginVersion();
    // Release plugins install the same version from npm; local plugin builds (x.y.z-dev.<id>) aren't published.
    if (!vendor && isRelease(version)) {
      lines.push(`Install it with: npm i -D ahemui@${version}  (pnpm add -D / yarn add -D work too)`);
    } else if (existsSync(tarball)) {
      await mkdir(join(s.dir, "vendor"), { recursive: true });
      const dest = join(s.dir, "vendor", VENDOR_TARBALL);
      await copyFile(tarball, dest);
      lines.push(`Vendored ahemui → ${relative(root, dest).split("\\").join("/")}`);
      lines.push(`Install it with: npm i -D ./.ahemui/vendor/${VENDOR_TARBALL}  (pnpm add -D / yarn add -D work too)`);
    } else {
      lines.push(`(vendor tarball missing at ${tarball}; build the ahemui repo to include it)`);
    }
    return lines.join("\n");
  },
);

function isLocal(url: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost|.+\.test)$/.test(new URL(url).hostname);
}

// ——— external trackers (Linear, Jira, Notion, GitHub…) through the user's own MCP servers ———

const TRACKER_HINTS: Record<Tracker["kind"], string> = {
  linear:
    "Use the Linear MCP server's tools (e.g. create/update issue, create comment, list issue statuses). Priority: high→High (or Urgent for broken prod), normal→Medium, low→Low.",
  jira:
    "Use the Atlassian/Jira MCP server's tools (e.g. create issue, get transitions + transition issue, add comment). Pick the issue type from the item's type (bug→Bug, otherwise Task/Story) unless the instructions say otherwise.",
  notion:
    "Use the Notion MCP server's tools to create a page in the target database (title property = ticket title; map Status/Type/Area/Priority to matching properties if they exist) and to add comments.",
  github: "Use the GitHub MCP server's issue tools (create issue, add comment, update/close issue). Map type and priority to labels.",
  other: "Use whichever connected MCP server manages the target described below.",
};

tool(
  "ahemui_board",
  "Where to see the backlog as a page: the live board URL (if ahemui serve is running for this repo, e.g. inside the Vite dev server) and a freshly written read-only snapshot at .ahemui/backlog.html.",
  {},
  async () => {
    const s = store();
    const { port } = await s.config();
    let live: string | null = null;
    for (let p = port; p < port + 10 && !live; p++) {
      const base = `http://127.0.0.1:${p}`;
      const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })
        .then((r) => r.json())
        .catch(() => null);
      if (health?.name === "ahemui" && health.root === s.root) live = `${base}/`;
    }
    const snapshot = await exportBoard(s);
    return [
      live ? `Live board (actions, live updates): ${live}` : "No ahemui serve running for this repo, so there's no live board. Start the dev server, or run `npx ahemui board`.",
      `Snapshot (read-only, opens from disk): ${snapshot}`,
    ].join("\n");
  },
);

tool(
  "ahemui_tracker",
  "Show the external tracker (Linear, Jira, Notion, GitHub…) this repo's AhemUI items are mirrored to, with guidance for creating and updating tickets through that tracker's MCP server.",
  {},
  async () => {
    const t = (await store().config()).tracker;
    if (!t) return 'No tracker configured: the repo backlog (.ahemui/) is the only backlog. Set one with ahemui_set_tracker.';
    return [
      `Tracker: ${t.kind}`,
      `Target: ${t.target}`,
      `Sync: ${t.sync}${t.sync === "auto" ? " (triage/work/watch create and update tickets as they go)" : " (only /ahemui:sync)"}`,
      t.labels.length ? `Labels on every ticket: ${t.labels.join(", ")}` : "",
      t.instructions ? `Team conventions: ${t.instructions}` : "",
      "",
      TRACKER_HINTS[t.kind],
      "Tool names differ between MCP servers. Find the connected one for this tracker; if none is connected, tell the user to enable it rather than improvising.",
      "Use ahemui_ticket to render an item as a ticket, and ahemui_link to record the ticket on the item.",
    ]
      .filter((l) => l !== "")
      .join("\n");
  },
);

tool(
  "ahemui_set_tracker",
  "Configure (or clear) the external tracker in .ahemui/config.json. Commit the change so the whole team mirrors to the same place.",
  {
    kind: z.enum(TRACKERS).nullable().describe("null removes the tracker"),
    target: z.string().max(300).optional().describe('Where tickets go, e.g. "Linear team ENG, project Website" or "Jira project WEB"'),
    sync: z.enum(["manual", "auto"]).optional(),
    labels: z.array(z.string().max(40)).max(10).optional(),
    instructions: z.string().max(1000).optional().describe("Team conventions for tickets"),
  },
  async ({ kind, target, ...rest }) => {
    if (kind === null) {
      await store().setTracker(null);
      return "Tracker removed; the repo backlog is the only backlog.";
    }
    if (!target) throw new AhemError("target is required");
    const config = await store().setTracker({ kind, target, ...rest });
    return `Tracker set: ${JSON.stringify(config.tracker)}`;
  },
);

tool(
  "ahemui_ticket",
  "Render a AhemUI item as a tracker ticket: title, markdown description (request, page, element, source, environment, screenshot path, back-link), suggested labels and priority, plus the screenshot image for trackers whose MCP can attach it.",
  idArg,
  async ({ id }) => {
    const s = store();
    const it = await s.get(id);
    const tracker = (await s.config()).tracker;
    const p = it.page ?? {};
    const shot = s.shotPath(it);
    const branch = gitBranch(s.root);
    const pageLine = [p.heading || p.title, p.routePattern ?? it.route, p.routeName && `(${p.routeName})`, p.section && `› ${p.section}`]
      .filter(Boolean)
      .join(" ");
    const element = [it.anchor.text && `"${it.anchor.text}"`, it.anchor.source && `\`${it.anchor.source}\``, it.anchor.components?.length && `(${it.anchor.components.join(" › ")})`]
      .filter(Boolean)
      .join(" ");
    const description = [
      `**Request** (captured with AhemUI by ${it.author}, ${it.created.slice(0, 10)})`,
      "",
      it.body
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n"),
      "",
      "**Where**",
      pageLine && `- Page: ${pageLine}`,
      it.url && `- URL: ${it.url}${p.env ? ` (${p.env})` : ""}`,
      element && `- Element: ${element}`,
      p.pageFile && `- Page component: \`${p.pageFile}\``,
      (p.browser || it.viewport) && `- Seen in: ${[p.browser, it.viewport, p.colorScheme && `${p.colorScheme} mode`].filter(Boolean).join(", ")}`,
      it.design && `- Design: ${it.design}`,
      it.steps?.length && `\n**Steps before capture**\n${it.steps.map((st, i) => `${i + 1}. ${st.kind}${st.target ? ` ${st.target}` : ""}${st.detail ? ` (${st.detail})` : ""}`).join("\n")}`,
      (it.evidence?.console?.length || it.evidence?.network?.length) &&
        `\n**Errors on the page**\n${[...(it.evidence?.console ?? []).map((c) => `- console.${c.level}: ${c.message.split("\n")[0]}`), ...(it.evidence?.network ?? []).map((n) => `- ${n.method} ${n.url} → ${n.status || "network error"}`)].join("\n")}`,
      "",
      shot && `**Screenshot:** \`${relative(s.root, shot).split("\\").join("/")}\`${branch ? ` on branch \`${branch}\`` : ""} (attached if the tracker supports it)`,
      `AhemUI-Item: \`${it.id}\``,
    ]
      .filter((l): l is string => typeof l === "string")
      .join("\n")
      .replace(/\n{3,}/g, "\n\n"); // empty optional lines collapse into one blank line
    const title = it.body.split("\n")[0].trim().slice(0, 90);
    const labels = [...(tracker?.labels ?? []), it.type, ...(it.labels ?? [])].filter(Boolean);
    const text = [
      `Title: ${title}`,
      `Labels: ${labels.join(", ") || "(none)"}`,
      `Priority: ${it.priority ?? "normal"}${it.start === "now" ? " (sent with Start now)" : ""}`,
      it.area && `Area: ${it.area}`,
      it.external && `Already linked: ${it.external.tracker} ${it.external.key}${it.external.url ? ` ${it.external.url}` : ""}`,
      "",
      "Description (markdown):",
      "",
      description,
    ]
      .filter((l): l is string => typeof l === "string")
      .join("\n");
    const content: Content[] = [{ type: "text", text }];
    if (shot && existsSync(shot)) content.push(await imageContent(shot));
    return content;
  },
);

tool(
  "ahemui_link",
  "Record the tracker ticket a AhemUI item is mirrored to (or unlink with key: null). The browser popover then shows the ticket key.",
  {
    ...idArg,
    key: z.string().max(80).nullable().describe('Ticket key, e.g. "ENG-123"; null unlinks'),
    url: z.string().max(500).optional(),
    status: z.string().max(80).optional().describe("Current status in the tracker"),
    tracker: z.enum(TRACKERS).optional().describe("Defaults to the configured tracker"),
  },
  async ({ id, key, url, status, tracker }) => {
    const s = store();
    if (key === null) return summary(await s.link(id, null));
    const kind = tracker ?? (await s.config()).tracker?.kind;
    if (!kind) throw new AhemError("no tracker configured; pass tracker or run ahemui_set_tracker");
    return summary(await s.link(id, { tracker: kind, key, url, status }));
  },
);

function gitBranch(root: string): string | null {
  try {
    return execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

async function imageContent(path: string): Promise<Content> {
  const ext = path.split(".").pop()!;
  return { type: "image", data: (await readFile(path)).toString("base64"), mimeType: ext === "jpg" ? "image/jpeg" : `image/${ext}` };
}

function claimant(): string {
  return `Claude (${defaultAuthor()})`;
}

const ICON = { open: "○", "in-progress": "◐", review: "◎", done: "✓", wontfix: "✗" } as const;

function summary(it: Item): string {
  const archived = it.location === "done" ? " [archived]" : "";
  const cls = [it.type, it.priority && it.priority !== "normal" ? it.priority : "", it.area, ...(it.labels ?? []).map((l) => `#${l}`)]
    .filter(Boolean)
    .join(" · ");
  const where = [it.page?.section && `› ${it.page.section}`, it.anchor.source ?? (it.page?.env === "deployed" ? `(${new URL(it.url!).host})` : "")]
    .filter(Boolean)
    .join("  ");
  const now =
    (it.start === "now" && it.status === "open" ? " ⚡start-now" : "") + (it.needs_reply ? " ?awaiting-reply" : "") + (it.intent === "review" ? " ◇for-review" : "");
  const ext = it.external ? `  → ${it.external.key}` : "";
  return `${ICON[it.status]} ${it.id}  ${it.status}${now}${archived}${cls ? `  [${cls}]` : "  [untriaged]"}${ext}  ${pageName(it)} ${where}\n    ${it.body.split("\n")[0].slice(0, 140)}`;
}

/** "Pricing (/pricing)" — the page an item is on, for grouping. */
function pageName(it: Item): string {
  const p = it.page;
  const name = p?.heading || p?.title || p?.pageComponent;
  const path = p?.routePattern ?? it.route ?? "?";
  return name ? `${name} (${path})` : path;
}

function stylesLine(st: NonNullable<Item["styles"]>): string {
  return Object.entries(st.computed ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

function ago(ms: number): string {
  return ms < 1000 ? "just" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}min`;
}

async function describe(s: AhemStore, it: Item): Promise<Content[]> {
  const shotPath = s.shotPath(it);
  const rel = (p: string) => relative(s.root, p).split("\\").join("/");
  const a = it.anchor;
  const p = it.page ?? {};
  const cls = [
    it.type && `type: ${it.type}`,
    it.priority && `priority: ${it.priority}`,
    it.area && `area: ${it.area}`,
    it.labels?.length && `labels: ${it.labels.join(", ")}`,
  ].filter(Boolean);
  const lines = [
    `# AhemUI item ${it.id} — ${it.status}${it.location === "done" ? " (archived)" : ""}`,
    cls.length ? `Classification: ${cls.join(" · ")}` : "Classification: not triaged yet",
    it.start === "now" && `Requested: ⚡ Start now (the person is waiting for this one)`,
    it.needs_reply && "Waiting for the requester to answer your question (see the thread below). Don't work it until they reply.",
    it.review?.verdict === "changes" && `Sent back by ${it.review.by} after review: see their Feedback below. The earlier attempt wasn't right.`,
    it.review?.verdict === "approved" && `Approved by ${it.review.by}.`,
    it.design && `Design reference: ${it.design} (compare against it, e.g. with a Figma MCP if connected)`,
    it.external && `Tracker ticket: ${it.external.tracker} ${it.external.key}${it.external.url ? ` ${it.external.url}` : ""}${it.external.status ? ` (status: ${it.external.status})` : ""}`,
    "",
    `**Request** (by ${it.author}, ${it.created}):`,
    "",
    it.body,
    "",
    "## Where",
    `- Route: ${it.route ?? "?"}${it.url ? ` (${it.url})` : ""}${it.viewport ? `, viewport ${it.viewport}` : ""}`,
    it.url && !isLocal(it.url) &&
      `- Captured on a deployed site (${new URL(it.url).host}), not local dev${a.source ? "" : ": no source mapping, so find the code from the text, CSS path and screenshot"}. The deployed build may differ from this branch.`,
    a.source && `- Source: ${a.source}  ← start here`,
    a.components?.length && `- ${p.framework ? p.framework[0].toUpperCase() + p.framework.slice(1) : "Vue"} components: ${a.components.join(" › ")}`,
    a.selector && `- CSS path: \`${a.selector}\``,
    a.text && `- Element text: "${a.text}"`,
    it.claimed_by && `- Claimed by: ${it.claimed_by}`,
    it.resolved_by && `- Resolved by commit: ${it.resolved_by}`,
    "",
    "## Page",
    (p.heading || p.title) && `- Page: ${[p.heading, p.title && p.title !== p.heading ? `title "${p.title}"` : ""].filter(Boolean).join(", ")}`,
    p.description && `- Description: ${p.description}`,
    (p.routeName || p.routePattern) && `- Vue Router: ${[p.routeName && `name "${p.routeName}"`, p.routePattern && `pattern ${p.routePattern}`].filter(Boolean).join(", ")}`,
    p.params && `- Params: ${JSON.stringify(p.params)}`,
    p.routeMeta && `- Route meta: ${JSON.stringify(p.routeMeta)}`,
    (p.pageComponent || p.pageFile) && `- Page component: ${[p.pageComponent, p.pageFile && s.relativeSource(p.pageFile)].filter(Boolean).join(" — ")}`,
    p.storyId && `- Storybook story: ${p.storyTitle ?? p.storyId}${p.storyFile ? ` — ${p.storyFile}` : ""}`,
    p.section && `- Section: ${p.section}`,
    p.landmark && `- Landmark: ${p.landmark}`,
    (p.env || p.browser) &&
      `- Environment: ${[p.env, p.browser, it.viewport && `${it.viewport}${p.dpr ? ` @${p.dpr}x` : ""}`, p.colorScheme && `${p.colorScheme} mode`, p.lang].filter(Boolean).join(", ")}`,
  ];
  if (it.elements?.length && !(it.elements.length === 1 && it.elements[0].source === a.source)) {
    lines.push("", "## Everything inside the highlight");
    for (const el of it.elements) {
      lines.push(`- <${el.tag}>${el.source ? ` ${el.source}` : ""}${el.component ? ` (${el.component})` : ""}${el.text ? ` "${el.text}"` : ""}`);
    }
  }
  for (const [i, ex] of (it.extras ?? []).entries()) {
    lines.push(
      "",
      ex.role === "reference"
        ? `## Example to match (area ${i + 2}): make the target look/behave like this`
        : `## Also applies here (area ${i + 2})`,
      ex.anchor.source && `- Source: ${ex.anchor.source}`,
      ex.anchor.components?.length && `- Components: ${ex.anchor.components.join(" › ")}`,
      ex.anchor.selector && `- CSS path: \`${ex.anchor.selector}\``,
      ex.anchor.text && `- Element text: "${ex.anchor.text}"`,
      ex.styles && `- Styles: ${stylesLine(ex.styles)}`,
    );
  }
  if (it.styles) {
    lines.push("", "## Styles of the highlighted element", `- ${stylesLine(it.styles)}`);
    if (it.styles.tokens) lines.push(`- Design tokens in use: ${Object.entries(it.styles.tokens).map(([k, v]) => `${k}: ${v}`).join("; ")} (prefer changing tokens/classes over hard-coded values)`);
    if (it.styles.classes?.length) lines.push(`- Classes: ${it.styles.classes.join(" ")}`);
  }
  if (it.state) {
    lines.push("", `## Component state${it.state.component ? ` (${it.state.component})` : ""} at capture time${it.state.truncated ? " (truncated)" : ""}`);
    if (it.state.props !== undefined) lines.push(`- props: ${JSON.stringify(it.state.props)}`);
    if (it.state.state !== undefined) lines.push(`- state: ${JSON.stringify(it.state.state)}`);
  }
  if (it.evidence?.console?.length || it.evidence?.network?.length) {
    lines.push("", "## Errors on the page before capture");
    for (const c of it.evidence.console ?? []) lines.push(`- console.${c.level} (${ago(c.ago)} before): ${c.message}`);
    for (const n of it.evidence.network ?? []) lines.push(`- ${n.method} ${n.url} → ${n.status || "network error"}${n.ms ? ` in ${n.ms}ms` : ""} (${ago(n.ago)} before)`);
  }
  if (it.a11y?.length) {
    lines.push("", "## Accessibility issues (axe-core) in the highlighted element");
    for (const v of it.a11y) lines.push(`- [${v.impact ?? "?"}] ${v.id}: ${v.help} (${v.nodes} node(s)${v.targets?.length ? `, e.g. ${v.targets[0]}` : ""})`);
  }
  if (it.steps?.length) {
    lines.push("", "## What the person did just before capturing (oldest first)");
    for (const st of it.steps) lines.push(`- ${ago(st.ago)} before: ${st.kind}${st.target ? ` ${st.target}` : ""}${st.detail ? ` (${st.detail})` : ""}`);
  }
  if (it.redacted) lines.push("", "Parts of the screenshot were blacked out to hide personal data (dark grey blocks).");

  lines.push("", `Item file: ${rel(join(s.itemDir(it.id, it.location), "item.md"))}`);
  const images: [string, string][] = [];
  if (shotPath) images.push([shotPath, "the highlighted area (red strokes, if any, were drawn by the person)"]);
  for (const [i, ex] of (it.extras ?? []).entries()) {
    if (ex.shot) images.push([join(s.itemDir(it.id, it.location), ex.shot), `area ${i + 2} (${ex.role === "reference" ? "example to match" : "also applies here"})`]);
  }
  if (it.after) images.push([join(s.itemDir(it.id, it.location), it.after), "the same spot after the change (taken in the browser for review)"]);
  const present = images.filter(([path]) => existsSync(path));
  if (present.length) lines.push(`Screenshots attached below, in order: ${present.map(([path, what], i) => `${i + 1}. ${rel(path)}: ${what}`).join("; ")}`);

  const content: Content[] = [{ type: "text", text: lines.filter((l): l is string => typeof l === "string").join("\n") }];
  for (const [path] of present) content.push(await imageContent(path));
  return content;
}

await server.connect(new StdioServerTransport());
