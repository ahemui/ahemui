---
description: Remove Snap from the current project (undo /snap:setup) — or, with "items", just clear the backlog and keep Snap set up. Use only when the user explicitly asks to remove Snap, uninstall it, or clear/empty the Snap backlog.
argument-hint: "[items]  (items = only clear the backlog)"
---

# Remove Snap from this project

Everything here deletes files, so always show the user exactly what will go and get a clear yes before deleting.
The CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/snap.mjs"`. Run it from the project root, where `.snap/` is.

## Just clear the backlog (`$ARGUMENTS` is `items`)

1. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/snap.mjs" clear` (or `clear --archive` to include `.snap/done/`). Without
   `--yes` it only lists what it would delete.
2. Show the list and ask the user to confirm. Mention that items already committed can be restored from git.
3. On a yes, run the same command with `--yes`. Snap stays installed and the overlay keeps working.

## Remove Snap completely

1. **Take stock.** Run `git status --porcelain` and `snap.mjs list --all`. Find:
   - the Vite config line(s): `import snap from "@snap/vite"` and `snap()` in `plugins`;
   - the `@snap/vite` entry in package.json;
   - the `.snap/` folder.

   Tell the user what will be removed. Point out any backlog items that aren't committed: they'd be lost. Offer to
   keep a read-only copy first with `snap.mjs export --out snap-backlog.html` (outside `.snap/`).
2. **Get a clear yes.** If they only want an empty backlog, do the section above instead.
3. **Stop watching:** stop any `snap wait` background task, and run `snap.mjs unwatch`.
4. **Vite config:** remove the `@snap/vite` import and `snap()` from `plugins`. Leave everything else exactly as it was.
5. **Package:** uninstall with the project's package manager, e.g. `npm uninstall @snap/vite` (pnpm/yarn: `remove`).
6. **Folder:** delete `.snap/`, which holds the items, config, vendored tarball and backlog.html.
7. **Check.** Search the repo for leftovers: `@snap/vite`, `.snap/`, `data-snap-src`. Mention any `data-private`
   attributes the team added. They're harmless, but they only mattered to Snap.
8. **Tell the user:**
   - Restart the dev server; the ✎ Snap pill will be gone.
   - Commit the removal if they want it gone for the team too.
   - The Claude Code plugin and the browser extension are installed per user, not per project, so they stay.
     To remove those too: `/plugin` → uninstall **snap**, and remove the extension in `vivaldi://extensions`.
     In the extension popup, set the project to **None** for any sites that pointed at this project.
