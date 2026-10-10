---
description: Hand off the AhemUI backlog on a local git branch so someone else (or another Claude session) can pick it up — commits .ahemui/ with a summary of open items and prints take-over instructions. Use only when the user asks to hand off or share the AhemUI backlog on a branch.
argument-hint: "<branch name, e.g. pricing-polish>"
---

# Hand off the AhemUI backlog

The goal is to commit the current `.ahemui/` backlog to a branch that someone else can check out and continue with `/ahemui:work`.
This is **local git only** by default: don't push or open a PR unless the user explicitly asks, e.g. with
`/ahemui:handoff <name> --pr` or "…and open a PR".

1. Call `ahemui_list` with status `["open", "in-progress"]`. If there's nothing to hand off, say so and stop.
2. Run `git status --porcelain` and `git branch --show-current`.
3. **Choose the branch.**
   - If `$ARGUMENTS` is given, use `ahemui/$ARGUMENTS`, or use it as-is if it already contains a `/`.
   - If there's no argument and you're already on a `ahemui/*` branch, use the current branch.
   - Otherwise ask the user for a short name.

   Create the branch with `git switch -c <branch>` unless you're already on it. Uncommitted changes carry over to the new branch, which is fine.
4. **Release claims.** For every item that is `in-progress` and claimed by this session (the claimant `ahemui_claim` reported, such as `Claude (<your name>)`), call `ahemui_reopen`
   so the receiver's `ahemui_next` will pick it up.
5. **Stage only the backlog:** `git add .ahemui/`. If other files have uncommitted changes, list them and ask whether they
   belong in the handoff. Never stage them silently.
6. **Commit** with a message that doubles as the handoff note. Follow the session's usual commit conventions:
   ```
   ahemui: hand off <N> open item(s)

   - <id first 10>  <route>  <source>  — <first line of request>
   ...

   Take over: git switch <branch>, run the app, then /ahemui:work
   ```
7. **Only if the user asked for a PR:** check `git remote -v` and that `gh auth status` works, then run
   `git push -u origin <branch>` and `gh pr create --draft`. Use the commit's handoff note as the body, add a checklist of
   the open items, and end with the session's usual PR attribution lines. If there's no remote or `gh` isn't set up,
   say so and stop at the local commit.
8. Tell the user the branch name, the commit (and PR link, if one was opened), and what the receiver does:
   - `git switch <branch>` (after fetching, if the branch is shared through a remote later)
   - `npm install`, which installs the vendored `ahemui` from `.ahemui/vendor/`
   - Start the dev server to see the markers, then run `/ahemui:work` in Claude Code.
