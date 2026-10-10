---
description: Remove AhemUI from the current project (undo /ahemui:setup) — or, with "items", just clear the backlog and keep AhemUI set up. Use only when the user explicitly asks to remove AhemUI, uninstall it, or clear/empty the AhemUI backlog.
argument-hint: "[items]  (items = only clear the backlog)"
---

# Remove AhemUI from this project

Everything here deletes files, so always show the user exactly what will go and get a clear yes before deleting.
The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/ahemui.mjs"`. Run it from the project root, where `.ahemui/` is.

## Just clear the backlog (`$ARGUMENTS` is `items`)

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/ahemui.mjs" clear` (or `clear --archive` to include `.ahemui/done/`). Without
   `--yes` it only lists what it would delete.
2. Show the list and ask the user to confirm. Mention that items already committed can be restored from git.
3. On a yes, run the same command with `--yes`. AhemUI stays installed and the overlay keeps working.

## Remove AhemUI completely

1. **Take stock.** Run `git status --porcelain` and `ahemui.mjs list --all`. Find:
   - the Vite config line(s): `import ahemui from "ahemui"` and `ahemui()` in `plugins`;
   - the `ahemui` entry in package.json;
   - the `.ahemui/` folder.

   Tell the user what will be removed. Point out any backlog items that aren't committed: they'd be lost. Offer to
   keep a read-only copy first with `ahemui.mjs export --out ahemui-backlog.html` (outside `.ahemui/`).
2. **Get a clear yes.** If they only want an empty backlog, do the section above instead.
3. **Stop watching:** stop any `ahemui wait` background task, and run `ahemui.mjs unwatch`.
4. **Vite config:** remove the `ahemui` import and `ahemui()` from `plugins`. Leave everything else exactly as it was.
5. **Package:** uninstall with the project's package manager, e.g. `npm uninstall ahemui` (pnpm/yarn: `remove`).
6. **Folder:** delete `.ahemui/`, which holds the items, config, vendored tarball and backlog.html.
7. **Check.** Search the repo for leftovers: `ahemui`, `.ahemui/`, `data-ahemui-src`. Mention any `data-private`
   attributes the team added. They're harmless, but they only mattered to AhemUI.
8. **Tell the user:**
   - Restart the dev server; the ✎ AhemUI pill will be gone.
   - Commit the removal if they want it gone for the team too.
   - The Claude Code plugin and the browser extension are installed per user, not per project, so they stay.
     To remove those too: `/plugin` → uninstall **ahemui**, and remove the extension on your browser's extensions page (`chrome://extensions`).
     In the extension popup, set the project to **None** for any sites that pointed at this project.
