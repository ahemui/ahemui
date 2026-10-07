# AhemUI

Highlight parts of your running web app, type what should change, and let Claude Code work through the backlog.
Markers on the page follow each request from **queued** (amber) → **in progress** (blue) → **ready for your review**
(purple ◎) → **approved** (green ✓). A **?** means Claude asked you something, and you can answer right in the page.

The backlog is plain files in your repo (`.ahemui/`), so it travels with git: capture a batch of feedback, commit it
to a branch, and someone else (or another Claude session) can pick it up.

## What it works with

| | Source file:line | Component chain | Screenshots, CSS path, page, errors, styles | How it gets on the page |
|---|---|---|---|---|
| **Vue 3 + Vite** | ✓ exact, from the template | ✓ | ✓ | Vite plugin |
| **React ≤ 18 + Vite** | ✓ from the dev build | ✓ | ✓ | Vite plugin |
| **React 19 + Vite** | component name only | ✓ | ✓ | Vite plugin |
| **Svelte + Vite** | ✓ from the dev build | ✓ | ✓ | Vite plugin |
| **Anything else** (webpack, Next.js, Rails, a deployed site…) | — | — | ✓ | Browser extension + `npx ahemui serve` |

Storybook stories map to their story file. Nuxt and SvelteKit run on Vite, so they count as Vite. Without Vite,
Claude finds the code from the selector, text and screenshot instead of a file:line, which works but is slower.

Browsers: the Vite-injected overlay runs in any modern browser, including Claude's built-in one; the extension is for
Chromium browsers (Chrome, Edge, Vivaldi, Brave, Arc).

```
 browser page ──(overlay: select / draw / type)──► ahemui serve ──► .ahemui/items/<id>/{item.md, shot.webp}
      ▲                                                  │                         ▲
      └──────────── live marker updates (WebSocket) ◄────┘ watches files           │
                                                                     Claude Code (ahemui MCP tools)
                                                                     git checkout / pull
```

## Packages

| Path | What |
|---|---|
| `packages/core` | Item schema and file store (`.ahemui/items`, `.ahemui/done`) |
| `packages/cli` | `ahemui` CLI and `ahemui serve` (HTTP + WebSocket, file watcher) |
| `packages/overlay` | In-page UI: selection, freehand, prompt bubble, markers, backlog panel |
| `packages/vite` | `ahemui`: Vue source attributes + in-process `ahemui serve` + overlay injection. Bundled, with the CLI, into one dependency-free package |
| `packages/extension` | MV3 extension for Chromium/Vivaldi: project picker, works on deployed sites, real tab screenshots, Alt+Shift+S |
| `packages/board` | The backlog board page (live at the server's address, or the `.ahemui/backlog.html` snapshot) |
| `packages/claude-plugin` | Claude Code plugin: MCP server (`ahemui_*` tools) + skills `/ahemui:setup`, `/ahemui:watch`, `/ahemui:board`, `/ahemui:triage`, `/ahemui:work`, `/ahemui:review`, `/ahemui:sync`, `/ahemui:status`, `/ahemui:handoff`, `/ahemui:archive` |
| `examples/vue-app` | Small Vue app wired up for trying it out |

## Getting started

**1. Install the Claude Code plugin** (from any Claude Code session):

```
/plugin marketplace add ahemui/ahemui
/plugin install ahemui@ahemui
```

(Working on AhemUI itself? `npm install && npm run build` here, then `/plugin marketplace add <path to this repo>`.)

**2. Set up a project.** Open your Vue + Vite repo in Claude Code and run `/ahemui:setup`. It:

- creates `.ahemui/`
- installs `ahemui` from npm as a dev dependency (so teammates get it with `npm install`)
- adds `ahemui()` after `vue()` in your Vite config

Or by hand:

```js
// vite.config.js
import vue from "@vitejs/plugin-vue";
import ahemui from "ahemui";
export default { plugins: [vue(), ahemui()] };
```

**3. Capture.** Restart `vite dev`. A **✎ AhemUI** pill appears bottom-right.

- **Alt+Shift+S** (or click ✎ AhemUI) → capture mode
- **drag** a rectangle, **click** an element, or **Shift+drag** to draw around something
- type the change, optionally tap a type chip (bug, style, layout, copy, feature, a11y), then either:
  - **⚡ Start now** (Enter): a watching Claude session starts on it right away. While Claude is busy with another item
    the button reads **Add to queue**, and the item goes next in line.
  - **Backlog** (Ctrl/⌘+Enter): save it for later. It waits until someone runs `/ahemui:work`.
  You stay in capture mode for the next one; **Esc** exits.
- bubble tools: **+ Area** (the change also applies there), **+ Like this** (an example to match), **▮ Hide** (drag
  on the thumbnail to black something out), **🔗** a design link (Figma…), **🎤** dictation
- click a marker for details and the thread; click the counts for the whole backlog, grouped by page

**What a capture includes**, so Claude doesn't have to guess:
- **Source:** file:line and the component chain.
- **Page:** route name and pattern, page component, section heading, landmark, environment.
- **Styles:** computed styles, plus the **design tokens** (CSS variables) and classes behind them.
- **State:** the component's props and state, with sensitive keys masked.
- **Errors and steps:** recent console errors and failed requests, and the last clicks and keys before the capture.
  Field values are never recorded.
- **Accessibility:** axe-core results for `a11y` items.

**Privacy:** password fields and anything marked `data-private` (or `.ahemui-private`) are blacked out in screenshots, and
their text is never sent. On deployed sites, all form fields, emails and long numbers are masked, and URL query strings are dropped.

**Review:** when Claude finishes, the item goes to **review**:
- The overlay photographs the same spot once the change has hot-reloaded, then shows you **before/after**.
- **Looks good ✓** approves it.
- **Not quite…** sends it back with your comment, and Claude sees the comment next time.
- Claude's questions show up as a **?** marker with a reply box, and as a desktop notification.
- To skip review, set `"review": false` in `.ahemui/config.json`.

**Start now needs a listening session.** Run `/ahemui:watch` in Claude Code:
- **Waiting:** it waits in a background command (`ahemui wait`), so you can keep chatting. The toolbar pill shows **Claude watching**.
- **Working:** when you press ⚡ Start now, Claude is woken up, works the item, commits it and goes back to waiting.
  The pill shows **Claude working** in the meantime.
- **Stop:** `/ahemui:watch stop`.

If nobody is watching, the item is still saved, marked ⚡, and goes first in the next `/ahemui:work`.

**See the whole backlog.** No tracker needed:
- **Live board** at the AhemUI server's address, `http://127.0.0.1:4777/` by default. Also reachable through the
  **Open full board ↗** link in the overlay's panel, `npx ahemui board`, or `/ahemui:board`.
  - Columns for ⚡ Queue, Backlog, In progress, In review (results to check and questions) and Done.
  - Search, a type filter, and grouping by page or area.
  - A detail panel with screenshots, before/after, the thread and all captured context.
  - Actions: start, move to backlog, approve, send back, reply, reopen, and edit the classification.
  - Live updates; `#<id>` links open an item directly.
- **`.ahemui/backlog.html`**: a read-only snapshot that opens straight from disk. The server keeps it current, and it's
  git-ignored. `npx ahemui export --out somewhere.html` writes one to share.

**4. Triage (optional).** `/ahemui:triage` classifies each item by type, area (`Page › Section`), priority and labels.
It uses the page metadata captured with it (route name, page component, section heading, landmark, environment),
and it flags duplicates.

**5. Work it.** In Claude Code: `/ahemui:work`, or a slice of it: `/ahemui:work area:Pricing`, `type:copy`, `label:mobile`,
`route:/pricing`. It goes high priority first, then page by page. For each item, Claude claims it (marker turns blue), reads the
screenshot and captured context, makes the change, hands it to you for review (◎), and commits the code together with the
item's status (`AhemUI-Item: <id>` trailer).

**UX review (optional).** In the backlog panel (☰), press **✦ Review page**. AhemUI outlines the page, runs
automatic accessibility checks (axe: contrast, names, labels, tap targets…) and takes a screenshot. The checks' findings
appear right away as teal ✦ markers. For Claude's judged review (hierarchy, copy, forms, states, consistency), run
`/ahemui:review` (or `/ahemui:review /pricing`) in Claude Code. Every suggestion lands in a "for review" batch and
never starts on its own: on the page, choose **Do it** (queue it now), **Later** (backlog) or **Dismiss**. On the board,
"Make these changes" takes on a whole batch.

**Using Jira, Linear, Notion or GitHub Issues?** AhemUI works alongside them. `.ahemui/` stays the capture inbox and
source of truth (anchors, screenshots, page metadata), and Claude mirrors items into your tracker through the MCP
server you already have connected. AhemUI doesn't reimplement any tracker API.

- `/ahemui:sync` sets the tracker up on first use: tracker, target team/project/database, `manual` or `auto`, and conventions.
  They're stored in `.ahemui/config.json` → `tracker`, so the whole team shares them.
- Each run creates tickets for unlinked items (description with page, element, source, environment and screenshot
  path, plus the screenshot attached where the MCP supports it) and reconciles status both ways.
- With `sync: auto`, `/ahemui:triage`, `/ahemui:work` and `/ahemui:watch` also create tickets, move them to in progress,
  and comment and close them as they go.
- The item records its ticket (`external: {tracker, key, url, status}`), and the browser popover links to it.

**6. Hand off / finish.**

- `/ahemui:handoff <name>` commits the open backlog to `ahemui/<name>`. The receiver runs `git switch ahemui/<name>`, then `npm install`, then `/ahemui:work`.
- `/ahemui:handoff <name> --pr` also pushes and opens a draft PR. Only when you ask; local is the default.
- `/ahemui:archive` moves done items to `.ahemui/done/`. Run it before merging. To keep the repo small it can drop
  screenshots from old archived items (`ahemui prune --drop-shots 30`), or you can track them with Git LFS (`ahemui_init` with `lfs: true`).

### Updating AhemUI

In a project, run `/ahemui:update` in Claude Code. It updates the plugin to the newest build, installs it into the project
(`.ahemui/vendor/` plus the app's package, with npm, pnpm, yarn or bun) and tells you what to restart. The CLI half on
its own is `node <plugin>/scripts/ahemui.mjs update`.

Working on AhemUI itself: every `npm run build` stamps a new build id into all bundles and into the plugin version, so
updates are always picked up. If the overlay, extension and server builds differ, the AhemUI toolbar dot turns amber and
says what to reload.

### Removing AhemUI

- **Empty the backlog, keep AhemUI:** `npx ahemui clear`. It lists what it would delete; add `--yes` to delete, and
  `--archive` to include `.ahemui/done/`.
- **Remove it from the project:** `/ahemui:remove` in Claude Code. It shows what will go, asks first, then removes
  `ahemui()` from the Vite config, uninstalls `ahemui` and deletes `.ahemui/`. The Claude Code plugin and the extension
  are per user, so they stay unless you uninstall them too.

### Browser extension (optional, and needed for deployed sites)

`chrome://extensions` (or `vivaldi://extensions`) → Developer mode → **Load unpacked** → `packages/extension/dist`.

Click the AhemUI toolbar icon to open the popup:

- **Send feedback from this site to…** lists every running AhemUI project (repo name, git branch, port). Pick one, and
  it's remembered per site. Local dev sites pick automatically when a project's `devOrigins` lists them.
- **Enable AhemUI on <host>** turns AhemUI on for a deployed dev, staging or prod site. Localhost, `*.localhost` and
  `*.test` are always on.

A project only shows up while its server is running: `vite dev` with the plugin, or `npx ahemui serve` in the repo.
The extension looks on ports 4777–4786.

Items captured on a deployed site record where they came from and only show markers on that site. They usually
have no file:line, because production builds carry no AhemUI attributes, so `/ahemui:work` finds the code from the
element text, CSS path and screenshot instead.

How it stays safe on sites you don't control: the extension's overlay runs in Chrome's isolated content-script
world, and all traffic to `ahemui serve` goes through the extension's service worker. Scripts on the page can't read
your backlog, reach your local server, or fake captures. A tiny main-world helper only reports Vue component names.

On local dev with both the extension and the Vite plugin, the extension's overlay takes over, which gives real tab
screenshots instead of re-rendering the DOM.

## Item format

```
.ahemui/
  config.json            # port, devOrigins, screenshot limits
  items/<ULID>/item.md   # active backlog (incl. done items until archived)
  items/<ULID>/shot.webp
  done/<ULID>/…          # archive
  vendor/ahemui.tgz
```

```markdown
---
id: 01M3G7TSH3XZY8F443FDH2KNS0
status: open                 # open | in-progress | done | wontfix
type: copy                   # classification: type, priority, area, labels
area: Pricing › Plan cards
author: Pietari Keurulainen
route: /pricing
viewport: 1280x720
page:                        # captured automatically
  heading: Pricing
  routeName: pricing         # Vue Router (prod builds too)
  routePattern: /pricing
  routeMeta: { title: Pricing, section: marketing }
  pageComponent: PricingPage
  pageFile: src/components/PricingPage.vue
  section: Team              # nearest heading above the element
  landmark: main
  env: local                 # or deployed
  browser: Chromium 152
  colorScheme: dark
anchor:
  source: src/components/PricingCard.vue:12:5
  components: [App, PricingPage, PricingCard]
  selector: "#app > main > section > div > article:nth-of-type(2) > button"
  text: Start free trial
elements: [...]              # everything inside the highlight
shot: shot.webp
claimed_by: null
resolved_by: null
external:                    # when mirrored to a tracker
  tracker: linear
  key: ENG-123
  url: https://linear.app/acme/issue/ENG-123
---

Make this CTA full width on the featured card
```

One folder per item, so parallel work on a branch rarely conflicts. Markers find their element again by source
location, then CSS path, then text, so they survive HMR and small refactors.

## CLI

```
ahemui init [--origin <url>]... [--port <n>]
ahemui serve [--port <n>]
ahemui list [--status <s>]... [--all] [--json]
ahemui show <id> | add --prompt … | claim <id> | resolve <id> [--wontfix] [--note …]
ahemui triage <id> [--type t] [--priority p] [--area a] [--label l]...
ahemui list [--route p] [--type t] [--label l] [--area a] [--untriaged]
ahemui board [--no-open] | export [--out file]
ahemui wait [--timeout s]   # used by /ahemui:watch; exits when ⚡ Start now items arrive
ahemui reply <id> <text> | approve <id> | changes <id> --note <text>
ahemui clear [--archive] [--yes]   # empty the backlog, keep the setup
ahemui prune [--drop-shots <days>]
ahemui reopen <id> | note <id> <text> | prune | unwatch
```

In a project with `ahemui` installed: `npx ahemui …`.

## Security

`ahemui serve` binds to 127.0.0.1 only. Requests carrying an `Origin` header are accepted only from
`chrome-extension://` pages and the configured `devOrigins`, which blocks random websites and DNS rebinding.
Only local non-browser tools (the Vite plugin) can add origins at runtime.

## Development

```bash
npm run build       # everything, incl. extension and plugin bundles
npm run typecheck
npm test            # core, server and MCP (stdio) tests
npm run dev -w ahemui-example-vue
```

`packages/claude-plugin/server/` and `vendor/` are build outputs. Commit them if others will install the plugin
from a git URL rather than a local path.
