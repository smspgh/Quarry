# Quarry git roadmap

Plan of attack for making Quarry's git experience the best one inside an editor. Written on 2026-11-12, at release 0.1.7, for a session that starts with no context. Read this, then the Git paragraph in `CLAUDE.md` and `docs/git.md`, before touching anything.

## Progress

Updated as work lands (last update: 2026-11-13). Each item has a spec in `specs/`; stories are `planned` until built, then `draft`; only the owner marks them `verified`. Stages: **Spec** (stories written and indexed) → **Built** (code + Vitest / Rust tests pass, committed on local main) → **Live** (seen working in the dev build on a throwaway repo).

Owner decisions, 2026-11-13: build items 0-9, item 10 gets a spec only; one local commit per item, nothing pushed or released; live checks in one pass after the build (the installed Quarry must be closed for it).

| # | Item | Spec file | Spec | Built | Live |
| --- | --- | --- | --- | --- | --- |
| 0 | Verification debt + `git.graph` in the palette | `git-graph.md` (GRAPH-019); live checks of CONFLICT-008 / 012 / 013 | indexed; GRAPH-019 is `draft` | palette fix yes (5eacf9b; 465 Vitest tests pass); nothing else to build | no: the menu item (GRAPH-019.4) and the three verification-debt checks wait for the live pass |
| 1 | Hunk and line staging | `git-staging.md` (STAGE-001..009) | indexed; 2 owner questions (partial staging of removed lines, silent save on Stage); to check in review: its Ctrl+K chord shortcuts | yes (see git log: "stage, unstage and discard single changes and lines"; on main: 674 Vitest + 148 Rust tests pass; stories `draft`) | no: 16 live checks listed by the build agent (the bar layout has never been seen rendered) |
| 2 | Stash | `git-stash.md` (STASH-001..011) | indexed; 2 owner questions (no Abort for a conflicted pop, untracked files included by default) | yes (b8660bf; on main: 610 Vitest + 132 Rust tests pass; stories `draft`) | no: 13 live checks listed by the build agent |
| 3 | Start a merge or a rebase | `git-merge-rebase.md` (MERGE-001..009; 009 = Force Push, shared with item 6) | indexed; open default: merge is blocked on a dirty tree | yes (8184e5c; on main: 542 Vitest + 124 Rust tests pass; stories `draft`) | no: 11 live checks listed by the build agent |
| 4 | Branch and tag housekeeping | `git-branches.md` (BRANCH-001..009) | indexed; 3 optional owner questions (remote tag delete, which remote when several, ask before deleting a merged branch) | no | no |
| 5 | Compare commits | `git-compare-commits.md` (COMMITCMP-001..006) | indexed; 2 owner questions (two-dot vs three-dot for branches, untracked files vs working tree) | no | no |
| 6 | Edit history | `git-history-edit.md` (HISTORY-001..011) | indexed; owner decided: warn, then Force Push (built with item 3) | no | no |
| 7 | Graph polish | `git-graph.md` (GRAPH-015..018) | indexed; no blocking questions | no | no |
| 8 | Buffer-aware safety | `git-safety.md` (SAFE-001..007) | written and indexed | no | no |
| 9 | Claude-assisted git | `git-claude.md` (GITAI-001..009) | indexed; owner decided: own model setting (default Haiku), draft covers all changes | no | no |
| 10 | Three-way merge view | `git-merge-editor.md` (THREEWAY-001..005) | indexed; 3 owner questions parked in the agent report (base pane without diff3, row button, Ctrl+S = Complete) | deferred | deferred |

Spec phase, 2026-11-13: all eleven items have stories (80 new, all `planned`), indexed with 0 problems (422 stories in total). A reconciliation pass then aligned the ten new spec files with each other (one ref-label menu, one branch picker, one unsaved-tabs dialog, one force push, one Git menu layout; the shared pieces are written once in the Decisions of `specs/git-merge-rebase.md`): 423 stories, 0 problems. Owner answers the same day: rewriting pushed commits warns, then offers Force Push (with lease); Claude git helpers get their own model setting, default Haiku; Draft Commit Message with nothing staged covers all changes; the unsaved-tabs dialog defaults to Save All and Pull always asks. Questions the spec agents left open are recorded in the rows above and in each file's Decisions list; the specified default stands until the owner says otherwise.

Build phase: the specs were committed locally as 021d25f. Wave 1 (items 0, 1, 2, 3) started 2026-11-13, one agent per item in its own worktree; the Built column changes when an item is merged into local main with tsc, Vitest and Rust tests passing.

Resumed 2026-11-13: item 2 (stash) merged as b8660bf (on main: 610 Vitest + 132 Rust tests pass). Item 1 merged the same day (wave 1 complete). Wave 2 (items 4, 5, 9) started on top of b8660bf.

Build order (agents work in parallel inside a wave, each in its own worktree; waves are merged before the next starts because they share `GraphView.tsx`, `git.ts` and `git.rs`): wave 1 = items 0, 1, 2, 3; wave 2 = 4, 5, 9; wave 3 = 6, 7; wave 4 = 8 (audits every action, so it goes last); then the live pass.

## The goal, stated honestly

- **Beat VS Code's built-in Source Control and Graph outright.** Mostly true already on layout, commit actions and guard rails; unproven on speed (never measured side by side), and behind on merge editing (VS Code has a three-way merge editor).
- **Be the best git experience inside an editor.** Not "replace Fork / GitKraken / Sublime Merge feature for feature": close the gaps developers hit daily, then win on what only Quarry can do (it owns the editor buffer, it has Claude built in, it handles huge files).
- Out of scope: pull requests, issues, code review, anything tied to one hosting service.

The owner uses the app day to day and reports rough edges himself. Do not plan around "use it for a week"; do plan around scripted and live verification of everything you build.

## What exists at 0.1.7

All of it is described in `CLAUDE.md` (Git paragraph) and `docs/git.md`. In short:

- **Source Control panel** (`components/panels/GitPanel.tsx`): branch + status line that tells uncommitted work from commits to push / pull, commit box, change sections, Commits list (marks unpushed), file history, collapsed Repository section.
- **Commit graph tab** (`components/GraphView.tsx`, layout in `lib/gitGraph.ts`): lanes with long lines cut by arrows, refs, Current branch / All branches, find + Search All History, details pane, right-click actions (branch, tag, checkout, cherry-pick, revert, reset soft / mixed / hard), Speed Up (commit-graph) offer.
- **Conflicts** (`lib/conflicts.ts`, `editor/conflicts.ts`): bars with Accept Current / Incoming / Both / Compare in the editor, whole-file Current / Incoming, guards on marking resolved, Abort / Skip / Continue Rebase, prefilled message.
- Rust side: `src-tauri/src/git.rs` (shells out to `git`; about 2,250 lines including tests). Wrappers in `lib/gitApi.ts`, state and actions in `lib/git.ts`, pure helpers in `lib/gitStatus.ts`, commands in `lib/gitCommands.ts`.

Nothing below exists yet unless this section says so. In particular there is **no stash, no hunk staging, no way to start a merge or rebase, no branch / tag delete or rename, no interactive rebase**.

## Ground rules

From `CLAUDE.md`, plus lessons from building the above:

- Every user action is a command in the registry; menus reference command ids. Dialogs only through `choose()` / `askDialog()` / `inform()`. No colour literals in components (tokens.css). No native `<select>`.
- **Anything that moves a branch, rewrites history or discards work asks first**, in plain words that say what will happen, with the safe button as the default. Say when commits are already pushed (`git_unpushed`).
- **Never write into `.git` unasked** (the commit-graph Speed Up is the model: explain, offer, wait).
- Git errors go through `gitErrorText` (drops `hint:` lines). Never show raw CLI advice as the only guidance: there must be a button for the way out.
- Pure logic goes in `lib/*.ts` with Vitest tests; git behaviour gets a Rust test in `git.rs` using its `repo()` temp-repo helper. Both existed for every feature so far; keep that.
- Commits: no Claude attribution trailers. Commit, push and release only when the owner says so. Release = `scripts/bump.ps1 <ver>`, commit "Quarry <ver>", push, `scripts/release.ps1 -Publish -Notes "..."` (see `docs/releasing.md`).
- Report honestly: say what was checked live, what only passed in tests, and what was not checked.

## How to verify

- `npx tsc --noEmit -p tsconfig.json`, `pnpm test`, `cd src-tauri && cargo test`. At 0.1.7: 251 unit tests, 102 Rust tests.
- **Live checks** drive the dev build over WebView2 remote debugging (port 9333); the recipe and its pitfalls are in the memory file `shiedit-stack-and-testing.md`. Essentials:
  - The installed Quarry must be closed (single-instance); ask the owner, never kill his copy. Back up `%APPDATA%\com.quarry.app\session.json` and `settings.json` first and restore them after.
  - **Act only on a throwaway repository** created in the scratchpad, and assert the open folder is that repo before any git action. Never test on the Quarry repo, and never reuse a repo the owner is testing in (it happened twice: his in-progress cherry-pick got resolved by a test script).
  - Take screenshots while the state is on screen, and look at them before describing them. One caption was wrong because the screenshot was taken after the state had been cleaned up.
- Large-history fixtures (rebuild when needed, they live in temp): `git clone --filter=tree:0 --no-checkout https://github.com/git/git.git` (86k commits) and the same for `rust-lang/rust` (352k). They have no files checked out: open them only as a graph tab, never as a folder with Source Control.

## Work, in order

Each item: what to build, how it should behave, and what "done" means. Ship each as its own commit; keep `docs/git.md` and the Git paragraph of `CLAUDE.md` in step.

### 0. Close the verification debt (small, do first)

Built and passing in tests, but never seen working in the app:

- A rebase that stops on a conflict **twice** (Continue must stop again with a clear message and the step count must advance).
- **Skip** during a rebase.
- A file **changed by us and deleted by the incoming commit** (Current keeps it, Incoming deletes it).
- Optional but valuable: time VS Code's own graph on the two large fixtures and record the numbers next to Quarry's (0.5 s / 1.8 s per page without commit-graph, 0.1 s / 0.3 s with it), so speed claims are measured.

Also fix: `git.graph` is hidden from the command palette when no repository is open. It should always be listed and say "Open a folder in a git repository" when there is none.

### 1. Hunk and line staging

The most-missed daily feature. Today only whole files can be staged.

- In the Compare tab that Source Control opens for a changed file (`lib/git.ts` `openChange`, `components/DiffView.tsx`, `@codemirror/merge`): per-hunk **Stage**, **Unstage** (staged view) and **Discard** controls, and the same for a selected range of lines.
- Mechanism: build a patch for just that hunk / those lines and apply it with `git apply --cached` (stage), `git apply --cached -R` (unstage), `git apply -R` (discard, after asking). Build patches in a pure, tested TS or Rust function; line-level patches need careful context and count handling, and CRLF files need a test.
- The file then shows in both Staged Changes and Changes; the Commit button already reads "Commit N Staged".
- Done when: a file with three hunks can have one staged, one discarded and one left, verified by `git diff --cached` and `git diff` in a Rust test and once live; partial lines of one hunk work; an unsaved tab is handled (save first, like `resolveConflicts`).

### 2. Stash

- Commands and a **Stashes** section in the panel: Stash Changes (with a message, option to include untracked), Apply, Pop, Drop (asks), and click to see what a stash holds (reuse the commit-files list and Compare tabs).
- `git stash push [-u] -m`, `git stash list --format=...`, `git stash show --name-status -z`, `apply` / `pop` / `drop stash@{n}`.
- A pop that conflicts enters the existing conflict flow; make sure the panel and the bars handle it (there is no `operation` for a stash pop: decide how to show "resolve, then drop the stash").
- Graph: show stashes as nodes attached to their base commit (All branches view).

### 3. Start a merge or a rebase

Quarry can finish these but not begin them (only Pull does, indirectly).

- Graph right-click on a commit or branch label: **Merge into `<current>`…**, **Rebase `<current>` onto This…**. Panel / palette: Merge Branch…, Rebase onto Branch… (reuse the branch picker).
- `git merge --no-edit <ref>` (offer fast-forward only / always a merge commit when it matters), `git rebase <ref>`. Conflicts land in the existing flow (Abort, Skip, Continue Rebase).
- Rebase warns when commits being replayed are already pushed.
- Done when: both run clean and with a conflict on a throwaway repo, live.

### 4. Branch and tag housekeeping

- Delete (refuses unmerged without a second confirmation), rename, set upstream, push a branch, delete a remote branch (asks, names the remote), delete a tag, push a tag.
- From the graph's ref labels (right-click a label, not just the commit) and from the branch picker.

### 5. Compare commits

- Select two commits in the graph (Ctrl+click) → list of files that differ, each opening a Compare tab. Commit vs working tree. "Compare with `<branch>`".
- `git diff --name-status -z A B`, contents through the existing `git_show`.

### 6. Edit history

In two steps, cheapest first:

1. Right-click a commit on the current branch: **Reword Message…**, **Drop Commit…**, **Squash into Parent…**, **Undo Last Commit** (soft reset, already possible but not named).
2. **Interactive rebase list**: the commits since a chosen base as a list to reorder (drag), mark pick / reword / squash / fixup / drop, then run.

- Mechanism: `git rebase -i` driven without an editor by pointing `GIT_SEQUENCE_EDITOR` at a command that replaces the todo file with one Quarry wrote (git runs it through its own `sh`, so a `cp` of a temp file works on Windows; verify), and `GIT_EDITOR` for reword messages. Stops go through the existing rebase flow.
- Always refuse or warn loudly for pushed commits; show exactly which commits will be rewritten.

### 7. Graph polish

- An **uncommitted changes** row at the top of the graph (today it is a strip above the list), selectable to show the changed files.
- Draggable divider for the Search All History results (the details pane already has one).
- Lanes: the worst rows on `git/git` still reach 33–44 lanes and everything past lane 16 shares one column. Look at whether a wider cap, horizontal scroll of the lane column, or smarter cutting reads better.
- Topological order means commits are not strictly newest-first across branches; consider a date-order option for small repos, where it does not cost lanes.

### 8. Buffer-aware safety (only Quarry can do this)

Quarry knows which tabs have unsaved edits; standalone git tools do not.

- Before checkout, reset, pull, merge, rebase, stash, discard: if open tabs with unsaved changes would be overwritten or orphaned, say which and offer Save All / Continue / Cancel.
- After any operation that rewrites files, open tabs reload (mostly done through `checkExternalChanges`; audit every action).

### 9. Claude-assisted git (only Quarry has this built in)

Claude Code tabs already exist (`src-tauri/src/claude.rs`, `lib/claude.ts`); the setting `claudeEnabled` must hide all of this when off.

- **Draft a commit message** from the staged diff (button beside the message box; the user edits it, nothing is committed automatically).
- **Explain this conflict** and propose a resolution for one conflict block (shown as a suggestion the user accepts or discards, never applied silently).
- **Summarise a branch** or a range of commits.
- Decide first how these call Claude (a one-off headless `claude -p` is the existing pattern) and what they cost the user; keep every result reviewable before it changes anything.

### 10. Three-way merge view (deferred)

Build only if real use shows the inline accept bars are not enough. It is the largest piece here, and many people turn VS Code's version off.

## Known weak spots to keep in mind

- Everything in "What exists" was built in one day and exercised by scripts on small throwaway repos. Each review round found a real gap (a commit path that skipped a guard, a half-cleaned conflict passing the marker check, a prepared message not offered twice). Assume more remain, and look for the bypass route every time you add a guard: menu command, palette, keyboard, "all" buttons.
- During a rebase, "Current" is the branch being rebased onto and "Incoming" is the user's own commit. The UI says so in the bars and tooltips; any new conflict UI must too.
- Paths are shown with backslashes everywhere in the app (Windows-only). A reviewer asked for forward slashes in commit file lists; the owner has not decided. Do not change one list alone.
- `resolveConflicts` checks the file on disk, after saving its tab. Any new staging path for conflicted files must go through it.
