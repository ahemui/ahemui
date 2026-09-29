# ahemui

Point at your running UI, say what's off, and let [Claude Code](https://claude.com/claude-code) fix it.
This package is AhemUI's Vite plugin, local server and CLI in one. Most people install it through the Claude Code
plugin's `/ahemui:setup`, which also creates the `.ahemui/` backlog in your repo.

```bash
npm i -D ahemui
```

```js
// vite.config.js
import vue from "@vitejs/plugin-vue";
import ahemui from "ahemui";

export default { plugins: [vue(), ahemui()] };
```

Run `vite dev`, press **Alt+Shift+S**, circle something and type what should change. Items land in `.ahemui/items/`
as Markdown with the source file and line, a screenshot and page context, ready for Claude Code.

| Stack | Source file:line |
|---|---|
| Vue 3 + Vite | exact, from the template |
| React ≤ 18 / Svelte + Vite | from the dev build |
| React 19 + Vite | component name only |
| Anything else | use the browser extension with `npx ahemui serve` |

The plugin only runs in `vite dev`; production builds are untouched. It listens on `127.0.0.1` only and sends nothing
anywhere else.

Docs, the Claude Code plugin and the browser extension: **https://ahemui.com** · Source: https://github.com/ahemui/ahemui
