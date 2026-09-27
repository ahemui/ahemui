---
description: Watch for "⚡ Start now" requests sent from the Snap browser overlay and work each one as soon as it arrives, while the session stays free for chat. Use when the user asks to watch snap, listen for snap requests, or wants Start now to work.
argument-hint: "[stop]"
---

# Watch for Start now requests

In the browser overlay, **Backlog** (Ctrl+Enter) only saves an item for later. **⚡ Start now** (Enter; labelled
**Add to queue** while you're busy with another item) saves it too and marks it
`start: now`. While this skill is watching, the toolbar pill says "Claude watching", and a Start-now item is picked
up right away.

Waiting happens in a background command, so the user can keep talking to you in the meantime.
`${CLAUDE_PLUGIN_ROOT}/bin/snap.mjs` is the Snap CLI bundled with this plugin. Run it from the project root.

## Stop

If `$ARGUMENTS` is `stop`, or the user asks you to stop watching:
1. Stop the background `snap wait` task if one is running.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/snap.mjs" unwatch`, which clears "Claude watching" in the browser.
3. Say that watching has stopped. Queued items stay in the backlog for `/snap:work`.

## Start

1. Do the one-time checks from `/snap:work` step 1: the git branch (don't commit to main/master without asking) and
   unrelated uncommitted changes.
2. Call `snap_list` with `start_now: true` and status `["open"]`. If there are items already waiting, work them first (step 4).
3. **Arm the watcher.** Run this with the Bash tool and `run_in_background: true`:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/snap.mjs" wait
   ```
   Tell the user in one line that you're watching and that ⚡ Start now in the browser sends work straight to you.
   Then end your turn. You'll be woken up when the command exits.
4. **When it exits:**
   - **Exit code 0.** Each output line is `START <id> <route> — <request>`. For each id in order, call `snap_claim`
     and then `snap_get`, and do the item exactly as in `/snap:work` step 2: understand it, implement, verify, resolve
     (to review by default), commit, and update any linked tracker ticket. Keep the user posted with one short line per item.
   - **Exit code 3** (timeout). Nothing arrived; go straight back to step 3.
   - **Any other failure.** Report it and stop.

   After the batch, call `snap_list` with `start_now: true` and status `["open"]` to catch anything that arrived while
   you were working, then go back to step 3.

While an item is being worked, the browser shows "Claude working", and new Start-now presses queue up behind it.
Plain queued items are left for `/snap:work`.

The person who pressed Start now is probably looking at the page:
- **Ambiguous items.** Ask with `snap_note` and `question: true`. They get a "?" marker, a notification and a reply box.
  Their answer releases the item again, and because it's still a Start-now item, `snap wait` wakes you for it.
- **Reviews.** When they review your result and choose "Not quite…", the item comes back the same way with their feedback.
