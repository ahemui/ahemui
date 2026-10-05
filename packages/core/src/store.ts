import { execFileSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import {
  type Config,
  ConfigSchema,
  type Item,
  ItemMetaSchema,
  type NewItem,
  NewItemSchema,
  type Status,
  type Triage,
  TriageSchema,
  type External,
  ExternalSchema,
  type Tracker,
  TrackerSchema,
  type Watcher,
  WatcherSchema,
  StatusSchema,
  type Batch,
  BatchSchema,
  type Scan,
  ScanSchema,
  type Finding,
  FindingSchema,
  SuggestionSchema,
  type Intent,
  type WatchControl,
  WatchControlSchema,
} from "./schema.js";
import { ulid } from "./ulid.js";

export const AHEMUI_DIR = ".ahemui";
/** The folder name before the project was renamed from Snap to AhemUI; migrated on first use. */
const LEGACY_DIR = ".snap";
const WATCHER_FILE = ".watcher.json";
const CONTROL_FILE = ".watch-control.json";
const ITEM_FILE = "item.md";
type Location = Item["location"];

export class AhemError extends Error {}

export interface Shot {
  data: Buffer;
  ext: "webp" | "png" | "jpg";
}

export class AhemStore {
  readonly dir: string;

  constructor(readonly root: string) {
    this.dir = join(root, AHEMUI_DIR);
  }

  /** Walks up from `cwd` to the nearest directory containing `.ahemui/config.json`. */
  static find(cwd = process.cwd()): AhemStore {
    let dir = resolve(cwd);
    for (;;) {
      if (existsSync(join(dir, AHEMUI_DIR, "config.json"))) return new AhemStore(dir);
      if (existsSync(join(dir, LEGACY_DIR, "config.json")) && !existsSync(join(dir, AHEMUI_DIR))) {
        renameSync(join(dir, LEGACY_DIR), join(dir, AHEMUI_DIR));
        // A watcher recorded by the old Snap CLI watches .snap/, which no longer exists: don't advertise it.
        rmSync(join(dir, AHEMUI_DIR, WATCHER_FILE), { force: true });
        return new AhemStore(dir);
      }
      const parent = dirname(dir);
      if (parent === dir) throw new AhemError(`no ${AHEMUI_DIR}/ found above ${cwd} — run \`ahemui init\``);
      dir = parent;
    }
  }

  static async init(root: string, config: Partial<Config> = {}): Promise<AhemStore> {
    const store = new AhemStore(resolve(root));
    await mkdir(join(store.dir, "items"), { recursive: true });
    await store.ensureGitignore();
    await mkdir(join(store.dir, "done"), { recursive: true });
    // Keep empty dirs in git.
    for (const loc of ["items", "done"]) {
      const keep = join(store.dir, loc, ".gitkeep");
      if (!existsSync(keep)) await writeFile(keep, "");
    }
    const cfgPath = join(store.dir, "config.json");
    if (!existsSync(cfgPath)) {
      await writeFile(cfgPath, JSON.stringify(ConfigSchema.parse(config), null, 2) + "\n");
    }
    return store;
  }

  async config(): Promise<Config> {
    return ConfigSchema.parse(JSON.parse(await readFile(join(this.dir, "config.json"), "utf8")));
  }

  /** Local-only files stay out of git: watcher presence, and the generated backlog.html snapshot. */
  async ensureGitignore(): Promise<void> {
    const file = join(this.dir, ".gitignore");
    const current = existsSync(file) ? await readFile(file, "utf8") : "";
    const lines = current.split(/\r?\n/).filter(Boolean);
    const missing = [WATCHER_FILE, CONTROL_FILE, "backlog.html", ".scans/"].filter((l) => !lines.includes(l));
    if (missing.length) await writeFile(file, [...lines, ...missing].join("\n") + "\n");
  }

  // ——— watcher presence (a Claude session running /ahemui:watch) ———

  async setWatcher(w: Omit<Watcher, "since" | "beat"> | null): Promise<void> {
    const file = join(this.dir, WATCHER_FILE);
    if (!w) return void (await rm(file, { force: true }));
    await this.ensureGitignore();
    const now = new Date().toISOString();
    await writeFile(file, JSON.stringify({ ...w, since: now, beat: now }));
  }

  /** Called every 30 s by the waiting process, so a crashed or killed watcher stops showing as "watching". */
  async heartbeat(pid = process.pid): Promise<void> {
    const file = join(this.dir, WATCHER_FILE);
    try {
      const w = WatcherSchema.parse(JSON.parse(await readFile(file, "utf8")));
      if (w.pid !== pid) return; // another session took over
      await writeFile(file, JSON.stringify({ ...w, beat: new Date().toISOString() }));
    } catch {
      /* no watcher file: nothing to refresh */
    }
  }

  /**
   * The current watcher, or null when nobody is listening. A waiting watcher must still be running;
   * a working one (its wait process has exited while Claude works) counts for up to 30 minutes.
   */
  async watcher(): Promise<Watcher | null> {
    let w: Watcher;
    try {
      w = WatcherSchema.parse(JSON.parse(await readFile(join(this.dir, WATCHER_FILE), "utf8")));
    } catch {
      return null;
    }
    const age = (iso?: string) => (iso ? Date.now() - Date.parse(iso) : Infinity);
    // Waiting: the process must exist and have beaten in the last 90 s. Records from before heartbeats get 6 hours,
    // which also retires a process id that the OS has since handed to something else.
    const waitingAlive = processAlive(w.pid) && (w.beat ? age(w.beat) < 90_000 : age(w.since) < 6 * 3600_000);
    const alive = w.state === "waiting" ? waitingAlive : age(w.since) < 30 * 60_000;
    if (!alive) return null;
    const control = await this.watchControl();
    return { ...w, paused: control?.mode === "paused" || undefined, stopping: control?.mode === "stop" || undefined };
  }

  /** The browser's pause or stop request for the watching session, if any. */
  async watchControl(): Promise<WatchControl | null> {
    try {
      return WatchControlSchema.parse(JSON.parse(await readFile(join(this.dir, CONTROL_FILE), "utf8")));
    } catch {
      return null;
    }
  }

  /** "paused" holds Start-now items until resumed (null); "stop" ends the watch after the current item. */
  async setWatchControl(mode: WatchControl["mode"] | null, by?: string): Promise<void> {
    const file = join(this.dir, CONTROL_FILE);
    if (!mode) return void (await rm(file, { force: true }));
    await this.ensureGitignore();
    await writeFile(file, JSON.stringify({ mode, at: new Date().toISOString(), by }));
  }

  /** Sets (or with null, removes) the external tracker in .ahemui/config.json. */
  async setTracker(tracker: Partial<Tracker> & Pick<Tracker, "kind" | "target"> | null): Promise<Config> {
    const file = join(this.dir, "config.json");
    const raw = JSON.parse(await readFile(file, "utf8"));
    if (tracker) raw.tracker = TrackerSchema.parse(tracker);
    else delete raw.tracker;
    const config = ConfigSchema.parse(raw);
    await writeFile(file, JSON.stringify(raw, null, 2) + "\n");
    return config;
  }

  /** Records (or with null, removes) the tracker ticket an item is mirrored to. */
  async link(id: string, external: Omit<External, "synced"> | null): Promise<Item> {
    const item = await this.get(id);
    const next: Item = { ...item, external: external ? ExternalSchema.parse({ ...external, synced: new Date().toISOString() }) : undefined };
    return this.save(next);
  }

  itemDir(id: string, location: Location): string {
    return join(this.dir, location, id);
  }

  shotPath(item: Item): string | null {
    return item.shot ? join(this.itemDir(item.id, item.location), item.shot) : null;
  }

  /** Every image an item references (screenshot, extra areas, after-shot), keyed by file name. */
  files(item: Item): string[] {
    return [item.shot, item.after, ...(item.extras ?? []).map((e) => e.shot)].filter((f): f is string => !!f);
  }

  /** Path of one of the item's own image files; anything else is refused. */
  filePath(item: Item, name: string): string {
    if (!this.files(item).includes(name)) throw new AhemError(`${item.id} has no file ${name}`);
    return join(this.itemDir(item.id, item.location), name);
  }

  async list(opts: ListFilter = {}): Promise<Item[]> {
    const locations: Location[] = opts.includeDone ? ["items", "done"] : ["items"];
    const items: Item[] = [];
    for (const loc of locations) {
      for (const id of await this.ids(loc)) {
        const item = await this.read(id, loc).catch(() => null); // skip half-written/corrupt items
        if (item && matches(item, opts)) items.push(item);
      }
    }
    return items.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Sets classification fields; `null` clears one. */
  async triage(id: string, patch: { [K in keyof Triage]?: Triage[K] | null }): Promise<Item> {
    const item = await this.get(id);
    const next: Item = { ...item };
    for (const [k, v] of Object.entries(patch) as [keyof Triage, unknown][]) {
      if (v === undefined) continue;
      (next as any)[k] = v === null ? undefined : TriageSchema.shape[k].parse(v);
    }
    return this.save(next);
  }

  /** Looks up an item by full id or unique prefix, in the backlog first, then the archive. */
  async get(idOrPrefix: string): Promise<Item> {
    const needle = idOrPrefix.toUpperCase();
    const matches: [string, Location][] = [];
    for (const loc of ["items", "done"] as const) {
      for (const id of await this.ids(loc)) if (id.startsWith(needle)) matches.push([id, loc]);
    }
    if (matches.length === 0) throw new AhemError(`no item matching "${idOrPrefix}"`);
    if (matches.length > 1) throw new AhemError(`"${idOrPrefix}" is ambiguous: ${matches.map((m) => m[0]).join(", ")}`);
    return this.read(...matches[0]);
  }

  /** `extraShots[i]` is the screenshot of `input.extras[i]`, if any. */
  // ——— batches (.ahemui/batches/<id>.json) ———

  async createBatch(input: { name: string; intent: Intent; author?: string }): Promise<Batch> {
    const batch = BatchSchema.parse({ id: ulid(), name: input.name.trim(), intent: input.intent, author: input.author ?? defaultAuthor(), created: new Date().toISOString() });
    await mkdir(join(this.dir, "batches"), { recursive: true });
    await writeFile(join(this.dir, "batches", `${batch.id}.json`), JSON.stringify(batch, null, 2) + "\n");
    return batch;
  }

  async listBatches(): Promise<Batch[]> {
    const dir = join(this.dir, "batches");
    const files = existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith(".json")) : [];
    const batches: Batch[] = [];
    for (const f of files) {
      try {
        batches.push(BatchSchema.parse(JSON.parse(await readFile(join(dir, f), "utf8"))));
      } catch {
        /* skip a malformed batch file */
      }
    }
    return batches.sort((a, b) => b.created.localeCompare(a.created));
  }

  /** By id, id prefix or (case-insensitive) name. */
  async findBatch(ref: string): Promise<Batch | null> {
    const all = await this.listBatches();
    const r = ref.trim().toLowerCase();
    return all.find((b) => b.id.toLowerCase().startsWith(r)) ?? all.find((b) => b.name.toLowerCase() === r) ?? null;
  }

  // ——— UX review: page scans and suggestions ———

  private get scansDir() {
    return join(this.dir, ".scans");
  }

  /** Saves a page scan (local only, gitignored) and keeps the newest 20. */
  async saveScan(input: Omit<Scan, "id" | "created" | "shot">, shot?: Shot): Promise<Scan> {
    await this.ensureGitignore();
    await mkdir(this.scansDir, { recursive: true });
    const id = ulid();
    const scan = ScanSchema.parse({ ...input, id, created: new Date().toISOString(), shot: shot ? `${id}.${shot.ext}` : undefined });
    if (shot) await writeFile(join(this.scansDir, scan.shot!), shot.data);
    await writeFile(join(this.scansDir, `${id}.json`), JSON.stringify(scan));
    const old = (await readdir(this.scansDir)).filter((f) => f.endsWith(".json")).sort().reverse().slice(20);
    for (const f of old) {
      const oldId = f.replace(/\.json$/, "");
      for (const g of (await readdir(this.scansDir)).filter((x) => x.startsWith(oldId))) await rm(join(this.scansDir, g), { force: true });
    }
    return scan;
  }

  async listScans(): Promise<Scan[]> {
    if (!existsSync(this.scansDir)) return [];
    const out: Scan[] = [];
    for (const f of (await readdir(this.scansDir)).filter((x) => x.endsWith(".json")).sort().reverse()) {
      try {
        out.push(ScanSchema.parse(JSON.parse(await readFile(join(this.scansDir, f), "utf8"))));
      } catch {
        /* skip a broken scan */
      }
    }
    return out;
  }

  /** By id prefix, or the newest scan of a route ("/pricing"). */
  async getScan(ref: string): Promise<Scan> {
    const all = await this.listScans();
    const r = ref.trim();
    const scan = all.find((s) => s.id.toLowerCase().startsWith(r.toLowerCase())) ?? all.find((s) => s.route === r || s.page?.routePattern === r);
    if (!scan) throw new AhemError(`no page scan matching "${ref}": open the page and press "Review this page" in the AhemUI panel`);
    return scan;
  }

  scanShotPath(scan: Scan): string | null {
    return scan.shot ? join(this.scansDir, scan.shot) : null;
  }

  /** Today's review batch for checks or for Claude ("UX review · 5 Oct"), created on first use. */
  async reviewBatch(by: "checks" | "claude"): Promise<Batch> {
    const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const name = by === "claude" ? `UX review · ${day}` : `Automatic checks · ${day}`;
    return (await this.findBatch(name)) ?? (await this.createBatch({ name, intent: "review", author: by === "claude" ? "Claude (UX review)" : "AhemUI checks" }));
  }

  /**
   * Files findings from a scan as suggestion items in today's review batch, pinned to the elements they're about.
   * A finding about the same element and rule as an open item is skipped, so re-running a review doesn't pile up.
   */
  async suggest(scanRef: string, findings: Finding[], by: "checks" | "claude"): Promise<{ created: Item[]; skipped: number }> {
    const scan = await this.getScan(scanRef);
    const batch = await this.reviewBatch(by);
    const open = await this.list({ status: ["open", "in-progress", "review"] });
    const shotPath = this.scanShotPath(scan);
    const shotData = shotPath && existsSync(shotPath) ? await readFile(shotPath) : undefined;
    const [vw, vh] = scan.viewport.split("x").map(Number);
    /** Where an element sits in the scan's screenshot, as fractions; none when it's mostly off screen. */
    const focusOf = (r: { x: number; y: number; w: number; h: number } | undefined) => {
      if (!r || !vw || !vh || r.w <= 0 || r.h <= 0) return undefined;
      const x = r.x - scan.scroll.x;
      const y = r.y - scan.scroll.y;
      const seen = Math.max(0, Math.min(x + r.w, vw) - Math.max(x, 0)) * Math.max(0, Math.min(y + r.h, vh) - Math.max(y, 0));
      if (seen < r.w * r.h * 0.4) return undefined;
      return { x: x / vw, y: y / vh, w: r.w / vw, h: r.h / vh };
    };
    const created: Item[] = [];
    let skipped = 0;
    for (const raw of findings) {
      const f = FindingSchema.parse(raw);
      const el = f.n !== undefined ? scan.elements.find((e) => e.n === f.n) : undefined;
      const selector = el?.selector ?? f.selector;
      const ruleKey = (f.rule ?? f.request).toLowerCase();
      const dup = open.some(
        (i) => i.anchor.selector === selector && (i.suggestion?.rule ?? i.body.split("\n")[0]).toLowerCase() === ruleKey,
      );
      if (dup) {
        skipped++;
        continue;
      }
      const focus = focusOf(el?.rect);
      const item = await this.create(
        {
          prompt: f.request,
          author: batch.author,
          route: scan.route,
          url: scan.url,
          viewport: scan.viewport,
          page: scan.page,
          type: f.type,
          start: "later",
          batch: batch.id,
          rect: el ? el.rect : undefined,
          anchor: { selector, source: el?.source, text: el?.text },
        },
        // Only a picture that shows the element: the overlay crops it to the element later (shot_focus).
        shotData && focus ? { data: shotData, ext: scan.shot!.split(".").pop() as Shot["ext"] } : undefined,
      );
      const suggestion = SuggestionSchema.parse({ by, severity: f.severity, rule: f.rule, why: f.why, fix: f.fix });
      const saved = await this.save({ ...item, suggestion, shot_focus: item.shot ? focus : undefined });
      open.push(saved);
      created.push(saved);
    }
    return { created, skipped };
  }

  /** Takes a suggestion (or any item flagged for review) on as a change: out of its review batch, onto the queue. */
  async accept(id: string, start: "now" | "later" = "later"): Promise<Item> {
    const item = await this.get(id);
    return this.save({ ...item, batch: undefined, intent: undefined, start });
  }

  /**
   * Moves an item into a batch (or out of any, with null). It takes the batch's intent: into a review batch it
   * leaves the queue (review only, never Start now); into a changes batch it can be worked again.
   */
  async setBatch(id: string, batchRef: string | null): Promise<Item> {
    const item = await this.get(id);
    const batch = batchRef ? await this.findBatch(batchRef) : null;
    if (batchRef && !batch) throw new AhemError(`no batch matching "${batchRef}"`);
    const next: Item = { ...item, batch: batch?.id, intent: batch?.intent === "review" ? "review" : undefined };
    if (next.intent === "review" && next.start === "now") next.start = "later";
    return this.save(next);
  }

  /** Turns a whole batch into changes to make, or into things for review, and its items with it. */
  async setBatchIntent(batchRef: string, intent: Intent): Promise<{ batch: Batch; items: Item[] }> {
    const batch = await this.findBatch(batchRef);
    if (!batch) throw new AhemError(`no batch matching "${batchRef}"`);
    const updated = BatchSchema.parse({ ...batch, intent });
    await writeFile(join(this.dir, "batches", `${batch.id}.json`), JSON.stringify(updated, null, 2) + "\n");
    const items: Item[] = [];
    for (const it of await this.list({ batch: batch.id })) items.push(await this.setBatch(it.id, batch.id));
    return { batch: updated, items };
  }

  async create(input: NewItem, shot?: Shot, extraShots: (Shot | undefined)[] = []): Promise<Item> {
    const { prompt, ...rest } = NewItemSchema.parse(input);
    // Items take their batch's intent; flagged-for-review ones never go straight to Claude.
    const batch = rest.batch ? await this.findBatch(rest.batch) : null;
    if (rest.batch && !batch) delete rest.batch;
    if (batch) {
      rest.batch = batch.id;
      if (batch.intent === "review") {
        (rest as { intent?: Intent }).intent = "review";
        rest.start = "later";
      }
    }
    rest.anchor.source = this.relativeSource(rest.anchor.source);
    for (const el of rest.elements ?? []) el.source = this.relativeSource(el.source);
    for (const ex of rest.extras ?? []) {
      ex.anchor.source = this.relativeSource(ex.anchor.source);
      for (const el of ex.elements ?? []) el.source = this.relativeSource(el.source);
    }
    if (rest.page?.pageFile) rest.page.pageFile = this.relativeSource(rest.page.pageFile);
    if (rest.page?.storyFile) rest.page.storyFile = this.relativeSource(rest.page.storyFile);
    const id = ulid();
    const dir = this.itemDir(id, "items");
    await mkdir(dir, { recursive: true });
    let shotName: string | undefined;
    if (shot) {
      shotName = `shot.${shot.ext}`;
      await writeFile(join(dir, shotName), shot.data);
    }
    const extras = [];
    for (const [i, ex] of (rest.extras ?? []).entries()) {
      const extraShot = extraShots[i];
      let name: string | undefined;
      if (extraShot) {
        name = `shot-${i + 2}.${extraShot.ext}`;
        await writeFile(join(dir, name), extraShot.data);
      }
      extras.push({ ...ex, shot: name });
    }
    const meta = ItemMetaSchema.parse({
      ...rest,
      ...(extras.length && { extras }),
      id,
      status: "open",
      author: rest.author ?? defaultAuthor(),
      created: new Date().toISOString(),
      shot: shotName,
    });
    const item: Item = { ...meta, body: prompt, location: "items" };
    await this.write(item);
    return item;
  }

  /** "/abs/repo/src/A.vue:3" → "src/A.vue:3"; leaves already-relative or out-of-repo paths alone. */
  relativeSource(source: string | undefined): string | undefined {
    if (!source) return source;
    const m = /^(.*?)((?::\d+){0,2})$/.exec(source)!;
    // Vite serves out-of-root files as /@fs/<abs path>; on Windows that's /@fs/C:/...
    const file = m[1].replace(/^\/@fs\/(?=[A-Za-z]:)/, "").replace(/^\/@fs\//, "/");
    if (!isAbsolute(file)) return source;
    const rel = relative(this.root, file);
    if (rel.startsWith("..") || isAbsolute(rel)) return source;
    return rel.split("\\").join("/") + m[2];
  }

  async claim(id: string, who: string, force = false): Promise<Item> {
    const item = await this.get(id);
    if (item.location === "done") throw new AhemError(`${item.id} is archived`);
    if (item.claimed_by && item.claimed_by !== who && item.status === "in-progress" && !force) {
      throw new AhemError(`${item.id} is already claimed by ${item.claimed_by}`);
    }
    return this.save({ ...item, status: "in-progress", claimed_by: who });
  }

  /** Finishes an item. "review" (the default when config.review is on) waits for the requester's approval. */
  async resolve(id: string, opts: { status?: "review" | "done" | "wontfix"; sha?: string; note?: string; author?: string } = {}) {
    let item = await this.get(id);
    if (opts.note) item = appendNote(item, opts.author ?? defaultAuthor(), opts.note);
    const status = opts.status ?? ((await this.config()).review ? "review" : "done");
    return this.save({ ...item, status, needs_reply: undefined, resolved_by: opts.sha ?? item.resolved_by });
  }

  /** Moves an item between the backlog ("later") and the queue a watching Claude session works from ("now"). */
  async setStart(id: string, start: "now" | "later"): Promise<Item> {
    const item = await this.get(id);
    if (item.status !== "open") throw new AhemError(`${item.id} is ${item.status}; only open items can be queued`);
    return this.save({ ...item, start });
  }

  /**
   * Takes an item off the backlog without doing it: won't fix, with a note, straight into the archive. Its marker
   * leaves the page; the item.md stays in git, and restore() brings it back.
   */
  async dismiss(id: string, author?: string): Promise<Item> {
    const item = await this.get(id);
    if (item.location === "done") return item;
    const resolved = await this.resolve(item.id, { status: "wontfix", note: "Dismissed from the backlog.", author });
    return this.move(resolved, "done");
  }

  /** Undo for archive and resolve: back into the backlog if archived, and back to `status` if given. */
  async restore(id: string, status?: Status): Promise<Item> {
    let item = await this.get(id);
    if (item.location === "done") item = await this.move(item, "items");
    // Undoing a dismiss takes its note back out of the thread too.
    const dismissed = /\n\n### Note — [^\n]*\n\nDismissed from the backlog\.\s*$/;
    if (dismissed.test(item.body)) item = await this.save({ ...item, body: item.body.replace(dismissed, "") });
    if (!status || status === item.status) return item;
    return this.save({ ...item, status: StatusSchema.parse(status), ...(status === "open" && { claimed_by: null }) });
  }

  async reopen(id: string): Promise<Item> {
    let item = await this.get(id);
    if (item.location === "done") item = await this.move(item, "items");
    return this.save({ ...item, status: "open", claimed_by: null, resolved_by: null, review: undefined });
  }

  async addNote(id: string, author: string, text: string): Promise<Item> {
    return this.save(appendNote(await this.get(id), author, text));
  }

  /** Claude asks the requester something; the item waits (open, unclaimed) until they reply in the browser. */
  async ask(id: string, author: string, question: string): Promise<Item> {
    const item = appendNote(await this.get(id), author, question, "Question");
    return this.save({ ...item, status: "open", claimed_by: null, needs_reply: true });
  }

  /** The requester answers a question from the browser; the item is ready to be picked up again. */
  async reply(id: string, author: string, text: string): Promise<Item> {
    const item = appendNote(await this.get(id), author, text, "Reply");
    return this.save({ ...item, status: item.status === "in-progress" ? item.status : "open", needs_reply: undefined });
  }

  /** The requester reviews finished work: approve (→ done) or ask for changes (→ open, with their feedback). */
  async review(id: string, author: string, verdict: "approved" | "changes", comment?: string): Promise<Item> {
    let item = await this.get(id);
    if (comment?.trim()) item = appendNote(item, author, comment, verdict === "approved" ? "Approved" : "Feedback");
    const review = { verdict, by: author, at: new Date().toISOString() };
    if (verdict === "approved") return this.save({ ...item, status: "done", review });
    return this.save({ ...item, status: "open", claimed_by: null, review, after: item.after });
  }

  /** Stores the "after" screenshot of the same spot, taken by the overlay once an item is in review. */
  /** Replaces an item's screenshot (a suggestion's, once cropped to its element). */
  async setShot(id: string, shot: Shot): Promise<Item> {
    const item = await this.get(id);
    // Several open tabs may crop the same suggestion; the first one wins and the rest change nothing.
    if (item.suggestion && !item.shot_focus) return item;
    const dir = this.itemDir(item.id, item.location);
    const name = `shot.${shot.ext}`;
    if (item.shot && item.shot !== name) await rm(join(dir, item.shot), { force: true });
    await writeFile(join(dir, name), shot.data);
    // Re-read: the item may have changed (taken on, moved) while the file was written.
    const now = await this.get(id);
    return this.save({ ...now, shot: name, shot_focus: undefined });
  }

  async setAfter(id: string, shot: Shot): Promise<Item> {
    const item = await this.get(id);
    const name = `after.${shot.ext}`;
    await writeFile(join(this.itemDir(item.id, item.location), name), shot.data);
    return this.save({ ...item, after: name });
  }

  /**
   * Moves every done/wontfix item from the backlog into `.ahemui/done/`. With `dropShotsOlderThanDays`, archived
   * items older than that lose their screenshots (the item.md stays) to keep the repo small.
   */
  async prune(opts: { dropShotsOlderThanDays?: number } = {}): Promise<{ moved: Item[]; shotsDropped: number }> {
    const finished = await this.list({ status: ["done", "wontfix"] });
    const moved: Item[] = [];
    for (const item of finished) moved.push(await this.move(item, "done"));
    let shotsDropped = 0;
    const days = opts.dropShotsOlderThanDays ?? (await this.config()).screenshot.keepArchivedDays;
    if (days !== undefined) {
      const cutoff = Date.now() - days * 86_400_000;
      for (const item of await this.list({ includeDone: true })) {
        if (item.location !== "done" || Date.parse(item.created) > cutoff || !this.files(item).length) continue;
        for (const f of this.files(item)) await rm(join(this.itemDir(item.id, "done"), f), { force: true });
        shotsDropped += this.files(item).length;
        const extras = item.extras?.map((e) => ({ ...e, shot: undefined }));
        await this.save(appendNote({ ...item, shot: undefined, after: undefined, extras }, "ahemui", "Screenshots removed when archiving.", "Note"));
      }
    }
    return { moved, shotsDropped };
  }

  /** Bytes of screenshots in the backlog and the archive, so skills can say when the repo is getting heavy. */
  async screenshotBytes(): Promise<{ items: number; done: number }> {
    const size = { items: 0, done: 0 };
    for (const loc of ["items", "done"] as const) {
      for (const id of await this.ids(loc)) {
        const dir = this.itemDir(id, loc);
        for (const f of await readdir(dir).catch(() => [] as string[])) {
          if (/\.(webp|png|jpe?g)$/i.test(f)) size[loc] += (await stat(join(dir, f))).size;
        }
      }
    }
    return size;
  }

  /** Archives one finished (done/wontfix) item: it moves to .ahemui/done/ and its marker leaves the page. */
  async archive(id: string): Promise<Item> {
    const item = await this.get(id);
    if (item.location === "done") return item;
    if (item.status !== "done" && item.status !== "wontfix") throw new AhemError(`${item.id} is ${item.status}; only finished items can be archived`);
    return this.move(item, "done");
  }

  /**
   * Empties the backlog (and with `archive`, .ahemui/done/ too) while keeping the setup: config, vendored package,
   * .gitignore. Returns the ids removed.
   */
  async clear(opts: { archive?: boolean } = {}): Promise<string[]> {
    const removed: string[] = [];
    for (const loc of opts.archive ? (["items", "done"] as const) : (["items"] as const)) {
      for (const id of await this.ids(loc)) {
        await rm(this.itemDir(id, loc), { recursive: true, force: true });
        removed.push(id);
      }
    }
    await rm(join(this.dir, "backlog.html"), { force: true });
    return removed;
  }

  /** Track screenshots with Git LFS (needs `git lfs install` on each machine). */
  async enableLfs(): Promise<void> {
    await writeFile(join(this.dir, ".gitattributes"), ["*.webp", "*.png", "*.jpg"].map((p) => `${p} filter=lfs diff=lfs merge=lfs -text`).join("\n") + "\n");
  }

  private async save(item: Item): Promise<Item> {
    await this.write(item);
    return item;
  }

  private async move(item: Item, to: Location): Promise<Item> {
    const from = this.itemDir(item.id, item.location);
    const dest = this.itemDir(item.id, to);
    await mkdir(dirname(dest), { recursive: true });
    try {
      await rename(from, dest);
    } catch {
      // Windows can refuse a rename while something holds a handle; copy instead.
      await cp(from, dest, { recursive: true });
      await rm(from, { recursive: true, force: true });
    }
    return { ...item, location: to };
  }

  private async ids(loc: Location): Promise<string[]> {
    const dir = join(this.dir, loc);
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  private async read(id: string, location: Location): Promise<Item> {
    const text = await readFile(join(this.itemDir(id, location), ITEM_FILE), "utf8");
    const { data, body } = parseFrontmatter(text);
    return { ...ItemMetaSchema.parse(data), body: body.trimEnd(), location };
  }

  private async write(item: Item): Promise<void> {
    const { body, location, ...meta } = item;
    const file = join(this.itemDir(item.id, location), ITEM_FILE);
    // Write-then-rename so the watcher never sees a half-written file. A temp name per write: two saves of the
    // same item at once must not share one.
    const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
    await writeFile(tmp, stringifyFrontmatter(meta, body));
    try {
      await renameRetrying(tmp, file);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }
}

let tmpSeq = 0;

/**
 * Windows refuses to replace a file another handle has open (a reader, the watcher, an antivirus scan) with
 * EPERM/EBUSY/EACCES for a moment. Try again briefly, as graceful-fs does.
 */
async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 10 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await new Promise((r) => setTimeout(r, 15 * (attempt + 1)));
    }
  }
}

export interface ListFilter {
  status?: Status[];
  includeDone?: boolean;
  /** Route or route pattern prefix, e.g. "/pricing" or "/products/:id". */
  route?: string;
  type?: Item["type"];
  label?: string;
  /** Case-insensitive substring of the area. */
  area?: string;
  /** Only items without a type or area yet. */
  untriaged?: boolean;
  start?: "now" | "later";
  /** true: only items mirrored to a tracker ticket; false: only items without one. */
  linked?: boolean;
  /** false: skip items waiting for the requester's reply. */
  needsReply?: boolean;
  /** "action" skips items flagged for review; "review" keeps only those. */
  intent?: Intent;
  /** Batch id, id prefix or exact name. */
  batch?: string;
}

function matches(it: Item, f: ListFilter): boolean {
  if (f.status && !f.status.includes(it.status)) return false;
  if (f.route && !(it.route?.startsWith(f.route) || it.page?.routePattern?.startsWith(f.route))) return false;
  if (f.type && it.type !== f.type) return false;
  if (f.label && !it.labels?.includes(f.label)) return false;
  if (f.area && !it.area?.toLowerCase().includes(f.area.toLowerCase())) return false;
  if (f.untriaged && it.type && it.area) return false;
  if (f.start && (it.start ?? "later") !== f.start) return false;
  if (f.linked !== undefined && !!it.external !== f.linked) return false;
  if (f.needsReply !== undefined && !!it.needs_reply !== f.needsReply) return false;
  if (f.intent && (it.intent ?? "action") !== f.intent) return false;
  if (f.batch && !(it.batch && it.batch.toLowerCase().startsWith(f.batch.toLowerCase()))) return false;
  return true;
}

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;

/** Work order: "start now" items first, then priority, then page by page (fewer context switches), then oldest. */
export function workOrder(items: Item[]): Item[] {
  const pageKey = (it: Item) => it.page?.routePattern ?? it.route ?? "￿"; // unknown pages last
  return [...items].sort(
    (a, b) =>
      Number(b.start === "now") - Number(a.start === "now") ||
      PRIORITY_RANK[a.priority ?? "normal"] - PRIORITY_RANK[b.priority ?? "normal"] ||
      pageKey(a).localeCompare(pageKey(b)) ||
      a.id.localeCompare(b.id),
  );
}

type NoteKind = "Note" | "Question" | "Reply" | "Feedback" | "Approved";

function appendNote(item: Item, author: string, text: string, kind: NoteKind = "Note"): Item {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return { ...item, body: `${item.body}\n\n### ${kind} — ${author}, ${stamp}\n\n${text.trim()}` };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

let gitName: string | null | undefined;

/** AHEMUI_AUTHOR, else `git config user.name`, else the OS user. */
export function defaultAuthor(): string {
  if (process.env.AHEMUI_AUTHOR) return process.env.AHEMUI_AUTHOR;
  if (gitName === undefined) {
    try {
      gitName = execFileSync("git", ["config", "user.name"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    } catch {
      gitName = null;
    }
  }
  return gitName || process.env.USERNAME || process.env.USER || "unknown";
}
