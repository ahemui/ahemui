---
description: Open the AhemUI backlog as a page — the live board (columns for queue, backlog, in progress, needs you, done; filters; screenshots; review and reply actions) or the read-only .ahemui/backlog.html snapshot. Use when the user asks to see, open or browse the AhemUI backlog/board.
---

# Open the AhemUI backlog board

1. Call `ahemui_board`. It returns the live board URL, if `ahemui serve` is running for this repo (usually inside the
   Vite dev server), and writes a fresh read-only snapshot to `.ahemui/backlog.html`.
2. **A live board exists:** open it for the user. On Windows run `start "" "<url>"`, on macOS `open "<url>"`, on Linux
   `xdg-open "<url>"`. Tell them the URL too.
3. **No live board:** start one in the background with the Bash tool and `run_in_background: true`:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/ahemui.mjs" board
   ```
   That runs `ahemui serve` and opens the board. It keeps running until stopped, which is fine in the background.
   Also mention the snapshot path, which opens straight from disk with no server.

Keep the reply to the URL(s) and one line on what the board offers.
