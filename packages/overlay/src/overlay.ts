import { checkA11y } from "./a11y.js";
import { armDanger, hasArmed } from "./confirm.js";
import { cropToDataUrl, loadImage } from "./crop.js";
import type { Health, Watcher } from "./api.js";
import { stylesOf } from "./design.js";
import { elementAt, inspectRect, type Inspection, locate } from "./inspect.js";
import { collectPage, LOCAL_HOST } from "./page.js";
import { scrub, scrubDeep, sensitiveRects } from "./redact.js";
import { outlinePage, runChecks } from "./review.js";
import { type Batch, cachedPrefs, cachePrefs, DEFAULT_PREFS, matchesShortcut, type Prefs, shortcutFromEvent, shortcutLabel } from "./prefs.js";
import { recentSteps, recordSteps } from "./steps.js";
import { STYLES } from "./styles.js";
import { type Host, type Item, type ItemType, type Page, type Point, type Rect, type Status, type Styles, TYPES } from "./types.js";
import { dictate, voiceSupported } from "./voice.js";

/** Marker and list icons: drawn, so they read at 22px where text glyphs like ◎ blur into a blob. */
const svg = (d: string, fill = false) =>
  `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="${fill ? "currentColor" : "none"}" stroke="${fill ? "none" : "currentColor"}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const GLYPH = {
  done: svg('<path d="M3 8.5l3.2 3.2L13 4.8"/>'),
  wontfix: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
  review: svg('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/>'),
  now: svg('<path d="M9.2 1L3 9.2h4.4L6.6 15 13 6.8H8.6z"/>', true),
  suggest: svg('<path d="M8 1l1.8 5.2L15 8l-5.2 1.8L8 15l-1.8-5.2L1 8l5.2-1.8z"/>', true),
  ask: svg('<path d="M5.6 5.8a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4"/><circle cx="8" cy="13" r=".6" fill="currentColor"/>'),
  open: svg('<circle cx="8" cy="8" r="4"/>'),
  "in-progress": svg('<path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5"/>'),
};

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
  /** Effective settings: built-in defaults, then the project's defaults, then the person's own choices. */
  private prefs: Prefs = cachedPrefs();
  private personal: Partial<Prefs> = {};
  private projectDefaults: Partial<Prefs> = {};
  private panelView: "list" | "settings" = "list";
  private suppressClick = false;
  private recordingShortcut = false;
  private batches: Batch[] = [];
  /** The batch new captures go into, remembered per project in this browser. */
  private batchId: string | null = null;
  /** An item to scroll to and open once its page (and element) shows up; reloadTo is the fallback navigation. */
  private pendingFocus: { id: string; until: number; reloadTo?: string } | null = null;
  private drag: { start: Point; freehand: boolean; points: Point[] } | null = null;
  private strokes: Point[][] = [];
  private markers = new Map<string, Marker>();
  private route = currentRoute();
  private frame = 0;
  private popFor: string | null = null;
  /** Sections of the popover someone opened or closed, so a live update doesn't undo it. */
  private popFolds = new Map<string, boolean>();
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
        <div class="bubble" role="dialog" aria-label="New feedback">
          <div class="b-head"><div class="where"></div><button class="b-close cancel" title="Cancel (Esc)">✕</button></div>
          <div class="page-line"></div>
          <div class="thumb-wrap"><img class="thumb" alt="" hidden><div class="redact-box"></div></div>
          <div class="areas"></div>
          <div class="batch-line" hidden></div>
          <textarea placeholder="What should change here?"></textarea>
          <input class="design" type="url" placeholder="Design link (Figma, …)" hidden>
          <div class="row">
            <div class="tools">
              <button class="tool add-also" title="Also here: highlight another place this change applies to">＋</button>
              <button class="tool add-ref" title="Like this: highlight an example to match">⧉</button>
              <button class="tool redact" title="Hide: black out parts of the screenshot">▮</button>
              <button class="tool design-toggle" title="Attach a design link">🔗</button>
              <button class="tool mic" title="Dictate" ${voiceSupported() ? "" : "hidden"}>🎤</button>
            </div>
            <span class="buttons"><button class="btn submit">Backlog</button><button class="btn primary start"></button></span>
          </div>
          <div class="b-foot">
            <select class="type-select" title="Type (optional; triage can set it later)"><option value="">Type…</option>${TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}</select>
            <span class="hint"></span>
          </div>
        </div>
        <div class="pop" role="dialog" aria-label="Feedback item" tabindex="-1"></div>
        <div class="panel" role="dialog" aria-label="Backlog" tabindex="-1"></div>
        <div class="statuspop" role="dialog" aria-label="Claude status" tabindex="-1"></div>
        <div class="bar" role="toolbar" aria-label="AhemUI" hidden>
          <button class="capture" title="Capture feedback (Alt+Shift+S). Shift+drag to draw.">✎ AhemUI</button>
          <button class="counts" title="Show backlog"></button>
          <button class="state"><span class="dot"></span></button>
        </div>
        <div class="lightbox" role="dialog" aria-label="Screenshot" hidden><img alt=""><button class="lb-x" aria-label="Close">✕</button></div>
        <div class="toast" role="status" aria-live="polite"></div>
      </div>`;
    document.documentElement.appendChild(this.hostEl);
    this.shadow.querySelectorAll<HTMLElement>("button[title], select[title]").forEach((b) => {
      if (!b.getAttribute("aria-label")) b.setAttribute("aria-label", b.title);
    });
    try {
      const id = sessionStorage.getItem(FOCUS_KEY);
      if (id) {
        sessionStorage.removeItem(FOCUS_KEY);
        this.pendingFocus = { id, until: Date.now() + 10_000 };
      }
    } catch {
      /* storage blocked: the page still opens, just without jumping to the item */
    }
    this.bindEvents();
    this.applyPrefs();
    recordSteps(this.isOwn, (s) => (deployed() ? scrub(s) : s));
    this.renderBar();
    this.host.transport.start(
      (items, watcher) => {
        this.notifyChanges(items);
        this.items = items;
        void this.cropSuggestionShots();
        if (watcher !== undefined) this.watcher = watcher;
        this.renderAll();
      },
      (health) => {
        const was = this.connected;
        this.health = health;
        if (health?.watcher !== undefined) this.watcher = health.watcher;
        this.connected = !!health;
        if (!was && this.connected) {
          this.loadPrefs();
          this.loadBatches();
        }
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
    this.$(".state").addEventListener("click", () => this.toggleStatus());
    this.bindDrag();
    this.host.onToggle?.(() => this.toggle());
    // Settings may have changed in another tab or the extension popup.
    this.host.onPrefsChanged?.(() => this.loadPrefs());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.connected) this.loadPrefs();
    });

    addEventListener(
      "keydown",
      (e) => {
        if (this.recordingShortcut) return; // the settings view is listening for a new shortcut
        if (this.mode === "select" && !this.drag && this.keyPick(e)) return;
        if (matchesShortcut(e, this.prefs.shortcut)) {
          e.preventDefault();
          this.toggle();
        } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && this.popFor && this.mode === "idle" && !typingIn(e)) {
          e.preventDefault();
          this.stepOpen(e.key === "ArrowRight" ? 1 : -1);
        } else if (e.key === "Escape") {
          if (this.mode === "select" && this.draft?.adding) this.cancelAdding();
          else if (this.popFor || this.$(".panel").style.display === "block" || this.$(".statuspop").style.display === "block") this.closePopups();
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
      const enterNow = this.prefs.enter === "now";
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.submit(enterNow ? "later" : "now");
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submit(enterNow ? "now" : "later");
      } else if (e.key === "Escape") this.setMode("select");
    });
    this.$(".design").addEventListener("keydown", (e) => e.stopPropagation());
    this.$(".cancel").addEventListener("click", () => this.setMode("select"));
    const typeSelect = this.$<HTMLSelectElement>(".type-select");
    typeSelect.addEventListener("change", () => {
      this.chosenType = (typeSelect.value || undefined) as ItemType | undefined;
      typeSelect.classList.toggle("on", !!this.chosenType);
    });
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
        if (!this.pendingFocus) this.closePopups();
        this.renderMarkers();
      } else this.schedule();
      this.tryPendingFocus();
    }, 300);

    this.shadow.addEventListener("mousedown", (e) => {
      const t = e.target as Element;
      if (!t.closest(".pop, .marker, .panel, .statuspop, .counts, .state")) this.closePopups();
    });
    document.addEventListener("mousedown", (e) => {
      if (!e.composedPath().includes(this.hostEl)) this.closePopups();
    });
  }

  /**
   * The shortcut can arrive twice for one press: the page's own key listener and the extension's browser command
   * (both Alt+Shift+S by default). Two toggles cancel out, so ignore a second one right after the first.
   */
  private lastToggle = 0;

  private toggle() {
    const now = Date.now();
    if (now - this.lastToggle < 400) return;
    this.lastToggle = now;
    if (!this.connected) {
      this.toast(this.host.disconnectedHint, 6000);
      return;
    }
    this.setMode(this.mode === "idle" ? "select" : "idle");
    if (this.mode === "select") this.toast("Click, drag or Shift+drag an area. Keyboard: arrows move, Enter picks, Esc exits.", 3500);
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

  // ——— picking with the keyboard ———

  /** The element the keyboard highlight is on in capture mode (arrows move it, Enter picks it). */
  private kbTarget: Element | null = null;

  private keyPick(e: KeyboardEvent): boolean {
    const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Enter"];
    if (!keys.includes(e.key) || e.ctrlKey || e.altKey || e.metaKey) return false;
    if (typingIn(e)) return false;
    e.preventDefault();
    e.stopPropagation();
    const visible = (el: Element | null): el is Element => {
      if (!el || this.isOwn(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    };
    let t = this.kbTarget?.isConnected ? this.kbTarget : null;
    if (!t) t = elementAt(innerWidth / 2, innerHeight / 3, this.isOwn) ?? document.body.firstElementChild;
    else if (e.key === "ArrowUp") t = t.parentElement && t.parentElement !== document.body ? t.parentElement : t;
    else if (e.key === "ArrowDown") t = [...t.children].find(visible) ?? t;
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      let n: Element | null = t;
      do n = e.key === "ArrowRight" ? n.nextElementSibling : n.previousElementSibling;
      while (n && !visible(n));
      t = n ?? t;
    } else if (e.key === "Tab") t = this.nextMeaningful(t, e.shiftKey ? -1 : 1) ?? t;
    else if (e.key === "Enter" && this.kbTarget) {
      const b = this.kbTarget.getBoundingClientRect();
      const rect = clampToViewport({ x: b.left, y: b.top, w: b.width, h: b.height });
      this.kbTarget = null;
      if (this.draft?.adding) this.addArea(rect, this.draft.adding);
      else this.compose(rect);
      return true;
    }
    if (!t) return true;
    this.kbTarget = t;
    t.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.box(this.$(".hover"), t.getBoundingClientRect());
    return true;
  }

  /** Tab order for picking: visible elements that are interactive or hold their own text, in document order. */
  private nextMeaningful(from: Element, dir: 1 | -1): Element | null {
    const all: Element[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode() as Element | null; n; n = walker.nextNode() as Element | null) {
      if (this.isOwn(n)) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) continue;
      const own = [...n.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent!.trim());
      if (own || n.matches("a, button, input, select, textarea, img, svg, [role], [tabindex]")) all.push(n);
    }
    const i = all.indexOf(from);
    return all.at(i < 0 ? (dir > 0 ? 0 : -1) : (i + dir + all.length) % all.length) ?? null;
  }

  private onMove(e: MouseEvent) {
    if (this.mode !== "select") return;
    if (!this.drag) {
      this.kbTarget = null;
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
    const typeSelect = this.$<HTMLSelectElement>(".type-select");
    typeSelect.value = "";
    typeSelect.classList.remove("on");
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
    const component = anchor.components?.at(-1);
    const section = draft.page?.section;
    const whereEl = this.$(".where");
    whereEl.textContent = [component ?? `<${main.inspection.primary.localName}>`, section].filter(Boolean).join(" › ");
    whereEl.title = [anchor.source, anchor.components?.join(" › "), pageLabel(draft.page, currentRoute())].filter(Boolean).join("\n");
    const pageLine = this.$(".page-line");
    pageLine.textContent = main.masked ? `${main.masked} private field(s) masked in the screenshot` : "";
    pageLine.hidden = !main.masked;
    const thumb = this.$<HTMLImageElement>(".thumb");
    thumb.hidden = !main.shot;
    if (main.shot) {
      thumb.src = main.shot;
      await Promise.race([thumb.decode().catch(() => {}), sleep(300)]); // measure with the thumbnail laid out
    }
    this.renderAreas();

    const bubble = this.$(".bubble");
    this.prepareBatch();
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
    if (!this.$<HTMLTextAreaElement>("textarea").value.trim()) return;
    if (!(await this.commitPick())) return;
    if (this.currentBatch()?.intent === "review") start = "later";
    const draft = this.draft;
    const ta = this.$<HTMLTextAreaElement>("textarea");
    const prompt = ta.value.trim();
    if (!prompt || !draft?.areas.length) return;
    if (start === "now" && this.prefs.notifications === "desktop") this.host.prepareNotifications?.();
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
        author: this.prefs.name || undefined,
        batch: this.currentBatch()?.id,
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
      if (this.currentBatch()?.intent === "review") this.toast(`Flagged for review in ${this.currentBatch()!.name} ✓`);
      else if (start === "later") this.toast("Saved to the backlog ✓");
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
    // Forget items that left review or the backlog, so a long session doesn't keep every id it ever saw.
    for (const id of this.reviewSince.keys()) if (this.seen.get(id)?.status !== "review") this.reviewSince.delete(id);
    for (const id of this.afterTried) if (!this.seen.has(id)) this.afterTried.delete(id);
    if (!prev) return;
    for (const it of items) {
      const was = prev.get(it.id);
      if (!was) continue;
      const title = it.body.split("\n")[0].slice(0, 120);
      if (it.status === "review" && was.status !== "review") this.alert("review", title, it.id);
      else if (it.needs_reply && !was.needs_reply) this.alert("ask", lastEntry(it.body, "Question") ?? title, it.id);
      else if (it.status === "done" && was.status === "in-progress") this.alert("done", title, it.id);
    }
  }

  private cropping = new Set<string>();

  /**
   * Suggestions are filed with the whole page's screenshot and where their element is in it (shot_focus). Crop each
   * to its element with some context and a box round it, and save that as the item's screenshot.
   */
  private async cropSuggestionShots() {
    for (const id of this.cropping) if (!this.items.some((i) => i.id === id && i.shot_focus)) this.cropping.delete(id);
    for (const item of this.items) {
      const f = item.shot_focus;
      if (!f || !item.shot || this.cropping.has(item.id)) continue;
      this.cropping.add(item.id);
      try {
        // Through a blob: an image straight from the server's origin would taint the canvas.
        const src = await this.host.transport.fileSrc(item.id, item.shot);
        const blobUrl = src.startsWith("http") ? URL.createObjectURL(await (await fetch(src)).blob()) : undefined;
        const img = await loadImage(blobUrl ?? src).finally(() => blobUrl && setTimeout(() => URL.revokeObjectURL(blobUrl), 0));
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const el = { x: f.x * W, y: f.y * H, w: f.w * W, h: f.h * H };
        // Some context round the element: about 5% of the page width, more for tall elements.
        const padX = Math.max(W * 0.05, el.w * 0.15);
        const padY = Math.max(W * 0.05, el.h * 0.5);
        const x = Math.max(0, el.x - padX);
        const y = Math.max(0, el.y - padY);
        const rect = { x, y, w: Math.min(W, el.x + el.w + padX) - x, h: Math.min(H, el.y + el.h + padY) - y };
        const b = { x: Math.max(el.x - 3, 0), y: Math.max(el.y - 3, 0), r: Math.min(el.x + el.w + 3, W), btm: Math.min(el.y + el.h + 3, H) };
        const box: Point[] = [[b.x, b.y], [b.r, b.y], [b.r, b.btm], [b.x, b.btm], [b.x, b.y]];
        const shot = await cropToDataUrl(img, 1, rect, [box], this.health?.maxBytes ?? 300_000);
        await this.host.transport.request("POST", `/api/items/${item.id}/shot`, { shot });
      } catch {
        /* keep the whole-page shot; it still shows the element */
      }
    }
  }

  private pendingAlerts: { kind: "review" | "ask" | "done"; text: string; id: string }[] = [];
  private alertTimer: ReturnType<typeof setTimeout> | undefined;
  private alertFirst = 0;

  /**
   * Queues a "ready for review / question / done" alert. When Claude works a batch, items change one after another,
   * so alerts wait until things have been quiet for a few seconds (at most 30) and go out as one.
   */
  private alert(kind: "review" | "ask" | "done", text: string, id: string) {
    if (this.prefs.notifications === "off") return;
    this.pendingAlerts = this.pendingAlerts.filter((a) => a.id !== id);
    this.pendingAlerts.push({ kind, text, id });
    if (!this.alertFirst) this.alertFirst = Date.now();
    clearTimeout(this.alertTimer);
    const wait = Math.max(0, Math.min(ALERT_QUIET, this.alertFirst + ALERT_MAX - Date.now()));
    this.alertTimer = setTimeout(() => this.flushAlerts(), wait);
  }

  private flushAlerts() {
    const all = this.pendingAlerts;
    this.pendingAlerts = [];
    this.alertFirst = 0;
    if (!all.length || this.prefs.notifications === "off") return;
    const NAMES = { review: "Ready for review", ask: "Claude has a question", done: "Done" };
    let title: string;
    let body: string;
    if (all.length === 1) {
      title = NAMES[all[0].kind];
      body = all[0].text;
    } else {
      const count = (k: keyof typeof NAMES) => all.filter((a) => a.kind === k).length;
      const parts = [
        count("review") && `${count("review")} ready for review`,
        count("ask") && `${count("ask")} question${count("ask") === 1 ? "" : "s"}`,
        count("done") && `${count("done")} done`,
      ].filter(Boolean);
      title = parts.join(", ");
      body = all.slice(0, 3).map((a) => `• ${a.text}`).join("\n") + (all.length > 3 ? `\n+ ${all.length - 3} more` : "");
    }
    this.toast(all.length === 1 ? `${title}: ${body}` : `${title}: ${all.map((a) => a.text).slice(0, 2).join("; ")}${all.length > 2 ? "…" : ""}`, 5000);
    // One tag for the whole round: a new notification replaces the last one instead of stacking up.
    if (this.prefs.notifications === "desktop") this.host.notify?.(`AhemUI — ${title}`, body, all.length === 1 ? `${all[0].id}:${all[0].kind}` : "round");
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
    // Redraw the popover only when what it shows changed: a redraw under the pointer swallows a click.
    if (this.popFor && this.popSignature(this.popFor) !== this.popSig) this.openPop(this.popFor);
    if (this.$(".panel").style.display === "block" && this.panelView === "list") this.renderPanel();
    if (this.$(".statuspop").style.display === "block") this.renderStatus();
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

  // ——— UX review ———

  /**
   * "Review this page": outline the page, run the automatic checks, take a screenshot, and send it all to the
   * server, which files the checks' findings as ✦ suggestions. Claude's judged review reads the same scan.
   */
  private async reviewPage() {
    if (!this.connected) return this.toast(this.host.disconnectedHint, 6000);
    this.closePopups();
    this.toast("Reviewing this page…", 15000);
    const clean = <T>(v: T): T => (deployed() ? scrubDeep(v) : v);
    try {
      const outline = outlinePage(this.isOwn, this.host.agent);
      const checks = await runChecks(outline).catch(() => []);
      const view = { x: 0, y: 0, w: innerWidth, h: innerHeight };
      let shot: string | undefined;
      try {
        shot = await this.host.capture(view, [], sensitiveRects(view, deployed(), this.isOwn), (this.health?.maxBytes ?? 300_000) * 2, () => this.hide());
      } catch {
        /* the outline and checks still help without a picture */
      }
      const main = document.querySelector("main") ?? document.body;
      const page = await collectPage(main, this.host.agent).catch(() => undefined);
      const res = await this.host.transport.request<{ scan: { id: string }; created: number; skipped: number }>("POST", "/api/scans", {
        scan: {
          route: currentRoute(),
          url: deployed() ? location.origin + location.pathname : location.href,
          title: document.title.slice(0, 200),
          viewport: `${innerWidth}x${innerHeight}`,
          scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
          page: clean(page),
          elements: clean(outline),
          checks: clean(checks),
        },
        shot,
      });
      const found = res.created ? `${res.created} issue${res.created === 1 ? "" : "s"} from the automatic checks (✦ on the page)` : "The automatic checks found nothing new";
      this.toast(`${found}. For Claude's UX review of this page, run /ahemui:review.`, 12000, {
        label: "Copy command",
        run: () => navigator.clipboard.writeText(`/ahemui:review ${currentRoute()}`).then(() => this.toast("Copied. Paste it into Claude Code.", 3000)),
      });
    } catch (err) {
      this.toast(`Review failed: ${(err as Error).message}`, 6000);
    }
  }

  /** Puts an item back where it was before an archive or resolve (the toast's Undo). */
  private async restoreItem(id: string, status?: Status) {
    const updated = await this.host.transport.request<Item>("POST", `/api/items/${id}/restore`, status ? { status } : {});
    this.items = this.items.some((i) => i.id === id) ? this.items.map((i) => (i.id === id ? updated : i)) : [...this.items, updated];
    this.renderAll();
  }

  /** The backlog row showing its "Dismiss this item?" strip; it clears itself after a few seconds. */
  private confirmDismiss: string | null = null;
  private confirmTimer = 0;

  private askDismiss(id: string | null) {
    this.confirmDismiss = id;
    clearTimeout(this.confirmTimer);
    if (id) this.confirmTimer = window.setTimeout(() => this.askDismiss(null), 5000);
    if (this.$(".panel").style.display === "block" && this.panelView === "list") this.renderPanel();
  }

  private toastQueued() {
    if (this.watcher?.stopping) this.toast("Queued, but Claude is stopping its watch. Run /ahemui:watch again to have it picked up.", 6000);
    else if (this.watcher?.paused) this.toast("Queued. Claude is paused and starts on it when you resume.", 5000);
    else if (this.watcher?.state === "waiting") this.toast("⚡ Claude is starting on it", 3000);
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

  /** Claude can't start this right away: it's busy, paused, or stopping. */
  private queueing(): boolean {
    const w = this.watcher;
    return !!w && (w.state === "working" || !!w.paused || !!w.stopping);
  }

  private startLabel(): string {
    return this.queueing() ? "Add to queue" : `${BOLT}Start`;
  }

  /** The primary action says what will actually happen: start now, or join the queue behind Claude's current item. */
  private renderActions(withBatch = true) {
    const busy = this.queueing();
    const backlogFirst = this.prefs.enter === "backlog";
    const nowKey = backlogFirst ? "Ctrl+Enter" : "Enter";
    const laterKey = backlogFirst ? "Enter" : "Ctrl/⌘+Enter";
    const start = this.$(".start");
    const submit = this.$(".submit");
    start.classList.toggle("primary", !backlogFirst);
    submit.classList.toggle("primary", backlogFirst);
    submit.title = `Save for later: waits in the backlog until someone runs /ahemui:work (${laterKey})`;
    start.innerHTML = busy ? (this.watcher?.paused ? "Add to queue (paused)" : "Add to queue") : `${BOLT}Start now`;
    start.title = busy
      ? this.watcher?.paused
        ? `Claude is paused; this starts when you resume (${nowKey})`
        : `Claude is working on another item; this one goes next in line (${nowKey})`
      : this.watcher
        ? `Claude starts on it right away (${nowKey})`
        : `Queue it for Claude to start as soon as a session runs /ahemui:watch (${nowKey})`;
    const nowWord = busy ? "queue" : "start now";
    this.$(".hint").textContent = backlogFirst ? `↵ backlog · Ctrl+↵ ${nowWord}` : `↵ ${nowWord} · Ctrl+↵ backlog`;
    // A "flag for review" batch is for a person to decide on: one button, no Start now.
    const review = this.noteIntent() === "review";
    start.hidden = review;
    submit.textContent = review ? "Flag for review" : "Backlog";
    submit.classList.toggle("primary", backlogFirst || review);
    if (review) {
      submit.title = "Saved for someone to review and decide on; Claude won't start it (Enter)";
      this.$(".hint").textContent = "↵ flag for review";
    }
    if (withBatch && this.mode === "compose" && !this.pickOpen) this.renderBatchUI();
  }

  private renderBar() {
    this.renderActions();
    const bar = this.$(".bar");
    // As an extension on arbitrary localhost pages, stay invisible until a server claims this origin.
    bar.hidden = this.host.mode === "ext" && !this.connected;
    const active = this.items.filter((i) => i.location === "items");
    const n = (s: Status) => active.filter((i) => i.status === s).length;
    const asks = active.filter((i) => i.needs_reply).length;
    // One menu button: the number of unfinished items, tinted when something waits on the person.
    const unfinished = n("open") + n("in-progress") + n("review");
    const tone = asks ? "ask" : n("review") ? "rv" : "";
    const counts = this.$(".counts");
    counts.innerHTML = `<span class="menu">☰</span>${unfinished ? `<span class="badge ${tone}">${unfinished}</span>` : ""}`;
    counts.title =
      `Backlog: ${n("open")} open, ${n("in-progress")} in progress, ${n("review")} to review` +
      (asks ? `, ${asks} question${asks === 1 ? "" : "s"} for you` : "") +
      (n("done") ? ` · ${n("done")} done` : "");
    const dot = this.$(".bar .dot");
    dot.classList.toggle("ok", this.connected);
    const w = this.watcher;
    dot.classList.toggle("watching", w?.state === "waiting" && !w.paused);
    dot.classList.toggle("working", w?.state === "working" && !w.paused);
    dot.classList.toggle("paused", !!w?.paused);
    dot.classList.toggle("stale", this.stale);
    this.$(".state").title = this.statusLines().join("\n");
    this.$(".state").setAttribute("aria-label", `Status: ${this.statusLines().join(". ")}`);
    counts.setAttribute("aria-label", counts.title);
    if (this.$(".panel").style.display === "block") this.renderPanel();
  }

  /** Project, branch, Claude's state and server details: the bar's tooltip and the panel header. */
  private statusLines(): string[] {
    const h = this.health;
    if (!h) return ["Not connected to ahemui serve"];
    const w = this.watcher;
    return [
      `${h.project ?? "project"}${h.branch ? ` · ${h.branch}` : ""}`,
      !w
        ? "No Claude session watching"
        : w.stopping
          ? w.state === "working" ? "Claude stops watching after this item" : "Claude is stopping"
          : w.paused
            ? w.state === "working" ? "Claude pauses after this item" : "Claude is paused: Start now items wait"
            : w.state === "waiting" ? "Claude is watching for Start now" : "Claude is working",
      ...(this.stale ? [`Overlay build ${BUILD} ≠ server build ${h.build}: reload the page${this.host.mode === "ext" ? " and the AhemUI extension" : ""}`] : []),
    ];
  }

  /** Pause, resume or stop the watching session. Starting one needs Claude Code, so offer the command to copy. */
  private watchControls(): string {
    if (!this.health) return "";
    const w = this.watcher;
    const b = (action: string, label: string, title: string) => `<button class="btn" data-watch="${action}" title="${title}">${label}</button>`;
    if (!w)
      return `<div class="cmd-copy" title="Run this in Claude Code so Start now is picked up straight away"><code>/ahemui:watch</code><button data-watch="copy" aria-label="Copy /ahemui:watch" title="Copy">${COPY_ICON}</button></div>`;
    if (w.stopping) return "";
    return `<div class="watch-ctl">${
      w.paused
        ? b("resume", "▶ Resume", "Let Claude pick up Start now items again")
        : b("pause", "❚❚ Pause", w.state === "working" ? "Finish the current item, then hold new ones until resumed" : "Hold Start now items until resumed")
    }${b("stop", "■ Stop", w.state === "working" ? "End the watch after the current item" : "End the watch")}</div>`;
  }

  private async watchAction(action: string) {
    if (action === "copy") {
      try {
        await navigator.clipboard.writeText("/ahemui:watch");
        this.toast("Copied. Paste it into Claude Code in this project.", 4000);
      } catch {
        this.toast("Run /ahemui:watch in Claude Code in this project.", 5000);
      }
      return;
    }
    try {
      const { watcher } = await this.host.transport.request<{ watcher: Watcher | null }>("POST", "/api/watch", { action });
      this.watcher = watcher;
      this.renderBar();
      this.toast(action === "pause" ? "Paused: Start now items wait until you resume" : action === "resume" ? "Resumed" : "Claude will stop watching", 3000);
    } catch (err) {
      this.toast((err as Error).message, 4000);
    }
  }

  private panelHead(): string {
    const [proj] = this.statusLines();
    const mode = (m: Prefs["markers"], label: string, title: string) =>
      `<button class="${this.prefs.markers === m ? "on" : ""}" data-mode="${m}" title="${title}">${label}</button>`;
    return `<div class="panel-head">
        <div class="grow"><div class="proj">Backlog</div><div class="claude">${esc(proj)}</div></div>
        <div class="seg" title="Which markers to show on the page">${mode("all", "All", "Show every marker")}${mode("active", "Open", "Hide finished markers (✓, won't fix)")}${mode("none", "None", "Hide markers")}</div>
        <button class="gear" data-settings title="Settings">⚙</button>
      </div>`;
  }

  private visibleItems(): Item[] {
    return this.items.filter((i) => i.location === "items" && i.route === this.route && sameSite(i.url));
  }

  private renderMarkers() {
    const wanted =
      this.prefs.markers === "none"
        ? []
        : this.visibleItems().filter((i) => this.prefs.markers === "all" || (i.status !== "done" && i.status !== "wontfix"));
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
        const el = document.createElement("button");
        el.type = "button";
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
      const suggested = !!item.suggestion && item.intent === "review" && item.status === "open";
      // What waits on the person gets a word as well as an icon: it should read at a glance.
      const word = asking ? "Question" : item.status === "review" ? "Review" : "";
      m.el.className = `marker ${item.status}${asking ? " ask" : ""}${suggested ? " suggest" : ""}${word ? " labelled" : ""}`;
      m.el.setAttribute("aria-label", `${asking ? "Question for you" : LABEL[item.status]}: ${item.body.split("\n")[0].slice(0, 80)}`);
      m.el.innerHTML = word
        ? `${asking ? GLYPH.ask : GLYPH.review}<span>${word}</span>`
        : asking
        ? GLYPH.ask
        : suggested
          ? GLYPH.suggest
          : item.status === "done" || item.status === "wontfix" || item.status === "review"
            ? GLYPH[item.status]
            : item.start === "now" && item.status === "open"
              ? GLYPH.now
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
      m.el.style.left = `${clamp(r.right - 11, 4, innerWidth - (m.el.offsetWidth || 22) - 4)}px`;
      m.el.style.top = `${clamp(r.top - 11, 4, innerHeight - 26)}px`;
    }
    if (this.popFor) this.placePop();
  }

  /** Unfinished items on this page, top to bottom: what the popover's ‹ › step through. */
  private openOnPage(): Item[] {
    const top = (i: Item) => this.markers.get(i.id)?.target?.getBoundingClientRect().top ?? i.rect?.y ?? 0;
    return this.visibleItems()
      .filter((i) => i.status !== "done" && i.status !== "wontfix")
      .sort((a, b) => top(a) - top(b) || a.created.localeCompare(b.created));
  }

  private popFooter(item: Item): string {
    const list = this.openOnPage();
    const at = list.findIndex((i) => i.id === item.id);
    const others = list.filter((i) => i.id !== item.id).length;
    const pos = !list.length ? "no open items here" : at >= 0 ? `${at + 1} of ${list.length} open` : `${list.length} open on this page`;
    const board = this.health?.base
      ? `<a class="pop-board" href="${esc(this.health.base)}/#${item.id}" target="_blank" rel="noopener" title="Open this item in the board">Board ↗</a>`
      : "";
    return `<div class="pop-foot">
        <span class="pop-nav"><button data-nav="-1" title="Previous open item (←)" ${others ? "" : "disabled"}>‹</button><span class="pos">${pos}</span><button data-nav="1" title="Next open item (→)" ${others ? "" : "disabled"}>›</button></span>
        ${board}
      </div>`;
  }

  /** Moves the popover to the previous or next unfinished item on this page, scrolling it into view. */
  private stepOpen(dir: number) {
    const list = this.openOnPage();
    if (!list.length) return;
    const at = list.findIndex((i) => i.id === this.popFor);
    const next = list.at(at < 0 ? (dir > 0 ? 0 : -1) : (at + dir + list.length) % list.length)!;
    if (next.id === this.popFor) return;
    const target = this.markers.get(next.id)?.target;
    const box = target?.getBoundingClientRect();
    const onScreen = box && box.top >= 0 && box.bottom <= innerHeight;
    if (target && !onScreen) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => this.openPop(next.id), 350);
    } else this.openPop(next.id);
  }

  private popSig = "";

  private popSignature(id: string): string {
    const item = this.items.find((i) => i.id === id);
    if (!item) return "";
    const batch = item.batch ? this.batches.find((b) => b.id === item.batch) : undefined;
    return JSON.stringify([item, batch?.name, batch?.intent, this.startLabel(), this.connected]) + this.popFooter(item);
  }

  private openPop(id: string) {
    const item = this.items.find((i) => i.id === id);
    const pop = this.$(".pop");
    if (!item) return this.closePopups();
    // Don't wipe a reply or review comment the person is typing when a live update arrives.
    const typing = pop.querySelector<HTMLTextAreaElement>("textarea");
    if (this.popFor === id && (typing?.value.trim() || hasArmed(pop))) return;
    this.$(".panel").style.display = "none";
    const opening = this.popFor !== id;
    this.popFor = id;
    this.popSig = this.popSignature(id);
    const asking = item.needs_reply && item.status === "open";
    const src = item.anchor.source ?? item.anchor.components?.join(" › ") ?? item.anchor.selector ?? "";
    const { prompt, thread } = splitThread(item.body);
    const extras = item.extras ?? [];

    // Flagged for review (a suggestion, or a note in a review batch): someone decides whether it becomes a change.
    const flagged = item.intent === "review" && item.status === "open" && !asking;
    let actions: string;
    if (flagged) {
      actions = `<div class="actions"><button class="btn primary" data-act="accept-now" title="Make it a change and queue it for Claude">Do it</button><button class="btn" data-act="accept-later" title="Make it a change, in the backlog for later">Later</button><button class="btn" data-act="dismiss">Dismiss</button></div>`;
    } else if (asking) {
      actions = `<textarea class="reply" placeholder="Your answer…"></textarea><div class="actions"><button class="btn primary" data-act="reply">Reply</button><button class="btn" data-act="dismiss">Dismiss</button></div>`;
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
      actions = `<div class="actions">${queue}<button class="btn" data-act="done">Mark done</button><button class="btn" data-act="dismiss" title="Take it off the backlog without doing it (Undo is offered)">Dismiss</button></div>`;
    }

    // Status and id; the request itself; who and when; where it lives; the picture; the conversation; actions.
    const also = extras.filter((e) => e.role === "also").length;
    const batch = item.batch ? this.batches.find((b) => b.id === item.batch) : undefined;
    const where: [string, string][] = [
      ...(batch ? [["Batch", `${esc(batch.name)}${batch.intent === "review" ? ' <span class="rv-tag">for review</span>' : ""}`] as [string, string]] : []),
      ["Page", esc(whereLabel(item))],
      ...(src ? [["Code", `<span class="mono">${esc(src)}</span>`] as [string, string]] : []),
      ...(also || extras.some((e) => e.role === "reference")
        ? [["Areas", `${also ? `${also + 1} places` : "1 place"}${extras.some((e) => e.role === "reference") ? " + an example to match" : ""}`] as [string, string]]
        : []),
      ...(item.external
        ? [["Ticket", `${esc(item.external.tracker)} ${item.external.url ? `<a class="ext" href="${esc(item.external.url)}" target="_blank" rel="noopener">${esc(item.external.key)}</a>` : esc(item.external.key)}${item.external.status ? ` · ${esc(item.external.status)}` : ""}`] as [string, string]]
        : []),
      ...(item.design ? [["Design", `<a class="ext" href="${esc(item.design)}" target="_blank" rel="noopener">${esc(shortUrl(item.design))}</a>`] as [string, string]] : []),
      ...(item.url && !sameSite(item.url) ? [["Site", esc(new URL(item.url).origin)] as [string, string]] : []),
    ];
    const tags = [
      item.start === "now" && item.status === "open" ? "⚡ start now" : "",
      item.type ?? "",
      item.priority && item.priority !== "normal" ? `${item.priority} priority` : "",
      item.area ?? "",
      ...(item.labels ?? []).map((l) => `#${l}`),
    ].filter(Boolean);
    // Folded sections: what someone chose for this item, else the default.
    const fold = (key: string, dflt: boolean) => this.popFolds.get(`${item.id}:${key}`) ?? dflt;
    // A note shows three lines until clicked; the newest question is always shown whole.
    const entry = (t: { kind: string; who: string; text: string }, n = -1) => {
      const whole = (asking && n === thread.length - 1) || t.text.length < 160;
      const open = whole || fold(`note${n}`, false);
      return `<div class="entry ${t.kind.toLowerCase()}${whole ? "" : " foldable"}${open ? "" : " clamped"}" data-note="${n}"><div class="who"><b>${esc(t.who)}</b> · ${esc(KIND[t.kind] ?? t.kind.toLowerCase())}</div><div class="text">${esc(t.text)}</div></div>`;
    };
    pop.innerHTML = `
      <div class="pop-top"><span class="pill ${asking ? "ask" : flagged ? "suggest" : item.status}">${asking ? "question for you" : flagged ? (item.suggestion ? `suggestion · ${item.suggestion.severity}` : "for review") : LABEL[item.status]}</span>
        <button class="id-copy mono" data-act="copy" title="Copy id">${item.id.slice(0, 10)}…</button></div>
      <div class="request">${esc(prompt.trim())}</div>
      ${
        item.suggestion
          ? `<details class="sugg" data-fold="sugg"${fold("sugg", flagged) ? " open" : ""}><summary class="sugg-by">${item.suggestion.by === "checks" ? "Automatic check" : "Claude's UX review"}${item.suggestion.rule ? ` · ${esc(item.suggestion.rule)}` : ""}<span class="fold-hint">Why &amp; fix</span></summary><p><b>Why</b> ${esc(item.suggestion.why)}</p>${item.suggestion.fix ? `<p><b>Fix</b> ${esc(item.suggestion.fix)}</p>` : ""}</details>`
          : ""
      }
      <div class="byline">${esc(item.author)} · ${esc(shortDate(item.created))}${item.claimed_by && item.status === "in-progress" ? ` · ${esc(item.claimed_by)} is on it` : ""}</div>
      ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
      <dl class="where">${where.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      ${
        item.status === "review"
          ? `<div class="compare"><figure><img data-file="${esc(item.shot ?? "")}" alt=""><figcaption>before</figcaption></figure><figure>${item.after ? `<img data-file="${esc(item.after)}" alt="">` : `<div class="pending">capturing…</div>`}<figcaption>after</figcaption></figure></div>`
          : item.shot
            ? `<img class="thumb" data-file="${esc(item.shot)}" alt="">`
            : ""
      }
      ${
        thread.length
          ? `<div class="thread">${
              thread.length > 1
                ? `<details class="earlier" data-fold="earlier"${fold("earlier", false) ? " open" : ""}><summary>${thread.length - 1} earlier ${thread.length === 2 ? "note" : "notes"}</summary>${thread.slice(0, -1).map(entry).join("")}</details>`
                : ""
            }${entry(thread.at(-1)!, thread.length - 1)}</div>`
          : ""
      }
      ${actions}
      ${this.popFooter(item)}`;

    pop.querySelectorAll<HTMLDetailsElement>("details[data-fold]").forEach((d) =>
      d.addEventListener("toggle", () => this.popFolds.set(`${item.id}:${d.dataset.fold}`, d.open)),
    );
    pop.querySelectorAll<HTMLElement>(".entry.foldable").forEach((e) =>
      e.addEventListener("click", () => {
        if (getSelection()?.toString()) return; // selecting text, not folding
        const open = e.classList.toggle("clamped") === false;
        this.popFolds.set(`${item.id}:note${e.dataset.note}`, open);
      }),
    );
    if (this.popFolds.size > 200) this.popFolds.clear();
    pop.querySelectorAll<HTMLImageElement>("img[data-file]").forEach((img) => {
      if (!img.dataset.file) return img.remove();
      this.host.transport.fileSrc(item.id, img.dataset.file).then((src) => (img.src = src), () => img.remove());
      img.title = "Enlarge";
      img.addEventListener("click", (e) => {
        e.stopPropagation();
        this.lightbox(img.src);
      });
    });
    pop.querySelectorAll("textarea").forEach((t) => t.addEventListener("keydown", (e) => e.stopPropagation()));
    pop.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((b) => b.addEventListener("click", () => this.stepOpen(Number(b.dataset.nav))));
    pop.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) =>
      b.addEventListener("click", async () => {
        const act = b.dataset.act!;
        if (act === "dismiss" && !armDanger(b)) return;
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
            updated = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/reply`, { text, author: this.prefs.name || undefined });
            this.toast("Sent to Claude ✓");
          } else if (act === "approve" || act === "changes") {
            if (act === "changes" && !text) return this.toast("Say what still needs to change");
            updated = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/review`, {
              verdict: act === "approve" ? "approved" : "changes",
              comment: text || undefined,
              author: this.prefs.name || undefined,
            });
            this.toast(act === "approve" ? "Approved ✓" : "Sent back to Claude");
          } else if (act === "reopen") {
            updated = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/reopen`, {});
          } else if (act === "accept-now" || act === "accept-later") {
            const before = { batch: item.batch ?? null };
            updated = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/accept`, { start: act === "accept-now" ? "now" : "later" });
            this.closePopups();
            this.toast(act === "accept-now" ? "On Claude's queue" : "In the backlog as a change", 6000, async () => {
              const back = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/batch`, before);
              this.items = this.items.map((i) => (i.id === back.id ? back : i));
              this.renderAll();
            });
          } else if (act === "dismiss") {
            const was = item.status;
            updated = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/dismiss`, { author: this.prefs.name || undefined });
            this.closePopups();
            this.toast("Dismissed", 6000, () => this.restoreItem(item.id, was));
          } else if (act === "archive") {
            updated = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/archive`, {});
            this.closePopups();
            this.toast("Archived", 6000, () => this.restoreItem(item.id));
          } else {
            updated = await this.host.transport.request<Item>("POST", `/api/items/${item.id}/resolve`, { status: act });
            const was = item.status;
            this.toast(act === "wontfix" ? "Marked won't fix" : "Marked done", 6000, () => this.restoreItem(item.id, was));
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
    if (opening) this.focusPopover(pop);
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
    this.focusPopover(panel);
  }

  private renderPanel() {
    const panel = this.$(".panel");
    if (this.panelView === "settings") return this.renderSettings();
    const active = this.items.filter((i) => i.location === "items");
    const board = this.health?.base
      ? `<a class="board-link" href="${esc(this.health.base)}/" target="_blank" rel="noopener" title="Open the full board">Board ↗</a>`
      : "";
    const bindHead = () => {
      panel.querySelector(".review-page")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.reviewPage();
      });
      panel.querySelector("[data-settings]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.panelView = "settings";
        this.renderPanel();
      });
      panel.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          this.setPrefs({ markers: b.dataset.mode as Prefs["markers"] });
        }),
      );
    };
    if (!active.length) {
      panel.innerHTML = `${this.panelHead()}<div class="empty">Backlog is empty. Press ✎ AhemUI or ${esc(shortcutLabel(this.prefs.shortcut))} to capture.</div><div class="panel-foot"><span class="foot-actions">${REVIEW_BUTTON}</span>${board}</div>`;
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
      // Flagged for review (suggestions too) never starts from here: open it and choose Do it, Later or Dismiss.
      if (i.status !== "open" || i.needs_reply || i.intent === "review") return "";
      if (i.start === "now") return `<span class="queued" title="Waiting for Claude (runs when /ahemui:watch is active)">⚡ queued</span>`;
      return `<button class="btn row-start" data-start="${i.id}" title="Have Claude work on this now">${this.startLabel()}</button>`;
    };
    const row = (i: Item) => `<div class="list-item ${i.route === this.route && sameSite(i.url) ? "" : "elsewhere"}" data-id="${i.id}">
          <span class="pill ${i.needs_reply ? "ask" : i.suggestion && i.intent === "review" && i.status === "open" ? "suggest" : i.status}">${i.needs_reply ? GLYPH.ask : i.suggestion && i.intent === "review" && i.status === "open" ? GLYPH.suggest : GLYPH[i.status]}</span>
          <span class="grow"><div>${esc(i.body.split("\n")[0].slice(0, 90))}</div><div class="route">${i.intent === "review" ? `<span class="rv-tag">for review</span> ` : ""}${esc(classLine(i) || i.page?.section || "")}${i.anchor.source ? ` <span class="mono">${esc(i.anchor.source)}</span>` : ""}</div></span>
          ${rowAction(i)}
          <button class="row-dismiss" data-dismiss="${i.id}" title="Dismiss: take it off the backlog" aria-label="Dismiss">✕</button>
          ${
            this.confirmDismiss === i.id
              ? `<div class="row-confirm" role="group" aria-label="Dismiss this item?"><span>Dismiss this item?</span><button class="btn rc-keep" data-keep="${i.id}">Cancel</button><button class="btn rc-go" data-confirm="${i.id}">Dismiss</button></div>`
              : ""
          }
        </div>`;
    const finished = active.filter((i) => i.status === "done" || i.status === "wontfix").length;
    const clear = finished
      ? `<button class="btn clear-finished" title="Archive every done and won't-fix item (moves them to .ahemui/done/)">Clear ${finished} done</button>`
      : "";
    panel.innerHTML =
      this.panelHead() +
      [...groups].map(([key, items]) => `<div class="group">${esc(groupLabel(key, items))}</div>${items.map(row).join("")}`).join("") +
      `<div class="panel-foot"><span class="foot-actions">${REVIEW_BUTTON}${clear}</span>${board}</div>`;
    bindHead();
    panel.querySelector(".clear-finished")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const { archived } = await this.host.transport.request<{ archived: string[] }>("POST", "/api/prune", {});
        this.items = this.items.map((i) => (archived.includes(i.id) ? { ...i, location: "done" } : i));
        this.renderAll();
        this.toast(`Archived ${archived.length} finished item(s)`, 6000, async () => {
          for (const id of archived) await this.restoreItem(id);
        });
      } catch (err) {
        this.toast((err as Error).message, 4000);
      }
    });
    panel.querySelectorAll<HTMLButtonElement>("button[data-dismiss]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.askDismiss(b.dataset.dismiss!);
      }),
    );
    panel.querySelectorAll<HTMLButtonElement>("button[data-keep]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.askDismiss(null);
      }),
    );
    panel.querySelectorAll<HTMLButtonElement>("button[data-confirm]").forEach((b) =>
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = b.dataset.confirm!;
        const was = this.items.find((i) => i.id === id)?.status;
        this.confirmDismiss = null;
        try {
          const updated = await this.host.transport.request<Item>("POST", `/api/items/${id}/dismiss`, { author: this.prefs.name || undefined });
          this.items = this.items.map((i) => (i.id === id ? updated : i));
          this.renderAll();
          this.toast("Dismissed", 6000, () => this.restoreItem(id, was));
        } catch (err) {
          this.renderPanel();
          this.toast((err as Error).message, 4000);
        }
      }),
    );
    panel.querySelector<HTMLButtonElement>(".rc-go")?.focus({ preventScroll: true });
    panel.querySelectorAll<HTMLButtonElement>("button[data-start]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        b.disabled = true;
        this.queueItem(b.dataset.start!);
      }),
    );
    panel.querySelectorAll<HTMLElement>(".list-item").forEach((row) =>
      row.addEventListener("click", (e) => {
        if ((e.target as Element).closest(".row-confirm")) return;
        const item = this.items.find((i) => i.id === row.dataset.id)!;
        if (item.route !== this.route || !sameSite(item.url)) return this.goToItem(item);
        const target = this.markers.get(item.id)?.target;
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(() => this.openPop(item.id), 350);
      }),
    );
  }

  /** A screenshot at full size over the page; a click anywhere or Esc closes it. */
  private lightbox(src: string) {
    const box = this.$(".lightbox");
    box.querySelector("img")!.src = src;
    box.hidden = false;
    const close = (e?: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      e?.stopPropagation();
      box.hidden = true;
      box.removeEventListener("click", close);
      removeEventListener("keydown", close, true);
    };
    box.addEventListener("click", close);
    addEventListener("keydown", close, true);
  }

  /** The control that opened a popover, so closing it (Esc) puts focus back there. */
  private returnFocus: HTMLElement | null = null;

  private focusPopover(el: HTMLElement) {
    const active = this.shadow.activeElement as HTMLElement | null;
    if (active && !el.contains(active)) this.returnFocus = active;
    el.focus({ preventScroll: true });
  }

  private closePopups() {
    const opened = ["pop", "panel", "statuspop"].some((c) => this.$(`.${c}`).style.display === "block");
    if (opened && this.returnFocus?.isConnected) {
      const back = this.returnFocus;
      this.returnFocus = null;
      setTimeout(() => back.focus({ preventScroll: true }), 0);
    }
    this.popFor = null;
    this.panelView = "list";
    this.$(".pop").style.display = "none";
    this.$(".panel").style.display = "none";
    this.$(".statuspop").style.display = "none";
  }

  // ——— batches: a named round of notes, chosen on the first note of a sitting ———

  private batchSkipped = false;
  /** The inline "this round is…" chooser is showing in the capture box. */
  private pickOpen = false;
  private pickIntent: Batch["intent"] = "action";
  private pickEdited = false;

  private batchKey(): string {
    return `ahemui:batch:${this.health?.root ?? location.origin}`;
  }

  private async loadBatches() {
    try {
      this.batches = await this.host.transport.request<Batch[]>("GET", "/api/batches");
    } catch {
      this.batches = []; // an older ahemui serve without batches
    }
    try {
      const saved = JSON.parse(localStorage.getItem(this.batchKey()) ?? "null");
      // A choice from more than 12 hours ago is a different sitting: ask again.
      this.batchId = saved && Date.now() - saved.at < 12 * 3600_000 ? saved.id : null;
    } catch {
      this.batchId = null;
    }
    this.renderActions();
  }

  private currentBatch(): Batch | null {
    return this.batches.find((b) => b.id === this.batchId) ?? null;
  }

  /** What the note being written will be: the chosen batch's intent, or the one picked in the open chooser. */
  private noteIntent(): Batch["intent"] {
    return this.pickOpen ? this.pickIntent : (this.currentBatch()?.intent ?? "action");
  }

  private useBatch(id: string | null) {
    this.batchId = id;
    this.batchSkipped = !id;
    try {
      if (id) localStorage.setItem(this.batchKey(), JSON.stringify({ id, at: Date.now() }));
      else localStorage.removeItem(this.batchKey());
    } catch {
      /* storage blocked: the choice lasts until the page reloads */
    }
  }

  private suggestBatchName(intent: Batch["intent"]): string {
    const day = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const page = (document.title.split(/\s[·|—–-]\s/)[0] || currentRoute()).trim().slice(0, 40);
    return `${page} ${intent === "review" ? "review" : "changes"} · ${day}`;
  }

  /** Called when the capture box opens: ask on the first note of a sitting, otherwise show where notes go. */
  private prepareBatch() {
    if (!this.pickOpen) this.pickOpen = this.prefs.batches === "ask" && !this.currentBatch() && !this.batchSkipped;
    if (this.pickOpen) {
      this.pickIntent = this.currentBatch()?.intent ?? this.pickIntent;
      this.pickEdited = false;
    }
    this.renderBatchUI();
  }

  /** Either the one-line chooser (first note) or the one-line "adding to …" summary. */
  private renderBatchUI() {
    const line = this.$(".batch-line");
    const current = this.currentBatch();
    if (this.pickOpen) {
      const recent = this.batches.slice(0, 5);
      line.hidden = false;
      line.className = "batch-line picking";
      line.innerHTML = `
        <div class="bp-row">
          <div class="seg bp-intent" title="Changes: Claude can pick these up. For review: someone looks and decides; Claude won't start them.">
            <button data-intent="action">Changes</button><button data-intent="review">For review</button>
          </div>
          <select class="bp-target" title="Start a new batch, add to a recent one, or capture without a batch">
            <option value="new">New batch</option>
            ${recent.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}
            <option value="none">No batch</option>
          </select>
        </div>
        <input class="bp-name" maxlength="120" title="Batch name">`;
      const name = line.querySelector<HTMLInputElement>(".bp-name")!;
      const target = line.querySelector<HTMLSelectElement>(".bp-target")!;
      if (current) target.value = current.id;
      const paint = () => {
        const picked = this.batches.find((b) => b.id === target.value);
        if (picked) this.pickIntent = picked.intent;
        line.querySelectorAll<HTMLButtonElement>("[data-intent]").forEach((b) => {
          b.classList.toggle("on", b.dataset.intent === this.pickIntent);
          b.disabled = !!picked || target.value === "none";
        });
        name.hidden = target.value !== "new";
        if (!this.pickEdited) name.value = this.suggestBatchName(this.pickIntent);
        this.renderActions(false);
      };
      line.querySelectorAll<HTMLButtonElement>("[data-intent]").forEach((b) =>
        b.addEventListener("click", () => {
          this.pickIntent = b.dataset.intent as Batch["intent"];
          paint();
        }),
      );
      target.addEventListener("change", paint);
      name.addEventListener("input", () => (this.pickEdited = true));
      name.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          this.$<HTMLTextAreaElement>("textarea").focus();
        }
      });
      paint();
      return;
    }
    line.className = "batch-line";
    if (!current && this.prefs.batches === "off") return void (line.hidden = true);
    line.hidden = false;
    line.innerHTML = current
      ? `<span class="bl-kind ${current.intent}">${current.intent === "review" ? "for review" : "changes"}</span><span class="bl-name" title="${esc(current.name)}">${esc(current.name)}</span><button class="bl-change" title="Pick or start another batch">change</button>`
      : `<span class="bl-name muted">No batch</span><button class="bl-change">start one</button>`;
    line.querySelector(".bl-change")!.addEventListener("click", () => {
      this.pickOpen = true;
      this.pickEdited = false;
      this.renderBatchUI();
    });
  }

  /** Turns the chooser into a real batch (created only now, with the first note) before that note is saved. */
  private async commitPick(): Promise<boolean> {
    if (!this.pickOpen) return true;
    const line = this.$(".batch-line");
    const target = line.querySelector<HTMLSelectElement>(".bp-target")?.value ?? "new";
    if (target === "none") this.useBatch(null);
    else if (target !== "new") this.useBatch(target);
    else {
      const name = line.querySelector<HTMLInputElement>(".bp-name")?.value.trim() || this.suggestBatchName(this.pickIntent);
      try {
        const batch = await this.host.transport.request<Batch>("POST", "/api/batches", { name, intent: this.pickIntent, author: this.prefs.name || undefined });
        this.batches.unshift(batch);
        this.useBatch(batch.id);
      } catch (err) {
        this.toast(`Couldn't start the batch: ${(err as Error).message}`, 4000);
        return false;
      }
    }
    this.pickOpen = false;
    this.renderBatchUI();
    return true;
  }

  // ——— jumping to an item on another page ———

  /**
   * Opens the page an item was captured on and highlights it there. Same app: navigate in place (the app's router
   * picks up the history change), falling back to a normal page load. Another site: open it in a new tab.
   */
  private goToItem(item: Item) {
    if (!sameSite(item.url)) {
      open(item.url!, "_blank", "noopener");
      return this.toast(`Opened ${new URL(item.url!).origin} in a new tab`, 3000);
    }
    const u = item.url ? new URL(item.url) : null;
    // Local dev servers count as one site, so keep this tab's origin even if the item was captured on another port.
    const target = u ? `${location.origin}${u.pathname}${u.search}${u.hash}` : location.origin + (item.route ?? "/");
    this.closePopups();
    this.toast(`Going to ${item.route ?? u?.pathname ?? "that page"}…`, 1500);
    history.pushState(null, "", target);
    dispatchEvent(new PopStateEvent("popstate", { state: null }));
    this.pendingFocus = { id: item.id, until: Date.now() + 1500, reloadTo: target };
  }

  private tryPendingFocus() {
    const pending = this.pendingFocus;
    if (!pending) return;
    const item = this.items.find((i) => i.id === pending.id);
    if (item && item.route === currentRoute()) {
      const known = this.markers.get(item.id)?.target;
      const target = known?.isConnected ? known : locate(item.anchor, this.isOwn);
      if (target) {
        this.pendingFocus = null;
        return this.focusItem(item.id, target);
      }
    }
    if (Date.now() < pending.until) return;
    this.pendingFocus = null;
    if (pending.reloadTo) {
      // The app didn't route on its own (not an SPA, or a router that ignores history events): load the page.
      try {
        sessionStorage.setItem(FOCUS_KEY, pending.id);
      } catch {
        /* the page still loads */
      }
      location.assign(pending.reloadTo);
    } else if (item) this.toast("Couldn't find that element on this page any more", 4000);
  }

  /** Scrolls the item's element into view, flashes an outline around it and opens its popover. */
  private focusItem(id: string, target: Element) {
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => {
      const outline = this.$(".outline");
      this.box(outline, target.getBoundingClientRect());
      outline.classList.add("flash");
      setTimeout(() => {
        outline.classList.remove("flash");
        outline.style.display = "none";
      }, 1600);
      this.renderMarkers();
      this.openPop(id);
    }, 450);
  }

  // ——— status popover (the dot): connection and the watching Claude session ———

  private toggleStatus() {
    const pop = this.$(".statuspop");
    if (pop.style.display === "block") return this.closePopups();
    this.closePopups();
    this.renderStatus();
    pop.style.display = "block";
    this.focusPopover(pop);
  }

  private renderStatus() {
    const pop = this.$(".statuspop");
    const h = this.health;
    const w = this.watcher;
    const [proj, claude, stale] = this.statusLines();
    const dotClass = this.$(".bar .dot").className;
    pop.innerHTML = `
      <div class="status-head"><span class="${dotClass}"></span><div class="grow"><div class="proj">${esc(proj)}</div>${
        claude ? `<div class="claude ${w && !w.paused ? "live" : ""}">${esc(claude)}</div>` : ""
      }</div></div>
      ${stale ? `<div class="stale-note">${esc(stale)}</div>` : ""}
      ${this.watchControls()}
      <div class="status-meta">${
        h
          ? `ahemui serve ${esc(h.base ? `:${h.base.split(":").pop()}` : "")} · ${esc(h.root)}`
          : esc(this.host.disconnectedHint)
      }</div>`;
    pop.querySelectorAll<HTMLButtonElement>("button[data-watch]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        b.disabled = true;
        this.watchAction(b.dataset.watch!);
      }),
    );
  }

  // ——— settings ———

  /** Loads the person's settings (~/.ahemui/prefs.json) and the project's defaults once connected. */
  private async loadPrefs() {
    try {
      const { prefs, defaults } = await this.host.transport.request<{ prefs: Partial<Prefs>; defaults: Partial<Prefs> }>("GET", "/api/prefs");
      this.personal = prefs ?? {};
      this.projectDefaults = defaults ?? {};
      this.prefs = { ...DEFAULT_PREFS, ...this.projectDefaults, ...this.personal };
      cachePrefs(this.prefs);
      this.applyPrefs();
    } catch {
      /* an older ahemui serve without /api/prefs: keep the cached settings */
    }
  }

  /** Applies a change at once and saves it for the person; null clears it back to the default. */
  private async setPrefs(patch: { [K in keyof Prefs]?: Prefs[K] | null }) {
    const personal: Record<string, unknown> = { ...this.personal };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") delete personal[k];
      else personal[k] = v;
    }
    this.personal = personal as Partial<Prefs>;
    this.prefs = { ...DEFAULT_PREFS, ...this.projectDefaults, ...this.personal };
    cachePrefs(this.prefs);
    this.applyPrefs();
    try {
      await this.host.transport.request("POST", "/api/prefs", patch);
    } catch (err) {
      this.toast(`Setting not saved: ${(err as Error).message}`, 4000);
    }
  }

  private applyPrefs() {
    this.$(".root").setAttribute("data-pos", this.prefs.position);
    this.$(".root").setAttribute("data-theme", this.prefs.theme);
    this.$(".capture").title = `Capture feedback (${shortcutLabel(this.prefs.shortcut)}). Shift+drag to draw.`;
    this.renderMarkers();
    this.renderBar();
    if (this.$(".panel").style.display === "block") this.renderPanel();
  }

  private renderSettings() {
    const panel = this.$(".panel");
    const p = this.prefs;
    const seg = <K extends keyof Prefs>(key: K, options: [Prefs[K], string, string][]) =>
      `<div class="seg" data-pref="${key}">${options
        .map(([v, label, title]) => `<button class="${p[key] === v ? "on" : ""}" data-value="${v}" title="${title}">${label}</button>`)
        .join("")}</div>`;
    const corner = (v: Prefs["position"], arrow: string) =>
      `<button class="${p.position === v ? "on" : ""}" data-value="${v}" title="${v.replace("-", " ")}">${arrow}</button>`;
    const fromProject = Object.keys(this.projectDefaults).length > 0;
    panel.innerHTML = `<div class="settings">
        <div class="settings-head"><button class="back" title="Back to the backlog">‹ Backlog</button><b>Settings</b></div>
        <div class="setting"><span>Toolbar corner</span><div class="corners" data-pref="position">${corner("top-left", "↖")}${corner("top-right", "↗")}${corner("bottom-left", "↙")}${corner("bottom-right", "↘")}</div></div>
        <div class="note">Or drag the toolbar; it snaps to the nearest corner.</div>
        <div class="setting"><span>Theme</span>${seg("theme", [
          ["dark", "Dark", "Dark overlay"],
          ["light", "Light", "Light overlay"],
          ["auto", "Auto", "Follow the system setting"],
        ])}</div>
        <div class="setting"><span>Notifications</span>${seg("notifications", [
          ["off", "Off", "No toasts or notifications when Claude finishes or asks"],
          ["page", "On page", "Toasts on this page only"],
          ["desktop", "Desktop", "Toasts, plus a system notification when this tab is in the background"],
        ])}</div>
        <div class="setting"><span>Enter key</span>${seg("enter", [
          ["now", "Start now", "Enter hands it to Claude; Ctrl+Enter saves to the backlog"],
          ["backlog", "Backlog", "Enter saves to the backlog; Ctrl+Enter hands it to Claude"],
        ])}</div>
        <div class="setting"><span>Markers</span>${seg("markers", [
          ["all", "All", "Show every marker"],
          ["active", "Open", "Hide finished markers"],
          ["none", "None", "Hide markers"],
        ])}</div>
        <div class="setting"><span>Shortcut</span><span class="shortcut-set"><kbd class="shortcut-key">${esc(shortcutLabel(p.shortcut))}</kbd><button class="btn shortcut-change" title="Press a new key combination">Change</button>${
          p.shortcut !== DEFAULT_PREFS.shortcut ? `<button class="shortcut-reset" title="Back to Alt+Shift+S">reset</button>` : ""
        }</span></div>
        ${navigator.platform.startsWith("Win") && p.shortcut.startsWith("Alt+Shift") ? `<div class="note">On Windows, Alt+Shift can also switch keyboard layouts. If the shortcut misses, pick one with Ctrl.</div>` : ""}
        <div class="setting"><span>Ask for a batch</span>${seg("batches", [
          ["ask", "When I start", "Name and classify each round of notes when you start capturing"],
          ["off", "Never", "Capture straight away, without a batch"],
        ])}</div>
        <div class="setting"><span>Your name</span><input class="pref-name" placeholder="Your git name" maxlength="80" value="${esc(p.name ?? "")}"></div>
        <div class="note">Saved for you in ~/.ahemui/prefs.json and used in every project on this computer.${
          fromProject ? " This project sets some defaults in .ahemui/config.json; your choices here override them." : ""
        }</div>
      </div>`;
    panel.querySelector(".back")!.addEventListener("click", (e) => {
      e.stopPropagation();
      this.panelView = "list";
      this.renderPanel();
    });
    panel.querySelectorAll<HTMLElement>("[data-pref]").forEach((group) =>
      group.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const key = group.dataset.pref as keyof Prefs;
          if (key === "notifications" && b.dataset.value === "desktop") this.host.prepareNotifications?.();
          this.setPrefs({ [key]: b.dataset.value });
        }),
      ),
    );
    const change = panel.querySelector<HTMLButtonElement>(".shortcut-change")!;
    const keyLabel = panel.querySelector<HTMLElement>(".shortcut-key")!;
    change.addEventListener("click", (e) => {
      e.stopPropagation();
      this.recordingShortcut = true;
      keyLabel.textContent = "Press keys…";
      keyLabel.classList.add("recording");
      const listen = (ev: KeyboardEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.key === "Escape") return done(null);
        const next = shortcutFromEvent(ev);
        if (next) done(next);
      };
      const done = (next: string | null) => {
        removeEventListener("keydown", listen, true);
        setTimeout(() => (this.recordingShortcut = false), 0);
        if (next) {
          this.setPrefs({ shortcut: next });
          this.toast(`Capture shortcut: ${shortcutLabel(next)}`, 2500);
        }
        this.renderPanel();
      };
      addEventListener("keydown", listen, true);
    });
    panel.querySelector(".shortcut-reset")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setPrefs({ shortcut: null });
    });
    const name = panel.querySelector<HTMLInputElement>(".pref-name")!;
    name.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") name.blur();
    });
    name.addEventListener("change", () => {
      const value = name.value.trim();
      this.setPrefs({ name: value || null });
      this.toast(value ? `Your items and replies will say ${value}` : "Using your git name", 2500);
    });
  }

  /** Drag the toolbar anywhere; on release it snaps to the nearest corner and remembers it. */
  private bindDrag() {
    const bar = this.$(".bar");
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const from = { x: e.clientX, y: e.clientY };
      const box = bar.getBoundingClientRect();
      let moving = false;
      const move = (ev: PointerEvent) => {
        if (!moving && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 6) return;
        if (!moving) {
          moving = true;
          bar.classList.add("dragging");
          this.closePopups();
        }
        const left = Math.min(Math.max(0, box.left + ev.clientX - from.x), innerWidth - box.width);
        const y0 = Math.min(Math.max(0, box.top + ev.clientY - from.y), innerHeight - box.height);
        Object.assign(bar.style, { left: `${left}px`, top: `${y0}px`, right: "auto", bottom: "auto" });
      };
      const up = (ev: PointerEvent) => {
        removeEventListener("pointermove", move, true);
        removeEventListener("pointerup", up, true);
        if (!moving) return;
        bar.classList.remove("dragging");
        bar.style.cssText = "";
        // The click that follows the release would otherwise open whatever button the drag started on.
        this.suppressClick = true;
        setTimeout(() => (this.suppressClick = false), 0);
        const position = `${ev.clientY < innerHeight / 2 ? "top" : "bottom"}-${ev.clientX < innerWidth / 2 ? "left" : "right"}` as Prefs["position"];
        this.setPrefs({ position });
      };
      addEventListener("pointermove", move, true);
      addEventListener("pointerup", up, true);
    });
    bar.addEventListener(
      "click",
      (e) => {
        if (!this.suppressClick) return;
        e.stopPropagation();
        e.preventDefault();
      },
      true,
    );
  }

  // ——— helpers ———

  private box(el: HTMLElement, r?: DOMRect | { left: number; top: number; width: number; height: number }) {
    if (!r) return void (el.style.display = "none");
    Object.assign(el.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  private toastTimer = 0;
  /** A short message; with a function, an Undo button; with { label, run }, a button of its own. */
  private toast(msg: string, ms = 1800, action?: (() => Promise<void>) | { label: string; run: () => unknown }) {
    const t = this.$(".toast");
    t.textContent = msg;
    t.classList.toggle("has-action", !!action);
    if (action) {
      const isUndo = typeof action === "function";
      const b = document.createElement("button");
      b.className = "toast-undo";
      b.textContent = isUndo ? "Undo" : action.label;
      b.addEventListener("click", async () => {
        t.classList.remove("show");
        try {
          await (isUndo ? action() : action.run());
          if (isUndo) this.toast("Undone");
        } catch (err) {
          this.toast(`${isUndo ? "Couldn't undo" : "That didn't work"}: ${(err as Error).message}`, 4000);
        }
      });
      t.append(" ", b);
    }
    t.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove("show"), ms);
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

/** True when the key went to a text field (on the page or inside the overlay), so arrows move the caret instead. */
function typingIn(e: KeyboardEvent): boolean {
  const el = e.composedPath()[0] as HTMLElement | undefined;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

const KIND: Record<string, string> = { Note: "note", Question: "asked", Reply: "replied", Feedback: "sent back", Approved: "approved" };

/** Route, then a short page name, then the section: "/pricing · Pricing › Plan cards". Never the page's <h1>. */
function whereLabel(it: Item): string {
  const path = it.page?.routePattern ?? it.route ?? "?";
  const name = it.page?.routeName ?? it.page?.pageComponent?.replace(/(Page|View)$/, "");
  const section = it.page?.section ? ` › ${it.page.section}` : "";
  return `${path}${name ? ` · ${name}` : ""}${section}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? `today ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? "/…" : "");
  } catch {
    return url;
  }
}

const FOCUS_KEY = "ahemui:focus";
/** Drawn in the text colour: the ⚡ emoji keeps its own orange, which vanishes on a coral button. */
const BOLT = `<svg class="bolt" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor"><path d="M9.2 1L3 9.2h4.4L6.6 15 13 6.8H8.6z"/></svg>`;
const ALERT_QUIET = 4000;
const ALERT_MAX = 30_000;

const REVIEW_BUTTON = `<button class="btn review-page" title="Check this page for UX and accessibility issues; Claude can review it in depth with /ahemui:review">✦ Review page</button>`;


const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`;

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
