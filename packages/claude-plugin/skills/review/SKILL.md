---
description: UX review of pages in the app — read the page scans taken with "Review page" in the AhemUI overlay (screenshot, element outline with source locations, automatic accessibility checks) and file the most important problems as ✦ suggestions pinned to elements, for the user to take on or dismiss. Use when the user asks for a UX review, design review, usability review or "review this page".
argument-hint: "[route…] (omit for every page with a recent scan)"
---

# UX review

A review needs a **page scan**: in the browser, the user opens the page, opens the AhemUI backlog panel (☰) and presses
**✦ Review page**. That sends AhemUI a screenshot of the viewport, a numbered outline of the page's headings,
actions, fields, media and text (each with its `file:line` when known), and runs the automatic checks (axe: contrast,
tap targets, names and labels, alt text…). Their findings are already filed as ✦ suggestions; your job is the part
that needs judgement.

## 1. Pick the scans

Call `ahemui_scans`.
- `$ARGUMENTS` names routes: use the newest scan of each. A route with no scan: ask the user to press
  **✦ Review page** there (it takes a second), and continue with the others.
- No arguments: review each route's newest scan from the last day or so.
- No scans at all: say how to take one and stop.

## 2. Review each page

Call `ahemui_scan` with the scan id. Look at the screenshot and the outline together; open the source files the
outline points to when the code explains more (states that aren't visible, copy defined elsewhere, shared components).
Also call `ahemui_list` with `route` set, so you don't suggest what's already in the backlog.

Look for problems a real user would hit, roughly in this order:
1. **Task and hierarchy.** Is it obvious what the page is for and what to do next? One primary action per view;
   competing or equally loud calls to action; important things below less important ones.
2. **Copy.** Vague or jargon labels, buttons that don't say what happens ("Submit", "Click here"), unclear errors,
   inconsistent names for the same thing.
3. **Forms and inputs.** Missing labels or hints, unclear required fields, no inline validation, bad defaults.
4. **States.** Missing empty, loading and error states (check the code: a list with no empty state, a fetch with no
   error branch), no feedback after an action.
5. **Layout and consistency.** Spacing, alignment and sizes that break the page's own pattern; similar components
   styled differently; text too long to read comfortably; things that will break on small screens.
6. **Accessibility beyond the checks.** Heading order that skips levels, meaning carried by colour alone, focus order,
   icon-only buttons.

Don't repeat the automatic checks' findings (`ahemui_scan` lists them), and don't suggest a redesign: each finding
is one concrete change to one element.

## 3. File the findings

Call `ahemui_suggest` once per page with **at most 8 findings, the most important first**. For each:
- `n`: the element's number from the outline (use `selector` only if nothing fits).
- `request`: the change as an instruction Claude could act on later: "Make *Start free trial* the only primary
  button in the hero; turn *Book a demo* into a secondary button."
- `why`: the user's problem in a sentence: "Two equally loud buttons split attention; most visitors won't know
  which to pick."
- `fix`: a concrete suggestion when there's one worth giving.
- `severity`: **high** blocks or misleads users, **medium** slows them down or confuses, **low** is polish.
- `rule`: a short slug (`competing-ctas`, `vague-label`, `missing-empty-state`…) so repeats are recognised.
- `type`: `copy`, `layout`, `style`, `a11y`, `bug` or `feature`.

Fewer, sharper findings beat a long list: if a page is in good shape, say so and file one or two, or none.

## 4. Report

Per page, one line: how many suggestions you filed (and how many the automatic checks found), and the single most
important one. Tell the user the ✦ markers are on the page: **Do it** queues a change for Claude, **Later** keeps it
in the backlog, **Dismiss** drops it. On the board, "Make these changes" on the *UX review* batch takes them all on.
