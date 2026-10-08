export const CSS = /* css */ `
:root {
  --bg: #f6f6f9; --panel: #ffffff; --card: #ffffff; --line: #e3e4ec; --fg: #1d2030; --muted: #6b7084;
  --accent: #16181d; --on-accent: #ffffff; --mark: #e5482c; --accent-soft: rgba(22,24,29,.07);
  --open: #d97706; --doing: #2563eb; --review: #7c3aed; --done: #16a34a; --wontfix: #6b7280; --ask: #d97706;
  --shadow: 0 1px 2px rgba(20,20,40,.06), 0 4px 16px rgba(20,20,40,.06);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111318; --panel: #171a21; --card: #1d2029; --line: #2b2f3a; --fg: #eceef4; --muted: #9398a8;
    --accent: #f2f2f4; --on-accent: #111317; --mark: #ff5a3c; --accent-soft: rgba(242,242,244,.08);
    --open: #f59e0b; --doing: #60a5fa; --review: #a78bfa; --done: #34d399; --wontfix: #9ca3af; --ask: #fbbf24;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 6px 20px rgba(0,0,0,.25);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; display: flex; flex-direction: column; }
a { color: var(--accent); }
code, .mono { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 12px; }
button, select, input, textarea { font: inherit; color: inherit; }

.top { display: flex; align-items: center; gap: 16px; padding: 12px 20px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; position: sticky; top: 0; z-index: 5; }
.brand { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.brand .logo { color: var(--mark); font-size: 18px; }
.brand .proj { color: var(--muted); margin-left: 6px; }
.filters { display: flex; gap: 8px; flex: 1; min-width: 280px; flex-wrap: wrap; align-items: center; }
.filters input.search { flex: 1; min-width: 180px; }
.filters input.search, .filters select { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; outline: none; }
.filters input:focus, .filters select:focus { border-color: var(--accent); }
.f-arch { color: var(--muted); font-size: 13px; display: flex; gap: 4px; align-items: center; }
.status { display: flex; gap: 14px; align-items: center; color: var(--muted); font-size: 12px; flex-wrap: wrap; }
.status b { color: var(--fg); }
.live { padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); }
.live.on { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--wontfix); }
.dot.ok { background: var(--done); }
.banner { padding: 8px 20px; background: var(--accent-soft); color: var(--fg); font-size: 13px; border-bottom: 1px solid var(--line); }

.board { flex: 1; overflow: auto; padding: 16px 20px 40px; }
.board.columns { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(260px, 1fr); gap: 14px; align-items: start; }
.col h2, .grp h2 { font-size: 13px; margin: 0 0 10px; display: flex; justify-content: space-between; align-items: center; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.col h2 span, .grp h2 span { background: var(--line); color: var(--fg); border-radius: 999px; padding: 0 8px; font-size: 12px; }
.col-queue h2 { color: var(--open); }
.col h2 .clear { margin-left: auto; margin-right: 6px; font-size: 11px; padding: 1px 8px; text-transform: none; letter-spacing: 0; }
.col-you h2 { color: var(--review); }
.col .cards { display: flex; flex-direction: column; gap: 10px; }
.board.groups .grp { margin-bottom: 24px; }
.board.groups .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.empty { color: var(--muted); font-size: 12px; border: 1px dashed var(--line); border-radius: 10px; padding: 12px; margin: 0; }
.empty.big { font-size: 14px; }

.card { background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--open); border-radius: 10px; padding: 10px 12px; box-shadow: var(--shadow); cursor: pointer; display: flex; flex-direction: column; gap: 6px; outline: none; }
.card:hover, .card:focus-visible { border-color: var(--accent); border-left-width: 3px; }
.card.sel { outline: 2px solid var(--accent); outline-offset: 1px; }
.card.s-in-progress { border-left-color: var(--doing); }
.card.s-review { border-left-color: var(--review); }
.card.s-done { border-left-color: var(--done); }
.card.s-wontfix { border-left-color: var(--wontfix); opacity: .75; }
.card.s-ask { border-left-color: var(--ask); }
.thumb { margin: -2px -4px 0; border-radius: 6px; overflow: hidden; background: var(--bg); max-height: 120px; display: flex; align-items: center; justify-content: center; }
.thumb img { max-width: 100%; max-height: 120px; display: block; }
.c-title { font-weight: 600; }
.c-page { color: var(--muted); font-size: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); color: var(--muted); }
.chip.t { color: var(--fg); }
.chip.now, .chip.ask { color: var(--open); border-color: var(--open); }
.chip.review { color: var(--review); border-color: var(--review); }
.chip.high { color: #dc2626; border-color: #dc2626; }
.chip.ext { color: var(--accent); border-color: var(--accent); }
.c-foot { display: flex; justify-content: space-between; align-items: center; color: var(--muted); font-size: 12px; gap: 8px; }
.quick { border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent); border-radius: 6px; padding: 2px 9px; font-size: 12px; cursor: pointer; white-space: nowrap; }

.scrim { position: fixed; inset: 0; background: rgba(8,9,12,.62); backdrop-filter: blur(2px); z-index: 9; }
.scrim[hidden] { display: none; }
.drawer { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 48px); background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 24px 80px rgba(0,0,0,.45); overflow: hidden; display: flex; flex-direction: column; z-index: 10; }
.drawer:not([hidden]) { display: flex; }
.d-head { flex: none; padding: 12px 16px 10px 24px; border-bottom: 1px solid var(--line); }
.d-head .open-page { margin-left: auto; font-size: 12px; text-decoration: none; }
.d-head .open-page + .x { margin-left: 4px; }
.d-body { flex: 1; overflow: auto; padding: 16px 24px 24px; }
.d-body h1.request { margin-top: 0; }
.d-status { display: flex; align-items: baseline; gap: 8px; margin: 10px 0 4px; font-size: 13px; }
.d-status .sdot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--open); transform: translateY(-1px); }
.d-status span:last-child { color: var(--muted); }
.st-doing .sdot { background: var(--doing); } .st-review .sdot { background: var(--review); } .st-done .sdot { background: var(--done); }
.st-wontfix .sdot { background: var(--wontfix); } .st-ask .sdot { background: var(--ask); }
.answer { margin: 14px 0 4px; }
.new-batch { display: flex; gap: 8px; }
.new-batch[hidden] { display: none; }
.new-batch input { flex: 1; }
.grp h2 .grp-act { margin-left: auto; margin-right: 8px; font-size: 11px; padding: 2px 10px; text-transform: none; letter-spacing: 0; }
.chip.suggest { color: #0d9488; border-color: #0d9488; }
.st-suggest .sdot { background: #0d9488; }
.sugg { margin: 12px 0 4px; padding: 10px 12px; border-radius: 10px; background: var(--bg); border-left: 3px solid #0d9488; }
.sugg p { margin: 4px 0; }
.sugg b { margin-right: 6px; }
.sugg .muted { color: var(--muted); font-size: 12px; }
.saved-hint { grid-column: 1 / -1; color: var(--muted); font-size: 11px; }
.answer label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.d-foot { flex: none; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 12px 24px; border-top: 1px solid var(--line); background: var(--bg); }
.btn.quiet { border-color: transparent; background: none; color: var(--muted); }
.btn.quiet:hover { color: #dc2626; border-color: transparent; }
.zoom { display: block; padding: 0; border: 0; background: none; cursor: zoom-in; width: 100%; }
.lightbox { position: fixed; inset: 0; z-index: 50; background: rgba(5,6,10,.86); display: grid; place-items: center; padding: 32px; cursor: zoom-out; }
.lightbox img { max-width: 100%; max-height: 100%; border-radius: 8px; box-shadow: 0 30px 80px rgba(0,0,0,.6); background: #fff; }
.lb-x { position: fixed; top: 14px; right: 16px; border: 0; background: rgba(255,255,255,.12); color: #fff; width: 34px; height: 34px; border-radius: 50%; font-size: 15px; cursor: pointer; }
/* drag and drop between columns */
.card[draggable] { cursor: grab; }
.card.dragging { opacity: .45; }
.board.is-dragging .col:not(.can-drop) { opacity: .45; }
.col.can-drop .cards { min-height: 60px; border-radius: 10px; transition: background .12s; }
.col.over .cards { background: var(--accent-soft); outline: 2px dashed var(--accent); outline-offset: 4px; }
.drawer[hidden] { display: none; }
body.modal-open { overflow: hidden; }
@media (max-width: 640px) { .drawer { top: auto; bottom: 0; left: 0; transform: none; width: 100vw; max-height: 92vh; border-radius: 14px 14px 0 0; } }
.d-head { display: flex; align-items: center; gap: 10px; }
.d-head code { color: var(--muted); }
.d-head .x { margin-left: auto; border: 0; background: none; font-size: 18px; cursor: pointer; color: var(--muted); }
.drawer h1 { font-size: 18px; margin: 10px 0 2px; }
.drawer h1.request { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.35; margin-top: 14px; }
.drawer .chips { margin: 10px 0 14px; }
.id-copy { border: 0; background: none; padding: 2px 4px; border-radius: 5px; cursor: pointer; }
.id-copy:hover { background: var(--card); }
details.tech { margin-top: 14px; border-top: 1px solid var(--line); padding-top: 10px; }
details.tech summary { cursor: pointer; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
details.tech[open] summary { margin-bottom: 4px; }
.d-sub { color: var(--muted); font-size: 12px; margin-bottom: 12px; }
.pill { font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; color: #fff; background: var(--open); }
.pill.s-in-progress { background: var(--doing); } .pill.s-review { background: var(--review); } .pill.s-done { background: var(--done); } .pill.s-wontfix { background: var(--wontfix); } .pill.s-ask { background: var(--ask); color: #111; }
.acts { display: flex; gap: 6px; flex-wrap: wrap; }
.acts.minor .btn { font-size: 12px; padding: 3px 10px; }
.btn { border: 1px solid var(--line); background: var(--card); border-radius: 7px; padding: 5px 12px; cursor: pointer; text-decoration: none; color: var(--fg); }
.btn:hover { border-color: var(--accent); }
.btn.armed { background: #dc2626; border-color: #dc2626; color: #fff; font-weight: 600; }
.bolt { display: inline-block; vertical-align: -1px; margin-right: 4px; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
textarea { width: 100%; min-height: 64px; resize: vertical; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px; outline: none; }
textarea:focus, .triage input:focus, .triage select:focus { border-color: var(--accent); }
figure { margin: 0 0 12px; }
figure img { max-width: 100%; border-radius: 8px; border: 1px solid var(--line); display: block; }
figcaption { color: var(--muted); font-size: 11px; margin-top: 3px; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pending { height: 80px; display: grid; place-items: center; text-align: center; color: var(--muted); font-size: 12px; border: 1px dashed var(--line); border-radius: 8px; padding: 6px; }
section { border-top: 1px solid var(--line); padding-top: 10px; margin-top: 14px; }
section h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 8px; }
.prose { white-space: pre-wrap; overflow-wrap: anywhere; }
.entry { border-left: 2px solid var(--line); padding-left: 10px; margin-top: 10px; }
.entry .who { color: var(--muted); font-size: 12px; }
.entry .who b { color: var(--fg); font-weight: 600; }
.entry.k-question { border-color: var(--ask); }
.entry.k-feedback { border-color: #dc2626; }
.entry.k-reply, .entry.k-approved { border-color: var(--done); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0; }
dt { color: var(--muted); font-size: 12px; }
dd { margin: 0; overflow-wrap: anywhere; }
.triage { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.triage label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--muted); }
.triage .wide { grid-column: 1 / -1; }
.triage input, .triage select { background: var(--card); border: 1px solid var(--line); border-radius: 7px; padding: 5px 8px; color: var(--fg); outline: none; }
.mono-list { margin: 0; padding-left: 18px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px; overflow: auto; font-size: 12px; max-height: 260px; margin: 0; }
.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: var(--fg); color: var(--bg); padding: 8px 14px; border-radius: 8px; opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 20; }
.toast.show { opacity: 1; }
.toast.has-action.show { pointer-events: auto; }
.toast-undo { margin-left: 10px; border: 0; background: none; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }

@media (max-width: 700px) {
  .top { padding: 10px 16px; }
  .board { padding: 12px 16px 40px; }
  .board.columns { grid-auto-flow: row; grid-auto-columns: auto; }
  .compare, .triage { grid-template-columns: 1fr; }
}
`;
