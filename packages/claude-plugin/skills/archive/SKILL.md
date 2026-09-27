---
description: Archive finished Snap items — move done/wontfix items from .snap/items/ to .snap/done/ and commit, typically right before merging a snap branch. Use only when the user asks to archive or clean up finished Snap items.
---

# Archive finished Snap items

1. Call `snap_list` with status `["done", "wontfix"]`. If it's empty, say there's nothing to archive and stop.
2. Call `snap_prune`. It moves those items into `.snap/done/`, a permanent record kept in the repo. Their markers disappear from the page.
   Items still in **review** (◎) are not archived. Mention them, since the requester still needs to approve them in the browser.
   **Housekeeping:** screenshots accumulate in git. If `.snap/done/` is getting large (`du -sh .snap` or similar), offer
   `snap_prune` with `drop_shots_older_than_days` (e.g. 30), which keeps each item.md but deletes old images. For teams that
   want to keep every image, suggest Git LFS instead: `snap_init` with `lfs: true` writes `.snap/.gitattributes`, and
   each machine needs `git lfs install`.
3. If this is a git repo, commit just the backlog:
   ```bash
   git add -A .snap/
   git commit -m "snap: archive <N> finished item(s)"
   ```
   Follow the session's usual commit conventions.
4. Report how many items were archived and how many remain open.

An archived item can be brought back with `snap_reopen <id>`.
