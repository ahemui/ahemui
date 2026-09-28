import { checkA11y } from "./a11y.js";
import type { Health, Watcher } from "./api.js";
import { stylesOf } from "./design.js";
import { elementAt, inspectRect, type Inspection, locate } from "./inspect.js";
import { collectPage, LOCAL_HOST } from "./page.js";
import { scrub, scrubDeep, sensitiveRects } from "./redact.js";
import { recentSteps, recordSteps } from "./steps.js";
import { STYLES } from "./styles.js";
import { type Host, type Item, type ItemType, type Page, type Point, type Rect, type Status, type Styles, TYPES } from "./types.js";
import { dictate, voiceSupported } from "./voice.js";

const ICON: Record<Status, string> = { open: "○", "in-progress": "◐", review: "◎", done: "✓", wontfix: "✕" };
const LABEL: Record<Status, string> = { open: "open", "in-progress": "in progress", review: "ready for review", done: "done", wontfix: "won't fix" };

/** Starts the overlay once per page, whichever of the extension or the Vite plugin gets there first. */
export function startOverlay(host: Host): void {
  const root = document.documentElement;
  if (root.hasAttribute("data-ahemui-overlay")) return;
  root.setAttribute("data-ahemui-overlay", host.mode);
  const start = () => new Overlay(host).mount();
  document.body ? start() : addEventListener("DOMContentLoaded", start, { once: true });
}

export function currentRoute(): string {
  return location.pathname + (location.hash.startsWith("#/") ? location.hash : "");
}

const deployed = () => !LOCAL_HOST.test(location.hostname);

declare const __AHEMUI_BUILD__: string | undefined;
const BUILD = typeof __AHEMUI_BUILD__ === "string" ? __AHEMUI_BUILD__ : "dev";

interface Marker {
  el: HTMLElement;
  target?: Element;
  lastLocate: number;
}

/** One highlighted area of a capture: the main one, more places it applies to, or an example to match. */
interface Area {
  role: "main" | "also" | "reference";
  rect: Rect;
  inspection: Inspection;
  styles: Styles;
  shot?: string;
  masked: number;
}

interface Draft {
  areas: Area[];
  page: Page | null;
  adding: "also" | "reference" | null;
  handRedacted: boolean;
}

class Overlay {
  private hostEl = document.createElement("ahemui-overlay");
  private shadow = this.hostEl.attachShadow({ mode: "open" });
  private $ = <T extends Element = HTMLElement>(sel: string) => this.shadow.querySelector(sel) as T;

  private items: Item[] = [];
  private health: Health | null = null;
  private watcher: Watcher | null = null;
  private connected = false;
  private mode: "idle" | "select" | "compose" = "idle";
  /** Which markers to show: everything, only unfinished items, or none. Remembered per site. */
  private markerMode: MarkerMode = loadMarkerMode();
  private drag: { start: Point; freehand: boolean; points: Point[] } | null = null;
  private strokes: Point[][] = [];
  private markers = new Map<string, Marker>();
  private route = currentRoute();
  private frame = 0;
  private popFor: string | null = null;
  private draft: Draft | null = null;
  private chosenType: ItemType | undefined;
  private stopVoice: (() => void) | null = null;
  private seen: Map<string, { status: Status; needs_reply?: boolean }> | null = null;
  private reviewSince = new Map<string, number>();
  private afterTried = new Set<string>();

  constructor(private host: Host) {}

  mount() {
    this.shadow.innerHTML = `
      <style>${STYLES}</style>
      <div class="root">
        <div class="markers"></div>
        <div class="outline"></div>
        <div class="xboxes"></div>
        <div class="layer"></div>
        <div class="hover"></div>
        <div class="sel"></div>
        <svg class="draw"><path d=""></path></svg>
        <div class="bubble">
          <div class="where"></div>
          <div class="page-line"></div>
          <div class="thumb-wrap"><img class="thumb" alt="" hidden><div class="redact-box"></div></div>
          <div class="areas"></div>
          <textarea placeholder="What should change here?"></textarea>
          <input class="design" type="url" placeholder="Design link (Figma, …)" hidden>
          <div class="types">${TYPES.map((t) => `<button class="chip" data-type="${t}">${t}</button>`).join("")}</div>
          <div class="tools">
            <button class="tool add-also" title="Highlight another place this change applies to">+ Area</button>
            <button class="tool add-ref" title="Highlight an example to match: “make it look like this”">+ Like this</button>
            <button class="tool redact" title="Black out parts of the screenshot">▮ Hide</button>
            <button class="tool design-toggle" title="Attach a design link">🔗</button>
            <button class="tool mic" title="Dictate" ${voiceSupported() ? "" : "hidden"}>🎤</button>
          </div>
          <div class="row">
            <span class="hint"></span>
            <span class="buttons"><button class="btn cancel">Cancel</button> <button class="btn submit" title="Save for later: waits in the backlog until someone runs /ahemui:work (Ctrl/⌘+Enter)">Backlog</button> <button class="btn primary start"></button></span>
          </div>
        </div>
        <div class="pop"></div>
        <div class="panel"></div>
        <div class="bar" hidden>
          <button class="capture" title="Capture feedback (Alt+Shift+S). Shift+drag to draw.">✎ AhemUI</button>
          <button class="counts" title="Show backlog"></button>
          <button class="state"><span class="dot"></span></button>
        </div>
        <div class="toast"></div>
      </div>`;
    document.documentElement.appendChild(this.hostEl);
    this.bindEvents();
    recordSteps(this.isOwn, (s) => (deployed() ? scrub(s) : s));
    this.renderBar();
    this.host.transport.start(
      (items, watcher) => {
        this.notifyChanges(items);
        this.items = items;
        if (watcher !== undefined) this.watcher = watcher;
        this.renderAll();
      },
      (health) => {
        this.health = health;
        if (health?.watcher !== undefined) this.watcher = health.watcher;
        this.connected = !!health;
        this.checkBuild();
        this.renderBar();
      },
    );
    setInterval(() => this.captureAfterShots(), 1500);
  }

  private isOwn = (el: Element) => el === this.hostEl || this.hostEl.contains(el);

  // ——— events ———

  private bindEvents() {
    this.$(".capture").addEventListener("click", () => this.toggle());
    this.$(".counts").addEventListener("click", () => this.togglePanel());
    this.$(".state").addEventListener("click", () => this.togglePanel());
    this.host.onToggle?.(() => this.toggle());

    addEventListener(
      "keydown",
      (e) => {
        if (e.altKey && e.shiftKey && e.code === "KeyS") {
          e.preventDefault();
          this.toggle();
        } else if (e.key === "Escape") {
          if (this.mode === "select" && this.draft?.adding) this.cancelAdding();
          else if (this.popFor || this.$(".panel").style.display === "block") this.closePopups();
          else if (this.mode !== "idle") this.setMode("idle");
        }
      },
      true,
    );

    const layer = this.$(".layer");
    layer.addEventListener("mousemove", (e) => this.onMove(e));
    layer.addEventListener("mousedown", (e) => this.onDown(e));
    addEventListener("mouseup", (e) => this.onUp(e), true);

    const ta = this.$<HTMLTextAreaElement>("textarea");
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation(); // keep app shortcuts from firing while typing
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.submit("later");
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submit("now");
      } else if (e.key === "Escape") this.setMode("select");
    });
    this.$(".design").addEventListener("keydown", (e) => e.stopPropagation());
    this.$(".cancel").addEventListener("click", () => this.setMode("select"));
    this.shadow.querySelectorAll<HTMLButtonElement>(".types .chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        const t = chip.dataset.type as ItemType;
        this.chosenType = this.chosenType === t ? undefined : t;
        this.shadow.querySelectorAll(".types .chip").forEach((c) => c.classList.toggle("on", (c as HTMLElement).dataset.type === this.chosenType));
        ta.focus();
      }),
    );
    this.$(".submit").addEventListener("click", () => this.submit("later"));
    this.$(".start").addEventListener("click", () => this.submit("now"));
    this.$(".add-also").addEventListener("click", () => this.startAdding("also"));
    this.$(".add-ref").addEventListener("click", () => this.startAdding("reference"));
    this.$(".design-toggle").addEventListener("click", () => {
      const input = this.$<HTMLInputElement>(".design");
      input.hidden = !input.hidden;
      if (!input.hidden) input.focus();
    });
    this.$(".mic").addEventListener("click", () => this.toggleVoice());
    this.bindRedaction();

    const schedule = () => this.schedule();
    addEventListener("scroll", schedule, { capture: true, passive: true });
    addEventListener("resize", schedule);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    setInterval(() => {
      if (currentRoute() !== this.route) {
        this.route = currentRoute();
        this.closePopups();
        this.renderMarkers();
      } else this.schedule();
    }, 500);

    this.shadow.addEventListener("mousedown", (e) => {
      const t = e.target as Element;
      if (!t.closest(".pop, .marker, .panel, .counts, .state")) this.closePopups();
    });
    document.addEventListener("mousedown", (e) => {
      if (!e.composedPath().includes(this.hostEl)) this.closePopups();
    });
  }

  private toggle() {
    if (!this.connected) {
      this.toast(this.host.disconnectedHint, 6000);
      return;
    }
    this.setMode(this.mode === "idle" ? "select" : "idle");
  }

  private setMode(mode: Overlay["mode"]) {
    this.mode = mode;
    this.drag = null;
    this.strokes = [];
    this.$(".layer").classList.toggle("active", mode !== "idle");
    this.$(".capture").classList.toggle("on", mode !== "idle");
    this.$(".hover").style.display = "none";
    this.$(".draw path").setAttribute("d", "");
    if (mode !== "compose") {
      this.stopVoice?.();
      this.$(".bubble").style.display = "none";
      this.$(".sel").style.display = "none";
      this.$(".xboxes").innerHTML = "";
      this.draft = null;
    }
    if (mode !== "idle") this.closePopups();
  }

  private onMove(e: MouseEvent) {
    if (this.mode !== "select") return;
    if (!this.drag) {
      const el = elementAt(e.clientX, e.clientY, this.isOwn);
      this.box(this.$(".hover"), el?.getBoundingClientRect());
      return;
    }
    const p: Point = [e.clientX, e.clientY];
    if (this.drag.freehand) {
      this.drag.points.push(p);
      this.$(".draw path").setAttribute("d", pathD([...this.strokes, this.drag.points]));
    } else {
      this.$(".hover").style.display = "none";
      if (!this.draft?.adding) this.box(this.$(".sel"), toDomRect(normRect(this.drag.start, p)));
      else this.box(this.$(".hover"), toDomRect(normRect(this.drag.start, p)));
    }
  }

  private onDown(e: MouseEvent) {
    // Pressing outside an empty bubble abandons it and starts a fresh selection.
    if (this.mode === "compose" && !this.$<HTMLTextAreaElement>("textarea").value.trim()) this.setMode("select");
    if (this.mode !== "select" || e.button !== 0) return;
    e.preventDefault();
    const p: Point = [e.clientX, e.clientY];
    this.drag = { start: p, freehand: e.shiftKey, points: [p] };
  }

  private onUp(e: MouseEvent) {
    if (this.mode !== "select" || !this.drag) return;
    const { start, freehand, points } = this.drag;
    this.drag = null;
    const end: Point = [e.clientX, e.clientY];
    // A closed lasso ends where it started, so judge freehand strokes by their extent, not their endpoints.
    const extent = freehand ? bbox(points) : normRect(start, end);
    const moved = Math.max(extent.w, extent.h) > 5;

    let rect: Rect;
    if (freehand && moved) {
      this.strokes.push(points);
      rect = pad(bbox(points), 8);
    } else if (moved) {
      rect = normRect(start, end);
    } else {
      const el = elementAt(end[0], end[1], this.isOwn);
      if (!el) return;
      const b = el.getBoundingClientRect();
      rect = { x: b.left, y: b.top, w: b.width, h: b.height };
    }
    rect = clampToViewport(rect);
    if (this.draft?.adding) this.addArea(rect, this.draft.adding);
    else this.compose(rect);
  }

  // ——— compose ———

  private async compose(rect: Rect) {
    this.draft = { areas: [], page: null, adding: null, handRedacted: false };
    this.chosenType = undefined;
    this.shadow.querySelectorAll(".types .chip").forEach((c) => c.classList.remove("on"));
    this.$<HTMLTextAreaElement>("textarea").value = "";
    const design = this.$<HTMLInputElement>(".design");
    design.value = "";
    design.hidden = true;
    await this.addArea(rect, "main");
  }

  private async addArea(rect: Rect, role: Area["role"]) {
    const draft = this.draft;
    if (!draft) return;
    this.mode = "compose";
    this.$(".hover").style.display = "none";
    if (role === "main") this.box(this.$(".sel"), toDomRect(rect));
    const inspection = inspectRect(rect, this.isOwn, this.host.agent);
    const masks = sensitiveRects(rect, deployed(), this.isOwn);
    const area: Area = { role, rect, inspection, styles: stylesOf(inspection.primary), masked: masks.length };
    try {
      area.shot = await this.host.capture(rect, this.strokes, masks, this.health?.maxBytes ?? 300_000, () => this.hide());
    } catch (err) {
      this.toast(`Screenshot failed: ${(err as Error).message}`, 4000);
    }
    this.strokes = [];
    this.$(".draw path").setAttribute("d", "");
    if (this.draft !== draft) return; // cancelled meanwhile
    draft.areas.push(area);
    draft.adding = null;
    if (role === "main") draft.page = await collectPage(inspection.primary, this.host.agent, inspection.framework);
    if (this.mode !== "compose" || this.draft !== draft) return;
    await this.showBubble();
  }

  private startAdding(role: "also" | "reference") {
    if (!this.draft) return;
    this.draft.adding = role;
    this.mode = "select";
    this.$(".bubble").style.display = "none";
    this.toast(role === "also" ? "Highlight another place this applies to (Esc to go back)" : "Highlight the example to match (Esc to go back)", 4000);
  }

  private cancelAdding() {
    if (!this.draft) return;
    this.draft.adding = null;
    this.mode = "compose";
    this.$(".hover").style.display = "none";
    this.showBubble();
  }

  private async showBubble() {
    const draft = this.draft!;
    const main = draft.areas[0];
    const { anchor } = main.inspection;
    const where = [anchor.source, anchor.components?.slice(-3).join(" › ")].filter(Boolean).join("  ·  ");
    this.$(".where").textContent = where || `<${main.inspection.primary.localName}>`;
    this.$(".page-line").textContent = pageLabel(draft.page, currentRoute()) + (main.masked ? `  ·  ${main.masked} private field(s) masked` : "");
    const thumb = this.$<HTMLImageElement>(".thumb");
    thumb.hidden = !main.shot;
    if (main.shot) {
      thumb.src = main.shot;
      await Promise.race([thumb.decode().catch(() => {}), sleep(300)]); // measure with the thumbnail laid out
    }
    this.renderAreas();

    const bubble = this.$(".bubble");
    bubble.style.display = "block";
    const { top, left } = placeBeside(main.rect, bubble.offsetWidth, bubble.offsetHeight);
    bubble.style.top = `${top}px`;
    bubble.style.left = `${left}px`;
    this.$<HTMLTextAreaElement>("textarea").focus();
  }

  /** Lists the extra areas in the bubble and outlines them on the page. */
  private renderAreas() {
    const extras = this.draft?.areas.slice(1) ?? [];
    const list = this.$(".areas");
    list.innerHTML = extras
      .map((a, i) => {
        const label = a.role === "reference" ? "like" : "also";
        const what = a.inspection.anchor.source ?? a.inspection.anchor.text ?? `<${a.inspection.primary.localName}>`;
        return `<span class="area-chip ${a.role}">${label}: ${esc(what.slice(0, 50))} <button data-i="${i + 1}" title="Remove">✕</button></span>`;
      })
      .join("");
    list.querySelectorAll<HTMLButtonElement>("button[data-i]").forEach((b) =>
      b.addEventListener("click", () => {
        this.draft?.areas.splice(Number(b.dataset.i), 1);
        this.renderAreas();
      }),
    );
    this.$(".xboxes").innerHTML = extras
      .map(
        (a) =>
          `<div class="xbox ${a.role}" style="left:${a.rect.x}px;top:${a.rect.y}px;width:${a.rect.w}px;height:${a.rect.h}px"><span>${a.role === "reference" ? "like this" : "also"}</span></div>`,
      )
      .join("");
  }

  /** Drag on the thumbnail in "Hide" mode to black out part of the screenshot. */
  private bindRedaction() {
    const wrap = this.$(".thumb-wrap");
    const box = this.$(".redact-box");
    const thumb = this.$<HTMLImageElement>(".thumb");
    const toggle = this.$(".redact");
    let active = false;
    let start: Point | null = null;
    toggle.addEventListener("click", () => {
      active = !active;
      toggle.classList.toggle("on", active);
      wrap.classList.toggle("redacting", active);
    });
    const local = (e: MouseEvent): Point => {
      const r = thumb.getBoundingClientRect();
      return [clamp(e.clientX - r.left, 0, r.width), clamp(e.clientY - r.top, 0, r.height)];
    };
    wrap.addEventListener("mousedown", (e) => {
      if (!active || thumb.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      start = local(e);
    });
    wrap.addEventListener("mousemove", (e) => {
      if (!start) return;
      const r = normRect(start, local(e));
      Object.assign(box.style, { display: "block", left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    });
    addEventListener(
      "mouseup",
      async (e) => {
        if (!start) return;
        const r = normRect(start, local(e));
        start = null;
        box.style.display = "none";
        const main = this.draft?.areas[0];
        if (!main?.shot || r.w < 3 || r.h < 3) return;
        const k = thumb.naturalWidth / thumb.clientWidth;
        const canvas = document.createElement("canvas");
        canvas.width = thumb.naturalWidth;
        canvas.height = thumb.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(thumb, 0, 0);
        ctx.fillStyle = "#3a3d45";
        ctx.fillRect(r.x * k, r.y * k, r.w * k, r.h * k);
        main.shot = canvas.toDataURL("image/webp", 0.9);
        thumb.src = main.shot;
        this.draft!.handRedacted = true;
      },
      true,
    );
  }

  private toggleVoice() {
    const mic = this.$(".mic");
    if (this.stopVoice) return this.stopVoice();
    const ta = this.$<HTMLTextAreaElement>("textarea");
    const before = ta.value.trim();
    mic.classList.add("on");
    this.stopVoice = dictate(
      (text) => (ta.value = before ? `${before} ${text}` : text),
      (error) => {
        mic.classList.remove("on");
        this.stopVoice = null;
        if (error) this.toast(`Dictation: ${error}`, 4000);
        ta.focus();
      },
    );
  }

  /** Hides the overlay for a clean screenshot; resolves with a function that shows it again. */
  private async hide(): Promise<() => void> {
    this.hostEl.style.visibility = "hidden";
    // Two frames so the hide is painted; the timeout covers background tabs where rAF is paused.
    await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), sleep(150)]);
    await sleep(30);
    return () => (this.hostEl.style.visibility = "");
  }

  /** Both actions put the item in the backlog; "now" also asks a watching Claude session to start on it. */
  private async submit(start: "now" | "later") {
    const draft = this.draft;
    const ta = this.$<HTMLTextAreaElement>("textarea");
    const prompt = ta.value.trim();
    if (!prompt || !draft?.areas.length) return;
    if (start === "now") this.host.prepareNotifications?.();
    this.stopVoice?.();
    const buttons = [this.$<HTMLButtonElement>(".submit"), this.$<HTMLButtonElement>(".start")];
    buttons.forEach((b) => (b.disabled = true));
    const [main, ...extras] = draft.areas;
    // On deployed sites everything captured from the page is scrubbed of emails, long numbers and URL queries.
    const clean = <T>(v: T): T => (deployed() ? scrubDeep(v) : v);
    try {
      const evidence = this.host.agent.evidence();
      let a11y;
      if (this.chosenType === "a11y") a11y = await checkA11y(main.inspection.primary).catch(() => undefined);
      const design = this.$<HTMLInputElement>(".design").value.trim();
      const item = await this.host.transport.request<Item>("POST", "/api/items", {
        prompt,
        route: currentRoute(),
        url: deployed() ? location.origin + location.pathname : location.href,
        viewport: `${innerWidth}x${innerHeight}`,
        page: clean(draft.page ?? undefined),
        type: this.chosenType,
        start,
        design: design || undefined,
        rect: docRect(main.rect),
        anchor: clean(main.inspection.anchor),
        elements: clean(main.inspection.elements),
        styles: main.styles,
        state: clean(this.host.agent.state(main.inspection.primary)),
        evidence: evidence.console?.length || evidence.network?.length ? clean(evidence) : undefined,
        a11y,
        steps: recentSteps(),
        redacted: draft.areas.some((a) => a.masked > 0) || draft.handRedacted || undefined,
        shot: main.shot,
        extras: extras.length
          ? extras.map((a) => ({ role: a.role, rect: docRect(a.rect), anchor: clean(a.inspection.anchor), elements: clean(a.inspection.elements), styles: a.styles }))
          : undefined,
        extraShots: extras.length ? extras.map((a) => a.shot ?? null) : undefined,
      });
      if (!this.items.some((i) => i.id === item.id)) this.items.push(item);
      this.renderAll();
      if (start === "later") this.toast("Saved to the backlog ✓");
      else this.toastQueued();
      this.setMode("select"); // stay in capture mode for the next note; Esc exits
    } catch (err) {
      this.toast(`Could not queue: ${(err as Error).message}`, 5000);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  // ——— review loop: notifications and after-shots ———

  /** Tells the person when Claude finishes something or asks them a question. */
  private notifyChanges(items: Item[]) {
    const prev = this.seen;
    this.seen = new Map(items.map((i) => [i.id, { status: i.status, needs_reply: i.needs_reply }]));
    for (const it of items) if (it.status === "review" && !this.reviewSince.has(it.id)) this.reviewSince.set(it.id, Date.now());
    if (!prev) return;
    for (const it of items) {
      const was = prev.get(it.id);
      if (!was) continue;
      const title = it.body.split("\n")[0].slice(0, 120);
      if (it.status === "review" && was.status !== "review") this.alert("Ready for review", title, `${it.id}:review`);
      else if (it.needs_reply && !was.needs_reply) this.alert("Claude has a question", lastEntry(it.body, "Question") ?? title, `${it.id}:q`);
      else if (it.status === "done" && was.status === "in-progress") this.alert("Done", title, `${it.id}:done`);
    }
  }

  private alert(title: string, body: string, tag: string) {
    this.toast(`${title}: ${body}`, 5000);
    this.host.notify?.(`AhemUI — ${title}`, body, tag);
  }

  /**
   * Once an item is in review and its element is on screen, photograph the same spot so the reviewer (and anyone
   * reading the item or ticket later) gets a before/after pair. Waits a moment so HMR has applied the change.
   */
  private async captureAfterShots() {
    if (this.mode !== "idle" || document.visibilityState !== "visible" || !this.connected) return;
    for (const item of this.visibleItems()) {
      if (item.status !== "review" || item.after || this.afterTried.has(item.id)) continue;
      if (Date.now() - (this.reviewSince.get(item.id) ?? Date.now()) < 2000) continue;
      const target = this.markers.get(item.id)?.target;
      const b = target?.getBoundingClientRect();
      if (!b || b.width === 0 || b.top < 0 || b.left < 0 || b.bottom > innerHeight || b.right > innerWidth) continue;
      this.afterTried.add(item.id);
      const rect = clampToViewport(pad({ x: b.left, y: b.top, w: b.width, h: b.height }, 12));
      try {
        const shot = await this.host.capture(rect, [], sensitiveRects(rect, deployed(), this.isOwn), this.health?.maxBytes ?? 300_000, () => this.hide());
        if (shot) await this.host.transport.request("POST", `/api/items/${item.id}/after`, { shot });
      } catch {
        /* best effort; the reviewer can still look at the page itself */
      }
      return; // one per tick keeps the page calm
    }
  }

  // ——— rendering ———

  private renderAll() {
    this.renderBar();
    this.renderMarkers();
    if (this.popFor) this.openPop(this.popFor);
    if (this.$(".panel").style.display === "block") this.renderPanel();
  }

  private warnedBuild = false;

  /**
   * The page's overlay and the project's AhemUI server come from separate installs (the vendored package, or the
   * unpacked extension). If they differ, keys and buttons may not match what the server and docs expect.
   */
  private checkBuild() {
    const server = this.health?.build;
    this.stale = !!server && server !== "dev" && BUILD !== "dev" && server !== BUILD;
    if (!this.stale || this.warnedBuild) return;
    this.warnedBuild = true;
    this.toast(
      this.host.mode === "ext"
        ? "The AhemUI extension is a different build than this project's AhemUI. Reload it in vivaldi://extensions (or chrome://extensions), then reload this page."
        : "AhemUI was updated. Restart the dev server if you haven't yet, then reload this page.",
      9000,
    );
  }
  private stale = false;

  private toastQueued() {
    if (this.watcher?.state === "waiting") this.toast("⚡ Claude is starting on it", 3000);
    else if (this.watcher?.state === "working") this.toast("Added to the queue: Claude picks it up after the current item", 4000);
    else this.toast("Queued, but no Claude session is watching yet. Run /ahemui:watch in Claude Code to start it.", 6000);
  }

  /** Moves a backlog item into the queue (or back); the watching Claude session picks queued items up. */
  private async queueItem(id: string, start: "now" | "later" = "now") {
    try {
      const updated = await this.host.transport.request<Item>("POST", `/api/items/${id}/start`, { start });
      this.items = this.items.map((i) => (i.id === updated.id ? updated : i));
      this.renderAll();
      if (start === "now") this.toastQueued();
      else this.toast("Moved back to the backlog");
    } catch (err) {
      this.toast((err as Error).message, 4000);
    }
  }

  private startLabel(): string {
    return this.watcher?.state === "working" ? "Add to queue" : "⚡ Start";
  }

  /** The primary action says what will actually happen: start now, or join the queue behind Claude's current item. */
  private renderActions() {
    const busy = this.watcher?.state === "working";
    const start = this.$(".start");
    start.textContent = busy ? "Add to queue" : "⚡ Start now";
    start.title = busy
      ? "Claude is working on another item; this one goes next in line (Enter)"
      : this.watcher
        ? "Claude starts on it right away (Enter)"
        : "Queue it for Claude to start as soon as a session runs /ahemui:watch (Enter)";
    this.$(".hint").textContent = `Enter ${busy ? "queue" : "start now"} · Ctrl+Enter backlog`;
  }

  private renderBar() {
    this.renderActions();
    const bar = this.$(".bar");
    // As an extension on arbitrary localhost pages, stay invisible until a server claims this origin.
    bar.hidden = this.host.mode === "ext" && !this.connected;
    const active = this.items.filter((i) => i.location === "items");
    const n = (s: Status) => active.filter((i) => i.status === s).length;
    const asks = active.filter((i) => i.needs_reply).length;
    // Only what needs attention; done counts, project and Claude's state live in the panel header.
    const counts = [
      n("open") ? `<b>${ICON.open}</b>${n("open")}` : "",
      n("in-progress") ? `<b>${ICON["in-progress"]}</b>${n("in-progress")}` : "",
      n("review") ? `<b class="rv">${ICON.review}</b>${n("review")}` : "",
      asks ? `<b class="ask">?</b>${asks}` : "",
    ].filter(Boolean);
    this.$(".counts").innerHTML = counts.length ? counts.join("&nbsp; ") : `<span class="none">☰</span>`;
    const dot = this.$(".dot");
    dot.classList.toggle("ok", this.connected);
    dot.classList.toggle("watching", this.watcher?.state === "waiting");
    dot.classList.toggle("working", this.watcher?.state === "working");
    dot.classList.toggle("stale", this.stale);
    this.$(".state").title = this.statusLines().join("\n");
    if (this.$(".panel").style.display === "block") this.renderPanel();
  }

  /** Project, branch, Claude's state and server details: the bar's tooltip and the panel header. */
  private statusLines(): string[] {
    const h = this.health;
    if (!h) return ["Not connected to ahemui serve"];
    const w = this.watcher;
    return [
      `${h.project ?? "project"}${h.branch ? ` · ${h.branch}` : ""}`,
      w ? (w.state === "waiting" ? "Claude is watching for Start now" : "Claude is working") : "No Claude session watching (run /ahemui:watch)",
      ...(this.stale ? [`Overlay build ${BUILD} ≠ server build ${h.build}: reload the page${this.host.mode === "ext" ? " and the AhemUI extension" : ""}`] : []),
    ];
  }

  private panelHead(): string {
    const [proj, claude, stale] = this.statusLines();
    const w = this.watcher;
    const mode = (m: MarkerMode, label: string, title: string) =>
      `<button class="${this.markerMode === m ? "on" : ""}" data-mode="${m}" title="${title}">${label}</button>`;
    return `<div class="panel-head">
        <div class="grow"><div class="proj">${esc(proj)}</div><div class="claude ${w ? "live" : ""}">${esc(claude ?? "")}</div>${stale ? `<div class="stale-note">${esc(stale)}</div>` : ""}</div>
        <div class="seg" title="Which markers to show on the page">${mode("all", "All", "Show every marker")}${mode("active", "Open", "Hide finished markers (✓, won't fix)")}${mode("none", "None", "Hide markers")}</div>
      </div>`;
  }

  private visibleItems(): Item[] {
    return this.items.filter((i) => i.location === "items" && i.route === this.route && sameSite(i.url));
  }

  private renderMarkers() {
    const wanted =
      this.markerMode === "none"
        ? []
        : this.visibleItems().filter((i) => this.markerMode === "all" || (i.status !== "done" && i.status !== "wontfix"));
    const keep = new Set(wanted.map((i) => i.id));
    for (const [id, m] of this.markers) {
      if (!keep.has(id)) {
        m.el.remove();
        this.markers.delete(id);
      }
    }
    let n = 0;
    for (const item of wanted) {
      let m = this.markers.get(item.id);
      if (!m) {
        const el = document.createElement("div");
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          this.popFor === item.id ? this.closePopups() : this.openPop(item.id);
        });
        el.addEventListener("mouseenter", () => this.box(this.$(".outline"), this.markers.get(item.id)?.target?.getBoundingClientRect()));
        el.addEventListener("mouseleave", () => (this.$(".outline").style.display = "none"));
        this.$(".markers").appendChild(el);
        m = { el, lastLocate: 0 };
        this.markers.set(item.id, m);
      }
      n++;
      const asking = item.needs_reply && item.status === "open";
      m.el.className = `marker ${item.status}${asking ? " ask" : ""}`;
      m.el.textContent = asking
        ? "?"
        : item.status === "done" || item.status === "wontfix" || item.status === "review"
          ? ICON[item.status]
          : item.start === "now" && item.status === "open"
            ? "⚡"
            : String(n);
      m.el.title = `${asking ? "Claude has a question" : LABEL[item.status]} — ${item.body.split("\n")[0]}`;
    }
    this.schedule();
  }

  private schedule() {
    if (this.frame) return;
    const run = () => {
      if (!this.frame) return;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.positionMarkers();
    };
    this.frame = requestAnimationFrame(run);
    setTimeout(run, 250); // rAF is paused in background/unpainted tabs; markers still need their targets
  }

  private positionMarkers() {
    const now = Date.now();
    for (const item of this.visibleItems()) {
      const m = this.markers.get(item.id);
      if (!m) continue;
      if ((!m.target || !m.target.isConnected) && now - m.lastLocate > 1000) {
        m.lastLocate = now;
        m.target = locate(item.anchor, this.isOwn);
      }
      let r: { left: number; top: number; right: number; bottom: number } | undefined = m.target?.getBoundingClientRect();
      if (r && r.right - r.left === 0 && r.bottom - r.top === 0) r = undefined; // element hidden (v-if, collapsed)
      if (!r && item.rect) {
        const left = item.rect.x - scrollX;
        const top = item.rect.y - scrollY;
        r = { left, top, right: left + item.rect.w, bottom: top + item.rect.h };
      }
      m.el.classList.toggle("detached", !m.target);
      if (!r || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
        m.el.style.display = "none";
        continue;
      }
      m.el.style.display = "grid";
      m.el.style.left = `${clamp(r.right - 11, 4, innerWidth - 26)}px`;
      m.el.style.top = `${clamp(r.top - 11, 4, innerHeight - 26)}px`;
    }
    if (this.popFor) this.placePop();
  }

  private openPop(id: string) {
    const item = this.items.find((i) => i.id === id);
    const pop = this.$(".pop");
    if (!item) return this.closePopups();
    // Don't wipe a reply or review comment the person is typing when a live update arrives.
    const typing = pop.querySelector<HTMLTextAreaElement>("textarea");
    if (this.popFor === id && typing?.value.trim()) return;
    this.$(".panel").style.display = "none";
    this.popFor = id;
    const asking = item.needs_reply && item.status === "open";
    const src = item.anchor.source ?? item.anchor.components?.join(" › ") ?? item.anchor.selector ?? "";
    const { prompt, thread } = splitThread(item.body);
    const extras = item.extras ?? [];

    let actions: string;
    if (asking) {
      actions = `<textarea class="reply" placeholder="Your answer…"></textarea><div class="actions"><button class="btn primary" data-act="reply">Reply</button></div>`;
    } else if (item.status === "review") {
      actions = `<div class="actions"><button class="btn primary" data-act="approve">Looks good ✓</button><button class="btn" data-act="changes-open">Not quite…</button></div>
        <div class="changes" hidden><textarea class="reply" placeholder="What still needs to change?"></textarea><div class="actions"><button class="btn primary" data-act="changes">Send back</button></div></div>`;
    } else if (item.status === "done" || item.status === "wontfix") {
      actions = `<div class="actions"><button class="btn" data-act="archive" title="Move to .ahemui/done/; the marker leaves the page">Archive</button><button class="btn" data-act="reopen">Reopen</button></div>`;
    } else {
      const queue =
        item.status !== "open"
          ? ""
          : item.start === "now"
            ? `<button class="btn" data-act="later" title="Take it out of the queue; it waits for /ahemui:work">Move to backlog</button>`
            : `<button class="btn primary" data-act="start">${this.startLabel()}</button>`;
      actions = `<div class="actions">${queue}<button class="btn" data-act="done">Mark done</button><button class="btn" data-act="wontfix">Won't fix</button></div>`;
    }

    pop.innerHTML = `
      <div><span class="pill ${asking ? "ask" : item.status}">${asking ? "question for you" : LABEL[item.status]}</span>
        <span class="meta mono">${item.id.slice(0, 14)}</span></div>
      <div class="meta">${esc(item.author)} · ${new Date(item.created).toLocaleString()}${item.claimed_by && item.status === "in-progress" ? ` · ${esc(item.claimed_by)} is on it` : ""}</div>
      <div class="body">${esc(prompt)}</div>
      ${classLine(item) ? `<div class="meta">${esc(classLine(item))}</div>` : ""}
      ${item.external ? `<div class="meta">${esc(item.external.tracker)}: ${item.external.url ? `<a class="ext" href="${esc(item.external.url)}" target="_blank" rel="noopener">${esc(item.external.key)}</a>` : esc(item.external.key)}${item.external.status ? ` · ${esc(item.external.status)}` : ""}</div>` : ""}
      <div class="meta">${esc(pageLabel(item.page, item.route))}</div>
      ${src ? `<div class="meta mono">${esc(src)}</div>` : ""}
      ${extras.length ? `<div class="meta">${extras.filter((e) => e.role === "also").length ? `+${extras.filter((e) => e.role === "also").length} more area(s) ` : ""}${extras.some((e) => e.role === "reference") ? "· with an example to match" : ""}</div>` : ""}
      ${item.design ? `<div class="meta"><a class="ext" href="${esc(item.design)}" target="_blank" rel="noopener">design link</a></div>` : ""}
      ${item.url && !sameSite(item.url) ? `<div class="meta mono">captured on ${esc(new URL(item.url).origin)}</div>` : ""}
      ${
        item.status === "review"
          ? `<div class="compare"><figure><img data-file="${esc(item.shot ?? "")}" alt=""><figcaption>before</figcaption></figure><figure>${item.after ? `<img data-file="${esc(item.after)}" alt="">` : `<div class="pending">capturing…</div>`}<figcaption>after</figcaption></figure></div>`
          : item.shot
            ? `<img class="thumb" data-file="${esc(item.shot)}" alt="">`
            : ""
      }
      ${thread.length ? `<div class="thread">${thread.map((t) => `<div class="entry ${t.kind.toLowerCase()}"><div class="who">${esc(t.kind)} · ${esc(t.who)}</div>${esc(t.text)}</div>`).join("")}</div>` : ""}
      ${actions}
      <div class="actions subtle"><button class="btn" data-act="copy">Copy id</button>${this.health?.base ? `<a class="btn" href="${esc(this.health.base)}/#${item.id}" target="_blank" rel="noopener">Open in board ↗</a>` : ""}</div>`;

    pop.querySelectorAll<HTMLImageElement>("img[data-file]").forEach((img) => {
      if (!img.dataset.file) return img.remove();
      this.host.transport.fileSrc(item.id, img.dataset.file).then((src) => (img.src = src), () => img.remove());
      img.title = "Open full size";
      img.addEventListener("click", () => {
        // data: URLs (extension mode) can't be opened as a top-level page, so show those in a blank tab's <img>.
        if (img.src.startsWith("data:")) {
          const w = open();
          if (w) w.document.write(`<body style="margin:0;background:#111"><img src="${img.src}" style="max-width:100%">`);
        } else open(img.src, "_blank", "noopener");
      });
    });
    pop.querySelectorAll("textarea").forEach((t) => t.addEventListener("keydown", (e) => e.stopPropagation()));
    pop.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) =>
      b.addEventListener("click", async () => {
        const act = b.dataset.act!;
        const text = pop.querySelector<HTMLTextAreaElement>(act === "changes" ? ".changes textarea" : "textarea.reply")?.value.trim() ?? "";
        try {
          let updated: Item | undefined;
          if (act === "copy") {
            await navigator.clipboard.writeText(item.id);
            return this.toast("Copied");
          } else if (act === "start" || act === "later") {
            return this.queueItem(item.id, act === "start" ? "now" : "later");
          } else if (act === "changes-open") {
            const box = pop.querySelector<HTMLElement>(".changes")!;
            box.hidden = false;
            box.querySelector("textarea")!.focus();
            return;
          } else if (act === "reply") {
            if (!text) return this.toast("Type an answer first");
            updated = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/reply`, { text });
            this.toast("Sent to Claude ✓");
          } else if (act === "approve" || act === "changes") {
            if (act === "changes" && !text) return this.toast("Say what still needs to change");
            updated = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/review`, {
              verdict: act === "approve" ? "approved" : "changes",
              comment: text || undefined,
            });
            this.toast(act === "approve" ? "Approved ✓" : "Sent back to Claude");
          } else if (act === "reopen") {
            updated = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/reopen`, {});
          } else if (act === "archive") {
            updated = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/archive`, {});
            this.closePopups();
            this.toast("Archived");
          } else {
            updated = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/resolve`, { status: act });
          }
          if (updated) {
            this.items = this.items.map((i) => (i.id === updated!.id ? updated! : i));
            pop.querySelectorAll("textarea").forEach((t) => (t.value = ""));
            this.renderAll();
          }
        } catch (err) {
          this.toast((err as Error).message, 4000);
        }
      }),
    );
    pop.style.display = "block";
    this.placePop();
  }

  private placePop() {
    const m = this.popFor && this.markers.get(this.popFor);
    const pop = this.$(".pop");
    if (!m || m.el.style.display === "none") return void (pop.style.display = "none");
    pop.style.display = "block";
    const mr = m.el.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = `${clamp(mr.right + 8 + w > innerWidth ? mr.left - w - 8 : mr.right + 8, 8, innerWidth - w - 8)}px`;
    pop.style.top = `${clamp(mr.top, 8, innerHeight - h - 8)}px`;
  }

  private togglePanel() {
    const panel = this.$(".panel");
    if (panel.style.display === "block") return this.closePopups();
    this.closePopups();
    this.renderPanel();
    panel.style.display = "block";
  }

  private renderPanel() {
    const panel = this.$(".panel");
    const active = this.items.filter((i) => i.location === "items");
    const board = this.health?.base
      ? `<a class="board-link" href="${esc(this.health.base)}/" target="_blank" rel="noopener">Open full board ↗</a>`
      : "";
    const bindHead = () =>
      panel.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          this.markerMode = b.dataset.mode as MarkerMode;
          saveMarkerMode(this.markerMode);
          this.renderMarkers();
          this.renderPanel();
        }),
      );
    if (!active.length) {
      panel.innerHTML = `${this.panelHead()}<div class="empty">Backlog is empty. Press ✎ AhemUI or Alt+Shift+S to capture.</div>${board}`;
      bindHead();
      return;
    }
    // Group by path (+ host for other sites); label each group with the richest page info any item has.
    const groups = new Map<string, Item[]>();
    for (const i of active) {
      const key = (i.page?.routePattern ?? i.route ?? "?") + (sameSite(i.url) ? "" : ` · ${new URL(i.url!).host}`);
      groups.set(key, [...(groups.get(key) ?? []), i]);
    }
    // The route plus a short page name; the page's <h1> is often a whole marketing sentence, so it's left out.
    const groupLabel = (key: string, items: Item[]) => {
      const page = items.find((i) => i.page?.routeName || i.page?.pageComponent)?.page;
      const name = page?.routeName ?? page?.pageComponent?.replace(/(Page|View)$/, "");
      return name ? `${key} · ${name}` : key;
    };
    const rowAction = (i: Item) => {
      if (i.status !== "open" || i.needs_reply) return "";
      if (i.start === "now") return `<span class="queued" title="Waiting for Claude (runs when /ahemui:watch is active)">⚡ queued</span>`;
      return `<button class="btn row-start" data-start="${i.id}" title="Have Claude work on this now">${this.startLabel()}</button>`;
    };
    const row = (i: Item) => `<div class="list-item ${i.route === this.route && sameSite(i.url) ? "" : "elsewhere"}" data-id="${i.id}">
          <span class="pill ${i.needs_reply ? "ask" : i.status}">${i.needs_reply ? "?" : ICON[i.status]}</span>
          <span class="grow"><div>${esc(i.body.split("\n")[0].slice(0, 90))}</div><div class="route">${esc(classLine(i) || i.page?.section || "")}${i.anchor.source ? ` <span class="mono">${esc(i.anchor.source)}</span>` : ""}</div></span>
          ${rowAction(i)}
        </div>`;
    const finished = active.filter((i) => i.status === "done" || i.status === "wontfix").length;
    const clear = finished
      ? `<button class="btn clear-finished" title="Archive every done and won't-fix item (moves them to .ahemui/done/)">Clear ${finished} finished</button>`
      : "";
    panel.innerHTML =
      this.panelHead() +
      [...groups].map(([key, items]) => `<div class="group">${esc(groupLabel(key, items))}</div>${items.map(row).join("")}`).join("") +
      `<div class="panel-foot">${clear}${board}</div>`;
    bindHead();
    panel.querySelector(".clear-finished")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const { archived } = await this.host.transport.request<{ archived: string[] }>("POST", "/api/prune", {});
        this.items = this.items.map((i) => (archived.includes(i.id) ? { ...i, location: "done" } : i));
        this.renderAll();
        this.toast(`Archived ${archived.length} finished item(s)`);
      } catch (err) {
        this.toast((err as Error).message, 4000);
      }
    });
    panel.querySelectorAll<HTMLButtonElement>("button[data-start]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        b.disabled = true;
        this.queueItem(b.dataset.start!);
      }),
    );
    panel.querySelectorAll<HTMLElement>(".list-item").forEach((row) =>
      row.addEventListener("click", () => {
        const item = this.items.find((i) => i.id === row.dataset.id)!;
        if (item.route !== this.route || !sameSite(item.url)) return this.toast(`That item is on ${item.url ?? item.route}`);
        const target = this.markers.get(item.id)?.target;
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(() => this.openPop(item.id), 350);
      }),
    );
  }

  private closePopups() {
    this.popFor = null;
    this.$(".pop").style.display = "none";
    this.$(".panel").style.display = "none";
  }

  // ——— helpers ———

  private box(el: HTMLElement, r?: DOMRect | { left: number; top: number; width: number; height: number }) {
    if (!r) return void (el.style.display = "none");
    Object.assign(el.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  private toastTimer = 0;
  private toast(msg: string, ms = 1800) {
    const t = this.$(".toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove("show"), ms);
  }
}

const MARKER_KEY = "ahemui:markers";

type MarkerMode = "all" | "active" | "none";

function loadMarkerMode(): MarkerMode {
  try {
    const v = localStorage.getItem(MARKER_KEY);
    return v === "active" || v === "none" ? v : "all";
  } catch {
    return "all";
  }
}

function saveMarkerMode(mode: string) {
  try {
    localStorage.setItem(MARKER_KEY, mode);
  } catch {
    /* storage blocked; the choice just won't survive a reload */
  }
}

/** Splits an item body into the original request and its thread of notes, questions, replies and feedback. */
function splitThread(body: string): { prompt: string; thread: { kind: string; who: string; text: string }[] } {
  const parts = body.split(/\n\n### (Note|Question|Reply|Feedback|Approved) — ([^\n]+)\n\n/);
  const thread: { kind: string; who: string; text: string }[] = [];
  for (let i = 1; i + 2 < parts.length + 1; i += 3) thread.push({ kind: parts[i], who: parts[i + 1].replace(/, \d{4}-\d\d-\d\d \d\d:\d\d$/, ""), text: (parts[i + 2] ?? "").trim() });
  return { prompt: parts[0], thread };
}

function lastEntry(body: string, kind: string): string | undefined {
  return splitThread(body).thread.filter((t) => t.kind === kind).at(-1)?.text;
}

/** Below the selection, else above, else to the right/left, else pinned top-left: never covering the selection if avoidable. */
function placeBeside(r: Rect, w: number, h: number): { top: number; left: number } {
  const gap = 10;
  const hx = clamp(r.x, 8, innerWidth - w - 8);
  if (r.y + r.h + gap + h <= innerHeight - 8) return { top: r.y + r.h + gap, left: hx };
  if (r.y - gap - h >= 8) return { top: r.y - gap - h, left: hx };
  const vy = clamp(r.y, 8, innerHeight - h - 8);
  if (r.x + r.w + gap + w <= innerWidth - 8) return { top: vy, left: r.x + r.w + gap };
  if (r.x - gap - w >= 8) return { top: vy, left: r.x - gap - w };
  return { top: 8, left: 8 };
}

/**
 * Items show on the site they were captured on. Local dev servers count as one site,
 * since Vite may move to another port between runs.
 */
function sameSite(url: string | undefined): boolean {
  if (!url) return true;
  const there = new URL(url);
  if (there.origin === location.origin) return true;
  return LOCAL_HOST.test(there.hostname) && LOCAL_HOST.test(location.hostname);
}

/** "Pricing — /pricing (pricing) › Pro" style label for a page and the section within it. */
function pageLabel(page: Page | null | undefined, route: string | undefined, withSection = true): string {
  const name = page?.storyTitle || page?.heading || page?.title || page?.pageComponent || "";
  const path = page?.routePattern ?? route ?? "";
  const routeName = page?.routeName ? ` (${page.routeName})` : "";
  const section = withSection && page?.section && page.section !== name ? ` › ${page.section}` : "";
  return `${name ? `${name} — ` : ""}${path}${routeName}${section}` || "unknown page";
}

function classLine(it: Item): string {
  return [
    it.start === "now" && it.status === "open" ? "⚡ start now" : "",
    it.external?.key,
    it.type,
    it.priority && it.priority !== "normal" ? `${it.priority} priority` : "",
    it.area,
    it.labels?.map((l) => `#${l}`).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Viewport rect → document coordinates (what items store). */
function docRect(r: Rect): Rect {
  return { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.w), h: Math.round(r.h) };
}
function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}
function bbox(points: Point[]): Rect {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return normRect([Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]);
}
function pad(r: Rect, n: number): Rect {
  return { x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n };
}
function clampToViewport(r: Rect): Rect {
  const x = clamp(r.x, 0, innerWidth);
  const y = clamp(r.y, 0, innerHeight);
  return { x, y, w: Math.max(1, Math.min(r.x + r.w, innerWidth) - x), h: Math.max(1, Math.min(r.y + r.h, innerHeight) - y) };
}
function toDomRect(r: Rect) {
  return { left: r.x, top: r.y, width: r.w, height: r.h };
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function pathD(strokes: Point[][]): string {
  return strokes.map((s) => s.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("")).join("");
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
