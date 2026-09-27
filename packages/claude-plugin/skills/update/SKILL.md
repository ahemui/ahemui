---
description: Update AhemUI — pull the newest AhemUI build into the Claude Code plugin, then install it into the current project (.ahemui/vendor + the app's package), and say what needs restarting. Use only when the user asks to update or refresh AhemUI.
---

# Update AhemUI in this project

Run from the project root, where `.ahemui/` is.

1. **Update the plugin.** Run with the Bash tool:
   ```bash
   claude plugin marketplace update ahemui
   ```
   ```bash
   claude plugin update ahemui@ahemui
   ```
   Note the versions it reports. "Already at the latest version" is fine.
2. **Update the project.** This picks up the newest package, even one the previous step just downloaded:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/ahemui.mjs" update
   ```
   It copies the package into `.ahemui/vendor/ahemui.tgz` and reinstalls it in every app that uses `ahemui`,
   using the project's package manager. It prints the build it moved from and to, and whether the running dev server is
   still on the old build. If it reports that nothing depends on `ahemui`, the project hasn't been set up; suggest `/ahemui:setup`.
3. **Tell the user what to restart,** only the parts that apply:
   - **Dev server:** restart it (AhemUI's server runs inside it), then reload the page.
   - **Browser extension**, if they use it: press ↻ on AhemUI in `vivaldi://extensions` or `chrome://extensions`, then
     reload the page. If a part is out of date, the amber dot in the AhemUI toolbar says so.
   - **Claude Code:** start a new session (or restart) so the updated plugin's commands and tools load, including
     any session running `/ahemui:watch`.
4. If `.ahemui/vendor/ahemui.tgz` and the lockfile changed, mention that committing them gives teammates the same
   version on their next `npm install`.
