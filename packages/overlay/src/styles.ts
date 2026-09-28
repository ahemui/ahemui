export const STYLES = /* css */ `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --bg: #16181d; --bg2: #22252c; --fg: #f3f4f6; --muted: #9ca3af; --line: #343842;
  --accent: #7c5cff; --open: #f59e0b; --doing: #3b82f6; --done: #16a34a; --wontfix: #6b7280;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg);
  position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
}
button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; }

.bar {
  position: fixed; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 2px;
  background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 3px;
  box-shadow: 0 6px 24px rgba(0,0,0,.35); pointer-events: auto; user-select: none;
}
.bar[hidden] { display: none; }
.bar button { padding: 5px 10px; border-radius: 999px; white-space: nowrap; }
.bar button:hover { background: var(--bg2); }
.bar .capture.on { background: var(--accent); }
.bar .counts { color: var(--muted); font-variant-numeric: tabular-nums; }
.bar .counts { display: flex; align-items: center; gap: 6px; }
.bar .counts .badge { min-width: 18px; padding: 0 5px; border-radius: 999px; background: var(--bg2); color: var(--fg); font-size: 11px; font-weight: 600; line-height: 18px; text-align: center; }
.bar .counts .badge.rv { background: #8b5cf6; color: #fff; }
.bar .counts .badge.ask { background: #f59e0b; color: #111; }
.bubble .buttons { white-space: nowrap; }
.bar .state { padding: 5px 9px 5px 6px; display: flex; align-items: center; }
.bar .dot { display: block; width: 8px; height: 8px; border-radius: 50%; background: var(--wontfix); }
.bar .dot.ok { background: var(--done); }
.bar .dot.watching { background: #a78bfa; box-shadow: 0 0 0 3px rgba(167,139,250,.25); }
.bar .dot.working { background: #a78bfa; animation: ahemui-pulse 1.4s infinite; }
.bar .dot.paused { background: transparent; box-shadow: inset 0 0 0 2px #a78bfa; }
.watch-ctl { display: flex; gap: 6px; margin-top: 6px; }
.watch-ctl .btn { font-size: 11px; padding: 2px 9px; }
.bar .dot.stale { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.3); animation: none; }
@keyframes ahemui-pulse { 50% { box-shadow: 0 0 0 5px rgba(167,139,250,.3); } }
@media (prefers-reduced-motion: reduce) { .bar .dot.working { animation: none; box-shadow: 0 0 0 3px rgba(167,139,250,.35); } }
.panel-head { display: flex; align-items: flex-start; gap: 10px; padding: 2px 6px 8px; margin-bottom: 6px; border-bottom: 1px solid var(--line); }
.panel-head .proj { font-weight: 600; overflow-wrap: anywhere; }
.panel-head .claude { color: var(--muted); font-size: 11px; }
.panel-head .grow { flex: 1; min-width: 0; }
.seg { flex: none; margin-left: auto; display: flex; border: 1px solid var(--line); border-radius: 999px; padding: 2px; }
.seg button { font-size: 11px; padding: 2px 8px; border-radius: 999px; color: var(--muted); }
.seg button.on { background: var(--bg2); color: var(--fg); }

.layer { position: fixed; inset: 0; pointer-events: none; cursor: crosshair; }
.layer.active { pointer-events: auto; }
.hover, .outline { position: fixed; pointer-events: none; border: 2px solid var(--accent); background: rgba(124,92,255,.08); border-radius: 3px; display: none; }
.outline { border-style: dashed; }
.outline.flash { border-style: solid; animation: ahemui-flash 1.6s ease-out; }
@keyframes ahemui-flash { 0%, 40% { box-shadow: 0 0 0 6px rgba(124,92,255,.35); } 100% { box-shadow: 0 0 0 0 rgba(124,92,255,0); } }
.sel { position: fixed; pointer-events: none; border: 2px dashed var(--accent); background: rgba(124,92,255,.12); display: none; }
svg.draw { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; }
svg.draw path { fill: none; stroke: #ff2d55; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }

.bubble {
  position: fixed; width: 340px; background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
  padding: 10px; pointer-events: auto; box-shadow: 0 12px 40px rgba(0,0,0,.45); display: none;
}
.bubble .where { color: var(--muted); font: 11px/1.3 ui-monospace, Consolas, monospace; margin-bottom: 6px; overflow-wrap: anywhere; }
.bubble .page-line { color: var(--muted); font-size: 11px; margin: -2px 0 6px; overflow-wrap: anywhere; }
.types { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.chip { padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-size: 11px; }
.chip:hover { color: var(--fg); }
.chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.group { color: var(--muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin: 8px 6px 2px; }
.group:first-child { margin-top: 0; }
.bubble .thumb { display: block; max-width: 100%; max-height: 120px; border-radius: 6px; border: 1px solid var(--line); margin-bottom: 8px; }
.bubble textarea {
  width: 100%; min-height: 70px; resize: vertical; background: var(--bg2); color: var(--fg); border: 1px solid var(--line);
  border-radius: 6px; padding: 7px 8px; font: inherit; outline: none;
}
.bubble textarea:focus { border-color: var(--accent); }
.bubble .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
.bubble .hint { color: var(--muted); font-size: 11px; }
.btn { padding: 5px 12px; border-radius: 6px; background: var(--bg2); border: 1px solid var(--line); color: var(--fg); font: inherit; cursor: pointer; }
.btn.primary { background: var(--accent); border-color: var(--accent); }
.btn:disabled { opacity: .5; cursor: default; }

.marker {
  position: fixed; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center;
  font-size: 11px; font-weight: 700; color: #fff; pointer-events: auto; cursor: pointer;
  border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,.35); transition: transform .12s;
}
.marker:hover { transform: scale(1.15); }
.marker.open { background: var(--open); }
.marker.in-progress { background: var(--doing); animation: pulse 1.6s infinite; }
.marker.done { background: var(--done); }
.marker.wontfix { background: var(--wontfix); }
.marker.detached { border-style: dashed; }
@keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(59,130,246,.25); } }

/* Screenshots in the popover fit its width and a sensible height; click opens them full size. */
.pop img[data-file] { display: block; max-width: 100%; max-height: 200px; width: auto; height: auto; object-fit: contain; margin: 10px 0 0; padding: 4px; border-radius: 6px; border: 1px solid var(--line); cursor: zoom-in; background: var(--bg2); }
.pop .compare img[data-file] { max-height: 140px; margin: 0; width: 100%; }
.pop-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pop .request { font-size: 14px; line-height: 1.45; font-weight: 500; white-space: pre-wrap; overflow-wrap: anywhere; margin: 10px 0 4px; }
.pop .byline { color: var(--muted); font-size: 11px; }
.pop .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.pop .tag { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; background: var(--bg2); color: var(--muted); border: 1px solid var(--line); }
.pop .where { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 10px 0 0; padding: 8px 0 0; border-top: 1px solid var(--line); font-size: 11.5px; }
.pop .where dt { color: var(--muted); }
.pop .where dd { margin: 0; overflow-wrap: anywhere; min-width: 0; }
.pop .where .mono { font-size: 11px; }
.id-copy { color: var(--muted); font-size: 11px; padding: 1px 4px; border-radius: 4px; }
.id-copy:hover { color: var(--fg); background: var(--bg2); }
.pop-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); }
.pop-nav { display: flex; align-items: center; gap: 6px; }
.pop-nav button { width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--line); color: var(--fg); font-size: 15px; line-height: 1; }
.pop-nav button:hover:not(:disabled) { border-color: var(--accent); }
.pop-nav button:disabled { opacity: .35; cursor: default; }
.pop-nav .pos { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.pop-board { color: #a78bfa; font-size: 12px; text-decoration: none; }
.pop-board:hover { color: var(--fg); }
.pop, .panel, .statuspop {
  position: fixed; width: 320px; max-height: 60vh; overflow: auto; background: var(--bg); border: 1px solid var(--line);
  border-radius: 10px; padding: 10px; pointer-events: auto; box-shadow: 0 12px 40px rgba(0,0,0,.45); display: none;
}
.panel { right: 16px; bottom: 60px; width: 360px; }
.statuspop { right: 16px; bottom: 60px; width: 290px; }
.status-head { display: flex; align-items: flex-start; gap: 10px; }
.status-head .dot { flex: none; width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; background: var(--wontfix); }
.status-head .dot.ok { background: var(--done); }
.status-head .dot.watching, .status-head .dot.working { background: #a78bfa; }
.status-head .dot.paused { background: transparent; box-shadow: inset 0 0 0 2px #a78bfa; }
.status-head .dot.stale { background: #f59e0b; }
.statuspop .proj { font-weight: 600; overflow-wrap: anywhere; }
.statuspop .claude { color: var(--muted); font-size: 12px; }
.statuspop .claude.live { color: #a78bfa; }
.statuspop .stale-note { color: #f59e0b; font-size: 11px; margin-top: 8px; }
.statuspop .watch-ctl { margin-top: 10px; }
.status-meta { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }

/* toolbar corner (settings or drag) */
.root[data-pos="bottom-left"] :is(.bar, .panel, .statuspop) { right: auto; left: 16px; }
.root[data-pos^="top"] .bar { bottom: auto; top: 16px; }
.root[data-pos^="top"] :is(.panel, .statuspop) { bottom: auto; top: 60px; }
.root[data-pos="top-left"] :is(.bar, .panel, .statuspop) { right: auto; left: 16px; }
.bar.dragging { cursor: grabbing; opacity: .92; box-shadow: 0 12px 40px rgba(0,0,0,.5); }
.bar.dragging button { pointer-events: none; }

/* settings view */
.panel-head .gear { flex: none; font-size: 14px; padding: 2px 6px; border-radius: 6px; color: var(--muted); }
.panel-head .gear:hover { color: var(--fg); background: var(--bg2); }
.settings-head { display: flex; align-items: center; gap: 10px; padding: 0 2px 8px; margin-bottom: 4px; border-bottom: 1px solid var(--line); }
.settings-head .back { color: #a78bfa; font-size: 12px; padding: 2px 4px; }
.setting { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 2px 4px; }
.setting > span { color: var(--fg); }
.corners { display: grid; grid-template-columns: repeat(2, 28px); gap: 3px; }
.corners button { height: 24px; border: 1px solid var(--line); border-radius: 5px; color: var(--muted); font-size: 12px; }
.corners button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.pref-name { width: 170px; font: inherit; font-size: 12px; color: var(--fg); background: var(--bg2); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
.pref-name:focus { outline: none; border-color: var(--accent); }
.settings .note { color: var(--muted); font-size: 11px; padding: 0 2px 4px; }
.settings .note:last-child { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
.pill { display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 9.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; line-height: 1.3; color: #fff; }
.pill.open { background: var(--open); } .pill.in-progress { background: var(--doing); }
.pill.done { background: var(--done); } .pill.wontfix { background: var(--wontfix); }
.meta { color: var(--muted); font-size: 11px; margin: 6px 0; overflow-wrap: anywhere; }
a.ext { color: #a78bfa; }
.body { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0; }
.mono { font-family: ui-monospace, Consolas, monospace; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.list-item { display: flex; gap: 8px; padding: 6px; border-radius: 6px; cursor: pointer; align-items: baseline; }
.list-item:hover { background: var(--bg2); }
.list-item .grow { flex: 1; min-width: 0; }
.panel-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line); }
.panel-foot .clear-finished { font-size: 12px; padding: 3px 10px; }
.board-link { display: block; text-align: center; margin-left: auto; padding: 4px; color: #a78bfa; text-decoration: none; font-size: 12px; }
.board-link:hover { color: var(--fg); }
a.btn, a.btn:visited { color: var(--fg); text-decoration: none; display: inline-block; }
a.btn:hover { border-color: var(--accent); }
.list-item .row-start { flex: none; align-self: center; padding: 3px 10px; font-size: 11px; background: var(--accent); border-color: var(--accent); }
.list-item .queued { flex: none; align-self: center; font-size: 11px; color: #f59e0b; white-space: nowrap; }
.list-item .route { color: var(--muted); font-size: 11px; }
.list-item.elsewhere { opacity: .6; }
.empty { color: var(--muted); padding: 6px; }

.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--bg); border: 1px solid var(--line);
  padding: 8px 14px; border-radius: 8px; pointer-events: none; opacity: 0; transition: opacity .2s; max-width: 520px; text-align: center;
}
.toast.show { opacity: 1; }

/* capture: extra areas, redaction, tools */
.thumb-wrap { position: relative; display: inline-block; max-width: 100%; }
.thumb-wrap.redacting { cursor: crosshair; outline: 2px dashed #f59e0b; outline-offset: 2px; border-radius: 6px; }
.thumb-wrap .thumb { margin-bottom: 0; }
.thumb-wrap { margin-bottom: 8px; }
.redact-box { position: absolute; display: none; background: rgba(58,61,69,.85); pointer-events: none; }
.areas { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.areas:empty { display: none; }
.area-chip { font-size: 11px; padding: 2px 4px 2px 8px; border-radius: 999px; background: var(--bg2); border: 1px solid var(--line); }
.area-chip.reference { border-color: #22c55e; }
.area-chip button { color: var(--muted); padding: 0 4px; }
.tools { display: flex; gap: 4px; margin-top: 6px; }
.tool { font-size: 11px; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--line); color: var(--muted); }
.tool:hover { color: var(--fg); }
.tool.on { background: #f59e0b; border-color: #f59e0b; color: #111; }
.tool.mic.on { background: #ef4444; border-color: #ef4444; color: #fff; }
.bubble input.design { width: 100%; margin-top: 6px; background: var(--bg2); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; font: inherit; font-size: 12px; outline: none; }
.xbox { position: fixed; pointer-events: none; border: 2px dashed var(--accent); border-radius: 3px; }
.xbox.reference { border-color: #22c55e; }
.xbox span { position: absolute; top: -18px; left: -2px; font-size: 10px; background: var(--accent); color: #fff; padding: 1px 5px; border-radius: 3px; }
.xbox.reference span { background: #22c55e; }

/* review, questions, thread */
.marker.review { background: #8b5cf6; }
.marker.ask { background: #f59e0b; animation: pulse-ask 1.2s infinite; }
@keyframes pulse-ask { 50% { box-shadow: 0 0 0 7px rgba(245,158,11,.3); } }
.pill.review { background: #8b5cf6; }
.pill.ask { background: #f59e0b; color: #111; }
.list-item .pill { font-size: 11px; letter-spacing: 0; padding: 1px 6px; } /* icon-only in the backlog list */
.pop { width: 340px; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 8px 0; }
.compare figure { margin: 0; }
.compare img, .compare .pending { width: 100%; border-radius: 6px; border: 1px solid var(--line); display: block; }
.compare .pending { height: 60px; display: grid; place-items: center; color: var(--muted); font-size: 11px; }
.compare figcaption { color: var(--muted); font-size: 10px; text-align: center; margin-top: 2px; }
.thread { margin: 10px 0 0; padding-top: 8px; border-top: 1px solid var(--line); display: grid; gap: 8px; }
.thread .entry { font-size: 12px; padding-left: 8px; border-left: 2px solid var(--line); }
.thread .entry .text { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 2px; }
.thread .who { color: var(--muted); font-size: 11px; }
.thread .who b { color: var(--fg); font-weight: 600; }
.thread .question { border-left-color: #f59e0b; }
.thread .feedback { border-left-color: #f87171; }
.thread .approved { border-left-color: var(--done); }
textarea.reply { width: 100%; min-height: 56px; margin-top: 8px; background: var(--bg2); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font: inherit; outline: none; resize: vertical; }
textarea.reply:focus { border-color: var(--accent); }
.bubble { width: 360px; }
.pop { overflow-x: hidden; } /* after the shared overflow rule */
`;
