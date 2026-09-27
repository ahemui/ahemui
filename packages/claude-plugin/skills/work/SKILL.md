---
description: Work through the Snap visual-feedback backlog (.snap/items) — implement each UI change someone highlighted in the browser, hand it back for their review, and commit it together with its status. Use when the user asks to work the snap queue/backlog, process snap items, or fix the highlighted UI feedback.
argument-hint: "[item id | area:<name> | type:<type> | label:<label> | route:<path>] (omit to work the whole queue)"
---

# Work the Snap backlog

Snap items are UI change requests captured in the browser. Each lives in `.snap/items/<id>/`:
- **`item.md`**: the request, anchors (source file:line, component chain, CSS path, text), page metadata, and
  whatever else was captured: styles and design tokens, component state, console and network errors, repro steps,
  accessibility issues, extra areas, and a design link.
- **Screenshots**: of the area, plus any extra areas and an "after" shot once in review.

The browser shows a marker per item: amber = open, ⚡ = start now, blue = in progress, **"?"** = waiting for the
person's answer, purple ◎ = ready for their review, green ✓ = approved or done.

## 1. Check before you start

1. Call `snap_list` with status `["open", "in-progress"]` (grouped by page). If it's empty, say so and stop.
   - If many items are untriaged, suggest `/snap:triage` first, but don't block on it.
   - Skip items claimed by someone else.
   - Skip items marked `?awaiting-reply`; they wait for the person.
2. Run `git status --porcelain` and `git branch --show-current`.
   - If there are uncommitted changes unrelated to `.snap/`, ask the user whether to continue. They would get mixed into the per-item commits.
   - If you're on `main`/`master` (or the repo's default branch), ask before committing there. Suggest `git switch -c snap/<topic>`.
   - If this isn't a git repo, work the items anyway and skip the commit steps.
3. Call `snap_tracker` once, so you know whether tickets need updating.

## 2. For each item

If `$ARGUMENTS` names an item id, call `snap_claim` on it and then `snap_get`. Otherwise call `snap_next`, which claims the
next open item and turns its marker blue. The order is: ⚡ Start-now first, then high priority, then page by page. If `$ARGUMENTS` holds filters
(`area:Pricing`, `type:copy`, `label:mobile`, `route:/pricing`), pass them to every `snap_next` call.

1. **Understand it.** `snap_get` gives you everything. Use what's there:
   - **Screenshots.** Red strokes are the person's drawing and dark blocks are redactions. "Area N (also applies here)" means the same
     change applies at those places too. "Example to match" is a reference: make the target look or behave like it, and
     compare their **Styles** entries.
   - **Source.** `file.vue:LINE:COL` is the exact element. React ≤18 and Svelte give `file:line:col` too. A bare
     component file (or React 19: names only) means you have to search inside it. The component chain shows the parents, including `v-for` owners.
   - **Page:** route, page component, section heading and landmark. A header, nav or footer item usually means a shared
     layout component. A **Storybook story** points to its story file, and the component is usually imported there.
   - **Styles and design tokens.** Change the token or class the element already uses (e.g. `var(--space-4)`,
     `px-4`), not a new hard-coded value. For "make it like that one", copy the reference's tokens and classes.
   - **Component state, errors and steps** (mostly bugs). Props and state at capture time, console errors and failed
     requests, and the clicks that led there. Reproduce with them before changing code.
   - **Accessibility issues** (a11y items). Fix the listed axe rules in the highlighted element.
   - **Design reference.** If a Figma (or other design) MCP is connected, look at the linked frame and match it.
   - **Deployed-site items** (the item says so) usually have no source. Search by element text and distinctive
     classes from the CSS path. The deployed build may differ from this branch.
   - **Sent back after review** (the item says so). Read the **Feedback** in the thread and compare the before/after
     screenshots. The earlier attempt wasn't right, so address the feedback specifically.
2. **Decide scope.** Make the smallest change that fully satisfies the request, in the codebase's existing style. For shared
   components, decide from the request and screenshots whether the change is for all instances or one variant.
3. **When unclear, ask; don't guess.** Call `snap_note` with `question: true` and one concrete question. That releases the
   item and shows a "?" with a reply box on the page. Their answer puts it back in the queue with the reply in the
   thread. Move on to the next item. Only resolve as `wontfix` when the user agreed or the item is clearly obsolete, with the reason in the note.
4. **Implement and verify.** If the dev server is running and you can view pages (a browser tool), open the route and
   check the result, using the steps to reproduce bugs. Otherwise run the project's cheap checks (typecheck/lint).
5. **Resolve.** Call `snap_resolve` with a one or two sentence `note` on what changed. By default it goes to **review**:
   - The person sees a before/after comparison on the page and approves it (✓, done) or sends it back with feedback.
   - The "after" screenshot is taken automatically in their browser.
   - Use `status: "done"` only when the user asked you to skip review.
6. **Tracker.** If the item has a linked ticket: comment what changed and move it to the team's in-review (or done) state.
   With `sync: auto` and no ticket, create one first as in `/snap:sync` step 2. Skip this if no tracker is configured.
7. **Commit** (one commit per item, when in a git repo). Stage only the files you changed for this item plus the item's folder:
   ```bash
   git add <changed files> .snap/items/<id>
   git commit -m "snap: <short summary of the change>" -m "<what changed and why>" -m "Snap-Item: <id>"
   ```
   Follow the repo's and this session's usual commit conventions (e.g. required trailers).

Repeat until `snap_next` reports no open items, or just once when a single item was requested.

## 3. Finish

Summarise in a short table grouped by area (or page): item id (first 10 chars), what changed, and status (in review / asked a
question / won't fix). Remind the user that ◎ items are waiting for their review on the page. Don't archive here; `/snap:archive` does
that when the branch is ready to merge.
