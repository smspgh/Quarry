# Quarry git roadmap

Plan of attack for making Quarry's git experience the best one inside an editor. Written on 2026-11-12, at release 0.1.7, for a session that starts with no context. Read this, then the Git paragraph in `CLAUDE.md` and `docs/git.md`, before touching anything.

## Progress

Updated as work lands (last update: 2026-11-13). Each item has a spec in `specs/`; stories are `planned` until built, then `draft`; only the owner marks them `verified`. Stages: **Spec** (stories written and indexed) → **Built** (code + Vitest / Rust tests pass, committed on local main) → **Live** (seen working in the dev build on a throwaway repo).

Owner decisions, 2026-11-13: build items 0-9, item 10 gets a spec only; one local commit per item, nothing pushed or released; live checks in one pass after the build (the installed Quarry must be closed for it).

| # | Item | Spec file | Spec | Built | Live |
| --- | --- | --- | --- | --- | --- |
| 0 | Verification debt + `git.graph` in the palette | `git-graph.md` (GRAPH-019); live checks of CONFLICT-008 / 012 / 013 | indexed; GRAPH-019 is `draft` | palette fix yes (5eacf9b; 465 Vitest tests pass); nothing else to build | yes, 2026-11-14: A0.1-A0.4 pass (rebase stopping twice, Skip, changed-by-us / deleted-by-them, palette + menu entry). VS Code timing comparison not done (optional) |
| 1 | Hunk and line staging | `git-staging.md` (STAGE-001..009) | indexed; 2 owner questions (partial staging of removed lines, silent save on Stage); to check in review: its Ctrl+K chord shortcuts | yes (see git log: "stage, unstage and discard single changes and lines"; on main: 674 Vitest + 148 Rust tests pass; stories `draft`) | yes, 2026-11-14: 16 checks, 15 pass (2 after fixes: sides not level 0dad0a5, view jump 6ac3e23); toolbar width fails (open issue 9). Not exercised: STAGE-005.2/.3, 006.4-.6, 007.10, 009.4 |
| 2 | Stash | `git-stash.md` (STASH-001..011) | indexed; 2 owner questions (no Abort for a conflicted pop, untracked files included by default) | yes (b8660bf; on main: 610 Vitest + 132 Rust tests pass; stories `draft`) | yes, 2026-11-14: 13 checks pass (after fixes dedf033, 7a40fec, c4ea84e); tooltips of disabled buttons not seen on screen. Not exercised: STASH-003.5, 005.6/.7, 006.10/.11, 008.7, 009.16, 010.10/.11/.13 |
| 3 | Start a merge or a rebase | `git-merge-rebase.md` (MERGE-001..009; 009 = Force Push, shared with item 6) | indexed; open default: merge is blocked on a dirty tree | yes (8184e5c; on main: 542 Vitest + 124 Rust tests pass; stories `draft`) | yes, 2026-11-14: 11 checks, 10 pass; Git menu layout fails (taller than the window, open issue 1). Not checked: detached HEAD, repo with no commits, MERGE-006.5, MERGE-008.4/.8/.9/.10 |
| 4 | Branch and tag housekeeping | `git-branches.md` (BRANCH-001..009) | indexed; 3 optional owner questions (remote tag delete, which remote when several, ask before deleting a merged branch) | yes (6fc83f8; on main: 840 Vitest + 162 Rust tests pass; stories `draft`) | yes, 2026-11-14: 17 checks pass (3 after fixes 59dd7a1, 5c88b53, ded6f92, 0f14552); a real Shift+F10 in the picker not observable over CDP; open issue 15 |
| 5 | Compare commits | `git-compare-commits.md` (COMMITCMP-001..006) | indexed; 2 owner questions (two-dot vs three-dot for branches, untracked files vs working tree) | yes ("Graph: compare two commits, a commit with the working tree, or with a branch"; on main: 730 Vitest + 152 Rust tests pass; stories `draft`) | yes, 2026-11-14: 11 checks pass (large diff on a generated 6000-file repo); open issues 14, 18 |
| 6 | Edit history | `git-history-edit.md` (HISTORY-001..011) | indexed; owner decided: warn, then Force Push (built with item 3) | yes (63b41f3; on main: 1068 Vitest + 192 Rust tests pass; stories `draft`; the no-editor rebase mechanism was verified on Windows in a throwaway repo). Open for the owner: reworded messages skip commit hooks (`--no-verify`) | yes, 2026-11-14: 14 checks, 13 pass (fixes 2231f8b, ad82990); signing failure during a history edit fails (open issue 21) |
| 7 | Graph polish | `git-graph.md` (GRAPH-015..018) | indexed; no blocking questions | yes (26882e8; on main: 988 Vitest + 175 Rust tests pass; GRAPH-015..018 `draft`) | yes, 2026-11-14: 11 checks, 10 pass; double-click on a file in the uncommitted row's list fails (open issue 14). Lane scrolling seen on git/git (rust-lang/rust not cloned) |
| 8 | Buffer-aware safety | `git-safety.md` (SAFE-001..007) | written and indexed | yes (4a033c9; on main: 1284 Vitest + 192 Rust tests pass; stories `draft`; a test enumerates every route and checks no file but git.ts calls a file-rewriting git function) | yes, 2026-11-14: all 15 checks pass (window refocus simulated; split, pull-with-open-question and macro started with internal calls) |
| 9 | Claude-assisted git | `git-claude.md` (GITAI-001..009) | indexed; owner decided: own model setting (default Haiku), draft covers all changes | yes (f18a829; on main: 944 Vitest + 173 Rust tests pass; stories `draft`; flags checked against Claude Code 2.1.325 with 2 real requests, everything else against a fake) | yes, 2026-11-14: all 11 checks pass with 8 real Haiku requests; signed-out / usage-limit errors still unverified; the Git › Claude submenu is unreachable by mouse (open issue 1) |
| 10 | Three-way merge view | `git-merge-editor.md` (THREEWAY-001..005) | indexed; 3 owner questions parked in the agent report (base pane without diff3, row button, Ctrl+S = Complete) | deferred | deferred |

Spec phase, 2026-11-13: all eleven items have stories (80 new, all `planned`), indexed with 0 problems (422 stories in total). A reconciliation pass then aligned the ten new spec files with each other (one ref-label menu, one branch picker, one unsaved-tabs dialog, one force push, one Git menu layout; the shared pieces are written once in the Decisions of `specs/git-merge-rebase.md`): 423 stories, 0 problems. Owner answers the same day: rewriting pushed commits warns, then offers Force Push (with lease); Claude git helpers get their own model setting, default Haiku; Draft Commit Message with nothing staged covers all changes; the unsaved-tabs dialog defaults to Save All and Pull always asks. Questions the spec agents left open are recorded in the rows above and in each file's Decisions list; the specified default stands until the owner says otherwise.

Build phase: the specs were committed locally as 021d25f. Wave 1 (items 0, 1, 2, 3) started 2026-11-13, one agent per item in its own worktree; the Built column changes when an item is merged into local main with tsc, Vitest and Rust tests passing.

Resumed 2026-11-13: item 2 (stash) merged as b8660bf (on main: 610 Vitest + 132 Rust tests pass). Item 1 merged the same day (wave 1 complete). Wave 2 complete (items 4, 5, 9 merged). Wave 3 complete 2026-11-14 (items 6, 7 merged). Wave 4 (item 8) merged the same day: the build of items 0-9 is complete on local main (nothing pushed). Live pass started 2026-11-14 in four serial runs (A: items 0, 3 done; B: 1, 2 done; C: 4, 5, 7 done; D: 6, 8, 9 done); results per item in the Live column, open issues in the section below. Live pass finished 2026-11-14: 123 checks, 3 left failing (issues 1, 9 and 21; issue 14 is the failing half of a fourth), 17 bugs fixed as separate "Fix: …" commits; on main 1311 Vitest tests pass. It needed the installed Quarry closed, about 120 live checks collected from the build agents plus item 0's three verification-debt checks.

Build order (agents work in parallel inside a wave, each in its own worktree; waves are merged before the next starts because they share `GraphView.tsx`, `git.ts` and `git.rs`): wave 1 = items 0, 1, 2, 3; wave 2 = 4, 5, 9; wave 3 = 6, 7; wave 4 = 8 (audits every action, so it goes last); then the live pass.

## Open issues from the live pass

Found in the dev build on throwaway repos; not fixed because each needs the owner's decision or is larger than a small fix. Fixed ones are separate "Fix: …" commits.

1. **Git menu taller than the window** (883 px in an 816 px window, does not scroll): Push, Force Push…, Add Remote… and the Claude submenu cannot be reached with the mouse. Scrolling the top level would clip its submenus: needs a design decision (regroup into submenus, or scroll).
2. **Disabled buttons show no tooltip** (`.btn:disabled` turns pointer events off): fixed for Merge or Rebase and Skip (ace9f47); every other disabled `.btn` / `.icon-btn` (Commit, header icons, stash, Draft) still has none. A global fix changes hover and click-through everywhere.
3. **First click on a conflict-bar button is lost while Source Control floats (unpinned)**: the click closes the panel, the editor shifts, and Accept Current / Incoming is not pressed. A conflict stop opens that panel by itself, so this is the usual state.
4. Menus and dialogs are see-through (text behind them is readable).
5. The graph's commit menu is too narrow (220 px): "Create Branch Here (Don't Switch)…" and both Summarise entries are cut.
6. The macro recorder records the picker step (`git.mergeBranch`) as well as `git.mergeRef`.
7. Small: "Merge main into main…" shows (greyed) on the own-branch label; Stash comes before Stage Part of a File in the Git menu (planned order is the reverse); after Skip a further conflict shows the error toast rather than the notification CONFLICT-012.3 names; an extra "changed on disk and was reloaded" toast when the text is unchanged; at 280 px the Merge or Rebase button label is clipped.
8. For the owner to confirm: the wording of fix a06eb63 ("Commit Merge" + its note) for a merge whose resolution changes no file; reworded / squashed messages skip commit hooks (`--no-verify`, item 6).

9. **Compare toolbar below about 1000 px of editor width** (item 1): file labels shrink to nothing, the Side by side / Inline switch is squashed, the swap icon overlaps the count. Needs a layout decision (wrap, icons, overflow menu).
10. **Drop-stash offer wording after resolving with "Current"** (item 2): it still says the stash's changes "are now in your files"; for that file they are not, and Drop Stash would lose them (Keep Stash is the default).
11. A Source Control comparison keeps "(unsaved)" in its label after the file's tab is saved, until the row is clicked again.
12. Staging the last change near the end of a file still moves the view when the file becomes shorter than the scroll position.
13. Small: a UTF-16 file still gets bars that can only refuse; a staged rename's left label reads "new-name (HEAD)"; the graph heading counts stash rows as commits ("343 commits" for 340); every stash, pop or staging save adds a "changed on disk and was reloaded" toast.

14. **Double-click on a file in the graph's file lists does not open the file** (GRAPH-015.6, COMMITCMP-003.9, also an ordinary commit's file list): the first click's Compare tab takes the front; a very fast double-click opens the file plus two identical Compare tabs. Decision: delay the single click, or drop the double-click promise.
15. A graph tab whose repository Quarry no longer knows greys every label-menu entry with "The open folder is not in a git repository" (untrue), while the commit menu of the same tab still offers Switch, Cherry-pick and Reset.
16. The graph's details pane has no minimum height (112 px with its content cut when the search results are dragged tall).
17. Returning to a graph tab reloads from page 1, so the place in a long list is lost (follows the stories, but noticeable).
18. Git › Compare with Branch… uses the Source Control repository even when another repository's graph tab is in front.
19. A locally deleted tag that exists on the remote comes back at the next automatic remote check.
20. The lane scroll-bar thumb is only 4-5 px thick.

21. **A history edit in a repository with `commit.gpgsign` on and signing failing** (item 6, the most serious open issue): Reword of an older commit leaves the rebase stopped with raw git output, and Continue Rebase then says "The rebase is finished." although the message is unchanged (HISTORY-009.12 expects no rebase left in progress); Squash stops the same way (Abort restores everything); Reword of the tip fails cleanly but the typed message is lost. Decision: abort automatically when the message step fails, or show a dedicated message.
22. The commit box text carries across repositories (an undone commit's message, or typed text, is still in the box after another folder is opened).
23. Drag reorder in the Edit History list auto-scrolls only while the pointer moves.
24. Small: the tip-drop dialog mentions replay conflicts although nothing is replayed; the list's reword box opens with the caret before the first letter; "Large change: Claude saw…" is in the past tense before sending; a conflict stop in a repo with no remote opens the Add Remote form and pushes the commit box out of view; "Recorded 1 steps". The Git menu is now 952 px tall (issue 1).

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
