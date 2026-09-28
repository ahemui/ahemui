---
description: Watch for "⚡ Start now" requests sent from the AhemUI browser overlay and work each one as soon as it arrives, while the session stays free for chat. Use when the user asks to watch ahemui, listen for ahemui requests, or wants Start now to work.
argument-hint: "[stop]"
---

# Watch for Start now requests

In the browser overlay, **Backlog** (Ctrl+Enter) only saves an item for later. **⚡ Start now** (Enter; labelled
**Add to queue** while you're busy with another item) saves it too and marks it
`start: now`. While this skill is watching, the toolbar pill says "Claude watching", and a Start-now item is picked
up right away.

Waiting happens in a background command, so the user can keep talking to you in the meantime.
`${CLAUDE_PLUGIN_ROOT}/scripts/ahemui.mjs` is the AhemUI CLI bundled with this plugin. Run it from the project root.

## Stop

If `$ARGUMENTS` is `stop`, or the user asks you to stop watching:
1. Stop the background `ahemui wait` task if one is running.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/ahemui.mjs" unwatch`, which clears "Claude watching" in the browser.
3. Say that watching has stopped. Queued items stay in the backlog for `/ahemui:work`.

## Start

1. Do the one-time checks from `/ahemui:work` step 1: the git branch (don't commit to main/master without asking) and
   unrelated uncommitted changes.
2. Don't look for waiting items yourself: `ahemui wait` returns any Start-now items that are already queued straight
   away, and respects a pause set in the browser.
3. **Arm the watcher.** Run this with the Bash tool and `run_in_background: true`:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/ahemui.mjs" wait
   ```
   Tell the user in one line that you're watching and that ⚡ Start now in the browser sends work straight to you.
   Then end your turn. You'll be woken up when the command exits.
4. **When it exits:**
   - **Exit code 0.** Each output line is `START <id> <route> — <request>`. For each id in order, call `ahemui_claim`
     and then `ahemui_get`, and do the item exactly as in `/ahemui:work` step 2: understand it, implement, verify, resolve
     (to review by default), commit, and update any linked tracker ticket. Keep the user posted with one short line per item.
   - **Exit code 3** (timeout). Nothing arrived; go straight back to step 3.
   - **Exit code 4** (`STOPPED`). The user stopped watching from the browser. Don't re-arm; say in one line that
     watching has stopped and that `/ahemui:watch` starts it again.
   - **Any other failure.** Report it and stop.

   After the batch, go back to step 3. `ahemui wait` returns anything that arrived while you were working straight
   away, unless the user paused or stopped the watch from the browser: then it holds, or exits with code 4.

The browser can **pause** the watch: `ahemui wait` keeps running but holds Start-now items until the user resumes.
Nothing changes on your side; just leave the wait running.

While an item is being worked, the browser shows "Claude working", and new Start-now presses queue up behind it.
Plain queued items are left for `/ahemui:work`.

The person who pressed Start now is probably looking at the page:
- **Ambiguous items.** Ask with `ahemui_note` and `question: true`. They get a "?" marker, a notification and a reply box.
  Their answer releases the item again, and because it's still a Start-now item, `ahemui wait` wakes you for it.
- **Reviews.** When they review your result and choose "Not quite…", the item comes back the same way with their feedback.
