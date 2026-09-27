---
description: Set up AhemUI in the current Vue + Vite project — create .ahemui/, vendor and install ahemui, and add the plugin to the Vite config. Use when the user asks to set up or install AhemUI in a project.
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
   `ahemui_init` also copies `ahemui.tgz` into `.ahemui/vendor/`. If the team prefers screenshots in Git LFS, pass `lfs: true`.
4. **Install** the vendored package from the Vite app's directory, using the project's package manager (check for
   `pnpm-lock.yaml` or `yarn.lock`). Use the path relative to that directory:
   ```bash
   npm i -D ./.ahemui/vendor/ahemui.tgz
   ```
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
   - Optional: the AhemUI browser extension (load `packages/extension/dist` unpacked in Chromium or Vivaldi) takes
     pixel-perfect screenshots instead of re-rendering the DOM.
   - Then run `/ahemui:work` to have Claude work through what was captured, or `/ahemui:watch` so that
     **⚡ Start now** in the browser is picked up immediately.
