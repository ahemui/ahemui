---
description: Update Snap — pull the newest Snap build into the Claude Code plugin, then install it into the current project (.snap/vendor + the app's package), and say what needs restarting. Use only when the user asks to update or refresh Snap.
---

# Update Snap in this project

Run from the project root, where `.snap/` is.

1. **Update the plugin.** Run with the Bash tool:
   ```bash
   claude plugin marketplace update snap
   ```
   ```bash
   claude plugin update snap@snap
   ```
   Note the versions it reports. "Already at the latest version" is fine.
2. **Update the project.** This picks up the newest package, even one the previous step just downloaded:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/snap.mjs" update
   ```
   It copies the package into `.snap/vendor/snap-vite.tgz` and reinstalls it in every app that uses `@snap/vite`,
   using the project's package manager. It prints the build it moved from and to, and whether the running dev server is
   still on the old build. If it reports that nothing depends on `@snap/vite`, the project hasn't been set up; suggest `/snap:setup`.
3. **Tell the user what to restart,** only the parts that apply:
   - **Dev server:** restart it (Snap's server runs inside it), then reload the page.
   - **Browser extension**, if they use it: press ↻ on Snap in `vivaldi://extensions` or `chrome://extensions`, then
     reload the page. If a part is out of date, the amber dot in the Snap toolbar says so.
   - **Claude Code:** start a new session (or restart) so the updated plugin's commands and tools load, including
     any session running `/snap:watch`.
4. If `.snap/vendor/snap-vite.tgz` and the lockfile changed, mention that committing them gives teammates the same
   version on their next `npm install`.
