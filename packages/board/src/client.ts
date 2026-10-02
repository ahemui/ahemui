// The AhemUI backlog board. One page, two modes:
//  - live: served by `ahemui serve` at http://127.0.0.1:<port>/ with actions and WebSocket updates
//  - static: `.ahemui/backlog.html`, a read-only snapshot with the data embedded and images referenced relatively
import type { Batch } from "../../overlay/src/prefs.js";
import type { Item, Page, Status } from "../../overlay/src/types.js";
import { armDanger, hasArmed } from "../../overlay/src/confirm.js";
import { CSS } from "./styles.js";

interface Watcher {
  state: "waiting" | "working";
  item?: string;
  paused?: boolean;
  stopping?: boolean;
}
interface Boot {
  mode: "live" | "static";
  project?: string;
  branch?: string | null;
  generated?: string;
  items?: Item[];
  batches?: Batch[];
  base?: string;
}
declare global {
  interface Window {
    __AHEMUI_BOARD__: Boot;
  }
}

const boot = window.__AHEMUI_BOARD__;
const live = boot.mode === "live";

const state = {
  items: (boot.items ?? []) as Item[],
  batches: (boot.batches ?? []) as Batch[],
  watcher: null as Watcher | null,
  connected: !live,
  project: boot.project ?? "",
  branch: boot.branch ?? null,
  q: "",
  type: "",
  groupBy: "status" as "status" | "page" | "area" | "batch",
  archived: false,
  selected: location.hash.slice(1) || null,
};

const TYPES = ["bug", "style", "layout", "copy", "feature", "a11y", "other"];
const PRIORITIES = ["high", "normal", "low"];
const LABEL: Record<Status, string> = { open: "open", "in-progress": "in progress", review: "ready for review", done: "done", wontfix: "won't fix" };

interface Column {
  key: string;
  title: string;
  hint: string;
  test: (i: Item) => boolean;
}
const COLUMNS: Column[] = [
  { key: "queue", title: "⚡ Queue", hint: "Claude works these as soon as a session runs /ahemui:watch", test: (i) => i.status === "open" && i.start === "now" && !i.needs_reply },
  { key: "backlog", title: "Backlog", hint: "Saved for later: /ahemui:work, or press Start", test: (i) => i.status === "open" && i.start !== "now" && !i.needs_reply },
  { key: "progress", title: "In progress", hint: "Claude is on it", test: (i) => i.status === "in-progress" },
  { key: "you", title: "Needs you", hint: "Review the result or answer Claude's question", test: (i) => i.status === "review" || (i.status === "open" && !!i.needs_reply) },
  { key: "done", title: "Done", hint: "Approved, done or won't fix", test: (i) => i.status === "done" || i.status === "wontfix" },
];

// ——— data ———

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function fileUrl(it: Item, name: string): string {
  if (live) return `/api/items/${it.id}/file/${encodeURIComponent(name)}`;
  return `${boot.base ? `${boot.base}/` : ""}${it.location}/${it.id}/${encodeURIComponent(name)}`;
}

async function connect() {
  try {
    const health = await api<{ project: string; branch: string | null; watcher: Watcher | null }>("GET", "/api/health");
    state.project = health.project;
    state.branch = health.branch;
    state.watcher = health.watcher;
    state.items = await api<Item[]>("GET", state.archived ? "/api/items?all" : "/api/items");
    state.batches = await api<Batch[]>("GET", "/api/batches").catch(() => []);
    render();
  } catch {
    /* the socket retry below covers it */
  }
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => {
    state.connected = true;
    renderHeader();
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type !== "items") return;
    // Live updates carry active items only; keep any archived ones fetched for the "archived" filter.
    state.items = state.archived ? [...msg.items, ...state.items.filter((i) => i.location === "done")] : msg.items;
    if (msg.watcher !== undefined) state.watcher = msg.watcher;
    // A new batch may have been started in the browser since the last fetch.
    if (msg.items.some((i: Item) => i.batch && !state.batches.some((b) => b.id === i.batch))) {
      api<Batch[]>("GET", "/api/batches").then((b) => ((state.batches = b), render()), () => {});
    }
    render();
  };
  ws.onclose = () => {
    state.connected = false;
    renderHeader();
    setTimeout(connect, 2000);
  };
}

// ——— rendering ———

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function mount() {
  document.head.insertAdjacentHTML("beforeend", `<style>${CSS}</style>`);
  document.body.innerHTML = `
    <header class="top">
      <div class="brand"><span class="logo">◉</span> <b>AhemUI</b> <span class="proj"></span></div>
      <div class="filters">
        <input class="search" type="search" placeholder="Search requests, pages, files…  ( / )">
        <select class="f-type"><option value="">All types</option>${TYPES.map((t) => `<option>${t}</option>`).join("")}</select>
        <select class="f-group">
          <option value="status">Columns by status</option>
          <option value="page">Group by page</option>
          <option value="area">Group by area</option>
          <option value="batch">Group by batch</option>
        </select>
        <label class="f-arch"><input type="checkbox"> archived</label>
      </div>
      <div class="status"></div>
    </header>
    ${live ? "" : `<div class="banner">Read-only snapshot${boot.generated ? ` from ${new Date(boot.generated).toLocaleString()}` : ""}. For the live board with actions, run <code>npx ahemui board</code> in the repo.</div>`}
    <main class="board"></main>
    <div class="scrim" hidden></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Item details" hidden></aside>
    <div class="toast"></div>`;

  $(".scrim").addEventListener("click", () => select(null));
  $<HTMLInputElement>(".search").addEventListener("input", (e) => {
    state.q = (e.target as HTMLInputElement).value.toLowerCase();
    renderBoard();
  });
  $<HTMLSelectElement>(".f-type").addEventListener("change", (e) => {
    state.type = (e.target as HTMLSelectElement).value;
    renderBoard();
  });
  $<HTMLSelectElement>(".f-group").addEventListener("change", (e) => {
    state.groupBy = (e.target as HTMLSelectElement).value as typeof state.groupBy;
    renderBoard();
  });
  $(".f-arch input").addEventListener("change", async (e) => {
    state.archived = (e.target as HTMLInputElement).checked;
    if (live && state.archived) state.items = await api<Item[]>("GET", "/api/items?all").catch(() => state.items);
    renderBoard();
  });
  addEventListener("keydown", (e) => {
    const typing = (e.target as HTMLElement).closest("input, textarea, select");
    if (e.key === "/" && !typing) {
      e.preventDefault();
      $(".search").focus();
    } else if (e.key === "Escape") select(null);
  });
  addEventListener("hashchange", () => select(location.hash.slice(1) || null, false));
  $(".board").addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
    const start = (e.target as HTMLElement).closest<HTMLElement>("[data-quick]");
    if (start) {
      e.stopPropagation();
      return act(start.dataset.id!, start.dataset.quick!);
    }
    if (card) select(card.dataset.id!);
  });
}

function render() {
  renderHeader();
  renderBoard();
  renderDrawer();
}

function renderHeader() {
  const active = state.items.filter((i) => i.location === "items");
  const w = state.watcher;
  $(".proj").textContent = [state.project, state.branch].filter(Boolean).join(" · ");
  document.title = `AhemUI backlog${state.project ? ` — ${state.project}` : ""}`;
  const counts = COLUMNS.map((c) => `<span title="${c.hint}">${c.title} <b>${active.filter(c.test).length}</b></span>`).join("");
  const claude = !live ? "" : w ? `<span class="live ${w.paused || w.stopping ? "" : "on"}">Claude ${w.stopping ? "stopping" : w.paused ? "paused" : w.state === "waiting" ? "watching" : "working"}</span>` : `<span class="live" title="Run /ahemui:watch in Claude Code">No Claude session watching</span>`;
  const conn = live ? `<span class="dot ${state.connected ? "ok" : ""}" title="${state.connected ? "Live" : "Reconnecting…"}"></span>` : "";
  $(".status").innerHTML = `${counts}${claude}${conn}`;
}

function visible(): Item[] {
  return state.items
    .filter((i) => state.archived || i.location === "items")
    .filter((i) => !state.type || i.type === state.type)
    .filter((i) => {
      if (!state.q) return true;
      const hay = [i.body, i.id, i.area, i.route, i.anchor.source, i.anchor.text, i.page?.heading, i.page?.title, i.page?.routeName, i.page?.section, i.labels?.join(" "), i.external?.key]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(state.q);
    })
    .sort((a, b) => (b.id > a.id ? 1 : -1)); // newest first
}

function renderBoard() {
  const items = visible();
  const board = $(".board");
  if (state.groupBy === "status") {
    board.className = "board columns";
    board.innerHTML = COLUMNS.map((c) => {
      const list = items.filter(c.test);
      const finishedHere = list.filter((i) => i.location === "items").length;
      const clear = live && c.key === "done" && finishedHere ? `<button class="btn clear" data-quick="prune" data-id="" title="Archive every done and won't-fix item (moves them to .ahemui/done/)">Clear ${finishedHere}</button>` : "";
      return `<section class="col col-${c.key}"><h2 title="${c.hint}">${c.title} <span>${list.length}</span>${clear}</h2><div class="cards">${list.map(card).join("") || `<p class="empty">${c.hint}</p>`}</div></section>`;
    }).join("");
  } else {
    board.className = "board groups";
    const groups = new Map<string, Item[]>();
    for (const it of items) {
      const key =
        state.groupBy === "page"
          ? pageName(it.page, it.route)
          : state.groupBy === "batch"
            ? batchLabel(it)
            : (it.area ?? "No area yet (run /ahemui:triage)");
      groups.set(key, [...(groups.get(key) ?? []), it]);
    }
    board.innerHTML =
      [...groups]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, list]) => `<section class="grp"><h2>${esc(k)} <span>${list.length}</span></h2><div class="cards">${list.map(card).join("")}</div></section>`)
        .join("") || `<p class="empty big">Nothing matches.</p>`;
  }
  board.querySelectorAll<HTMLElement>(".card").forEach((c) => c.classList.toggle("sel", c.dataset.id === state.selected));
}

function card(it: Item): string {
  const asking = it.status === "open" && it.needs_reply;
  const chips = [
    it.start === "now" && it.status === "open" && !asking ? `<span class="chip now">⚡ queued</span>` : "",
    it.intent === "review" ? `<span class="chip ask">for review</span>` : "",
    asking ? `<span class="chip ask">? question for you</span>` : "",
    it.status === "review" ? `<span class="chip review">◎ review</span>` : "",
    it.status === "wontfix" ? `<span class="chip">won't fix</span>` : "",
    it.location === "done" ? `<span class="chip">archived</span>` : "",
    it.type ? `<span class="chip t">${esc(it.type)}</span>` : "",
    it.priority === "high" ? `<span class="chip high">high</span>` : "",
    it.area ? `<span class="chip">${esc(it.area)}</span>` : "",
    ...(it.labels ?? []).map((l) => `<span class="chip">#${esc(l)}</span>`),
    it.external ? `<span class="chip ext">${esc(it.external.key)}</span>` : "",
  ].join("");
  const quick =
    live && it.status === "open" && !asking && it.start !== "now"
      ? `<button class="quick" data-quick="start" data-id="${it.id}" title="Have Claude work on this now">${state.watcher?.state === "working" ? "Add to queue" : "⚡ Start"}</button>`
      : "";
  return `<article class="card s-${it.status}${asking ? " s-ask" : ""}" data-id="${it.id}" tabindex="0">
    ${it.shot ? `<div class="thumb"><img loading="lazy" src="${fileUrl(it, it.shot)}" alt=""></div>` : ""}
    <div class="c-title">${esc(firstLine(it))}</div>
    <div class="c-page">${esc(pageName(it.page, it.route))}${it.page?.section ? ` › ${esc(it.page.section)}` : ""}</div>
    ${chips ? `<div class="chips">${chips}</div>` : ""}
    <div class="c-foot"><span>${esc(it.author)} · ${ago(it.created)}</span>${quick}</div>
  </article>`;
}

function select(id: string | null, updateHash = true) {
  state.selected = id;
  if (updateHash) history.replaceState(null, "", id ? `#${id}` : location.pathname + location.search);
  renderDrawer();
  document.querySelectorAll<HTMLElement>(".card").forEach((c) => c.classList.toggle("sel", c.dataset.id === id));
}

function renderDrawer() {
  const drawer = $(".drawer");
  const it = state.items.find((i) => i.id === state.selected);
  const scrim = $(".scrim");
  if (!it) {
    drawer.hidden = true;
    scrim.hidden = true;
    document.body.classList.remove("modal-open");
    return;
  }
  // Keep text someone is typing across live updates.
  const drafts = new Map([...drawer.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("[data-keep]")].map((el) => [el.dataset.keep!, el.value]));
  // Keep a half-typed reply, or an armed Dismiss, through live updates.
  if (drawer.dataset.id === it.id && ([...drafts.values()].some((v) => v.trim()) || hasArmed(drawer))) return;
  drawer.dataset.id = it.id;
  drawer.hidden = false;
  scrim.hidden = false;
  document.body.classList.add("modal-open");
  const asking = it.status === "open" && it.needs_reply;
  const { prompt, thread } = splitThread(it.body);
  const p: Page = it.page ?? {};
  const a = it.anchor;

  const images: string[] = [];
  if (it.status === "review" || it.after) {
    images.push(`<div class="compare">${fig(it, it.shot, "before")}${it.after ? fig(it, it.after, "after") : `<figure><div class="pending">after-shot is taken when the page is open</div><figcaption>after</figcaption></figure>`}</div>`);
  } else if (it.shot) images.push(fig(it, it.shot, "highlighted area"));
  for (const [n, ex] of (it.extras ?? []).entries()) {
    if (ex.shot) images.push(fig(it, ex.shot, ex.role === "reference" ? `area ${n + 2}: example to match` : `area ${n + 2}: also applies here`));
  }

  // Same order as the popover on the page: status, the request, who/when, what to do, the picture, the
  // conversation, where it lives; everything technical folded away underneath.
  const tags = [
    it.intent === "review" ? "for review" : "",
    it.start === "now" && it.status === "open" && !asking ? "⚡ start now" : "",
    it.type ?? "",
    it.priority && it.priority !== "normal" ? `${it.priority} priority` : "",
    it.area ?? "",
    ...(it.labels ?? []).map((l) => `#${l}`),
  ].filter(Boolean);
  const technical = [
    row("Components", a.components?.join(" › ")),
    row("Page file", p.pageFile, true),
    row("Story", p.storyTitle ? `${p.storyTitle}${p.storyFile ? ` — ${p.storyFile}` : ""}` : undefined),
    row("Element", a.text ? `"${a.text}"` : undefined),
    row("CSS path", a.selector, true),
    row("Seen in", [p.browser, it.viewport, p.colorScheme && `${p.colorScheme} mode`].filter(Boolean).join(", ")),
  ].join("");
  drawer.innerHTML = `
    <div class="d-head">
      <span class="pill s-${it.status}${asking ? " s-ask" : ""}">${asking ? "question for you" : LABEL[it.status]}</span>
      <button class="id-copy" data-act="copy" title="Copy id"><code>${it.id.slice(0, 10)}…</code></button>
      <button class="x" title="Close (Esc)" aria-label="Close">✕</button>
    </div>
    <h1 class="request">${esc(prompt.trim())}</h1>
    <div class="d-sub">${esc(it.author)} · ${new Date(it.created).toLocaleString()}${it.claimed_by && it.status === "in-progress" ? ` · ${esc(it.claimed_by)} is on it` : ""}</div>
    ${tags.length ? `<div class="chips">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>` : ""}
    ${live ? actions(it, asking) : ""}
    ${images.join("")}
    ${
      thread.length
        ? `<section><h3>Conversation</h3>${thread
            .map((t) => `<div class="entry k-${t.kind.toLowerCase()}"><div class="who"><b>${esc(t.who)}</b> · ${esc(t.kind.toLowerCase())}</div><div class="prose">${esc(t.text)}</div></div>`)
            .join("")}</section>`
        : ""
    }
    <section><h3>Where</h3><dl>
      ${it.batch ? row("Batch", batchLabel(it)) : ""}
      ${row("Page", pageName(p, it.route) + (p.section ? ` › ${p.section}` : ""))}
      ${row("Code", a.source, true)}
      ${it.url ? `<dt>URL</dt><dd><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.url)}</a>${p.env === "deployed" ? " (deployed)" : ""}</dd>` : ""}
      ${it.design ? `<dt>Design</dt><dd><a href="${esc(it.design)}" target="_blank" rel="noopener">${esc(it.design)}</a></dd>` : ""}
      ${it.external ? `<dt>Ticket</dt><dd>${it.external.url ? `<a href="${esc(it.external.url)}" target="_blank" rel="noopener">${esc(it.external.key)}</a>` : esc(it.external.key)}${it.external.status ? ` · ${esc(it.external.status)}` : ""}</dd>` : ""}
    </dl></section>
    ${triageSection(it)}
    <details class="tech"><summary>Technical details</summary>
      ${technical ? `<section><dl>${technical}</dl></section>` : ""}
      ${contextSections(it)}
    </details>`;

  for (const [k, v] of drafts) {
    const el = drawer.querySelector<HTMLTextAreaElement>(`[data-keep="${k}"]`);
    if (el) el.value = v;
  }
  drawer.querySelector(".x")!.addEventListener("click", () => select(null));
  drawer.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.act === "dismiss" && !armDanger(b)) return;
      act(it.id, b.dataset.act!);
    }),
  );
  drawer.querySelectorAll("textarea, input").forEach((el) => el.addEventListener("keydown", (e) => e.stopPropagation()));
}

function fig(it: Item, name: string | undefined, caption: string): string {
  if (!name) return `<figure><div class="pending">no screenshot</div><figcaption>${esc(caption)}</figcaption></figure>`;
  return `<figure><a href="${fileUrl(it, name)}" target="_blank"><img src="${fileUrl(it, name)}" alt=""></a><figcaption>${esc(caption)}</figcaption></figure>`;
}

function actions(it: Item, asking: boolean | undefined): string {
  const btn = (act: string, label: string, primary = false) => `<button class="btn${primary ? " primary" : ""}" data-act="${act}">${label}</button>`;
  let main = "";
  if (asking) {
    main = `<textarea data-keep="reply" placeholder="Answer Claude's question…"></textarea><div class="acts">${btn("reply", "Reply", true)}</div>`;
  } else if (it.status === "review") {
    main = `<div class="acts">${btn("approve", "Looks good ✓", true)}</div>
      <textarea data-keep="changes" placeholder="Not quite? Say what still needs to change…"></textarea><div class="acts">${btn("changes", "Send back")}</div>`;
  } else if (it.status === "open") {
    const queue = it.start === "now" ? btn("later", "Move to backlog") : btn("start", state.watcher?.state === "working" ? "Add to queue" : "⚡ Start now", true);
    main = `<div class="acts">${queue}${btn("done", "Mark done")}${btn("dismiss", "Dismiss")}</div>`;
  } else if (it.status === "in-progress") {
    main = `<div class="acts">${btn("done", "Mark done")}${btn("reopen", "Put back to open")}${btn("dismiss", "Dismiss")}</div>`;
  } else if (it.location === "items") {
    main = `<div class="acts">${btn("archive", "Archive")}${btn("reopen", "Reopen")}</div>`;
  } else {
    main = `<div class="acts">${btn("reopen", "Reopen")}</div>`;
  }
  return `<div class="d-actions">${main}${it.url ? `<div class="acts minor"><a class="btn" href="${esc(it.url)}" target="_blank" rel="noopener">Open page ↗</a></div>` : ""}</div>`;
}

function triageSection(it: Item): string {
  if (!live) {
    const cls = [it.type, it.priority, it.area, ...(it.labels ?? []).map((l) => `#${l}`)].filter(Boolean).join(" · ");
    return cls ? `<section><h3>Classification</h3><p>${esc(cls)}</p></section>` : "";
  }
  const opt = (list: string[], cur?: string, empty = "—") => `<option value="">${empty}</option>${list.map((v) => `<option ${v === cur ? "selected" : ""}>${v}</option>`).join("")}`;
  return `<section><h3>Classification</h3><div class="triage">
    <label>Type <select data-t="type">${opt(TYPES, it.type)}</select></label>
    <label>Priority <select data-t="priority">${opt(PRIORITIES, it.priority, "normal")}</select></label>
    <label class="wide">Area <input data-t="area" value="${esc(it.area ?? "")}" placeholder="Page › Section"></label>
    <label class="wide">Labels <input data-t="labels" value="${esc((it.labels ?? []).join(", "))}" placeholder="mobile, dark-mode"></label>
    <div class="acts"><button class="btn" data-act="triage">Save classification</button></div>
  </div></section>`;
}

function contextSections(it: Item): string {
  const out: string[] = [];
  const st = (it as any).styles;
  if (st?.computed) {
    out.push(`<section><h3>Styles</h3><dl>${Object.entries(st.computed).map(([k, v]) => row(k, `${v}${st.tokens?.[k] ? `  →  ${st.tokens[k]}` : ""}`, true)).join("")}${st.classes ? row("classes", st.classes.join(" "), true) : ""}</dl></section>`);
  }
  const ev = (it as any).evidence;
  if (ev?.console?.length || ev?.network?.length) {
    out.push(`<section><h3>Errors before capture</h3><ul class="mono-list">${[
      ...(ev.console ?? []).map((c: any) => `<li><b>console.${esc(c.level)}</b> ${esc(c.message)}</li>`),
      ...(ev.network ?? []).map((n: any) => `<li><b>${esc(n.method)} ${n.status || "failed"}</b> ${esc(n.url)}</li>`),
    ].join("")}</ul></section>`);
  }
  const steps = (it as any).steps;
  if (steps?.length) out.push(`<section><h3>Steps before capture</h3><ol class="mono-list">${steps.map((s: any) => `<li>${esc(s.kind)} ${esc(s.target ?? "")}${s.detail ? ` (${esc(s.detail)})` : ""}</li>`).join("")}</ol></section>`);
  const a11y = (it as any).a11y;
  if (a11y?.length) out.push(`<section><h3>Accessibility</h3><ul class="mono-list">${a11y.map((v: any) => `<li><b>${esc(v.impact ?? "")}</b> ${esc(v.id)}: ${esc(v.help)}</li>`).join("")}</ul></section>`);
  const state = (it as any).state;
  if (state && (state.props !== undefined || state.state !== undefined)) {
    out.push(`<section><h3>Component state${state.component ? ` · ${esc(state.component)}` : ""}</h3><pre>${esc(JSON.stringify({ props: state.props, state: state.state }, null, 2))}</pre></section>`);
  }
  return out.join("");
}

// ——— actions (live) ———

async function act(id: string, action: string) {
  if (action === "prune") {
    try {
      const { archived } = await api<{ archived: string[] }>("POST", "/api/prune", {});
      state.items = state.items.map((i) => (archived.includes(i.id) ? { ...i, location: "done" as const } : i));
      render();
      toast(`Archived ${archived.length} finished item(s)`, async () => {
        for (const a of archived) await restore(a);
      });
    } catch (err) {
      toast((err as Error).message);
    }
    return;
  }
  const it = state.items.find((i) => i.id === id);
  if (!it) return;
  const drawer = $(".drawer");
  const text = (k: string) => drawer.querySelector<HTMLTextAreaElement>(`[data-keep="${k}"]`)?.value.trim() ?? "";
  try {
    let updated: Item | undefined;
    switch (action) {
      case "copy":
        await navigator.clipboard.writeText(id);
        return toast("Copied");
      case "start":
      case "later":
        updated = await api<Item>("POST", `/api/items/${id}/start`, { start: action === "start" ? "now" : "later" });
        toast(action === "later" ? "Moved to the backlog" : state.watcher?.state === "waiting" ? "⚡ Claude is starting on it" : state.watcher ? "Added to the queue" : "Queued; start /ahemui:watch in Claude Code to work it");
        break;
      case "done":
      case "wontfix": {
        const was = it.status;
        updated = await api<Item>("POST", `/api/items/${id}/resolve`, { status: action });
        toast(action === "wontfix" ? "Marked won't fix" : "Marked done", () => restore(id, was));
        break;
      }
      case "reopen":
        updated = await api<Item>("POST", `/api/items/${id}/reopen`, {});
        break;
      case "dismiss": {
        const was = it.status;
        updated = await api<Item>("POST", `/api/items/${id}/dismiss`, {});
        toast("Dismissed", () => restore(id, was));
        break;
      }
      case "archive":
        updated = await api<Item>("POST", `/api/items/${id}/archive`, {});
        toast("Archived", () => restore(id));
        break;
      case "reply":
        if (!text("reply")) return toast("Type an answer first");
        updated = await api<Item>("POST", `/api/items/${id}/reply`, { text: text("reply") });
        toast("Sent to Claude ✓");
        break;
      case "approve":
        updated = await api<Item>("POST", `/api/items/${id}/review`, { verdict: "approved" });
        toast("Approved ✓");
        break;
      case "changes":
        if (!text("changes")) return toast("Say what still needs to change");
        updated = await api<Item>("POST", `/api/items/${id}/review`, { verdict: "changes", comment: text("changes") });
        toast("Sent back to Claude");
        break;
      case "triage": {
        const v = (k: string) => drawer.querySelector<HTMLInputElement>(`[data-t="${k}"]`)!.value.trim();
        const labels = v("labels").split(",").map((l) => l.trim()).filter(Boolean);
        updated = await api<Item>("POST", `/api/items/${id}/triage`, {
          type: v("type") || null,
          priority: v("priority") || null,
          area: v("area") || null,
          labels: labels.length ? labels : null,
        });
        toast("Saved");
        break;
      }
    }
    if (updated) {
      drawer.querySelectorAll<HTMLTextAreaElement>("[data-keep]").forEach((el) => (el.value = ""));
      state.items = state.items.map((i) => (i.id === updated!.id ? updated! : i));
      render();
    }
  } catch (err) {
    toast((err as Error).message);
  }
}

// ——— helpers ———

function row(label: string, value: string | undefined, mono = false): string {
  return value ? `<dt>${esc(label)}</dt><dd${mono ? ` class="mono"` : ""}>${esc(value)}</dd>` : "";
}

function firstLine(it: Item): string {
  return it.body.split("\n")[0].slice(0, 140);
}

/** "/pricing · Pricing": the route plus a short page name. Not the <h1>, which is often a whole sentence. */
function batchLabel(it: Item): string {
  if (!it.batch) return "No batch";
  const b = state.batches.find((x) => x.id === it.batch);
  return b ? `${b.name} (${b.intent === "review" ? "for review" : "changes"} · ${b.author})` : `Batch ${it.batch.slice(0, 8)}`;
}

function pageName(p: Page | undefined, route: string | undefined): string {
  const name = p?.storyTitle || p?.routeName || p?.pageComponent?.replace(/(Page|View)$/, "");
  const path = p?.routePattern ?? route ?? "?";
  return name ? `${path} · ${name}` : path;
}

function splitThread(body: string): { prompt: string; thread: { kind: string; who: string; text: string }[] } {
  const parts = body.split(/\n\n### (Note|Question|Reply|Feedback|Approved) — ([^\n]+)\n\n/);
  const thread: { kind: string; who: string; text: string }[] = [];
  for (let i = 1; i + 2 < parts.length + 1; i += 3) thread.push({ kind: parts[i], who: parts[i + 1].replace(/, \d{4}-\d\d-\d\d \d\d:\d\d$/, ""), text: (parts[i + 2] ?? "").trim() });
  return { prompt: parts[0], thread };
}

function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

let toastTimer = 0;
function toast(msg: string, undo?: () => Promise<void>) {
  const t = $(".toast");
  t.textContent = msg;
  t.classList.toggle("has-action", !!undo);
  if (undo) {
    const b = document.createElement("button");
    b.className = "toast-undo";
    b.textContent = "Undo";
    b.addEventListener("click", async () => {
      t.classList.remove("show");
      await undo().then(() => toast("Undone"), (err) => toast(`Couldn't undo: ${err.message}`));
    });
    t.append(" ", b);
  }
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), undo ? 6000 : 2500);
}

/** The toast's Undo: back into the backlog, and to the status it had before. */
async function restore(id: string, status?: Status) {
  const updated = await api<Item>("POST", `/api/items/${id}/restore`, status ? { status } : {});
  state.items = state.items.map((i) => (i.id === id ? updated : i));
  render();
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

mount();
render();
if (live) connect();
