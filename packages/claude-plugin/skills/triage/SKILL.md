---
description: Triage the AhemUI visual-feedback backlog — classify each untriaged item by type, area and priority using the page metadata captured with it, spot duplicates, and summarise the backlog by page. Use when the user asks to triage, classify, sort, organise or prioritise ahemui items/tickets.
argument-hint: "[--all to re-triage everything]"
---

# Triage the AhemUI backlog

Every item carries page metadata captured in the browser:
- **The page:** title, main heading, Vue Router name, pattern and meta, and page component.
- **Where on the page:** the nearest section heading and landmark.
- **Environment:** local or deployed, browser, viewport, colour scheme.

Use it to give items consistent classifications so they can be filtered and worked page by page.

Items marked `◇for-review` came from a **"flag for review" batch** (see `ahemui_batches`): someone flagged them for a
person to look at and decide on. Triage them like any other item, and in the summary list them separately, per batch,
so the reviewer can see what's waiting for a decision.

1. **Load.** Call `ahemui_list` with `group_by: "page"` and status `["open", "in-progress"]` for the lay of the land. Then call
   `ahemui_list` with `untriaged: true` for the items to classify. With `$ARGUMENTS` = `--all`, triage every open item.
2. **Reuse existing vocabulary.** Before inventing an area or label, look at the ones already on triaged items
   (`ahemui_list` with `group_by: "area"`). Areas are `Page › Section`, e.g. `Pricing › Plan cards` or `Global › Nav bar`.
   Name the page after the route name, heading or title, not the raw URL. Use the page `Global` for things on every page:
   header, nav, footer, and layout chrome, which the landmark usually reveals.
3. **Classify each item** with `ahemui_triage`:
   - `type`, the one that best fits:
     - `bug`: broken behaviour or wrong data
     - `style`: colours, fonts, spacing on one element
     - `layout`: arrangement, alignment, responsive behaviour
     - `copy`: wording or typos
     - `feature`: something new
     - `a11y`: accessibility
     - `other`
     If the person already picked a type when capturing, keep it unless it's clearly wrong.
   - `area` as above.
   - `priority`: `high` for bugs that block or mislead users, anything on prod that looks broken, and
     copy errors on key pages. `low` for polish and nice-to-haves. Otherwise leave it unset (normal).
   - `labels`, only when useful for slicing, e.g. `mobile` (narrow viewport), `dark-mode`, `prod` (captured on a
     deployed site), `design-system` (a shared component used across pages). Keep them few and consistent.
   Captured evidence helps. Console errors or failed requests suggest `bug`. Axe issues suggest `a11y`. An "example to
   match" area with a style-only request suggests `style`. Repro steps with navigation or clicks usually mean `bug`.
   The text of `ahemui_list` / `ahemui_get` is usually enough. Look at the screenshot (`ahemui_get`) only when the request is
   too terse to classify.
4. **Duplicates and conflicts.** If two items ask for the same change, or for opposite changes, on the same element or
   area, `ahemui_note` each with the other's id. Don't close anything yourself; list them in your summary.
5. **Summarise** in a compact table per area: id (first 10 chars), type, priority, and the request in a few words.
   Finish with the suggested order of work: high priority first, then area by area. Mention that the user can run
   `/ahemui:work area:<name>`, `type:<type>` or `route:<path>` to work one slice.

6. **Tracker.** If `ahemui_tracker` shows `sync: auto`, create tickets for the newly triaged items that have none yet
   (as in `/ahemui:sync` step 2), so classification lands in the tracker too. With `manual`, mention `/ahemui:sync`
   if many items are unlinked.

Triage only classifies (and mirrors when auto-sync is on). Don't change code or item status here.
