---
description: Set up AhemUI in the current Vue + Vite project — create .ahemui/, install ahemui, and add the plugin to the Vite config. Use when the user asks to set up or install AhemUI in a project.
---

# Set up AhemUI in this project

1. **Find the app.** Locate the Vite config (`vite.config.{js,ts,mjs,mts}`). In a monorepo, ask which app if there's more than one.
   AhemUI works best with Vue (exact template file:line through `@vitejs/plugin-vue`). React ≤18 and Svelte give
   file:line from their dev builds automatically. React 19 gives component names only. Everything else (screenshots,
   selectors, page metadata, errors, styles) works with any framework.
2. **Work out the dev origin.** Read `server.port` from the Vite config (default `5173`) and whether `server.https` is set.
   The origin is `http(s)://localhost:<port>`. The Vite plugin also registers whatever port Vite actually ends up on,
   so this only matters for the browser extension.
3. **Initialise.** Call `ahemui_init` with `dev_origins` set to that origin. `.ahemui/` must sit at the **git repo root**
   (the directory you're in), even when the Vite app is in a subfolder. The Vite plugin searches upward for it.
   Screenshots are committed with the items (WebP, capped at 300 KB each, typically 20–80 KB). Ask the user once how
   to keep the repo light, and pass the answer:
   - **Keep everything** (fine for most projects): nothing to pass.
   - **Drop old screenshots when archiving**: `keep_archived_days: 30` (or their number). The item.md stays; only images go.
   - **Git LFS**: `lfs: true`. Every machine then needs `git lfs install`. Pass `vendor: true` only when the machine can't reach the npm registry.
4. **Install** the package from the Vite app's directory with the project's package manager (check for
   `pnpm-lock.yaml`, `yarn.lock` or `bun.lock`). `ahemui_init` prints the exact command: normally
   `npm i -D ahemui@<version>`, matching this plugin's version. For a local plugin build it prints a vendored tarball
   path instead, because those builds aren't on npm. `.ahemui/` sits at the repo root, so from an app in a subfolder the
   path goes up: `npm i -D ../.ahemui/vendor/ahemui.tgz` one folder down, `./.ahemui/vendor/ahemui.tgz` at the root.
5. **Add the plugin** to the Vite config, after `vue()`:
   ```js
   import ahemui from "ahemui";
   // ...
   plugins: [vue(), ahemui()],
   ```
   The plugin only runs in `vite dev` (`apply: "serve"`), so production builds are unaffected.
6. **Tracker (optional).** Ask whether the team tracks work in Linear, Jira, Notion or GitHub Issues. If it does,
   and that tracker's MCP server is connected here, configure it with `ahemui_set_tracker` (target, `manual` or `auto`
   sync, conventions). The repo backlog stays the source of truth; `/ahemui:sync` mirrors it.
7. Tell the user:
   - Restart the dev server. A **✎ AhemUI** pill appears bottom-right, and **Alt+Shift+S** toggles capture mode.
     Drag a rectangle, click an element, or Shift+drag to draw, then type the change and press Enter.
   - Commit `.ahemui/` and the package.json change so teammates get the same setup.
   - Optional: the AhemUI browser extension (the zip on the GitHub release, loaded unpacked; a store listing is coming) takes
     pixel-perfect screenshots instead of re-rendering the DOM, and works on deployed sites.
   - Then run `/ahemui:work` to have Claude work through what was captured, or `/ahemui:watch` so that
     **⚡ Start now** in the browser is picked up immediately.
