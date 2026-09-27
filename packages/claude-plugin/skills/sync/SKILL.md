---
description: Mirror the AhemUI backlog to the team's tracker (Linear, Jira, Notion, GitHub Issues…) through its already-connected MCP server — create tickets for new items, and reconcile status both ways. Use when the user asks to sync ahemui items to Linear/Jira/Notion/GitHub or to set up a tracker for AhemUI.
argument-hint: "[push | pull] (default: both)"
---

# Sync AhemUI with the team's tracker

The repo backlog (`.ahemui/`) stays the source of truth for everything captured: anchors, screenshots and page metadata.
The tracker gets a mirrored ticket per item, so the rest of the team can see, plan and discuss the work where they already
are. AhemUI never calls tracker APIs itself. You use the MCP server the user already has connected.

## 1. Tracker configured?

Call `ahemui_tracker`.
- **Not configured.** Look at which tracker MCP tools are available in this session (Linear, Atlassian/Jira, Notion, GitHub…).
  Ask the user which tracker to use, where tickets should go (team/project/database), and whether sync should be
  `manual` (only this skill) or `auto` (triage, work and watch also create and update tickets). Save it with
  `ahemui_set_tracker`. Suggest committing `.ahemui/config.json` so the whole team mirrors to the same place.
- **Configured, but its MCP server isn't connected.** Stop and tell the user to enable it. Don't fall back to anything else.

Follow the tracker's `instructions` (team conventions) throughout.

## 2. Push: create tickets for unlinked items

Skip this if `$ARGUMENTS` is `pull`.

Call `ahemui_list` with `linked: false` and status `["open", "in-progress"]`. For each item:
1. Call `ahemui_ticket`. It returns the title, a markdown description, labels, priority and the screenshot.
2. Create the ticket in the configured target with the tracker's MCP tools. Map type, priority and labels to the
   tracker's fields. If the tracker's MCP can attach files, attach the screenshot. Otherwise the description already
   points to it in the repo.
3. Call `ahemui_link` with the ticket key, URL and status.

If a similar ticket probably already exists (search by title or by the `AhemUI-Item:` id if the tracker supports search),
link it instead of creating a duplicate.

## 3. Pull and reconcile status

Skip this if `$ARGUMENTS` is `push`.

For each linked item (`ahemui_list` with `linked: true`, statuses open, in-progress and done), read the ticket's current status:
- **Ticket closed as done**, but the item is open. Call `ahemui_resolve` with status `done` and the note
  "Closed in <tracker> as <status>". If it was closed as won't do or duplicate, use `wontfix`.
- **Item in review** (◎). Move the ticket to the team's in-review state if it has one.
- **Item done**, but the ticket is still open. Comment what changed (the resolve note, plus the commit if known), then move
  the ticket to the team's done or in-review state. Ask if the right state is unclear.
- **Ticket reopened**, but the item is done. Call `ahemui_reopen`.
- Update the stored status with `ahemui_link`, passing the same key and the new status.

## 4. Report

Give a short table: item id (first 10), ticket key, and what happened (created / linked / status updated / no change).
Mention any items you skipped and why.
