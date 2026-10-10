// The page agent runs in the page's own JS world, as early as possible (a classic <script> injected first by the
// Vite plugin, or the extension's main-world content script at document_start). It is the only part of AhemUI that
// can see framework internals and hook console/network. The overlay talks to it through DOM events and attributes,
// which works from the extension's isolated world as well as from the page itself.

export interface FrameworkInfo {
  framework?: "vue" | "react" | "svelte";
  components?: string[]; // outermost → innermost
  file?: string; // component file (Vue __file)
  source?: string; // exact element source "file:line:col" (React ≤18 _debugSource, Svelte __svelte_meta)
}

/** The current Vue Router route; works in production builds too, since the app instance stays reachable. */
export interface RouteInfo {
  routeName?: string;
  routePattern?: string;
  params?: Record<string, string>;
  routeMeta?: Record<string, string | number | boolean>;
  pageComponent?: string;
  pageFile?: string;
}

export interface EvidenceInfo {
  console?: { level: string; message: string; ago: number }[];
  network?: { method: string; url: string; status: number; ms?: number; ago: number }[];
}

export interface StateInfo {
  component?: string;
  props?: unknown;
  state?: unknown;
  truncated?: boolean;
}

/** What the overlay can ask the page agent. Missing agent → empty answers. */
export interface PageAgent {
  elements(els: Element[]): FrameworkInfo[];
  route(): RouteInfo;
  evidence(): EvidenceInfo;
  state(el: Element): StateInfo | undefined;
}

const TAG = "data-ahemui-q";
const ANSWER = "data-ahemui-a";
const DOC_ANSWER = "data-ahemui-doc-a";

// ——————————————————————————— client side (overlay, any world) ———————————————————————————

function ask<T>(event: string, els: Element[] = []): (T | undefined)[] | T | undefined {
  els.forEach((el) => el.setAttribute(TAG, ""));
  document.dispatchEvent(new CustomEvent(`ahemui:${event}`)); // listeners in every world run synchronously
  const read = (el: Element, attr: string) => {
    const raw = el.getAttribute(attr);
    el.removeAttribute(attr);
    try {
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  };
  if (!els.length) return read(document.documentElement, DOC_ANSWER);
  return els.map((el) => {
    el.removeAttribute(TAG);
    return read(el, ANSWER);
  });
}

export const agent: PageAgent = {
  elements: (els) => (ask<FrameworkInfo>("elements", els) as (FrameworkInfo | undefined)[]).map((x) => x ?? {}),
  route: () => (ask<RouteInfo>("route") as RouteInfo | undefined) ?? {},
  evidence: () => (ask<EvidenceInfo>("evidence") as EvidenceInfo | undefined) ?? {},
  state: (el) => (ask<StateInfo>("state", [el]) as (StateInfo | undefined)[])[0],
};

// ——————————————————————————— agent side (page main world) ———————————————————————————

const RING = 30;
const logs: { level: string; message: string; t: number }[] = [];
const requests: { method: string; url: string; status: number; ms?: number; t: number }[] = [];
const push = <T>(arr: T[], e: T) => {
  arr.push(e);
  if (arr.length > RING) arr.shift();
};
const AHEMUI_SERVER = /^https?:\/\/(127\.0\.0\.1|localhost):47[78]\d\//;

export function installAgent() {
  const w = window as any;
  if (w.__ahemuiAgent) return;
  w.__ahemuiAgent = true;

  hookConsole();
  hookNetwork();

  const answerEach = (event: string, fn: (el: Element) => unknown) =>
    document.addEventListener(`ahemui:${event}`, () => {
      for (const el of document.querySelectorAll(`[${TAG}]`)) {
        try {
          el.setAttribute(ANSWER, JSON.stringify(fn(el) ?? null));
        } catch {
          /* never break the page */
        }
      }
    });
  const answerDoc = (event: string, fn: () => unknown) =>
    document.addEventListener(`ahemui:${event}`, () => {
      try {
        document.documentElement.setAttribute(DOC_ANSWER, JSON.stringify(fn() ?? null));
      } catch {
        /* never break the page */
      }
    });

  answerEach("elements", frameworkInfo);
  answerEach("state", componentState);
  answerDoc("route", routeInfo);
  answerDoc("evidence", () => {
    const now = Date.now();
    const recent = <T extends { t: number }>(arr: T[]) =>
      arr.filter((e) => now - e.t < 10 * 60_000).map(({ t, ...rest }) => ({ ...rest, ago: now - t }));
    const out: EvidenceInfo = {};
    if (logs.length) out.console = recent(logs);
    if (requests.length) out.network = recent(requests);
    return out;
  });
}

function hookConsole() {
  for (const level of ["error", "warn"] as const) {
    const original = console[level];
    console[level] = function (...args: unknown[]) {
      try {
        push(logs, { level, message: fmt(args), t: Date.now() });
      } catch {
        /* ignore */
      }
      return original.apply(this, args);
    };
  }
  addEventListener(
    "error",
    (e) => {
      const target = e.target as Element | null;
      const message =
        target && target !== (window as any) && "localName" in target
          ? `Failed to load <${target.localName}> ${(target as HTMLImageElement).src ?? (target as HTMLLinkElement).href ?? ""}`
          : `${e.message}${e.filename ? ` (${e.filename}:${e.lineno})` : ""}`;
      push(logs, { level: "error", message: message.slice(0, 600), t: Date.now() });
    },
    true,
  );
  addEventListener("unhandledrejection", (e) => push(logs, { level: "error", message: `Unhandled rejection: ${fmt([e.reason])}`, t: Date.now() }));
}

function hookNetwork() {
  const originalFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const t0 = performance.now();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = input instanceof Request ? input.url : String(input);
    try {
      const res = await originalFetch.call(this, input, init);
      if (!res.ok && !AHEMUI_SERVER.test(res.url || url)) push(requests, { method, url: res.url || url, status: res.status, ms: Math.round(performance.now() - t0), t: Date.now() });
      return res;
    } catch (err) {
      if (!AHEMUI_SERVER.test(url)) push(requests, { method, url, status: 0, ms: Math.round(performance.now() - t0), t: Date.now() });
      throw err;
    }
  };
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: any, method: string, url: string | URL, ...rest: any[]) {
    this.__ahemui = { method: method.toUpperCase(), url: String(url) };
    return (open as any).call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (this: any, body?: any) {
    const info = this.__ahemui;
    if (info) {
      const t0 = performance.now();
      this.addEventListener("loadend", () => {
        if ((this.status >= 400 || this.status === 0) && !AHEMUI_SERVER.test(info.url)) {
          push(requests, { ...info, status: this.status, ms: Math.round(performance.now() - t0), t: Date.now() });
        }
      });
    }
    return send.call(this, body);
  };
}

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack.split("\n").slice(1, 4).join("\n")}` : ""}`;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(safe(a, 2));
      } catch {
        return String(a);
      }
    })
    .join(" ")
    .slice(0, 600);
}

// ——— frameworks ———

function frameworkInfo(el: Element): FrameworkInfo {
  return vueInfo(el) ?? reactInfo(el) ?? svelteInfo(el) ?? {};
}

function vueInstance(el: Element): any {
  for (let e: any = el; e; e = e.parentElement) if (e.__vueParentComponent) return e.__vueParentComponent;
  return undefined;
}

function vueInfo(el: Element): FrameworkInfo | undefined {
  const inst = vueInstance(el);
  if (!inst) return undefined;
  const components: string[] = [];
  for (let i = inst; i && components.length < 8; i = i.parent) components.unshift(typeName(i.type) ?? "Anonymous");
  return { framework: "vue", components, file: inst.type?.__file };
}

function typeName(t: any): string | undefined {
  if (!t) return undefined;
  if (typeof t === "function") return t.displayName || t.name || undefined;
  if (typeof t !== "object") return undefined;
  if (t.displayName || t.name || t.__name) return t.displayName || t.name || t.__name;
  if (t.render) return typeName(t.render); // React forwardRef
  if (t.type) return typeName(t.type); // React memo
  const file: string | undefined = t.__file;
  return file ? file.split(/[\\/]/).pop()!.replace(/\.\w+$/, "") : undefined;
}

function reactFiber(el: Element): any {
  for (let e: any = el; e; e = e.parentElement) {
    const key = Object.keys(e).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (key) return e[key];
  }
  return undefined;
}

const isComponentFiber = (f: any) => typeof f.type === "function" || (f.type && typeof f.type === "object" && (f.type.render || f.type.type));

function reactInfo(el: Element): FrameworkInfo | undefined {
  const fiber = reactFiber(el);
  if (!fiber) return undefined;
  const components: string[] = [];
  let source: string | undefined;
  for (let f = fiber; f; f = f.return) {
    if (!source && f._debugSource) source = `${f._debugSource.fileName}:${f._debugSource.lineNumber}:${f._debugSource.columnNumber ?? 1}`;
    if (isComponentFiber(f) && components.length < 8) {
      const name = typeName(f.type);
      if (name) components.unshift(name);
    }
  }
  return { framework: "react", components, source };
}

function svelteInfo(el: Element): FrameworkInfo | undefined {
  for (let e: any = el; e; e = e.parentElement) {
    const loc = e.__svelte_meta?.loc;
    if (loc?.file) {
      const name = String(loc.file).split(/[\\/]/).pop()!.replace(/\.svelte$/, "");
      return { framework: "svelte", components: [name], source: `${loc.file}:${loc.line}:${(loc.column ?? 0) + 1}`, file: loc.file };
    }
  }
  return undefined;
}

function routeInfo(): RouteInfo {
  const app = (document.querySelector("[data-v-app]") as any)?.__vue_app__;
  const r = app?.config?.globalProperties?.$router?.currentRoute?.value;
  if (!r) return {};
  const last = r.matched?.at(-1);
  const comp = last?.components?.default; // a function until a lazy route has loaded
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.params ?? {}).slice(0, 10)) params[k] = String(Array.isArray(v) ? v.join("/") : v).slice(0, 200);
  const meta: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(r.meta ?? {}).slice(0, 12)) {
    if (typeof v === "string") meta[k] = v.slice(0, 200);
    else if (typeof v === "number" || typeof v === "boolean") meta[k] = v;
  }
  return {
    routeName: r.name != null ? String(r.name).slice(0, 120) : undefined,
    routePattern: last?.path,
    params: Object.keys(params).length ? params : undefined,
    routeMeta: Object.keys(meta).length ? meta : undefined,
    pageComponent: typeof comp === "object" ? typeName(comp) : undefined,
    pageFile: typeof comp === "object" ? comp?.__file : undefined,
  };
}

// ——— component state ———

const SENSITIVE_KEY = /pass|secret|token|auth|api.?key|session|cookie|ssn|card|cvv|iban|otp|pin|phone|e.?mail|address|dob|birth/i;

function componentState(el: Element): StateInfo | undefined {
  const inst = vueInstance(el);
  if (inst) {
    const setup = inst.setupState ?? {};
    const state: Record<string, unknown> = {};
    for (const k of Object.keys(setup)) if (!k.startsWith("_") && !k.startsWith("$") && typeof setup[k] !== "function") state[k] = read(setup, k);
    const data = inst.data ?? {};
    for (const k of Object.keys(data)) state[k] = read(data, k);
    return capped({ component: typeName(inst.type), props: plain(inst.props), state: Object.keys(state).length ? state : undefined });
  }
  let f = reactFiber(el);
  while (f && !isComponentFiber(f)) f = f.return;
  if (f) {
    const { children: _children, ...props } = f.memoizedProps ?? {};
    let state: unknown;
    if (f.stateNode && f.stateNode.state) state = f.stateNode.state; // class component
    else {
      // Hook state has no names, so key-based masking can't help: next to a password field, text values are masked.
      const scope = el.closest("form") ?? el.parentElement?.parentElement ?? el;
      const secretNearby = !!scope.querySelector?.("input[type=password]") || el.matches?.("input[type=password]");
      const hooks: unknown[] = [];
      for (let h = f.memoizedState; h && hooks.length < 15; h = h.next) {
        if (h.queue) hooks.push(secretNearby && typeof h.memoizedState === "string" ? "[masked]" : h.memoizedState); // useState/useReducer
      }
      state = hooks.length ? hooks : undefined;
    }
    return capped({ component: typeName(f.type), props, state });
  }
  return undefined;
}

function read(obj: any, key: string): unknown {
  try {
    return obj[key];
  } catch {
    return "[unreadable]";
  }
}

function plain(obj: any): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) out[k] = read(obj, k);
  return Object.keys(out).length ? out : undefined;
}

/** Keeps the snapshot small: tries depth 3, then 2, then 1, and marks it truncated. */
function capped(s: StateInfo): StateInfo {
  for (const depth of [3, 2, 1]) {
    const out = { component: s.component, props: safe(s.props, depth), state: safe(s.state, depth) };
    if (JSON.stringify(out).length <= 4000) return depth === 3 ? out : { ...out, truncated: true };
  }
  return { component: s.component, truncated: true };
}

export function safe(v: unknown, maxDepth = 3, depth = 0, seen = new WeakSet<object>()): unknown {
  if (v == null || typeof v === "boolean" || typeof v === "number") return v;
  if (typeof v === "string") return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  if (typeof v === "function") return "[fn]";
  if (typeof v === "bigint" || typeof v === "symbol") return String(v);
  if (typeof Element !== "undefined" && v instanceof Element) return `<${v.localName}>`;
  if (v instanceof Date) return v.toISOString();
  const o = v as any;
  // Framework singletons (router, stores, plugins) are huge and say nothing about this element.
  if (!Array.isArray(o)) {
    if ("currentRoute" in o && typeof o.push === "function") return `[router at ${o.currentRoute?.value?.fullPath ?? "?"}]`;
    if (typeof o.$id === "string" && "$state" in o) return `[store ${o.$id}]`;
    if (typeof o.install === "function") return "[plugin]";
  }
  if (depth >= maxDepth) return Array.isArray(o) ? `[${o.length} items]` : "{…}";
  if (seen.has(o)) return "[circular]";
  seen.add(o);
  if (Array.isArray(o)) {
    const out = o.slice(0, 10).map((x) => safe(x, maxDepth, depth + 1, seen));
    if (o.length > 10) out.push(`…${o.length - 10} more`);
    return out;
  }
  if (o instanceof Map) return safe(Object.fromEntries([...o.entries()].slice(0, 20).map(([k, val]) => [String(k), val])), maxDepth, depth, seen);
  if (o instanceof Set) return safe([...o], maxDepth, depth, seen);
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const k of Object.keys(o)) {
    if (k.startsWith("__v_") || k.startsWith("_")) continue;
    if (++n > 30) {
      out["…"] = "more keys";
      break;
    }
    out[k] = SENSITIVE_KEY.test(k) ? "[masked]" : safe(read(o, k), maxDepth, depth + 1, seen);
  }
  return out;
}
