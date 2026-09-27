---
description: Archive finished AhemUI items — move done/wontfix items from .ahemui/items/ to .ahemui/done/ and commit, typically right before merging a ahemui branch. Use only when the user asks to archive or clean up finished AhemUI items.
---

# Archive finished AhemUI items

1. Call `ahemui_list` with status `["done", "wontfix"]`. If it's empty, say there's nothing to archive and stop.
2. Call `ahemui_prune`. It moves those items into `.ahemui/done/`, a permanent record kept in the repo. Their markers disappear from the page.
   Items still in **review** (◎) are not archived. Mention them, since the requester still needs to approve them in the browser.
   **Housekeeping:** screenshots accumulate in git. If `.ahemui/done/` is getting large (`du -sh .ahemui` or similar), offer
   `ahemui_prune` with `drop_shots_older_than_days` (e.g. 30), which keeps each item.md but deletes old images. For teams that
   want to keep every image, suggest Git LFS instead: `ahemui_init` with `lfs: true` writes `.ahemui/.gitattributes`, and
   each machine needs `git lfs install`.
3. If this is a git repo, commit just the backlog:
   ```bash
   git add -A .ahemui/
   git commit -m "ahemui: archive <N> finished item(s)"
   ```
   Follow the session's usual commit conventions.
4. Report how many items were archived and how many remain open.

An archived item can be brought back with `ahemui_reopen <id>`.
