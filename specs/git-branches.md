---
area: Branch and Tag Housekeeping
prefix: BRANCH
---

# Branch and Tag Housekeeping

Tidying up refs without a terminal: delete and rename local branches, set or clear a branch's upstream, push any branch, delete a branch on the remote, delete a tag and push a tag. Every action is reachable from two places: a right-click on a ref label in the commit graph, and the branch picker (plus the Git menu and the command palette, which open the same picker). This is roadmap item 4 in `GIT-ROADMAP.md`; switching and creating branches are GIT-007 and GRAPH-011, Fetch / Pull / Push of the current branch are GIT-015. User documentation: "Tidying up branches and tags" in `docs/git.md`.

Where the code lives: the pure wording, checks and picker rows are in `src/lib/gitBranches.ts`; the menu entries in `src/lib/gitRefs.ts` (`refMenu`, `rowMenu`); the actions in `src/lib/gitRefActions.ts` (`refCommand` → `refAction`); the git work in `ref_action` / `push_ref` / `branch_info` of `src-tauri/src/git.rs`.

Decisions (choices made where the roadmap left the design open):

- **Owner decisions (2026-11-13).** The unsaved-tabs question (Save All / Continue Without Saving / Cancel) is specified once, in SAFE-001 to SAFE-003, and is built. No action of this area rewrites files, so none of them asks (SAFE-003.10); only "Switch to …" does (`checkoutRef`, which holds the shared guard), and that is the existing switch of GIT-007. The "Pull" / "Switch to" offers after a rejected push go through `remote` / `checkoutRef` and ask the same way. Force Push is not part of this area: it exists only for the current branch after pushed commits were rewritten (MERGE-009).
- **One guarded path.** Each action is a command (`git.deleteBranch`, `git.renameBranch`, `git.setUpstream`, `git.pushBranch`, `git.deleteRemoteBranch`, `git.deleteTag`, `git.pushTag`). The graph label menu, the picker's row menu, the Git menu and the palette all run that command, so the confirmations cannot be skipped by taking another route. Run without a target, a command first opens the picker to choose one. Cancel (or Close) is the default button of every dialog here; `choose()` in `src/lib/dialogs.ts` already takes a per-choice `default`.
- **Label menu, not commit menu: the one ref-label menu of MERGE-002.** A right-click on a ref label in the graph (in a row, or in the details pane's Refs line) selects the commit and opens a menu for that ref; a right-click anywhere else on the row still opens the commit menu of GRAPH-011 unchanged (its "Switch to …" entries stay). The menu, the labels that open it and its headings are introduced by MERGE-002, which is built first, with two entries (Merge … into …, Rebase … onto …); this area adds its entries to that same menu and does not create a second one. The labels that open it are the same in both specs: a local branch label (the current branch's included), a remote branch label and a tag label; the detached "HEAD" label and a "stash" label (STASH-010) have no label menu and open their row's menu. Order of the full menu: Switch to … (not on the current branch's label, not on a tag); then the merge and rebase entries of MERGE-002; then this area's entries for the kind of ref; then Copy Branch Name / Copy Tag Name. Entries are built by `refMenu(label, ctx)` in `src/lib/gitRefs.ts`, the file MERGE-002 creates.
- **Branch picker.** There is one branch picker: palette mode `branch`, opened by `pickBranch(purpose)` in `src/lib/git.ts` (the purpose is introduced by MERGE-003; the table of all purposes is in `specs/git-merge-rebase.md`, Decisions). This area adds the purposes `delete-branch` (local branches without the current one), `local-branch` (every local branch, the current one first: rename, set upstream, push), `remote-branch` (remote branches only), `tag` (tags only, newest first), `upstream` (the remote branches one local branch can track, with a "Stop tracking" row) and `new-name` (type the new name of a branch). As with every purpose other than `switch`, they have no "Create branch" row, and a picked row runs the command it was opened for with that name.
- **Picker row menu.** In the branch picker opened to switch branch (purpose `switch`, GIT-007) a row's actions open from its "⋯" button, a right-click, or Shift+F10 on the highlighted row. Enter and click still switch branch as today. Pickers opened for any other purpose (merge, rebase, compare, the lists of this area) have no row menu.
- **Tags are not listed in the Switch Branch picker.** Delete Tag… and Push Tag… open the same picker with the purpose `tag`, listing tags only.
- **Git menu.** The seven commands are in a Git › Branches and Tags submenu, directly after Merge Branch… / Rebase onto Branch… and before Edit History (group 6 of the planned Git menu, `specs/git-merge-rebase.md` Decisions).
- **Delete always asks once; an unmerged branch asks twice.** "Merged" follows git's own rule: every commit of the branch is in its upstream when it has one, otherwise in the branch I am on. The second question is a danger dialog. Cancel is the default button of both.
- **The current branch cannot be deleted**: the entry is shown but disabled with the reason, and the branch is left out of the Delete Branch… list.
- **Deleting a local branch never deletes its remote branch, and the other way round.** They are two separate actions; each dialog says the other one is kept.
- **Rename is local only.** The upstream setting is kept; the branch on the remote keeps its old name and the notification says so. An existing name is never overwritten (no force rename).
- **Which remote.** Pushing a branch goes to its upstream; with no upstream it goes to `origin`, or the first remote when none is called origin, and starts tracking it (the rule of GIT-015.2). Tags follow the same origin-or-first rule. The menu entry always names the remote ("Push v1.2.0 to origin").
- **Pushes do not ask and never force.** A rejected push is reported with a button for the way out. (The one forced push in Quarry is MERGE-009's Force Push of the current branch.)
- **No remote configured**: push and set-upstream entries stay enabled and lead to the Add Remote form, as Fetch / Pull / Push do (GIT-015.5).
- **A remote's default branch (what `origin/HEAD` points to) cannot be deleted from Quarry.**
- **Deleting a tag is local only.** Deleting a tag on the remote is out of scope; the dialog says the remote's copy is not touched.
- **Names with spaces**: the graph's naming strip rejects them (as GRAPH-011.8); the picker turns spaces into hyphens (as GIT-007.4).

## BRANCH-001: Right-click a branch or tag label in the graph

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — the ref-label menu of MERGE-002 (`RefBadge` right-click in the row list and the details pane, `RefMenu` state, rendered with `GraphMenu`) gets this area's entries (`refAct`: Switch, Copy and the rename strip are the view's, everything else is `runCommand` with `{ name, root }`); `refCtx`; reload when `useGit().refsTick` changes
  - `src/lib/gitRefs.ts` — `refMenu(label, ctx)` (created by MERGE-002 with the merge and rebase entries) extended by `withHousekeeping` once `ctx.remotes` is given: Switch to, the housekeeping entries per kind of ref, Copy; labels naming the remote, disabled reasons; `REF_COMMANDS` (entry id → command)
  - `src/lib/gitBranches.ts` — pure: `splitRemoteRef`, `pushTarget`, `defaultRemote`, `pushLabel`, `ON_THIS_BRANCH`
  - `src/lib/gitGraph.ts` — `refLabels` / `RefLabel` (kinds the menu is built from)
  - `src/lib/git.ts` — `refInfo` state the menu needs (upstream of each branch, default branch per remote) and `loadRefInfo`; `refsTick`
  - `src/lib/gitRefActions.ts` — `copyRefName`; `busyRun` bumps `refsTick` after every action
  - `src/lib/gitApi.ts` — `git.refInfo`, `GitRefInfo`
  - `src-tauri/src/git.rs` — `git_ref_info` / `ref_info` (`for-each-ref` upstreams, `default_branch` from `refs/remotes/<remote>/HEAD`)
  - `src/styles/app.css` — `.graph-ref` hover / `.menu-open` state
- Tests: `src/__tests__/gitRefs.test.ts`, `src/__tests__/gitBranches.test.ts`, `src/__tests__/graphBranches.test.tsx`, `src/__tests__/graphMerge.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer looking at the commit graph
**I want** to right-click a branch or tag label and act on that ref
**So that** I can tidy up the ref I am pointing at instead of hunting for it in a list

```gherkin
Scenario: BRANCH-001.1 A local branch label
  Given I am on "main", the only remote is "origin", and a commit carries the label "feature" with no upstream
  When I right-click the label "feature"
  Then the commit is selected
  And the label menu of MERGE-002 opens, headed "Branch feature"
  And it offers, in this order: Switch to feature; "Merge feature into main…" and "Rebase main onto feature…"; Rename Branch…, Set Upstream…, Push feature to origin and Delete Branch…; Copy Branch Name
  And the commit menu (Cherry-pick, Reset, …) does not open

Scenario: BRANCH-001.2 The label of the branch I am on
  Given I am on "main", which tracks "origin/main"
  When I right-click the filled label "main"
  Then the menu is headed "Branch main" and has no "Switch to" entry
  And its merge and rebase entries are greyed out, as in MERGE-002.4
  And "Delete Branch…" is greyed out with the tooltip "You are on this branch. Switch to another branch first."
  And Rename Branch…, Set Upstream… and "Push main to origin/main" are available

Scenario: BRANCH-001.3 A remote branch label
  Given I am on "main", a commit carries the label "origin/topic" and origin's default branch is "main"
  When I right-click the label "origin/topic"
  Then a menu opens headed "Remote branch origin/topic"
  And it offers Switch to origin/topic, "Merge origin/topic into main…", "Rebase main onto origin/topic…", "Delete topic from origin…" and Copy Branch Name
  And it has no Rename, Set Upstream or Push entry

Scenario: BRANCH-001.4 A tag label
  Given I am on "main", a commit carries the tag label "v1.2.0" and the only remote is "origin"
  When I right-click the label "v1.2.0"
  Then a menu opens headed "Tag v1.2.0"
  And it offers "Merge v1.2.0 into main…", "Rebase main onto v1.2.0…", "Push v1.2.0 to origin", Delete Tag… and Copy Tag Name
  And it has no "Switch to" entry

Scenario: BRANCH-001.5 Right-clicking the row beside the labels still gives the commit menu
  Given a commit carries the labels "feature" and "v1.2.0"
  When I right-click the commit's message, author or id
  Then the commit menu of GRAPH-011 opens, headed by the short id and message
  And it still has "Switch to feature"

Scenario: BRANCH-001.6 The detached HEAD label has no ref actions
  Given HEAD is detached on a commit that shows the label "HEAD"
  When I right-click the label "HEAD"
  Then the commit menu opens, not a label menu
  And a "stash" label opens its stash row's menu, as in MERGE-002.5

Scenario: BRANCH-001.7 Labels in the details pane work the same way
  Given a commit with the label "feature" is selected and the details pane lists it under Refs
  When I right-click "feature" in the details pane
  Then the same "Branch feature" menu opens

Scenario: BRANCH-001.8 Copy the name
  When I choose "Copy Branch Name" on the label "origin/topic"
  Then "origin/topic" is on the clipboard and a notification says "Copied the branch name"

Scenario: BRANCH-001.9 Closing the menu
  Given a label menu is open
  When I press Escape, click elsewhere or the window loses focus
  Then the menu closes and nothing is changed

Scenario: BRANCH-001.10 Nothing can be started while git is busy
  Given a push is running
  When I right-click the label "feature"
  Then every entry except Copy Branch Name is greyed out until the push ends, the merge and rebase entries included

Scenario: BRANCH-001.11 The graph follows the change
  Given the label menu of "feature"
  When an action from it succeeds, for example Rename Branch… to "feature-2"
  Then the graph reloads and the commit shows "feature-2" and no "feature"
  And the selected commit is kept, and so is the scroll position within the first page of commits (a reload starts again from the first page, as after a commit or a fetch)

Scenario: BRANCH-001.12 A label shows that it has a menu
  When I point at a branch or tag label
  Then it is outlined
  And while its menu is open the label stays outlined, so I can see which label the menu belongs to
```

## BRANCH-002: Manage branches and tags from the branch picker and the Git menu

- Status: draft
- Commands: `git.deleteBranch`, `git.renameBranch`, `git.setUpstream`, `git.pushBranch`, `git.deleteRemoteBranch`, `git.deleteTag`, `git.pushTag`
- Files:
  - `src/components/CommandPalette.tsx` — `mode === "branch"`: row "⋯" button (`.palette-more`), right-click and Shift+F10 open the row menu (`rowMenu` state, `openRowMenu`, `runRowEntry`; rows of the purpose `switch` only, keyboard handled in `onKey`, Escape through `cancel`); the purposes `delete-branch`, `local-branch`, `remote-branch`, `tag`, `upstream`, `new-name` with their prompts, rows (`housekeepingRows`) and empty texts (`branchEmpty`)
  - `src/lib/git.ts` — `pickBranch(purpose, pickFor)` (the purpose argument and `branchPick` come from MERGE-003) gains this area's purposes: `branchPickFor` (command, target branch, repository), `branchPickSeq`, loads `tags` beside `branches` for `tag`
  - `src/lib/gitRefActions.ts` — `refCommand` (what the seven commands run: with a name the action, without one the picker), `refArgs`, `refRepo`, `refAction` (the one function every entry point reaches)
  - `src/lib/gitCommands.ts` — the seven commands, each taking an optional `{ name }` (and `{ root }` from a graph tab), enabled while there is a repository; without a name a command opens the picker with its purpose, and the picked row runs the same command with the name
  - `src/lib/gitRefs.ts` — `rowMenu` (the picker's row menu has the housekeeping and Copy entries of the graph label menu; the Switch, merge and rebase entries are left out of it), `branchPick`, `pickList` (which refs a purpose lists), `REF_COMMANDS`
  - `src/lib/gitBranches.ts` — pure: `housekeepingRows` (the rows of each purpose), `housekeepingPrompt`, `isHousekeeping`, `BranchPickFor`
  - `src/components/MenuBar.tsx` — Git › Branches and Tags submenu referencing the command ids, after Rebase onto Branch… (planned layout in `specs/git-merge-rebase.md`, Decisions)
  - `src/lib/gitApi.ts` — `git.tags`, `GitTag`
  - `src-tauri/src/git.rs` — `git_tags` (`for-each-ref --sort=-creatordate refs/tags`, newest first)
  - `src/styles/app.css` — `.palette-more`, `.branch-row-menu`, the list's note line
- Tests: `src/__tests__/gitRefs.test.ts`, `src/__tests__/gitBranches.test.ts`, `src/__tests__/branchPickerRefs.test.tsx`, `src/__tests__/gitRefActions.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer who works from the keyboard or keeps the graph closed
**I want** the same branch and tag actions in the branch picker, the Git menu and the command palette
**So that** I do not have to find a commit in the graph to tidy a branch

```gherkin
Scenario: BRANCH-002.1 Row menu in the branch picker
  Given the branch picker is open on a repository on "main" with local branch "feature" and remote branch "origin/topic"
  When I click the "⋯" button on the row "feature", or right-click the row
  Then a menu opens with Rename Branch…, Set Upstream…, Push feature to origin, Delete Branch… and Copy Branch Name
  And the picker stays open behind it and the branch is not switched

Scenario: BRANCH-002.2 Row menu from the keyboard
  Given the branch picker is open and the row "feature" is highlighted
  When I press Shift+F10
  Then the row menu for "feature" opens with its first entry highlighted
  And Up / Down move in it, Enter runs the entry and Escape returns to the picker

Scenario: BRANCH-002.3 The row menu matches the kind of row
  Given the branch picker is open
  When I open the row menu of "origin/topic"
  Then it offers "Delete topic from origin…" and Copy Branch Name only
  And the row menu of "main", labelled "current", has "Delete Branch…" greyed out with the tooltip "You are on this branch. Switch to another branch first."

Scenario: BRANCH-002.4 Enter and click still switch
  Given the branch picker is open
  When I press Enter on the row "feature" or click its name
  Then the repository switches to "feature" as before and no menu opens

Scenario: BRANCH-002.5 Choosing an action closes the picker
  Given the row menu of "feature" is open
  When I choose "Delete Branch…"
  Then the picker closes and the question "Delete branch "feature"?" is asked

Scenario: BRANCH-002.6 The Git menu
  Given a repository is open
  When I open Git › Branches and Tags
  Then it lists Rename Branch…, Delete Branch…, Set Upstream…, Push Branch…, Delete Remote Branch…, Delete Tag… and Push Tag…
  And the same seven are found in the command palette under "Git"

Scenario: BRANCH-002.7 A command without a target asks which one
  Given local branches "main" (current), "feature" and "old-idea"
  When I run Git › Branches and Tags › Delete Branch…
  Then the picker opens with the prompt "Delete which branch?"
  And it lists "feature" and "old-idea" only: no remote branches and not "main"
  When I pick "old-idea"
  Then the question "Delete branch "old-idea"?" is asked, exactly as from the graph

Scenario: BRANCH-002.8 Each command lists only what it can act on
  Given local branches, remote branches "origin/main" and "origin/topic", and tags "v1.0" and "v1.1"
  When I run Delete Remote Branch…
  Then the picker lists "origin/topic" and "origin/main" only, with the prompt "Delete which branch on the remote?"
  And Delete Tag… and Push Tag… list "v1.1" then "v1.0" (newest first) and no branches
  And Rename Branch…, Set Upstream… and Push Branch… list every local branch, the current one first

Scenario: BRANCH-002.9 Nothing to choose from
  Given a repository with no tags
  When I run Delete Tag…
  Then the picker shows "This repository has no tags" and nothing can be picked

Scenario: BRANCH-002.10 Escape leaves everything as it was
  Given the picker opened by Delete Branch…
  When I press Escape
  Then the picker closes and no branch is deleted

Scenario: BRANCH-002.11 Unavailable without a repository
  Given no repository is known
  When I open Git › Branches and Tags
  Then all seven entries are greyed out
  And running one from a shortcut or a macro does nothing

Scenario: BRANCH-002.12 The picker shows a change made elsewhere
  Given I deleted "old-idea" a moment ago
  When I open the branch picker again
  Then "old-idea" is not listed
```

## BRANCH-003: Delete a local branch

- Status: draft
- Commands: `git.deleteBranch`
- Files:
  - `src/lib/gitBranches.ts` — `deleteQuestion` (first dialog), `unmergedQuestion` (second, danger), `refDone`, `NOT_MERGED` / `isNotMerged`
  - `src/lib/gitRefActions.ts` — `refAction("branch-delete")` → `deleteBranch`: reads the branch, asks, runs the safe delete (or, after the second question, the forced one for the commit asked about), toast, refresh
  - `src/lib/gitApi.ts` — `git.refAction`, `git.branchInfo`, `GitBranchInfo`
  - `src-tauri/src/git.rs` — `git_branch_info` / `branch_info` (upstream, the branch "merged" is measured against, count of commits not in it via `rev-list --count`), `ref_action` / `git_ref_action` (`branch-delete` = `branch -d`, failing with `NOT_MERGED` when git refuses; `branch-delete-force` = `branch -D`, only while the branch still points at the commit the question named; both refuse the checked-out branch), `known_ref`
  - `src/components/GraphView.tsx` — label menu entry, reload
  - `src/components/CommandPalette.tsx` — "Delete which branch?" list
- Tests: `src/__tests__/gitBranches.test.ts`, `src/__tests__/gitRefActions.test.ts`, `src-tauri/src/git.rs`, `src/__tests__/graphBranches.test.tsx`, `src/__tests__/branchPickerRefs.test.tsx`
- Docs: `docs/git.md`

**As a** developer whose branch list has filled up with finished work
**I want** to delete a branch, and be stopped when it still holds commits found nowhere else
**So that** I can clean up without losing work by accident

```gherkin
Scenario: BRANCH-003.1 Delete a merged branch
  Given I am on "main" and branch "feature" has no upstream and all its commits are in "main"
  When I choose "Delete Branch…" on the label "feature" in the graph
  Then a dialog asks "Delete branch "feature"?" and says "All its commits are in "main", so nothing is lost. The branch on a remote, if there is one, is not touched."
  And its buttons are "Delete Branch" and "Cancel", with Cancel the default
  When I click "Delete Branch"
  Then "feature" is gone from the graph and the branch picker
  And a notification says "Deleted branch feature (was 1a2b3c4)"

Scenario: BRANCH-003.2 Enter does not delete
  Given the dialog "Delete branch "feature"?" is open
  When I press Enter or Escape
  Then the dialog closes and "feature" still exists

Scenario: BRANCH-003.3 An unmerged branch needs a second confirmation
  Given I am on "main" and branch "experiment" has no upstream and 2 commits that are not in "main"
  When I choose "Delete Branch…" for "experiment"
  Then the first dialog says "2 commits on "experiment" are not in "main": you are asked once more before they are lost."
  When I click "Delete Branch" in it
  Then the branch is not deleted yet
  And a second dialog asks "Delete "experiment" and lose 2 commits?" and says "2 commits on "experiment" are not in "main". Deleting the branch leaves them on no branch. Its last commit is 9f8e7d6, should you need it back."
  And its buttons are a red "Delete Anyway" and "Cancel", with Cancel the default
  When I click "Delete Anyway"
  Then "experiment" is deleted and a notification says "Deleted branch experiment (was 9f8e7d6)"

Scenario: BRANCH-003.4 Cancelling the second question keeps the branch
  Given the dialog "Delete "experiment" and lose 2 commits?" is open
  When I click "Cancel" or press Enter
  Then "experiment" and its 2 commits are still there and no notification is shown

Scenario: BRANCH-003.5 A branch with an upstream is compared with its upstream
  Given branch "review" tracks "origin/review", has nothing to push, and is not merged into "main"
  When I choose "Delete Branch…" for "review"
  Then the single dialog says "All its commits are in "origin/review", so nothing is lost."
  And no second question is asked

Scenario: BRANCH-003.6 Unpushed commits on a tracking branch count as unmerged
  Given branch "review" tracks "origin/review" and has 1 commit to push
  When I confirm the first dialog
  Then the second dialog asks "Delete "review" and lose 1 commit?" and names "origin/review"

Scenario: BRANCH-003.7 The current branch cannot be deleted
  Given I am on "main"
  When I look at "Delete Branch…" in the label menu or the picker row menu of "main"
  Then it is greyed out with the tooltip "You are on this branch. Switch to another branch first."
  And "main" is not offered by Git › Branches and Tags › Delete Branch…
  And running the delete command for "main" from a macro deletes nothing and shows "You are on main. Switch to another branch first."

Scenario: BRANCH-003.8 Detached HEAD
  Given HEAD is detached at 1a2b3c4 and branch "feature" has 3 commits that are not in 1a2b3c4
  When I delete "feature" and confirm the first dialog
  Then the second dialog says "3 commits on "feature" are not in the commit you are on (1a2b3c4)."

Scenario: BRANCH-003.9 Only the local branch goes
  Given branch "review" tracks "origin/review"
  When I delete "review"
  Then "origin/review" still exists on the remote and its label stays in the graph

Scenario: BRANCH-003.10 My files are not touched
  Given 2 uncommitted changes on "main"
  When I delete branch "feature"
  Then I am still on "main" and the 2 changes are still listed in Source Control

Scenario: BRANCH-003.11 Git refuses for another reason
  Given branch "feature" is checked out in another worktree
  When I delete it and confirm
  Then the branch is kept
  And an error shows git's message without "hint:" lines
  And no forced delete is attempted

Scenario: BRANCH-003.12 The branch changed between the question and the answer
  Given the first dialog said "feature" was merged, and a commit was added to "feature" from a terminal while it was open
  When I click "Delete Branch"
  Then the branch is not deleted and the second, "lose 1 commit" question is asked

Scenario: BRANCH-003.13 The forced delete is only for the commit that was asked about
  Given the dialog "Delete "experiment" and lose 2 commits?" is open, and a third commit was added to "experiment" from a terminal
  When I click "Delete Anyway"
  Then the branch is kept and an error says ""experiment" changed while the question was open. Nothing was deleted."
```

## BRANCH-004: Rename a local branch

- Status: draft
- Commands: `git.renameBranch`
- Files:
  - `src/components/GraphView.tsx` — naming strip (`Naming`) gains a rename action, prefilled with the current name (`commitNaming` runs `git.renameBranch` with `{ name, to, root }`)
  - `src/components/CommandPalette.tsx` — branch mode, purpose `new-name`: prompt, prefilled query (the effect on `branchPickSeq`), single `Rename "a" to "b"` row
  - `src/lib/gitBranches.ts` — `renameCheck(old, typed, existing, hyphens)` (same name, taken name, picker's space-to-hyphen), `housekeepingRows("new-name")`, `refDone`
  - `src/lib/gitRefActions.ts` — `refAction("branch-rename")` → `renameBranch`; status refresh so the panel and status bar show the new name
  - `src-tauri/src/git.rs` — `ref_action` `branch-rename` = `branch -m <old> <new>` (never `-M`; a change of letter case only goes through a free temporary name, because git refuses it where file names ignore case), `valid_ref_name`, `ref_exists`
  - `src/lib/gitApi.ts` — `git.refAction`
- Tests: `src/__tests__/gitBranches.test.ts`, `src/__tests__/gitRefActions.test.ts`, `src-tauri/src/git.rs`, `src/__tests__/graphBranches.test.tsx`, `src/__tests__/branchPickerRefs.test.tsx`
- Docs: `docs/git.md`

**As a** developer who named a branch badly
**I want** to rename it in place
**So that** its name says what it is without recreating the branch

```gherkin
Scenario: BRANCH-004.1 Rename from the graph
  Given branch "fix" exists and I am on "main"
  When I choose "Rename Branch…" on the label "fix"
  Then a strip "Rename branch fix to:" appears with a name box holding "fix", selected, and a disabled "Rename" button
  When I type "fix-login-timeout" and press Enter
  Then the branch is called "fix-login-timeout", points at the same commit, and "fix" no longer exists
  And a notification says "Renamed fix to fix-login-timeout"

Scenario: BRANCH-004.2 Rename from the branch picker
  Given the branch picker's row menu for "fix"
  When I choose "Rename Branch…"
  Then the picker shows the prompt "New name for "fix"…" with "fix" in the box
  When I type "fix login timeout"
  Then the only row reads Rename "fix" to "fix-login-timeout"
  When I press Enter
  Then the branch is renamed to "fix-login-timeout"

Scenario: BRANCH-004.3 Rename the branch I am on
  Given I am on "fix" with 1 uncommitted change
  When I rename "fix" to "fix-login-timeout"
  Then the branch button in Source Control and the status bar read "fix-login-timeout"
  And I am still on the same commit and the uncommitted change is untouched

Scenario: BRANCH-004.4 Same or empty name
  Given the rename strip for "fix" is open
  When the box is empty or still holds "fix"
  Then the "Rename" button is disabled and Enter does nothing

Scenario: BRANCH-004.5 The name is taken
  Given branches "fix" and "main" exist
  When I rename "fix" to "main"
  Then nothing is renamed and an error says "A branch named "main" already exists."
  And "main" still points at its own commit
  And in the "New name for "fix"…" picker the list says the same and offers no row to pick

Scenario: BRANCH-004.6 Invalid names
  Given the rename strip for "fix" in the graph
  When I enter "bad name", "-D", "a..b" or "wip.lock"
  Then nothing is renamed and an error says the name is not valid
  And "fix" still exists

Scenario: BRANCH-004.7 Change only the letter case
  Given branch "Feature" exists
  When I rename it to "feature"
  Then the branch is called "feature" and a notification says "Renamed Feature to feature"

Scenario: BRANCH-004.8 The remote branch keeps its name
  Given branch "fix" tracks "origin/fix"
  When I rename "fix" to "fix-login-timeout"
  Then "fix-login-timeout" still tracks "origin/fix" and nothing is pushed or deleted on the remote
  And the notification says "Renamed fix to fix-login-timeout. It still tracks origin/fix; the branch on origin keeps its name."

Scenario: BRANCH-004.9 Cancel
  Given the rename strip or the "New name for "fix"…" picker is open
  When I press Escape
  Then it closes and the branch is still called "fix"

Scenario: BRANCH-004.10 Remote branches and tags cannot be renamed
  Given the labels "origin/topic" and "v1.2.0" in the graph
  When I open their menus
  Then neither has a Rename entry
  And Git › Branches and Tags › Rename Branch… lists local branches only

Scenario: BRANCH-004.11 Git refuses
  Given a rebase of "fix" is stopped on a conflict
  When I rename "fix" to "fix-2"
  Then the branch keeps its name and an error shows git's message without "hint:" lines
```

## BRANCH-005: Set or clear a branch's upstream

- Status: draft
- Commands: `git.setUpstream`
- Files:
  - `src/components/CommandPalette.tsx` — branch mode, purpose `upstream`: prompt, "tracking" label, "Stop tracking" row, the "No remote branches yet" note with the "Push … to origin and track it" row
  - `src/lib/gitBranches.ts` — `housekeepingRows("upstream")` (same-name branch first, Stop tracking row, push-and-track row), `refDone`, `NO_REMOTE`
  - `src/lib/gitRefActions.ts` — `refAction("upstream-set" | "upstream-unset")` → `setUpstream` (nothing is run for the upstream it already has), `refCommand` no-remote redirect (`showAddRemote`), status refresh
  - `src-tauri/src/git.rs` — `ref_action` `upstream-set` = `branch --set-upstream-to=refs/remotes/<remote/branch> <branch>`, `upstream-unset` = `branch --unset-upstream <branch>`; `branches` (already returns `upstream`)
  - `src/lib/gitApi.ts` — `git.refAction`
  - `src/components/GraphView.tsx` — label menu entry
- Tests: `src/__tests__/gitBranches.test.ts`, `src/__tests__/gitRefActions.test.ts`, `src-tauri/src/git.rs`, `src/__tests__/branchPickerRefs.test.tsx`, `src/__tests__/graphBranches.test.tsx`
- Docs: `docs/git.md`

**As a** developer whose branch tracks nothing, or the wrong remote branch
**I want** to choose the remote branch it follows
**So that** the to-push and to-pull counts, Pull and Push work for it

```gherkin
Scenario: BRANCH-005.1 Choose an upstream
  Given branch "feature" has no upstream and the remote branches are "origin/feature" and "origin/main"
  When I choose "Set Upstream…" for "feature" in the graph label menu or the picker row menu
  Then a list opens with the prompt "Which remote branch should "feature" track?"
  And it lists "origin/feature" first (same name), then "origin/main"; no local branches
  When I pick "origin/feature"
  Then "feature" tracks "origin/feature" and a notification says "feature now tracks origin/feature"
  And nothing is fetched, pushed or changed in my files

Scenario: BRANCH-005.2 The status line follows
  Given I am on "feature", which has no upstream, and "origin/feature" is 2 commits behind it
  When I set its upstream to "origin/feature"
  Then the Source Control status line shows 2 commits to push instead of offering Publish Branch

Scenario: BRANCH-005.3 Change an upstream
  Given "feature" tracks "origin/feature"
  When I open Set Upstream… for it
  Then "origin/feature" is labelled "tracking" and the first row is Stop tracking "origin/feature"
  When I pick "origin/main"
  Then "feature" tracks "origin/main" and a notification says "feature now tracks origin/main"

Scenario: BRANCH-005.4 Stop tracking
  Given "feature" tracks "origin/feature"
  When I pick the row Stop tracking "origin/feature"
  Then "feature" has no upstream and a notification says "feature no longer tracks a remote branch"
  And "origin/feature" still exists

Scenario: BRANCH-005.5 Picking what it already tracks changes nothing
  Given "feature" tracks "origin/feature"
  When I pick "origin/feature"
  Then the list closes and no notification or error is shown

Scenario: BRANCH-005.6 A remote exists but has no branches yet
  Given remote "origin" is configured and nothing was ever pushed or fetched
  When I open Set Upstream… for "feature"
  Then the list says "No remote branches yet" and offers the single row Push "feature" to origin and track it
  When I pick that row
  Then "feature" is pushed as in BRANCH-006 and tracks "origin/feature"

Scenario: BRANCH-005.7 No remote configured
  Given a repository with no remote
  When I choose "Set Upstream…" for "feature"
  Then no list opens and git is not run
  And Source Control opens on its Add Remote form with the message "This repository has no remote yet. Add one in Source Control."

Scenario: BRANCH-005.8 Only local branches have an upstream
  Given the labels "origin/topic" and "v1.2.0" in the graph
  When I open their menus
  Then neither has a Set Upstream entry

Scenario: BRANCH-005.9 The remote branch disappeared
  Given the list shows "origin/topic", which was deleted from a terminal while the list was open
  When I pick "origin/topic"
  Then the upstream is not changed and an error shows git's message without "hint:" lines
```

## BRANCH-006: Push a branch

- Status: draft
- Commands: `git.pushBranch`
- Files:
  - `src/lib/gitBranches.ts` — `pushTarget(branch, upstream, remotes)` (upstream, else origin, else first remote), `pushLabel`, `pushRejected` (recognises a non-fast-forward rejection), `rejectedDialog`, `refDone`
  - `src/lib/gitRefActions.ts` — `refAction("branch-push")` → `pushBranch`: no-remote redirect, busy label, result toast, rejection dialog via `choose` (Switch to …, or Pull on the current branch), `isMissingRepo` recorded in `remoteCheck` as `remote()` does
  - `src-tauri/src/git.rs` — `push_ref` / `git_push_ref` (`push <remote> refs/heads/<b>:refs/heads/<upstream name>`, with `--set-upstream` when the branch has none; never `--force`); `default_remote`
  - `src/lib/gitApi.ts` — `git.pushRef`, `GitPushRef`
  - `src/lib/gitStatus.ts` — `gitErrorText`, `isMissingRepo`
  - `src/components/GraphView.tsx` — label menu entry; `src/components/CommandPalette.tsx` — row menu entry and "Push which branch?" list
- Tests: `src/__tests__/gitBranches.test.ts`, `src/__tests__/gitRefs.test.ts`, `src/__tests__/gitRefActions.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer with work on a branch I am not on
**I want** to push that branch without switching to it
**So that** I can share or back it up and stay where I am

```gherkin
Scenario: BRANCH-006.1 Push a branch that tracks a remote branch
  Given I am on "main" and branch "feature" tracks "origin/feature" with 2 commits to push
  When I choose "Push feature to origin/feature" in the label menu or the picker row menu
  Then "Pushing feature…" is shown beside the branch in Source Control and in the status bar while it runs
  And afterwards a notification says "Pushed feature to origin"
  And the label "origin/feature" sits on the same commit as "feature" in the graph
  And I am still on "main" and my files are untouched

Scenario: BRANCH-006.2 Publish a branch that has no upstream
  Given branch "feature" has no upstream and the remotes are "origin" and "backup"
  When I open its label menu
  Then the entry reads "Push feature to origin"
  When I choose it
  Then "feature" is pushed to "origin" and tracks "origin/feature" from then on
  And a notification says "Pushed feature to origin; it now tracks origin/feature"

Scenario: BRANCH-006.3 No remote called origin
  Given branch "feature" has no upstream and the remotes are "backup" and "work", in that order
  When I open its label menu
  Then the entry reads "Push feature to backup"

Scenario: BRANCH-006.4 The upstream has another name
  Given branch "feature" tracks "origin/review"
  When I choose "Push feature to origin/review"
  Then the commits go to the branch "review" on origin and no branch "feature" is created there

Scenario: BRANCH-006.5 Nothing to push
  Given "feature" and "origin/feature" are on the same commit
  When I push "feature"
  Then a notification says "feature is already up to date on origin"

Scenario: BRANCH-006.6 Pushing the current branch
  Given I am on "main" with 1 commit to push
  When I choose "Push main to origin/main" on the label "main"
  Then the result is the same as Git › Push: the commit is on origin and the status line shows nothing to push

Scenario: BRANCH-006.7 No remote configured
  Given a repository with no remote
  When I open the label menu of "feature"
  Then the entry reads "Push feature…" and is available
  When I choose it
  Then git is not run and Source Control opens on its Add Remote form with the message "This repository has no remote yet. Add one in Source Control."

Scenario: BRANCH-006.8 The remote has commits the branch does not have
  Given I am on "main" and "origin/feature" has 1 commit that "feature" does not have
  When I push "feature"
  Then nothing is pushed and nothing is forced
  And a dialog "origin did not accept feature" says "origin/feature has commits that "feature" does not have. Switch to "feature" and pull, then push again." above git's message without "hint:" lines
  And its buttons are "Switch to feature" and "Close", with Close the default
  When I click "Switch to feature"
  Then the repository is on "feature" and Source Control shows what there is to pull
  And when the rejected branch is the one I am on, the dialog says "Pull, then push again." and its buttons are "Pull" and "Close"

Scenario: BRANCH-006.9 Other failures
  Given the remote cannot be reached
  When I push "feature"
  Then an error shows git's message without "hint:" lines and the status is refreshed
  And when the message is "repository not found" Source Control shows the missing-repository warning with its Create / Change URL buttons (GIT-016)

Scenario: BRANCH-006.10 One action at a time
  Given a fetch is running
  When I open the label menu of "feature"
  Then the Push entry is greyed out until the fetch ends

Scenario: BRANCH-006.11 Only local branches are pushed from here
  Given the label "origin/topic" in the graph
  When I open its menu
  Then it has no Push entry

Scenario: BRANCH-006.12 A branch Quarry rewrote is pointed at Force Push
  Given I am on "main", whose pushed commits were rewritten by a rebase in Quarry (MERGE-009)
  When I choose "Push main to origin/main" and the remote refuses it
  Then no dialog offers to pull
  And an error shows git's message and says "main was rewritten after it was pushed: use Git › Force Push (Replace Remote Branch)… instead of pulling."
```

## BRANCH-007: Delete a branch on the remote

- Status: draft
- Commands: `git.deleteRemoteBranch`
- Files:
  - `src/lib/gitBranches.ts` — `splitRemoteRef(name, remotes)` (longest matching remote name, so "origin/feature/login" is "feature/login" on "origin"), `remoteDeleteQuestion`, `remotePlace`, `refDone`
  - `src/lib/gitRefs.ts` — the entry's label and its default-branch reason (`withHousekeeping`, from `ctx.defaults`)
  - `src/lib/gitRefActions.ts` — `refAction("remote-branch-delete")` → `deleteRemoteBranch`: reads the branch, refuses a default branch, asks (the remote's URL from the status), busy label, toast, refresh
  - `src-tauri/src/git.rs` — `push_ref` `delete` = `push <remote> --delete refs/heads/<branch>`, only for a remote branch this repository knows, never a default branch; an already-missing ref is answered with `fetch --prune <remote>` and reported as gone; `git_branch_info` (commits only on that remote branch; the remote's default branch from `refs/remotes/<remote>/HEAD`), `split_remote`
  - `src/lib/gitApi.ts` — `git.pushRef`, `git.branchInfo`
  - `src/components/GraphView.tsx` — remote label menu entry; `src/components/CommandPalette.tsx` — row menu entry and "Delete which branch on the remote?" list
- Tests: `src/__tests__/gitBranches.test.ts`, `src/__tests__/gitRefs.test.ts`, `src/__tests__/gitRefActions.test.ts`, `src-tauri/src/git.rs`, `src/__tests__/graphBranches.test.tsx`
- Docs: `docs/git.md`

**As a** developer whose branch was merged and is still sitting on the remote
**I want** to delete it there from Quarry, after being told exactly which remote loses what
**So that** the shared repository stays tidy and I never delete someone's branch by a slip

```gherkin
Scenario: BRANCH-007.1 The question names the remote
  Given remote "origin" points to "https://github.com/acme/app.git" and "origin/topic" is fully merged into "main"
  When I choose "Delete topic from origin…" on the label "origin/topic"
  Then a dialog asks "Delete "topic" from origin?"
  And it says "This deletes the branch "topic" in the remote repository origin (github.com/acme/app), for everyone who uses it. Your local branches are kept."
  And its buttons are a red "Delete from origin" and "Cancel", with Cancel the default
  And nothing has been sent to the remote yet

Scenario: BRANCH-007.2 Confirm
  Given the dialog "Delete "topic" from origin?" is open
  When I click "Delete from origin"
  Then "Deleting origin/topic…" is shown while it runs
  And afterwards the branch is gone from the remote, the label "origin/topic" is gone from the graph and the picker
  And a notification says "Deleted topic from origin (was 4c5d6e7)"

Scenario: BRANCH-007.3 Enter or Escape keeps it
  Given the dialog "Delete "topic" from origin?" is open
  When I press Enter or Escape
  Then the dialog closes and "origin/topic" still exists on the remote

Scenario: BRANCH-007.4 Commits that exist nowhere else are spelled out
  Given "origin/topic" has 3 commits that are in no local branch
  When I choose "Delete topic from origin…"
  Then the dialog also says "3 commits are only on origin/topic (as of the last fetch). They are lost unless someone else has them."

Scenario: BRANCH-007.5 The local branch is kept
  Given I am on "main" and local branch "topic" tracks "origin/topic"
  When I delete "topic" from origin
  Then the local branch "topic" still exists with all its commits
  And it is not deleted, renamed or switched to

Scenario: BRANCH-007.6 Deleting the upstream of the branch I am on
  Given I am on "topic", which tracks "origin/topic"
  When I delete "topic" from origin
  Then I am still on "topic" and my files are untouched
  And the Source Control status line reads "origin/topic no longer exists on the remote." with the button "Push to Recreate It" (GIT-013.8)

Scenario: BRANCH-007.7 A remote's default branch is protected
  Given origin's default branch is "main"
  When I open the menu of the label "origin/main"
  Then "Delete main from origin…" is greyed out with the tooltip "main is origin's default branch."
  And running the delete command for "origin/main" from a macro deletes nothing and shows the same sentence
  And a repository that has no "origin/HEAD" (it was not cloned, and `git remote set-head` was never run) knows no default branch: the entry is then available, and the remote itself decides

Scenario: BRANCH-007.8 The right remote and the whole branch name
  Given remotes "origin" and "backup" and the label "backup/feature/login"
  When I open its menu
  Then the entry reads "Delete feature/login from backup…"
  And confirming deletes "feature/login" on "backup" only; "origin/feature/login" is not touched

Scenario: BRANCH-007.9 It was already gone
  Given "topic" was deleted on origin by a colleague and my label "origin/topic" is stale
  When I confirm deleting it
  Then the stale label disappears and a notification says "topic was already gone from origin"
  And no error is shown

Scenario: BRANCH-007.10 The remote refuses
  Given the hosting service protects the branch "release"
  When I confirm deleting "release" from origin
  Then "origin/release" is kept and an error shows the remote's message without "hint:" lines
  And the graph still shows the label

Scenario: BRANCH-007.11 Only remote branches have this entry
  Given the local label "topic" and the tag label "v1.2.0"
  When I open their menus
  Then neither has a "Delete … from origin…" entry
  And deleting the local branch "topic" (BRANCH-003) never asks about, or deletes, "origin/topic"

Scenario: BRANCH-007.12 One action at a time
  Given a pull is running
  When I open the menu of the label "origin/topic"
  Then "Delete topic from origin…" is greyed out until the pull ends
```

## BRANCH-008: Delete a tag

- Status: draft
- Commands: `git.deleteTag`
- Files:
  - `src/lib/gitBranches.ts` — `tagDeleteQuestion`, `refDone`
  - `src/lib/gitRefActions.ts` — `refAction("tag-delete")` → `deleteTag`: reads the tag's commit, asks, toast, graph reload signal (`refsTick`)
  - `src-tauri/src/git.rs` — `ref_action` `tag-delete` = `tag -d <name>` (name checked with `known_ref` / `ref_exists("refs/tags/…")`, never passed as an option), `git_tags`, `git_branch_info` (kind `tag`: the commit it points at)
  - `src/lib/gitApi.ts` — `git.refAction`, `git.tags`
  - `src/components/GraphView.tsx` — tag label menu entry; `src/components/CommandPalette.tsx` — "Delete which tag?" list
- Tests: `src/__tests__/gitBranches.test.ts`, `src/__tests__/gitRefActions.test.ts`, `src-tauri/src/git.rs`, `src/__tests__/graphBranches.test.tsx`, `src/__tests__/branchPickerRefs.test.tsx`
- Docs: `docs/git.md`

**As a** developer who tagged the wrong commit or mistyped a version
**I want** to delete the tag
**So that** I can tag again correctly

```gherkin
Scenario: BRANCH-008.1 Delete a tag from the graph
  Given tag "v1.2.0" is on commit 18bc71d
  When I choose "Delete Tag…" on the label "v1.2.0"
  Then a dialog asks "Delete tag "v1.2.0"?" and says "Removes the tag from this computer. The commit 18bc71d and its branch are not changed. If the tag was pushed, the remote keeps its copy."
  And its buttons are "Delete Tag" and "Cancel", with Cancel the default
  When I click "Delete Tag"
  Then the label "v1.2.0" is gone from the graph and the commit is still there
  And a notification says "Deleted tag v1.2.0 (was 18bc71d)"
  And the background remote check does not bring it back (GIT-014.4)

Scenario: BRANCH-008.2 Delete a tag from the Git menu
  Given tags "v1.1" and "v1.2.0"
  When I run Git › Branches and Tags › Delete Tag… and pick "v1.2.0"
  Then the same question is asked, and confirming deletes "v1.2.0" only

Scenario: BRANCH-008.3 Enter or Escape keeps the tag
  Given the dialog "Delete tag "v1.2.0"?" is open
  When I press Enter or Escape
  Then the tag still exists

Scenario: BRANCH-008.4 Nothing is sent to the remote
  Given "v1.2.0" was pushed to origin
  When I delete the tag
  Then git contacts no remote and origin still has "v1.2.0"

Scenario: BRANCH-008.5 A branch with the same name is safe
  Given a tag "release" and a branch "release"
  When I delete the tag "release"
  Then the branch "release" still exists and still points at its commit

Scenario: BRANCH-008.6 The tag is already gone
  Given "v1.2.0" was deleted from a terminal while the graph was open
  When I confirm deleting it
  Then an error says the tag "v1.2.0" was not found and the graph reloads without the label

Scenario: BRANCH-008.7 Annotated tags
  Given "v2.0" is an annotated tag with the message "Second release"
  When I delete it
  Then it is deleted like any other tag after the same single question
```

## BRANCH-009: Push a tag

- Status: draft
- Commands: `git.pushTag`
- Files:
  - `src/lib/gitBranches.ts` — `defaultRemote` (origin, else first remote), `pushLabel`, `tagRejected`, `tagRejectedText`, `refDone`
  - `src/lib/gitRefActions.ts` — `refAction("tag-push")` → `pushTag`: no-remote redirect, busy label, toasts, error
  - `src-tauri/src/git.rs` — `push_ref` `tag` = `push <remote> refs/tags/<name>` (never `--force`, never `--tags`); "Everything up-to-date" recognised
  - `src/lib/gitApi.ts` — `git.pushRef`
  - `src/lib/gitStatus.ts` — `gitErrorText`
  - `src/components/GraphView.tsx` — tag label menu entry; `src/components/CommandPalette.tsx` — "Push which tag?" list
- Tests: `src/__tests__/gitBranches.test.ts`, `src/__tests__/gitRefs.test.ts`, `src/__tests__/gitRefActions.test.ts`, `src-tauri/src/git.rs`, `src/__tests__/graphBranches.test.tsx`
- Docs: `docs/git.md`

**As a** developer who tagged a release
**I want** to push that one tag to the remote
**So that** the release is marked for everyone without pushing every local tag

```gherkin
Scenario: BRANCH-009.1 Push a tag from the graph
  Given tag "v1.2.0" exists locally and the only remote is "origin"
  When I choose "Push v1.2.0 to origin" on the label "v1.2.0"
  Then "Pushing v1.2.0…" is shown while it runs
  And afterwards origin has the tag and a notification says "Pushed tag v1.2.0 to origin"
  And no question is asked first

Scenario: BRANCH-009.2 Only that tag is pushed
  Given local tags "v1.2.0" and "wip-test", neither on origin, and 2 unpushed commits on "main" after "v1.2.0"
  When I push the tag "v1.2.0"
  Then origin has "v1.2.0" and the commits it needs
  And "wip-test" is not pushed and "origin/main" does not move

Scenario: BRANCH-009.3 Push a tag from the Git menu
  Given tags "v1.1" and "v1.2.0"
  When I run Git › Branches and Tags › Push Tag…
  Then the picker opens with the prompt "Push which tag to origin?"
  When I pick "v1.2.0"
  Then "v1.2.0" is pushed to origin

Scenario: BRANCH-009.4 Which remote
  Given the remotes are "backup" and "work", in that order, and none is called origin
  When I open the menu of the label "v1.2.0"
  Then the entry reads "Push v1.2.0 to backup"
  And with remotes "backup" and "origin" it reads "Push v1.2.0 to origin"

Scenario: BRANCH-009.5 The tag is already there
  Given origin already has "v1.2.0" on the same commit
  When I push the tag
  Then a notification says "v1.2.0 is already on origin"

Scenario: BRANCH-009.6 The remote has the tag on another commit
  Given origin has "v1.2.0" on a different commit
  When I push the tag
  Then the remote's tag is not moved and nothing is forced
  And an error says "origin already has a tag v1.2.0 on another commit. Quarry does not overwrite tags on a remote." above git's message without "hint:" lines

Scenario: BRANCH-009.7 No remote configured
  Given a repository with no remote
  When I open the menu of the label "v1.2.0"
  Then the entry reads "Push v1.2.0…" and is available
  When I choose it
  Then git is not run and Source Control opens on its Add Remote form with the message "This repository has no remote yet. Add one in Source Control."

Scenario: BRANCH-009.8 Other failures
  Given the remote cannot be reached
  When I push the tag
  Then an error shows git's message without "hint:" lines and the tag stays local

Scenario: BRANCH-009.9 One action at a time
  Given a pull is running
  When I open the menu of the label "v1.2.0"
  Then the Push entry is greyed out until the pull ends
```
