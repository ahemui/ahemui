# Changelog

All notable changes to AhemUI. The format follows [Keep a Changelog](https://keepachangelog.com/), and versions
follow [semantic versioning](https://semver.org/) (0.x: minor versions may change behaviour).

## [Unreleased]

## [0.4.0] — 2026-10-10

First public release.

- Capture UI feedback in the running app: drag, click or Shift-lasso; extra areas, "make it like this" examples,
  redaction, design links, dictation.
- Repo-committed backlog in `.ahemui/`: one Markdown file per item with source file:line, component chain, page,
  styles and design tokens, component state, console and network errors, repro steps and screenshots.
- Claude Code plugin with twelve skills: `/ahemui:watch` (Start now), `/ahemui:work`, review, triage, status, board,
  sync with Linear, Jira, Notion or GitHub Issues through their MCP servers, hand-off, archive, update, setup and remove.
- Review loop: automatic after-shots, before/after on the page, approve or send back.
- UX review: **✦ Review page** in the overlay runs automatic accessibility checks; `/ahemui:review` adds the
  agent's judged review. Findings arrive as ✦ suggestions pinned to elements, to take on or dismiss.
- Batches: name each round of notes and mark it "changes" or "for review".
- Live board, and a static `backlog.html` snapshot.
- Browser extension for Chromium browsers, including deployed sites (zip on the GitHub release; store listing to follow).
- Personal settings: toolbar corner, notifications, Enter key, markers, shortcut, theme, name.
- Agent-neutral data format: suggestions are stored as `by: agent`, the watcher records `watcher.agent`, and
  `config.agent` names the agent, so other agents can follow Claude Code.
