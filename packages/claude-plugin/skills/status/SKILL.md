---
description: Show the AhemUI visual-feedback backlog at a glance — counts by status and the open items grouped by route. Use when the user asks what is in the AhemUI backlog or for its status.
---

# AhemUI backlog status

1. Call `ahemui_list` (it groups by page by default). If most items are triaged, call it again with `group_by: "area"`.
2. Reply with:
   - One line of counts, for example `3 open · 1 in progress · 2 in review · 1 awaiting reply · 5 done · 2 untriaged`.
   - The open and in-progress items grouped by page or area, each as
     `id (first 10) · type/priority · section · first line of the request`. Show who claimed any in-progress item.
   - If items are untriaged, suggest `/ahemui:triage`.
   - If items are in review (◎) or awaiting reply (?), say they're waiting on the person in the browser.
3. Mention the board for a visual overview: `/ahemui:board`, or the **Open full board ↗** link in the overlay.
4. If there are done items, mention that `/ahemui:archive` moves them to `.ahemui/done/` once the branch is ready to merge.

Keep it short. Don't fetch individual items or screenshots unless the user asks about one.
