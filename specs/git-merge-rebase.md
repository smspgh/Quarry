---
area: Start a Merge or Rebase
prefix: MERGE
---

# Start a Merge or Rebase

Starting a merge of another branch or commit into the current branch, and starting a rebase of the current branch onto another branch or commit: from the commit graph's right-click menus, the Source Control panel, the Git menu and the command palette; and Force Push, the guarded way to replace the remote branch after pushed commits were rewritten (MERGE-009, also used by Edit History). What happens after a merge or rebase stops on a conflict (Abort, Skip, Continue Rebase, the conflict bars) is the existing flow in [git-conflicts.md](git-conflicts.md); this area only promises that a stop lands there. Roadmap: `GIT-ROADMAP.md` item 3. User documentation: `docs/git.md`.

This area is built in the first wave, so it also owns the things the later git specs share and refer back to: the graph's ref-label menu (MERGE-002), the purposes of the branch picker, the planned layout of the Git menu and of the graph's commit menu, and Force Push (MERGE-009). Each is written down once, below.

Decisions (taken where the roadmap left the choice open):

- **Owner decisions (2026-11-13).** (1) Pushed commits: warn, then offer Force Push. A rebase that would replay pushed commits warns in a danger dialog that names them, with Cancel as the default (MERGE-006); afterwards the status line offers "Force Push…" (`git push --force-with-lease`), which asks again (MERGE-009). (2) The unsaved-tabs question (Save All / Continue Without Saving / Cancel) is specified once, in SAFE-001 to SAFE-003, and arrives with that area; nothing in this area asks about unsaved tabs.
- **Cancel is the default button of every merge, rebase and force-push dialog.** Enter and Escape both cancel; the action needs a click (or Tab + Enter). This follows the roadmap ground rule "the safe button as the default" and is stricter than today's cherry-pick dialog, whose confirm button is the default. `choose()` in `src/lib/dialogs.ts` already takes a per-choice `default`, so the dialogs themselves need no change.
- **What is merged / rebased onto.** Right-clicking a commit that carries exactly one branch label other than the current branch acts on that branch by name (so the merge message reads "Merge branch 'feature' into main"). A commit with no such label, or with several, is used by its id; right-clicking one of its labels picks that branch or tag by name. A remote branch is used as it was last fetched: nothing is fetched and no local branch is created.
- **Ref-label menu (one menu, shared with BRANCH-001).** A right-click on a ref label in the graph (in a row, or in the details pane's Refs line) selects the commit and opens a menu for that ref instead of the commit's menu. The labels that open it are: a local branch label (the current branch's included), a remote branch label and a tag label. It is headed "Branch feature", "Remote branch origin/topic" or "Tag v1.2.0". The detached "HEAD" label and a "stash" label (STASH-010) have no label menu: a right-click on them opens their row's menu. This area gives the menu its first two entries, "Merge <ref> into <current>…" and "Rebase <current> onto <ref>…" (greyed out on the current branch's own label); BRANCH-001 later adds the housekeeping entries to the same menu around them. The entries are built by the pure `refMenu(label, ctx)` in `src/lib/gitRefs.ts`, created here and extended there.
- **Fast-forward choice.** The choice is offered only when it matters, which is when the current branch has no commits the other side lacks: the dialog then has "Fast-forward" (`--ff-only`) and "Create a Merge Commit" (`--no-ff`). When both sides have commits, a merge commit is the only outcome and there is one "Merge" button. There is no stored setting for the preference.
- **Nothing to do is said, not run.** When the current branch already contains the other side, git is not run and a notification says so. A rebase with nothing to replay is offered as a fast-forward.
- **Uncommitted changes to tracked files block both.** Merge and rebase refuse to start (git itself would allow some merges) so that Abort always restores exactly what was there. Untracked files do not block. There is no automatic stash, and the refusal does not offer to stash (Stash is built in the same wave; offering it there would be a later change). The refusal dialog "Commit or discard your changes first" (MERGE-008.1) is the one Edit History uses too (HISTORY-006.6).
- **Detached HEAD.** Merge is allowed and worded "into Here" / "the current commit (not on a branch)", like cherry-pick. Rebase is disabled: it moves a branch, and there is none.
- **"Already pushed"** means: reachable from any remote-tracking branch as last fetched (not only the branch's own upstream, so a branch with no upstream is still protected). Edit History uses the same definition and the same Rust helper, `pushed_commits` in `src-tauri/src/git.rs` (HISTORY-006). The warning replaces the ordinary rebase dialog (one dialog, never two) and is danger-styled; the rebase can still be run with "Rebase Anyway". The rebase itself pushes nothing; afterwards the status line offers "Force Push…" (MERGE-009).
- **Force Push** is always `--force-with-lease` against the remote branch as last fetched, never a bare `--force`. It exists only for the current branch and its upstream, it always asks first (danger dialog, Cancel default), and the plain Push never forces. After Quarry rewrote pushed commits, the status line stops advising "Pull first" (a pull would bring the old commits back) and offers "Force Push…" instead. Quarry remembers that it rewrote pushed commits per repository and branch, in memory only (nothing is written into `.git`); after a restart, or when the branch differs from its upstream for any other reason, the status line is the ordinary one and Force Push is reached from the Git menu or the palette.
- **A rebase does not keep merge commits** (plain `git rebase`); the dialog says so when the commits to replay include one.
- **After a conflict stop, Source Control is shown** (when it is not already), so the user started from the palette or the Git menu also lands on Merge Changes.
- **Panel entry point** is a "Merge or Rebase" button directly after the branch button, opening a two-entry menu; the badges beside the branch (the stopped-operation badge, and "Stash conflicts" of STASH-009) come after it. The same two commands are in the Git menu and the palette.
- **Branch picker.** There is one branch picker: palette mode `branch`, opened by `pickBranch(purpose)` in `src/lib/git.ts`. The purpose (kept in `useGit` as `branchPick`) sets the prompt, which rows are listed and which command a picked row runs. Only the `switch` purpose (GIT-007, today's behaviour) has the "Create branch" row and, later, the row menu of BRANCH-002; with any other purpose a typed name that matches no row gives "No matches" and Enter does nothing. Rows are local branches first, then remote branches (labelled "remote"), each group newest first, unless the purpose says otherwise. This area introduces the purpose with `merge` and `rebase`; the later specs add theirs to the same function and the same palette mode (no second picker and no second palette mode):

  | Purpose | Story | Rows | A picked row runs |
  | --- | --- | --- | --- |
  | `switch` | GIT-007 | every local and remote branch, the current one labelled "current"; a "Create branch" row for a new name | `git.checkoutTo` / `git.createBranch` |
  | `merge`, `rebase` | MERGE-003 | local and remote branches without the current branch | `git.mergeRef` / `git.rebaseOnto` |
  | `compare` | COMMITCMP-005 | local and remote branches, the current one included | `git.compareBranchPick` |
  | `summarise`, `summarise-base` | GITAI-009 | `summarise`: local branches (asked only on a detached HEAD); `summarise-base`: local and remote branches without the summarised one, the suggested base first | `git.summariseBranch` with the picked names |
  | `delete-branch` | BRANCH-003 | local branches without the current branch | `git.deleteBranch` |
  | `local-branch` | BRANCH-004, BRANCH-005, BRANCH-006 | every local branch, the current one first | `git.renameBranch` / `git.setUpstream` / `git.pushBranch` |
  | `remote-branch` | BRANCH-007 | remote branches only | `git.deleteRemoteBranch` |
  | `tag` | BRANCH-008, BRANCH-009 | tags only, newest first | `git.deleteTag` / `git.pushTag` |
  | `upstream` | BRANCH-005 | the remote branches one local branch can track, the one of the same name first, with a "Stop tracking" row | `git.setUpstream` |
  | `new-name` | BRANCH-004 | no list: the single row `Rename "a" to "b"` for the typed name | `git.renameBranch` |

- **Git menu (planned layout).** Several specs add to the Git menu of `src/components/MenuBar.tsx`. This is the one layout they all describe; each numbered line is a group between separators, "▸" marks a submenu, and an entry without a story id exists today:
  1. Show Source Control, Show Commit Graph, Refresh Git Status
  2. Compare with Last Commit (HEAD), Compare with Branch… (COMMITCMP-005), Show File History, Show / Hide Line Blame
  3. Next Change, Previous Change, Show Change at Cursor, Revert Change at Cursor
  4. Conflicts ▸ (today's entries; Open in Merge View of THREEWAY-001 would be added to it, deferred)
  5. Stage Current File, Unstage Current File, Stage Part of a File ▸ (STAGE-008), Stash ▸ (STASH-011)
  6. Switch Branch…, Merge Branch…, Rebase onto Branch… (MERGE-003), Branches and Tags ▸ (BRANCH-002), Edit History ▸ (HISTORY-002, HISTORY-007)
  7. Fetch, Pull, Push, Force Push (Replace Remote Branch)… (MERGE-009), Add Remote…
  8. Claude ▸ (GITAI-001; the whole submenu is left out while Claude Code is switched off)
- **Graph commit menu (planned layout).** The right-click menu of a commit row gets entries from several specs, in this order, each line a group: (1) Copy Commit Id, Copy Message; (2) Switch to …, Create Branch Here…, Create Branch Here (Don't Switch)…, Create Tag Here…, Check Out This Commit…; (3) the compare entries of COMMITCMP-001, COMMITCMP-004 and COMMITCMP-005; (4) Cherry-pick…, Revert This Commit… and, from this area, the merge and rebase entries; (5) the three Reset entries; (6) the edit-history entries of HISTORY-001; (7) the Summarise … with Claude entries of GITAI-009. A stash row (STASH-010) and the uncommitted-changes row (GRAPH-015) never get any of these.
- **One sentence for "something is in progress".** "Finish or abort the rebase first" (or merge, cherry-pick, revert, patch series) comes from the pure `finishFirst(operation)` in `src/lib/gitStatus.ts`, built on `operationWords`; Stash (STASH-003) and Edit History (HISTORY-001) use the same helper. As a tooltip it has no full stop; as a notification it ends with one.

## MERGE-001: Merge and rebase from a commit's right-click menu in the graph

- Status: planned
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — two new entries in the commit menu, directly after Cherry-pick / Revert and before the Reset entries (the planned order of the whole menu is in this file's Decisions), their disabled states and tooltips, calls `startMerge` / `startRebase`
  - `src/lib/gitMerge.ts` — new, pure: `targetOf(commit, branch)` (one other branch label → that branch, else the commit id), `entryLabels`, `startBlocked` (why an entry is disabled)
  - `src/lib/git.ts` — new `startMerge(root, target)`, `startRebase(root, target)`
  - `src/lib/gitGraph.ts` — `refLabels` (which labels a commit carries)
- Tests: `src/__tests__/gitMerge.test.ts`, `src/__tests__/graphView.test.tsx`
- Docs: `docs/git.md`

**As a** developer looking at the commit graph
**I want** to merge the commit I am pointing at into my branch, or rebase my branch onto it
**So that** I can start from the picture of the history instead of typing branch names in a terminal

```gherkin
Scenario: MERGE-001.1 The entries name the current branch
  Given I am on "main" and commit 18bc71d carries no branch label
  When I right-click commit 18bc71d
  Then the menu has "Merge 18bc71d into main…" and "Rebase main onto This…" below Cherry-pick and Revert
  And nothing is merged or rebased until I confirm a dialog

Scenario: MERGE-001.2 A commit with one branch label is treated as that branch
  Given I am on "main" and commit 18bc71d carries only the label "feature"
  When I right-click commit 18bc71d
  Then the entries read "Merge feature into main…" and "Rebase main onto feature…"
  And choosing the merge entry opens the dialog "Merge feature into main?"

Scenario: MERGE-001.3 A commit with several branch labels is used by its id
  Given I am on "main" and commit 18bc71d carries the labels "feature" and "origin/feature"
  When I right-click the commit's row, not one of its labels
  Then the entries read "Merge 18bc71d into main…" and "Rebase main onto This…"

Scenario: MERGE-001.4 The commit I am on
  Given I am on "main" at commit 9f2c0aa
  When I right-click commit 9f2c0aa
  Then both entries are greyed out with the tooltip "This is the commit you are on"

Scenario: MERGE-001.5 Detached HEAD
  Given HEAD is detached at commit 1a2b3c4
  When I right-click commit 18bc71d
  Then the merge entry reads "Merge 18bc71d into Here…" and is enabled
  And the rebase entry reads "Rebase onto This…" and is greyed out with the tooltip "Switch to a branch first: a rebase moves a branch"

Scenario: MERGE-001.6 Greyed out while something else is going on
  Given a cherry-pick is stopped on a conflict
  When I right-click a commit
  Then both entries are greyed out with the tooltip "Finish or abort the cherry-pick first"
  And while another git action is running they are greyed out too

Scenario: MERGE-001.7 Starting from the graph refreshes the graph
  Given I am on "main" and "feature" has 3 commits that "main" lacks
  When I choose "Merge feature into main…" and confirm
  Then the graph reloads and shows the result with the "main" label on the new top commit
```

## MERGE-002: Merge and rebase from a branch or tag label in the graph

- Status: planned
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `RefBadge` gets its own right-click, in the row list and in the details pane (selects the commit, stops the row's menu); new `RefMenu` state beside `Menu`, rendered with `GraphMenu` and headed by the kind and name of the ref. BRANCH-001 adds its entries to this same menu
  - `src/lib/gitRefs.ts` — new, pure: `refMenu(label, ctx)` (which labels have a menu, its heading and its entries; here only the merge and rebase entries)
  - `src/lib/gitMerge.ts` — `entryLabels` for a named branch or tag, `startBlocked`
  - `src/lib/gitGraph.ts` — `refLabels` / `RefLabel` (the kinds the menu is built from)
  - `src/lib/git.ts` — `startMerge`, `startRebase`
- Tests: `src/__tests__/gitRefs.test.ts`, `src/__tests__/gitMerge.test.ts`, `src/__tests__/graphView.test.tsx`
- Docs: `docs/git.md`

**As a** developer looking at a commit that several branches point at
**I want** to right-click the label of the branch I mean
**So that** the merge or rebase names that branch and not just a commit id

```gherkin
Scenario: MERGE-002.1 The label menu of a local branch
  Given I am on "main" and a commit carries the labels "feature" and "origin/feature"
  When I right-click the label "feature"
  Then the commit is selected
  And a menu headed "Branch feature" opens with "Merge feature into main…" and "Rebase main onto feature…"
  And the commit's own menu does not open

Scenario: MERGE-002.2 A remote branch label
  Given I am on "main"
  When I right-click the label "origin/topic"
  Then a menu headed "Remote branch origin/topic" opens with "Merge origin/topic into main…" and "Rebase main onto origin/topic…"
  When I choose "Merge origin/topic into main…"
  Then the dialog is "Merge origin/topic into main?" and says "origin/topic is used as it was last fetched"
  And after I confirm, no local branch "topic" has been created and nothing was fetched

Scenario: MERGE-002.3 A tag label
  Given I am on "main" and a commit carries the tag "v1.2.0"
  When I right-click the label "v1.2.0"
  Then a menu headed "Tag v1.2.0" opens with "Merge v1.2.0 into main…" and "Rebase main onto v1.2.0…"
  And choosing the merge entry opens the dialog "Merge v1.2.0 into main?", which says the commit the tag points at is merged

Scenario: MERGE-002.4 The label of the branch I am on
  Given I am on "main"
  When I right-click the label "main"
  Then a menu headed "Branch main" opens
  And its merge and rebase entries are greyed out with the tooltip "This is the branch you are on"

Scenario: MERGE-002.5 Labels without a label menu
  Given HEAD is detached on a commit that shows the label "HEAD"
  When I right-click the label "HEAD"
  Then the commit's menu opens as for a right-click on the row
  And a right-click on the "stash" label of a stash row opens that stash's menu, not a label menu

Scenario: MERGE-002.6 Labels in the details pane
  Given a commit with the label "feature" is selected and the details pane lists it under Refs
  When I right-click "feature" in the details pane
  Then the same "Branch feature" menu opens

Scenario: MERGE-002.7 Closing the label menu
  Given the label menu is open
  When I press Escape or click elsewhere
  Then it closes and nothing is merged or rebased

Scenario: MERGE-002.8 Same disabled states as the commit menu
  Given a rebase is stopped on a conflict
  When I right-click the label "feature"
  Then both entries are greyed out with the tooltip "Finish or abort the rebase first"
  And with a detached HEAD the rebase entry is greyed out with the tooltip "Switch to a branch first: a rebase moves a branch"
```

## MERGE-003: Merge Branch… and Rebase onto Branch… from the panel, the Git menu and the palette

- Status: planned
- Commands: `git.mergeBranch`, `git.rebaseBranch`, `git.mergeRef`, `git.rebaseOnto`
- Files:
  - `src/lib/gitCommands.ts` — `git.mergeBranch` ("Merge Branch…"), `git.rebaseBranch` ("Rebase onto Branch…") with `enabled()`; hidden `git.mergeRef` / `git.rebaseOnto` taking the picked name (like `git.checkoutTo`), which run the same guards
  - `src/lib/git.ts` — `pickBranch(purpose)`: today's `pickBranch()` gains the purpose (`"switch"` by default, here also `"merge"` and `"rebase"`), kept in `useGit` as `branchPick`; later specs add their purposes to it (table in this file's Decisions); `startMerge`, `startRebase`
  - `src/components/CommandPalette.tsx` — `mode === "branch"`: prompt, rows and the command of a picked row from the purpose; no current branch and no "Create branch" row when merging / rebasing, picked row runs `git.mergeRef` / `git.rebaseOnto`
  - `src/components/panels/GitPanel.tsx` — "Merge or Rebase" button directly after the branch button (before the operation / "Stash conflicts" badge) with a two-entry menu, disabled states
  - `src/components/MenuBar.tsx` — the two commands in the Git menu directly after Switch Branch… (group 6 of the planned layout in this file's Decisions)
  - `src/lib/gitMerge.ts` — `startBlocked` (shared reason text for the disabled states)
  - `src/lib/gitStatus.ts` — new pure `finishFirst(operation)` ("Finish or abort the merge first"), on `operationWords`
- Tests: `src/__tests__/gitMerge.test.ts`, `src/__tests__/gitPanel.test.tsx`
- Docs: `docs/git.md`

**As a** developer who knows which branch they want
**I want** Merge Branch… and Rebase onto Branch… in the Source Control panel, the Git menu and the command palette
**So that** I can start a merge or rebase without opening the graph

```gherkin
Scenario: MERGE-003.1 Merge Branch… opens the branch list
  Given a repository on "main" with local branch "feature" and remote branch "origin/topic"
  When I run Git › Merge Branch… from the menu or the command palette
  Then a list opens with the prompt "Merge which branch into main?"
  And it lists "feature" and "origin/topic" (labelled "remote"), local branches first, each group newest first
  And "main" is not in the list and there is no "Create branch" row

Scenario: MERGE-003.2 Picking a branch asks before merging
  Given the merge list is open
  When I pick "feature"
  Then the dialog "Merge feature into main?" opens
  And nothing has been merged yet

Scenario: MERGE-003.3 Rebase onto Branch…
  Given a repository on "main" with local branch "feature"
  When I run Git › Rebase onto Branch…
  Then a list opens with the prompt "Rebase main onto which branch?"
  And picking "feature" opens the dialog "Rebase main onto feature?"

Scenario: MERGE-003.4 Typing a name that is not a branch
  Given the merge list is open
  When I type "no-such-branch"
  Then the list says "No matches" and Enter does nothing

Scenario: MERGE-003.5 Closing the list
  Given the merge list is open
  When I press Escape
  Then the list closes and nothing is merged

Scenario: MERGE-003.6 From the Source Control panel
  Given the Source Control panel shows a repository on "main"
  When I click the "Merge or Rebase" button beside the branch button
  Then a menu offers "Merge Branch…" and "Rebase onto Branch…"
  And they open the same lists as the Git menu commands

Scenario: MERGE-003.7 Only one other branch is needed
  Given a repository whose only branch is "main" and which has no remote branches
  When I run Git › Merge Branch…
  Then the list opens empty and says "No matches"

Scenario: MERGE-003.8 Greyed out without a repository
  Given no repository is known
  When I open the Git menu
  Then Merge Branch… and Rebase onto Branch… are greyed out
  And in the command palette they are greyed out too

Scenario: MERGE-003.9 Greyed out during a stopped operation or while git is busy
  Given a merge is stopped on a conflict
  When I look at the Git menu and the Source Control panel
  Then Merge Branch… and Rebase onto Branch… are greyed out
  And the panel's "Merge or Rebase" button is disabled with the tooltip "Finish or abort the merge first"
  And while another git action is running the button is disabled as well

Scenario: MERGE-003.10 Rebase needs a branch
  Given HEAD is detached at commit 1a2b3c4
  When I open the Git menu
  Then Rebase onto Branch… is greyed out
  And Merge Branch… is enabled and its list has the prompt "Merge which branch into the current commit?"
```

## MERGE-004: Merge asks first, then merges

- Status: planned
- Commands: `git.mergeRef`
- Files:
  - `src/lib/gitMerge.ts` — `mergeConfirm(preview, target, branch)` (title, text, buttons; Cancel default), `mergeDone` (notifications)
  - `src/lib/git.ts` — `startMerge` (preview → dialog via `choose()` → run with busy label "Merging…" → notification, `checkExternalChanges`)
  - `src/lib/dialogs.ts` — `choose()` (unchanged: three choices, `default: true` on Cancel)
  - `src-tauri/src/git.rs` — new `merge_preview` / `git_merge_preview` (commits on each side: `rev-list --count --left-right HEAD...<ref>`), new `start_merge` / `git_merge` (`merge --no-edit`, with `--ff-only` or `--no-ff` on request; `GIT_EDITOR=true`; ref validated)
  - `src/lib/gitApi.ts` — `git.mergePreview`, `git.merge`, `GitMergePreview`, `GitMergeMode`
- Tests: `src/__tests__/gitMerge.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer bringing another branch's work into mine
**I want** to be told in plain words what the merge will do, and to choose between a fast-forward and a merge commit when both are possible
**So that** my branch never moves without my say and the history looks the way I intend

```gherkin
Scenario: MERGE-004.1 Both branches have commits: one way to merge
  Given I am on "main", "feature" has 3 commits that "main" lacks and "main" has 2 that "feature" lacks
  When I start a merge of "feature"
  Then a dialog "Merge feature into main?" says the 3 commits of feature are brought into main and joined with a merge commit, that nothing is rewritten, and that a conflict stops the merge and shows the files in Source Control
  And its buttons are "Merge" and "Cancel"

Scenario: MERGE-004.2 Cancel is the default
  Given the dialog "Merge feature into main?" is open
  When I press Enter or Escape
  Then the dialog closes, git is not run, and the branch and my files are unchanged

Scenario: MERGE-004.3 A clean merge
  Given the dialog "Merge feature into main?" is open and the changes do not conflict
  When I click "Merge"
  Then "Merging…" shows beside the branch while it runs
  And a merge commit "Merge branch 'feature' into main" is on "main" without my being asked for a message
  And a notification says "Merged feature into main"
  And open tabs whose files changed on disk are re-checked

Scenario: MERGE-004.4 A fast-forward is possible: I choose
  Given I am on "main", "feature" has 3 commits that "main" lacks and "main" has none that "feature" lacks
  When I start a merge of "feature"
  Then the dialog says main has no commits of its own, so it can simply move forward by 3 commits, or a merge commit can record that feature was a separate branch
  And its buttons are "Fast-forward", "Create a Merge Commit" and "Cancel", with "Cancel" the default

Scenario: MERGE-004.5 Fast-forward
  Given the fast-forward dialog for "feature" is open
  When I click "Fast-forward"
  Then "main" points at the same commit as "feature" and no merge commit exists
  And a notification says "main moved forward to feature (3 commits)"

Scenario: MERGE-004.6 Always a merge commit
  Given the fast-forward dialog for "feature" is open
  When I click "Create a Merge Commit"
  Then a merge commit "Merge branch 'feature' into main" is on "main" with "feature" as its second parent
  And a notification says "Merged feature into main"

Scenario: MERGE-004.7 Already up to date
  Given "main" already contains every commit of "feature"
  When I start a merge of "feature"
  Then no dialog opens and git is not run
  And a notification says "main already contains feature: nothing to merge."

Scenario: MERGE-004.8 Merging a commit by its id
  Given I am on "main" and commit 18bc71d carries no branch label
  When I choose "Merge 18bc71d into main…" in the graph and click "Merge"
  Then the dialog was titled "Merge 18bc71d into main?" and quoted the commit's message
  And a notification says "Merged 18bc71d into main"

Scenario: MERGE-004.9 Merging on a detached HEAD
  Given HEAD is detached at commit 1a2b3c4
  When I start a merge of "feature"
  Then the dialog is titled "Merge feature into the current commit?" and says I am not on a branch, so the result belongs to no branch until I create one

Scenario: MERGE-004.10 What a merge never does
  Given I am on "main" tracking "origin/main"
  When I merge "feature" and it finishes
  Then nothing was fetched or pushed and "feature" itself is unchanged
  And the status line counts the new commits as commits to push
```

## MERGE-005: Rebase asks first, then rebases

- Status: planned
- Commands: `git.rebaseOnto`
- Files:
  - `src/lib/gitMerge.ts` — `rebaseConfirm(preview, target, branch)` (title, text, buttons; Cancel default; merge-commit note), `rebaseDone`
  - `src/lib/git.ts` — `startRebase` (preview → dialog → run with busy label "Rebasing…" → notification, `checkExternalChanges`)
  - `src-tauri/src/git.rs` — `merge_preview` (also: how many of the commits to replay are merge commits), new `start_rebase` / `git_rebase` (`rebase <ref>`, `GIT_EDITOR=true`, refused on a detached HEAD)
  - `src/lib/gitApi.ts` — `git.rebase`
- Tests: `src/__tests__/gitMerge.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer who wants their commits to sit on top of another branch
**I want** to be told which commits will be replayed and that they get new ids before it happens
**So that** I rewrite my branch's history knowingly

```gherkin
Scenario: MERGE-005.1 The dialog says what will be replayed
  Given I am on "main" with 2 commits that "feature" lacks, none of them pushed, and "feature" has 3 that "main" lacks
  When I start a rebase onto "feature"
  Then a dialog "Rebase main onto feature?" says the 2 commits of main that feature does not have are replayed on top of feature one by one and get new ids, and that a conflict stops the rebase and shows the files in Source Control
  And its buttons are "Rebase" and "Cancel"

Scenario: MERGE-005.2 Cancel is the default
  Given the dialog "Rebase main onto feature?" is open
  When I press Enter or Escape
  Then the dialog closes, git is not run, and the branch and my files are unchanged

Scenario: MERGE-005.3 A clean rebase
  Given the dialog "Rebase main onto feature?" is open and the commits do not conflict
  When I click "Rebase"
  Then "Rebasing…" shows beside the branch while it runs
  And "main" consists of the commits of "feature" followed by my 2 commits, each with its own message and no editor opened
  And a notification says "Rebased main onto feature (2 commits replayed)"
  And open tabs whose files changed on disk are re-checked

Scenario: MERGE-005.4 Nothing to rebase
  Given "main" already contains every commit of "feature"
  When I start a rebase onto "feature"
  Then no dialog opens and git is not run
  And a notification says "main is already based on feature: nothing to rebase."

Scenario: MERGE-005.5 No commits of my own: a fast-forward
  Given "main" has no commits that "feature" lacks and "feature" has 3 that "main" lacks
  When I start a rebase onto "feature"
  Then the dialog says main has no commits of its own to replay, so it simply moves forward by 3 commits
  And its buttons are "Fast-forward" and "Cancel", with "Cancel" the default
  And after "Fast-forward" a notification says "main moved forward to feature (3 commits)"

Scenario: MERGE-005.6 Merge commits are not kept
  Given 1 of the 4 commits to replay is a merge commit
  When I start a rebase onto "feature"
  Then the dialog adds "1 of them is a merge commit; a rebase does not keep it: the changes it brought in are replayed as ordinary commits."

Scenario: MERGE-005.7 Rebasing onto a commit
  Given I am on "main" and commit 18bc71d carries no branch label
  When I choose "Rebase main onto This…" in the graph
  Then the dialog is titled "Rebase main onto 18bc71d?" and quotes the commit's message

Scenario: MERGE-005.8 What a rebase never does
  Given I am on "main" tracking "origin/main"
  When I rebase onto "feature" and it finishes
  Then nothing was fetched or pushed, and "feature" itself is unchanged
  And uncommitted work was never stashed or restored behind my back
```

## MERGE-006: Rebase warns when commits to replay are already pushed

- Status: planned
- Commands: `git.rebaseOnto`
- Files:
  - `src/lib/gitMerge.ts` — `rebaseConfirm` (danger variant: counts, the remote branch named, "Rebase Anyway")
  - `src/lib/git.ts` — `startRebase` (uses the preview's pushed count; one dialog, never two; after "Rebase Anyway" finished it sets the `rewrotePushed` marker of MERGE-009)
  - `src-tauri/src/git.rs` — new `pushed_commits(root, range)`: the commits of a range that are reachable from any remote-tracking branch (`rev-list <range>` minus `rev-list <range> --not --remotes`), and the first remote branch that holds them. It is the one "already pushed" helper: `merge_preview` uses it for `<ref>..HEAD` (`pushed`, `pushedOn`), and `history_range` of HISTORY-006 uses it too. Not `unpushed` / `git_unpushed`, which only looks at the upstream and returns nothing without one
  - `src/lib/gitApi.ts` — `GitMergePreview.pushed`, `pushedOn`
- Tests: `src/__tests__/gitMerge.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer whose branch is already on a remote
**I want** a loud warning before a rebase rewrites commits other people may have
**So that** I do not break a shared branch by accident

```gherkin
Scenario: MERGE-006.1 The warning
  Given I am on "main" tracking "origin/main", with 5 commits that "feature" lacks, 3 of them already on "origin/main"
  When I start a rebase onto "feature"
  Then a dialog "Rebase commits that are already pushed?" says 3 of the 5 commits to replay are already on origin/main and lists those 3 by short id and message
  And it says that rebasing gives them new ids so main and origin/main will no longer agree, that a normal Push will be refused and Quarry will then offer Force Push, and that anyone who pulled them will have to repair their copy
  And it suggests merging feature into main instead, which rewrites nothing
  And its buttons are "Rebase Anyway", styled as dangerous, and "Cancel", with "Cancel" the default

Scenario: MERGE-006.2 Cancel
  Given the dialog "Rebase commits that are already pushed?" is open
  When I press Enter, press Escape or click "Cancel"
  Then git is not run and "main" still has its 5 original commits

Scenario: MERGE-006.3 Rebase anyway
  Given the dialog "Rebase commits that are already pushed?" is open
  When I click "Rebase Anyway"
  Then the rebase runs as usual and a notification says "Rebased main onto feature (5 commits replayed)"
  And the rebase itself pushes nothing, with or without force
  And the status line then offers "Force Push…" (MERGE-009.1)

Scenario: MERGE-006.4 Nothing pushed: the ordinary dialog
  Given none of the 5 commits to replay is on any remote branch
  When I start a rebase onto "feature"
  Then the ordinary dialog "Rebase main onto feature?" opens, with no warning

Scenario: MERGE-006.5 Pushed somewhere other than the upstream
  Given "main" has no upstream but 2 of its commits to replay are on "backup/main"
  When I start a rebase onto "feature"
  Then the warning dialog opens and names "backup/main"
  And after "Rebase Anyway" the status line does not offer "Force Push…", because "main" has no upstream to replace

Scenario: MERGE-006.6 Every entry point gets the warning
  Given 3 of the commits to replay are already on "origin/main"
  When I start the rebase from the graph's commit menu, a branch label's menu, the panel's "Merge or Rebase" button, the Git menu or the command palette
  Then the warning dialog opens each time before git is run

Scenario: MERGE-006.7 A fast-forward rewrites nothing
  Given "main" has no commits that "feature" lacks and its commits are on "origin/main"
  When I start a rebase onto "feature"
  Then the fast-forward dialog opens, with no warning about pushed commits
```

## MERGE-007: A merge or rebase that stops on a conflict

- Status: planned
- Commands: none
- Files:
  - `src/lib/git.ts` — `startMerge` / `startRebase` failure path (error via `gitErrorText`, status refresh, `showPanel("git")`, `checkExternalChanges`), `abortOperation`, `continueOperation`
  - `src/lib/gitStatus.ts` — `gitErrorText` ("Stopped on a conflict…"), `operationWords` (merge / rebase wording, unchanged)
  - `src/components/panels/GitPanel.tsx` — operation badge, Skip / Abort, prefilled message, Continue Rebase (existing; must show for an operation Quarry started)
  - `src/components/GraphView.tsx` — stopped-operation strip (existing)
  - `src/lib/panels.ts` — `showPanel`, `isPanelShown`
  - `src-tauri/src/git.rs` — `start_merge` / `start_rebase` return git's output on a stop; `operation`, `operation_message`, `operation_step`
- Tests: `src-tauri/src/git.rs`, `src/__tests__/gitMerge.test.ts`
- Docs: `docs/git.md`

**As a** developer whose merge or rebase hit a conflict
**I want** to land in the same resolve / abort / continue flow as after a pull or cherry-pick
**So that** a merge or rebase I started in Quarry can also be finished or undone in Quarry

```gherkin
Scenario: MERGE-007.1 A merge stops
  Given "feature" and "main" both changed line 4 of notes.txt
  When I merge "feature" into "main" and confirm
  Then an error says "Stopped on a conflict. Resolve the files under Merge Changes in Source Control and commit, or press Abort to go back." followed by git's CONFLICT line for notes.txt
  And the Source Control panel is showing, with notes.txt under Merge Changes and the badge "Merging" with an "Abort" button and no "Skip" button
  And no "Merged feature into main" notification appears

Scenario: MERGE-007.2 Finishing the merge
  Given the merge of "feature" is stopped and I have resolved notes.txt and marked it resolved
  When I look at the commit box
  Then the message box holds "Merge branch 'feature' into main"
  And clicking the Commit button creates the merge commit and the "Merging" badge goes away

Scenario: MERGE-007.3 Aborting the merge
  Given the merge of "feature" is stopped on a conflict
  When I click "Abort" and confirm with "Abort Merge"
  Then "main" and my files are exactly as before the merge and Merge Changes is empty

Scenario: MERGE-007.4 A rebase stops
  Given I am on "main" with 2 commits to replay and the first conflicts with "feature" in notes.txt
  When I rebase "main" onto "feature" and confirm
  Then the error "Stopped on a conflict. …" is shown and the Source Control panel is showing
  And the badge reads "Rebasing 1 of 2", with "Skip" and "Abort" buttons
  And the main button reads "Resolve 1 Conflict First"
  And the conflict bars in notes.txt say "Rebasing: Current is the branch you are rebasing onto, Incoming is your own commit."

Scenario: MERGE-007.5 Continuing the rebase
  Given the rebase is stopped and I have resolved notes.txt and marked it resolved
  When I click "Continue Rebase"
  Then the second commit is replayed and a notification says "The rebase is finished."
  And "main" consists of the commits of "feature" followed by my 2 commits

Scenario: MERGE-007.6 Aborting the rebase
  Given the rebase onto "feature" is stopped on a conflict
  When I click "Abort" and confirm with "Abort Rebase"
  Then I am on "main" with its 2 original commits, ids unchanged, and my files as before

Scenario: MERGE-007.7 The graph shows the stop
  Given the graph tab is open
  When a merge I started from it stops on a conflict
  Then the strip "The merge stopped part-way: 1 file has conflicts. Resolve them in Source Control and commit, or abort to go back to how things were." appears with an "Abort" button

Scenario: MERGE-007.8 A conflicted file that is open
  Given notes.txt is open in a tab without unsaved changes
  When the merge stops with a conflict in notes.txt
  Then the tab reloads from disk and shows the conflict with its Accept Current / Incoming / Both bar

Scenario: MERGE-007.9 No second operation on top
  Given a merge is stopped on a conflict
  When I look for a way to start another merge or a rebase
  Then every merge and rebase entry is greyed out until the merge is committed or aborted
```

## MERGE-008: Refuse to start when it is not safe

- Status: planned
- Commands: `git.mergeBranch`, `git.rebaseBranch`, `git.mergeRef`, `git.rebaseOnto`
- Files:
  - `src/lib/gitMerge.ts` — `startBlocked(repo, kind)` (operation in progress, detached HEAD for rebase, no commits yet, uncommitted tracked changes) and its wording; `dirtyRefusal(kind, count)` (the "Commit or discard your changes first" dialog, shared with HISTORY-006.6)
  - `src/lib/gitStatus.ts` — `finishFirst(operation)`
  - `src/lib/git.ts` — `startMerge` / `startRebase` call `startBlocked` on a fresh status before the preview (covers every entry point, including the hidden commands and recorded macros); errors through `gitErrorText`
  - `src/lib/gitCommands.ts` — `enabled()` of the four commands
  - `src/lib/dialogs.ts` — `choose()` for the "uncommitted changes" refusal with its Show Source Control button
  - `src-tauri/src/git.rs` — `start_merge` / `start_rebase` refuse again on their side (operation in progress, changed tracked files, detached HEAD for rebase)
- Tests: `src/__tests__/gitMerge.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer with work in progress
**I want** a merge or rebase to refuse to start when it could lose or tangle that work, and to tell me the way out
**So that** I can always get back to exactly where I was

```gherkin
Scenario: MERGE-008.1 Uncommitted changes block a merge
  Given I am on "main" with 3 uncommitted changes to tracked files
  When I start a merge of "feature" from any entry point
  Then a dialog "Commit or discard your changes first" says there are 3 uncommitted changes and that a merge is only started from a clean state so that Abort can bring everything back
  And its buttons are "Show Source Control" and "Close", with "Close" the default
  And git is not run

Scenario: MERGE-008.2 Uncommitted changes block a rebase
  Given I am on "main" with 1 staged change
  When I start a rebase onto "feature"
  Then the same dialog opens, worded for a rebase, and git is not run
  And my staged change is still staged

Scenario: MERGE-008.3 Untracked files do not block
  Given my only change is the untracked file scratch.txt, which "feature" does not contain
  When I start a merge of "feature"
  Then the ordinary dialog "Merge feature into main?" opens
  And after the merge scratch.txt is still there, untracked

Scenario: MERGE-008.4 An untracked file in the way
  Given the untracked file notes.txt exists and "feature" adds a file notes.txt
  When I confirm the merge of "feature"
  Then an error shows git's message naming notes.txt, without "hint:" lines
  And "main" and my files are unchanged and no operation is in progress

Scenario: MERGE-008.5 An operation is already in progress
  Given a rebase is stopped on a conflict
  When I run the hidden merge command from a recorded macro
  Then a notification says "Finish or abort the rebase first." and git is not run

Scenario: MERGE-008.6 Rebase on a detached HEAD
  Given HEAD is detached at commit 1a2b3c4
  When I run the hidden rebase command from a recorded macro
  Then a notification says "Switch to a branch first: a rebase moves a branch." and git is not run

Scenario: MERGE-008.7 A repository with no commits yet
  Given a repository in which nothing has been committed
  When I open the Git menu
  Then Merge Branch… and Rebase onto Branch… are greyed out

Scenario: MERGE-008.8 Histories that have nothing in common
  Given "imported" shares no commit with "main"
  When I confirm the merge of "imported"
  Then an error says git refuses to merge unrelated histories
  And "main" and my files are unchanged and no operation is in progress

Scenario: MERGE-008.9 The branch went away
  Given the branch list was opened and "feature" was then deleted outside Quarry
  When I pick "feature"
  Then an error says "feature" is not a branch or commit in this repository and no dialog offers to merge it

Scenario: MERGE-008.10 Things changed while the dialog was open
  Given the dialog offered "Fast-forward" and a commit was then made on "main" outside Quarry
  When I click "Fast-forward"
  Then git refuses, an error shows its message, and no merge commit was created instead

Scenario: MERGE-008.11 One action at a time
  Given a pull is running
  When I look at the graph menus, the panel and the Git menu
  Then every merge and rebase entry is greyed out until it ends
```

## MERGE-009: Force Push after pushed commits were rewritten

- Status: planned
- Commands: `git.forcePush`
- Files:
  - `src/lib/gitCommands.ts` — `git.forcePush` ("Force Push (Replace Remote Branch)…", enabled on a branch that has an upstream, with no operation stopped and git not busy)
  - `src/lib/git.ts` — new `forcePush(root)` (fresh status, asks, then `remote(root, "push-force")`, notification); `rewrotePushed` per repository and branch in `useGit` (in memory only): set by `startRebase` after "Rebase Anyway" finished (also when it finished through Continue Rebase), cleared by a successful force push, an Abort, a branch switch, or when the upstream no longer has commits the branch lacks. HISTORY-011 sets the same marker for history edits
  - `src/lib/gitMerge.ts` — `forcePushConfirm(branch, upstream, lost)` (danger dialog: the commits that are only on the remote, up to 12 lines then "and N more"; Cancel default), `forcePushDone`
  - `src/lib/gitStatus.ts` — `syncLine` gains the rewritten case ("… was rewritten: … still has the N old commits", no "Pull first")
  - `src/components/panels/GitPanel.tsx` — `SyncStatus`: "Force Push…" as the action of the rewritten case, in place of Pull (Merge) / Pull (Rebase)
  - `src/components/MenuBar.tsx` — Git menu item after Push
  - `src/lib/gitApi.ts` — `GitRemoteOp` gains `"push-force"`
  - `src-tauri/src/git.rs` — `remote_op` `"push-force"` = `push --force-with-lease=<branch>:<upstream tip as last fetched> <remote> <branch>:<upstream branch>` (never a bare `--force`, never another branch); `pushed_commits` (the shared "already pushed" helper, see MERGE-006)
- Tests: `src/__tests__/gitMerge.test.ts`, `src/__tests__/gitRemote.test.ts`, `src/__tests__/gitPanel.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer who knowingly rewrote commits that were already pushed
**I want** a guarded way to replace the remote branch with my rewritten one
**So that** I am not left with only Pull, which would bring the old commits back

```gherkin
Scenario: MERGE-009.1 The status line offers Force Push after the rewrite
  Given I am on "main" tracking "origin/main" and I confirmed "Rebase Anyway" for 5 commits, 3 of them on "origin/main"
  When the rebase has finished
  Then the Source Control status line shows a warning "main was rewritten: origin/main still has the 3 old commits. Force Push replaces them with yours."
  And its only action is "Force Push…"
  And it does not say "Pull first, then push" and offers no "Pull (Merge)" or "Pull (Rebase)" button
  And nothing has been pushed

Scenario: MERGE-009.2 Force Push asks on its own
  Given the status line offers "Force Push…"
  When I click it, choose Git › Force Push (Replace Remote Branch)… or run "Git: Force Push (Replace Remote Branch)…" from the command palette
  Then a danger dialog "Replace origin/main with your main?" says the 3 commits that are only on origin/main will be removed from it, lists them by short id and message, and says anyone who pulled them will have to repair their copy
  And its buttons are "Force Push", styled as dangerous, and "Cancel", with "Cancel" the default
  And nothing is sent to the remote yet

Scenario: MERGE-009.3 Cancel
  Given the dialog "Replace origin/main with your main?" is open
  When I press Enter, press Escape or click "Cancel"
  Then nothing is pushed and the status line still offers "Force Push…"

Scenario: MERGE-009.4 Force Push
  Given the dialog "Replace origin/main with your main?" is open
  When I click "Force Push"
  Then "Pushing…" shows beside the branch while it runs
  And "origin/main" points at my newest commit and the status line says everything matches origin/main
  And a notification says "Replaced origin/main with your main."

Scenario: MERGE-009.5 Someone pushed in the meantime
  Given a colleague pushed a new commit to "origin/main" after my last fetch
  When I confirm the force push
  Then it is refused and their commit is still on the remote
  And an error says "origin/main has commits you have not fetched. Fetch and look at them first."

Scenario: MERGE-009.6 A long list is shortened
  Given 20 commits are only on "origin/main"
  When the force-push dialog opens
  Then it lists the first 12 and ends with "and 8 more"

Scenario: MERGE-009.7 The plain Push never forces
  Given the status line offers "Force Push…"
  When I click the panel's Push button or run Git › Push
  Then the push is refused as today and nothing on the remote is replaced

Scenario: MERGE-009.8 Not offered when nothing pushed was rewritten
  Given I rebased "main" and none of the replayed commits was on a remote branch
  When the rebase has finished
  Then the status line counts the commits to push as usual, with no "Force Push…"

Scenario: MERGE-009.9 A branch that differs from its remote for another reason
  Given a colleague pushed 1 commit to "origin/main" and I have 2 commits of my own, and I rewrote nothing
  When I look at the status line
  Then it reads "Diverged from origin/main: 2 commits to push, 1 to pull. Pull first, then push." with "Pull (Merge)" and "Pull (Rebase)" as before
  And it does not offer "Force Push…"

Scenario: MERGE-009.10 After a restart
  Given I rewrote pushed commits, did not force push, and restarted Quarry
  When I open the Source Control panel
  Then the status line is the ordinary one for a branch that differs from its remote
  And "Force Push (Replace Remote Branch)…" in the Git menu and the palette still opens the same dialog

Scenario: MERGE-009.11 Nothing on the remote to replace
  Given "origin/main" has no commit that "main" lacks
  When I run "Git: Force Push (Replace Remote Branch)…"
  Then nothing is forced and a notification says "origin/main has nothing to replace: use Push."

Scenario: MERGE-009.12 The command is greyed out when it cannot run
  Given the current branch has no upstream, or HEAD is detached, or an operation is stopped on a conflict, or another git action is running
  When I open the Git menu or the command palette
  Then "Force Push (Replace Remote Branch)…" is greyed out

Scenario: MERGE-009.13 The rebase was aborted
  Given I confirmed "Rebase Anyway", the rebase stopped on a conflict and I aborted it
  When I look at the status line
  Then it does not offer "Force Push…", because nothing was rewritten

Scenario: MERGE-009.14 Only this branch, only its upstream
  Given I am on "main" tracking "origin/main" and the remote also has "origin/release"
  When I force push
  Then only "main" on origin is replaced; no other branch or tag on the remote changes
```
