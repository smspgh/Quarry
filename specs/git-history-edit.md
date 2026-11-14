---
area: Edit History
prefix: HISTORY
---

# Edit History

Rewriting commits of the current branch from the commit graph: Undo Last Commit, Reword Message, Drop Commit and Squash into Parent on one commit, and an Edit History list (interactive rebase) to reorder commits and mark each pick / reword / squash / fixup / drop before running. Built as roadmap item 6 of `GIT-ROADMAP.md`; user documentation is in `docs/git.md` (Edit history).

Decisions (made where the roadmap left the choice open):

- **Owner decisions (2026-11-13).** (1) Pushed commits: warn, then offer Force Push. A history edit that would rewrite pushed commits warns in a danger dialog that names them, with Cancel as the default (HISTORY-006.3); afterwards the status line offers "Force Push…" (`git push --force-with-lease`), which asks again. Force Push itself (`git.forcePush`, the dialog, the status-line wording, the Rust remote operation) is specified in MERGE-009, which is built first; HISTORY-011 only adds what is particular to history edits. (2) The unsaved-tabs question (Save All / Continue Without Saving / Cancel) is specified once, in SAFE-001 to SAFE-003 (history edits: SAFE-003.5), and arrives with that area; nothing in this area asks about unsaved tabs. Open tabs are re-checked against the disk after every action, as today.
- **Where.** The four single-commit actions and "Edit History from Here…" are a new group in the graph's right-click menu, after the Reset entries (the planned order of the whole menu is in `specs/git-merge-rebase.md`, Decisions). Entries that cannot run are shown disabled with a tooltip that says why, never hidden, except Undo Last Commit, which only shows on the tip commit. `git.undoLastCommit` and `git.editHistory` are in the palette and in a Git › Edit History submenu ("Undo Last Commit…", "Edit History…"), which sits after Branches and Tags in the Git menu (same layout reference).
- **Only the current branch.** A commit qualifies when it is an ancestor of (or is) the tip of the checked-out branch. With a detached HEAD nothing in this area runs.
- **"Already pushed"** means: reachable from any remote-tracking branch as last fetched (not only the branch's own upstream, so a branch with no upstream is still protected). It is the definition of MERGE-006 and the same Rust helper, `pushed_commits` in `src-tauri/src/git.rs`. `git_unpushed` returns nothing without an upstream, so it is not enough on its own.
- **Pushed commits: warn loudly, do not refuse.** One danger-styled dialog names the remote branch, counts and lists the pushed commits, and has Cancel as its default button. The edit itself pushes nothing. Afterwards the status line offers "Force Push…" in place of the Pull buttons, which would bring the old commits back (MERGE-009).
- **Always show what is rewritten.** Every confirmation lists each commit that will get a new id (the edited one and all commits after it), oldest change first, up to 12 lines then "and N more", and gives the current tip id so the branch can be put back.
- **Cancel (or the choice that keeps things as they are) is the default button of every dialog here**; `choose()` in `src/lib/dialogs.ts` already takes a per-choice `default`, so the dialogs themselves need no change.
- **No backup branch** is created automatically (nothing is written that the user did not ask for); the dialog and the finished notification name the previous tip id instead.
- **Uncommitted changes.** Anything that replays commits refuses while tracked files have uncommitted changes (untracked files do not count), with the same "Commit or discard your changes first" dialog as a merge or rebase (MERGE-008.1). No automatic stash. The two exceptions touch only the tip and never the files: Undo Last Commit and Reword of the tip commit.
- **Merge commits.** A merge commit cannot itself be reworded, dropped, squashed or undone here, and no action replays across one: when a merge lies between the edited commit and the tip, the action is refused. Merges are never flattened and `--rebase-merges` is not used.
- **Root commit.** It can be reworded and can be the last row of the list; it cannot be dropped as a single action or squashed (it has no parent), and Undo Last Commit is off when the tip is the root.
- **Messages are collected before anything runs.** Reword and squash messages are typed up front (a strip in the graph tab, or inline in the list); git never opens an editor, and a message typed for a commit is still applied when the rebase stopped on a conflict before reaching it.
- **List order** is the graph's: newest at the top. Squash and fixup fold a row into the nearest row below it that is not dropped, so the row that cannot be squash / fixup is the bottom (oldest) one. Squash joins both messages (editable); fixup keeps only the lower row's message.
- **The list lives in the graph tab** (it replaces every row of the graph, the uncommitted-changes row of GRAPH-015 and stash rows included, until Run or Cancel); it is not a dialog and not a new tab kind, and it is not kept in the session. At most 100 commits.
- **The list's keys are its own.** P, R, S, F, D, Up, Down, Alt+Up, Alt+Down, Ctrl+Enter and Escape act on the list only while the list itself has the keyboard focus; they are not commands and not global shortcuts. With the focus in a message box of the list they are text or do what that box says; with the focus anywhere else (another tab, a panel, the palette) they keep their usual meaning, so Alt+Up / Alt+Down still move a line in an editor (`edit.moveLineUp` / `edit.moveLineDown`).
- **Only what changed is rewritten.** Rows below the lowest changed row keep their ids; the confirmation says so.
- **How it runs (decided while building).** A plan is `git rebase -i` with a todo Quarry wrote: `GIT_SEQUENCE_EDITOR` is `cp '<temporary file>'` (git runs it through its own sh; checked on Windows with spaces, parentheses, an apostrophe and backslashes in the path), `GIT_EDITOR=true`, and the user's `rebase.autoStash` / `rebaseMerges` / `updateRefs` / `autoSquash` / `missingCommitsCheck` are switched off for the run. A dropped commit is simply left out of the todo. A new message is an `exec` line after the commit (and after everything folded into it) that pipes the text into `git commit --amend -F -`; it is part of the rebase's own state, so it survives a conflict stop, Continue, and a restart of Quarry, and nothing of Quarry's is left behind. Squash is therefore `fixup` plus that line. The badge "Rebasing 2 of 4" counts commits, not these lines. Commit hooks (`pre-commit`, `commit-msg`) are not run for a reworded message (`--no-verify`): the changes were committed before, and a failing hook would stop the rebase half-way with no button for it. A commit that becomes empty is kept (`--empty=keep`). Dropping the tip commit alone replays nothing: the branch is moved back to its parent. At most 1000 commits are replayed by one edit.
- **Conflicts** use the existing stopped-rebase flow unchanged (badge "Rebasing 2 of 4", Continue Rebase, Skip, Abort; CONFLICT-011 to CONFLICT-013). Source Control is shown when the edit stops, as for a merge or rebase started in Quarry (MERGE-007).

## HISTORY-001: Edit-history entries in a commit's right-click menu

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — hosts the group after the Reset entries (`historyEdit.menu(commit)`)
  - `src/components/GraphHistory.tsx` — new; `useGraphHistory`: the menu group (`ENTRIES`; disabled entries carry the reason as their tooltip, Undo only on the tip), the message strip, the list host
  - `src/lib/historyEdit.ts` — new; pure `editAllowed(action, commit, ctx)` → the reason an entry is off, or null (busy, operation, detached, not on the branch, merge, merge after, root, merge parent); `graphEditContext` (a commit's place from the graph's loaded rows), `rangeEditContext` (the same from a fresh range)
  - `src/lib/gitStatus.ts` — `finishFirst(operation)` (the shared "Finish or abort the rebase first" sentence)
  - `src/lib/git.ts` — `historyGuard` (the fresh re-check when an entry is chosen), `busy`
  - `src/lib/gitApi.ts` — `git.historyRange`, `GitHistoryCommit`, `GitHistoryRange`
  - `src-tauri/src/git/history.rs` — new; `history_range` / `git_history_range` (`merge-base --is-ancestor`, `log --topo-order` with parents; pushed = the definition of `pushed_commits`)
  - `src-tauri/src/git.rs` — `pushed_commits` (which remote branch holds the pushed commits), `pub mod history`
- Tests: `src/__tests__/historyEdit.test.ts`, `src/__tests__/graphHistory.test.tsx`, `src-tauri/src/git/history.rs`
- Docs: `docs/git.md`

**As a** developer looking at a commit in the graph
**I want** the menu to offer the history edits that are possible for that commit and say why the others are not
**So that** I never start a rewrite that cannot work, and I know what to do instead

```gherkin
Scenario: HISTORY-001.1 The entries
  Given I am on "main" with a clean working tree and the commits, newest first, e5f6a7b "Add tab limit tests", d4e5f6a "Fix typo", c3d4e5f "Add tab limit", b2c3d4e "Rename helper", a1b2c3d "Initial commit"
  When I right-click d4e5f6a
  Then after the Reset entries the menu has a separator and "Reword Message…", "Squash into Parent…", "Drop Commit…" and "Edit History from Here…"
  And "Drop Commit…" is styled as dangerous
  And all four are enabled

Scenario: HISTORY-001.2 Undo Last Commit only on the tip
  When I right-click the tip commit e5f6a7b
  Then the group also has "Undo Last Commit…" as its first entry
  And when I right-click any other commit the menu has no "Undo Last Commit…" entry

Scenario: HISTORY-001.3 A commit that is not on the current branch
  Given I am on "main" and commit 9a8b7c6 is only on branch "feature"
  When I right-click 9a8b7c6
  Then the four entries are shown disabled
  And their tooltip says "Only commits on main can be edited. Switch to the commit's branch first."
  And Cherry-pick, Revert and the Reset entries are unaffected

Scenario: HISTORY-001.4 Detached HEAD
  Given HEAD is detached
  When I right-click any commit
  Then every entry of the group is disabled with the tooltip "You are not on a branch. Switch to a branch to edit its history."

Scenario: HISTORY-001.5 A merge commit
  Given 7c6d5e4 "Merge branch 'feature'" is a merge commit on "main"
  When I right-click it
  Then "Reword Message…", "Squash into Parent…", "Drop Commit…" and "Edit History from Here…" are disabled
  And their tooltip says "A merge commit can't be edited here. Use Revert This Commit… to undo it."

Scenario: HISTORY-001.6 A merge between the commit and the tip
  Given the merge commit 7c6d5e4 was made after c3d4e5f on "main"
  When I right-click c3d4e5f
  Then the four entries are disabled
  And their tooltip says "The merge commit 7c6d5e4 comes after this commit. Quarry does not rewrite across a merge."
  And a commit made after 7c6d5e4 still has the entries enabled

Scenario: HISTORY-001.7 The root commit
  When I right-click the first commit of the repository, a1b2c3d
  Then "Reword Message…" and "Edit History from Here…" are enabled
  And "Squash into Parent…" is disabled with the tooltip "This is the first commit: it has no parent."
  And "Drop Commit…" is disabled with the tooltip "The first commit can't be dropped."

Scenario: HISTORY-001.8 The only commit cannot be undone
  Given "main" has a single commit a1b2c3d
  When I right-click it
  Then "Undo Last Commit…" is disabled with the tooltip "This is the first commit: there is nothing to go back to."

Scenario: HISTORY-001.9 An operation is in progress
  Given a rebase, merge, cherry-pick, revert or patch series is stopped part-way
  When I right-click a commit on the current branch
  Then every entry of the group is disabled
  And the tooltip names the operation, for example "Finish or abort the rebase first"

Scenario: HISTORY-001.10 Git is busy
  Given another git action is running
  When I right-click a commit
  Then every entry of the group is disabled until it finishes
```

## HISTORY-002: Undo Last Commit

- Status: draft
- Commands: `git.undoLastCommit`
- Files:
  - `src/components/GraphHistory.tsx` — "Undo Last Commit…" entry on the tip commit
  - `src/lib/gitCommands.ts` — `git.undoLastCommit` ("Undo Last Commit…", `enabled` from `commandBlocked`)
  - `src/components/MenuBar.tsx` — Git › Edit History submenu (Undo Last Commit…, Edit History…), after Branches and Tags
  - `src/lib/historyEdit.ts` — `commandBlocked("undo", repo, busy)`, `historyConfirm("undo", …)`, `historyDone`
  - `src/lib/git.ts` — `undoLastCommit(root)` (guard, asks, runs, sets `useGit().undone`, `checkExternalChanges`)
  - `src/components/panels/GitPanel.tsx` — the message box takes `useGit().undone` (the undone commit's message) when it is empty
  - `src/lib/gitApi.ts` — `GitStatus.headParents` (the tip is the first commit or a merge: the command is greyed out)
  - `src-tauri/src/git/history.rs` — `history_rewrite` action `undo` (`reset --soft HEAD~1`; refuses a merge or root tip, a detached HEAD, an operation in progress and a tip that moved), `tip_parents`
  - `src-tauri/src/git.rs` — `GitStatus.head_parents`
- Tests: `src/__tests__/historyEdit.test.ts`, `src/__tests__/graphHistory.test.tsx`, `src-tauri/src/git/history.rs`
- Docs: `docs/git.md`

**As a** developer who committed too early
**I want** to take the last commit back and keep its changes
**So that** I can fix it and commit again without learning what a soft reset is

```gherkin
Scenario: HISTORY-002.1 Undo asks first
  Given I am on "main" and the tip is e5f6a7b "Add tab limit tests", not pushed
  When I choose "Undo Last Commit…" from its right-click menu
  Then a dialog "Undo the last commit?" says e5f6a7b "Add tab limit tests" leaves "main", its changes stay staged, and my files are not touched
  And its buttons are "Cancel" and "Undo Commit", with Cancel the default

Scenario: HISTORY-002.2 Undo
  When I confirm with "Undo Commit"
  Then "main" points at d4e5f6a "Fix typo"
  And the files changed by e5f6a7b are under Staged Changes with their content unchanged on disk
  And a notification says "Undid the last commit: its changes are staged. main was at e5f6a7b."
  And the graph reloads without e5f6a7b

Scenario: HISTORY-002.3 The message comes back
  Given the commit message box is empty
  When I undo the commit "Add tab limit tests"
  Then the message box contains "Add tab limit tests"
  But a message I had already typed in the box is left as it is

Scenario: HISTORY-002.4 Uncommitted changes are kept
  Given I have 1 staged file and 2 unstaged changes
  When I undo the last commit
  Then it runs without refusing
  And the 1 staged file and the 2 unstaged changes are still there beside the undone commit's staged changes

Scenario: HISTORY-002.5 From the command palette or the Git menu
  When I run "Git: Undo Last Commit…" from the command palette, or choose Git › Edit History › Undo Last Commit…
  Then the same dialog is shown for the tip commit of the current branch

Scenario: HISTORY-002.6 The command is greyed out when it cannot run
  Given HEAD is detached, or the tip is a merge commit, or the branch has one commit, or an operation is in progress
  When I open the command palette or Git › Edit History
  Then "Undo Last Commit…" is greyed out

Scenario: HISTORY-002.7 The last commit is already pushed
  Given the tip e5f6a7b is on "origin/main"
  When I choose "Undo Last Commit…"
  Then the dialog is the pushed-commits warning of HISTORY-006.3 instead, with the confirm button "Undo Pushed Commit"

Scenario: HISTORY-002.8 Cancel
  When I cancel the dialog or press Escape
  Then git is not run and the branch, the staged files and the message box are unchanged
```

## HISTORY-003: Reword a commit's message

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphHistory.tsx` — "Reword Message…" entry, `MessageStrip` (multi-line; Ctrl+Enter submits, Escape closes), submits to `rewordCommit`
  - `src/components/GraphView.tsx` — renders the strip above the rows
  - `src/lib/historyEdit.ts` — `singlePlan("reword", …)`, `planTodo`, `historyConfirm("reword", …)`, `historyDone`
  - `src/lib/git.ts` — `loadEditCommit` (the whole message, read fresh; refuses before the strip opens), `rewordCommit(root, sha, message)` (guards of HISTORY-006, busy label "Rewording…")
  - `src/lib/gitApi.ts` — `git.historyRewrite`, `GitHistoryStep`
  - `src-tauri/src/git/history.rs` — `history_rewrite` / `git_history_rewrite`: tip = `commit --amend --only -F -`; older = `rebase -i` with `GIT_SEQUENCE_EDITOR` copying a todo Quarry wrote (`--root` for the first commit); the new message is an `exec` line of that todo (`todo_text`), so it survives a stop
  - `src/App.tsx` — leaves Ctrl+Enter and Escape to the strip (`data-history-keys`)
  - `src/styles/app.css` — `.graph-message-strip`
- Tests: `src/__tests__/historyEdit.test.ts`, `src/__tests__/graphHistory.test.tsx`, `src-tauri/src/git/history.rs`
- Docs: `docs/git.md`

**As a** developer who spots a wrong commit message a few commits back
**I want** to change that message from the graph
**So that** the history reads correctly without an interactive rebase in a terminal

```gherkin
Scenario: HISTORY-003.1 The message strip
  Given d4e5f6a has the message "Fix typo" and a body "In the tab limit dialog."
  When I choose "Reword Message…" on it
  Then a strip "New message for d4e5f6a:" appears with a multi-line box holding the whole current message, selected
  And its "Reword" button is disabled until the text differs from the current message
  And nothing has changed in the repository

Scenario: HISTORY-003.2 Reword the last commit
  Given the tip e5f6a7b "Add tab limit tsts" is not pushed
  When I change the text to "Add tab limit tests" and click "Reword"
  Then a dialog "Reword this commit?" says e5f6a7b gets the new message and a new id, and no other commit changes
  When I confirm with "Reword"
  Then the tip's message is "Add tab limit tests" and its changes and author are the same
  And a notification says "Reworded the commit. main was at e5f6a7b."

Scenario: HISTORY-003.3 Reword an older commit lists what gets a new id
  Given c3d4e5f "Add tab limit" has 2 commits after it, d4e5f6a "Fix typo" and e5f6a7b "Add tab limit tests", none pushed
  When I reword c3d4e5f to "Add a limit on open tabs"
  Then the dialog says "3 commits on main get new ids:" and lists c3d4e5f "Add tab limit" (reworded to "Add a limit on open tabs"), d4e5f6a "Fix typo" (new id) and e5f6a7b "Add tab limit tests" (new id)
  And it says "main is now at e5f6a7b: Reset main to Here on that commit puts it back."
  When I confirm with "Reword"
  Then the three commits are replaced by three with the same changes, authors and dates, the first with the new message
  And b2c3d4e and everything before it keep their ids

Scenario: HISTORY-003.4 Keyboard
  Given the message strip is open
  When I press Ctrl+Enter
  Then it submits like the "Reword" button
  And Enter alone adds a line to the message
  And Escape closes the strip and nothing is changed

Scenario: HISTORY-003.5 An empty message is not accepted
  Given the message strip is open
  When I clear the box
  Then the "Reword" button is disabled

Scenario: HISTORY-003.6 The last commit with uncommitted changes
  Given I have 2 staged files and 1 unstaged change
  When I reword the tip commit and confirm
  Then only its message changes
  And the 2 staged files are still staged and not part of the commit

Scenario: HISTORY-003.7 The first commit
  When I reword the repository's first commit a1b2c3d and confirm
  Then its message changes and every commit on the branch gets a new id, as the dialog listed

Scenario: HISTORY-003.8 No editor ever opens
  Given git's configured editor is a program that would wait for input
  When I reword any commit
  Then it finishes without that program being started
  And the repository's pre-commit and commit-msg hooks are not run for the new message

Scenario: HISTORY-003.9 Cancel
  When I cancel the "Reword this commit?" dialog
  Then git is not run and the strip stays open with my text
```

## HISTORY-004: Drop a commit

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphHistory.tsx` — "Drop Commit…" entry (dangerous style)
  - `src/lib/historyEdit.ts` — `singlePlan("drop", …)`, `planTodo`, `historyConfirm("drop", …)` (danger), `historyDone`
  - `src/lib/git.ts` — `dropCommit(root, sha)` (guards of HISTORY-006, busy label "Dropping…", `checkExternalChanges`)
  - `src-tauri/src/git/history.rs` — `history_rewrite` with a `drop` step (the commit is left out of the todo; the tip alone = `reset --hard` to its parent, tracked files being clean)
- Tests: `src/__tests__/historyEdit.test.ts`, `src/__tests__/graphHistory.test.tsx`, `src-tauri/src/git/history.rs`
- Docs: `docs/git.md`

**As a** developer with a commit on my branch that should never have been made
**I want** to remove that one commit and keep the ones after it
**So that** I do not have to reset and redo the later work

```gherkin
Scenario: HISTORY-004.1 Drop asks first and says the changes are gone
  Given d4e5f6a "Fix typo" is followed by e5f6a7b "Add tab limit tests", none pushed, and the working tree is clean
  When I choose "Drop Commit…" on d4e5f6a
  Then a danger dialog "Drop this commit?" says d4e5f6a "Fix typo" and its changes are removed from "main" and are not kept anywhere in my files
  And it lists what gets a new id: e5f6a7b "Add tab limit tests"
  And it says "main is now at e5f6a7b"
  And its buttons are "Cancel" (default) and "Drop Commit"

Scenario: HISTORY-004.2 Drop a commit in the middle
  When I confirm with "Drop Commit"
  Then "main" no longer has "Fix typo" and its changes are gone from my files
  And "Add tab limit tests" is still the tip, with a new id and the same changes
  And a notification says "Dropped \"Fix typo\". main was at e5f6a7b."
  And open tabs of files that changed on disk are re-checked

Scenario: HISTORY-004.3 Drop the last commit
  When I drop the tip commit e5f6a7b and confirm
  Then "main" points at d4e5f6a and the files match it
  And the dialog had said that no other commit changes

Scenario: HISTORY-004.4 Later commits depend on it
  Given e5f6a7b changes the same lines as d4e5f6a
  When I drop d4e5f6a and confirm
  Then the rebase stops on a conflict and is handled as in HISTORY-010
  And nothing is lost: "Abort" puts "main" back at e5f6a7b

Scenario: HISTORY-004.5 Cancel
  When I cancel the dialog
  Then git is not run and the branch and files are unchanged

Scenario: HISTORY-004.6 Untracked files are left alone
  Given I have 2 untracked files and no other changes
  When I drop a commit that does not touch them
  Then it runs and the 2 untracked files are still there
```

## HISTORY-005: Squash a commit into its parent

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphHistory.tsx` — "Squash into Parent…" entry, message strip prefilled with the joined message
  - `src/lib/historyEdit.ts` — `squashMessage(parent, child)`, `singlePlan("squash", …)`, `planTodo`, `historyConfirm("squash", …)`, `historyDone`
  - `src/lib/git.ts` — `loadEditCommit(root, sha, "squash")`, `squashCommit(root, sha, message)` (reads the range from the parent; guards of HISTORY-006, busy label "Squashing…")
  - `src-tauri/src/git/history.rs` — `history_rewrite` with a `fixup` step and the message on the parent's `pick`; `history_range` from the parent (merge / pushed)
- Tests: `src/__tests__/historyEdit.test.ts`, `src/__tests__/graphHistory.test.tsx`, `src-tauri/src/git/history.rs`
- Docs: `docs/git.md`

**As a** developer who made a small follow-up commit
**I want** to fold it into the commit before it
**So that** the history has one complete commit instead of a change and its fix

```gherkin
Scenario: HISTORY-005.1 The combined message
  Given d4e5f6a "Fix typo" has the parent c3d4e5f "Add tab limit"
  When I choose "Squash into Parent…" on d4e5f6a
  Then a strip "Message for c3d4e5f + d4e5f6a:" appears with a box containing "Add tab limit", a blank line, then "Fix typo"
  And its "Squash" button is enabled because the message is not empty

Scenario: HISTORY-005.2 Squash
  Given none of the commits are pushed and the working tree is clean
  When I shorten the message to "Add tab limit" and click "Squash"
  Then a dialog "Squash into the parent?" says d4e5f6a "Fix typo" is folded into c3d4e5f "Add tab limit", and lists the commits that get new ids: c3d4e5f (takes in the commits folded into it), d4e5f6a (folded into c3d4e5f) and e5f6a7b "Add tab limit tests" (new id)
  When I confirm with "Squash"
  Then "main" has one commit "Add tab limit" holding the changes of both, with the author and date of c3d4e5f
  And "Add tab limit tests" follows it with the same changes
  And the files in my working folder are exactly as before
  And a notification says "Squashed \"Fix typo\" into \"Add tab limit\". main was at e5f6a7b."

Scenario: HISTORY-005.3 Squash the last commit
  When I squash the tip commit into its parent and confirm
  Then the branch is one commit shorter and the new tip holds both commits' changes

Scenario: HISTORY-005.4 The parent is a merge commit
  Given the parent of d4e5f6a is the merge commit 7c6d5e4
  When I right-click d4e5f6a
  Then "Squash into Parent…" is disabled with the tooltip "The parent is a merge commit: nothing can be squashed into it."

Scenario: HISTORY-005.5 The parent is pushed but the commit is not
  Given c3d4e5f is on "origin/main" and d4e5f6a is not
  When I squash d4e5f6a into it
  Then the dialog is the pushed-commits warning of HISTORY-006.3, naming c3d4e5f as the pushed commit that is rewritten

Scenario: HISTORY-005.6 Cancel
  When I press Escape in the strip or cancel the dialog
  Then git is not run and both commits are unchanged

Scenario: HISTORY-005.7 No stop for a message
  When I confirm a squash
  Then it finishes with the message I typed, without an editor opening and without the rebase stopping to ask for one
```

## HISTORY-006: Guards on every history edit

- Status: draft
- Commands: none
- Files:
  - `src/lib/historyEdit.ts` — `planTodo` (the lowest changed commit and everything after it), `historyConfirm` (list of up to 12 lines + "and N more", current tip, pushed variant with `kind: "danger"`), `rewriteList`, `movedText`
  - `src/lib/gitMerge.ts` — `dirtyRefusal("history", count)` (the "Commit or discard your changes first" dialog of MERGE-008.1, worded for a history edit), `trackedChanges`, `LISTED`
  - `src/lib/git.ts` — `historyGuard(root, from, check, replay)` used by every entry point (menu actions, the list's Run, the commands): fresh status and `historyRange`, busy / operation / branch / merge checks, dirty check, then the dialog; `historyRun` (maps `quarry-moved`)
  - `src/lib/dialogs.ts` — `choose()` (unchanged: `default: true` on Cancel)
  - `src-tauri/src/git/history.rs` — `history_range` (pushed = reachable from any remote-tracking branch, and which one: `pushed_commits`), `history_rewrite` re-checks before running: expected tip id (`MOVED`), clean tracked files, no operation, on a branch, the steps name exactly the commits of the range, no merge among them
  - `src-tauri/src/git.rs` — `pushed_commits` (shared with MERGE-006)
- Tests: `src/__tests__/historyEdit.test.ts`, `src-tauri/src/git/history.rs`
- Docs: `docs/git.md`

**As a** developer about to change commits that exist
**I want** to be shown exactly which commits will be rewritten, warned loudly when any is already pushed, and stopped when the rewrite cannot run safely
**So that** I never rewrite shared history or lose work by accident

```gherkin
Scenario: HISTORY-006.1 The confirmation lists every rewritten commit
  Given I edit a commit that has 3 commits after it on "main"
  When the confirmation dialog opens
  Then it lists the 4 commits that get new ids, oldest first, each with its short id and message and what happens to it
  And it gives the current tip id, for example "main is now at e5f6a7b"
  And Cancel is the default button, so pressing Enter or Escape changes nothing

Scenario: HISTORY-006.2 A long list is shortened, not hidden
  Given the edit rewrites 20 commits
  When the confirmation dialog opens
  Then it says "20 commits on main get new ids:", lists the first 12 and ends with "and 8 more"

Scenario: HISTORY-006.3 Pushed commits get a loud warning
  Given "origin/main" is at d4e5f6a, and I reword c3d4e5f, which has d4e5f6a and e5f6a7b after it
  When I submit the new message
  Then a danger dialog "Rewrite commits that are already pushed?" says 2 of the 3 commits are on "origin/main": c3d4e5f "Add tab limit" and d4e5f6a "Fix typo"
  And it says anyone who has pulled them will have to repair their copy, that a normal Push will be refused afterwards and Quarry will then offer Force Push, and that Revert This Commit… is the safe way to undo a pushed commit
  And its buttons are "Cancel" (default) and "Rewrite Pushed Commits"
  And no second, ordinary confirmation follows

Scenario: HISTORY-006.4 Pushed on another remote branch
  Given "main" has no upstream but c3d4e5f is on "origin/release"
  When I drop c3d4e5f
  Then the pushed warning is shown and names "origin/release"

Scenario: HISTORY-006.5 Nothing is pushed when there is no remote
  Given the repository has no remote
  When I edit a commit
  Then the ordinary confirmation is shown, without the pushed warning

Scenario: HISTORY-006.6 Uncommitted changes block a replay
  Given I have 3 uncommitted changes to tracked files
  When I choose "Drop Commit…", "Squash into Parent…" or "Reword Message…" on a commit that is not the tip
  Then the dialog "Commit or discard your changes first" of MERGE-008.1 says there are 3 uncommitted changes to tracked files and that a history edit is only started from a clean state, so that Abort can bring everything back exactly as it was
  And for Reword and Squash it comes before the message strip opens
  And its buttons are "Show Source Control" and "Close", with "Close" the default
  And git is not run, and my changes are not stashed, staged or touched

Scenario: HISTORY-006.7 The branch moved while I was deciding
  Given a confirmation dialog is open for "main" at e5f6a7b
  And a commit is made on "main" from a terminal
  When I confirm
  Then nothing is rewritten and an error says "main has changed since you started. Nothing was rewritten."
  And the graph reloads

Scenario: HISTORY-006.8 An operation started in the meantime
  Given a cherry-pick was started from a terminal after the menu opened
  When I choose a history edit and confirm
  Then it is refused with "Finish or abort the cherry-pick first." and nothing is rewritten

Scenario: HISTORY-006.9 No route skips the guards
  When I start a history edit from the right-click menu, from the Edit History list, or from the command palette
  Then the same checks and the same confirmation run before git does
  And there is no setting or key that runs a history edit without the confirmation

Scenario: HISTORY-006.10 What is never done
  When any history edit runs
  Then commits on other branches, tags and stashes are not changed
  And nothing is pushed, fetched or force-pushed as part of it: Force Push is only ever offered afterwards (HISTORY-011)
  And a tag or another branch that pointed at a rewritten commit still points at the old commit
```

## HISTORY-007: Open the Edit History list

- Status: draft
- Commands: `git.editHistory`
- Files:
  - `src/components/HistoryEditList.tsx` — new; the list shown in the graph tab in place of the commit rows (header, rows, Reset List / Cancel / Run)
  - `src/components/GraphHistory.tsx` — "Edit History from Here…" entry; hosts `HistoryEditList` for `useGit().historyEdit`; closes it when the tab closes or an operation stops
  - `src/components/GraphView.tsx` — renders the list; the class `editing-history` hides the commit rows, the find box, the search results and the panes below while it is open
  - `src/lib/gitCommands.ts` — `git.editHistory` ("Edit History…": opens the graph tab with the list over the commits not yet pushed)
  - `src/components/MenuBar.tsx` — Git › Edit History › Edit History… (the submenu of HISTORY-002)
  - `src/lib/historyEdit.ts` — `MAX_PLAN` = 100, `initialPlan(commits)` (every row pick), `defaultBase(range)` (oldest commit not pushed, stopping at a merge), `listWords`, `tooMany`, `allPushed`, `commandBlocked("list", …)`
  - `src/lib/git.ts` — `openHistoryEdit(root, fromSha?)`, `closeHistoryEdit`, `useGit().historyEdit`, `openGraph`
  - `src-tauri/src/git/history.rs` — `history_range` (commits from a commit to the tip with message, author, date, pushed, parents; without a commit: the ones no remote has)
  - `src/styles/app.css` — `.history-edit`, `.he-*` rows (colours from tokens.css)
- Tests: `src/__tests__/historyEdit.test.ts`, `src/__tests__/historyEditList.test.tsx`, `src/__tests__/graphHistory.test.tsx`, `src-tauri/src/git/history.rs`
- Docs: `docs/git.md`

**As a** developer cleaning up a branch before sharing it
**I want** to open my recent commits as an editable list
**So that** I can plan several changes to the history and apply them in one go

```gherkin
Scenario: HISTORY-007.1 Open from a commit
  Given I am on "main" with a clean working tree and the commits, newest first, e5f6a7b, d4e5f6a, c3d4e5f, b2c3d4e
  When I right-click c3d4e5f and choose "Edit History from Here…"
  Then the graph's commit rows are replaced by a list headed "Edit history of main: 3 commits since b2c3d4e"
  And it has 3 rows, newest at the top: e5f6a7b "Add tab limit tests", d4e5f6a "Fix typo", c3d4e5f "Add tab limit"
  And each row shows a drag handle, an action set to "Pick", the short id, the message, the author and the date
  And under the rows a line says "b2c3d4e Rename helper and earlier commits are not changed"
  And the buttons "Run" (disabled) and "Cancel" are shown

Scenario: HISTORY-007.2 Nothing has happened yet
  When the list opens
  Then git has changed nothing: no rebase is in progress and the Source Control panel shows no operation

Scenario: HISTORY-007.3 Pushed rows are marked
  Given c3d4e5f is on "origin/main"
  When the list opens from c3d4e5f
  Then its row carries a "pushed" badge with the tooltip "Already on origin/main"
  And a warning line above the rows says "1 of these commits is already pushed. Changing it or anything below a change rewrites pushed history."

Scenario: HISTORY-007.4 Open from the command palette or the Git menu
  Given "origin/main" is at b2c3d4e and 3 commits after it are not pushed
  When I run "Git: Edit History…" from the command palette, or choose Git › Edit History › Edit History…
  Then the commit graph tab opens (or comes to the front) with the list of those 3 commits

Scenario: HISTORY-007.5 The command when everything is pushed
  Given every commit on "main" is on "origin/main"
  When I run "Git: Edit History…"
  Then a message says "Every commit on main is already pushed. To rewrite pushed commits, right-click a commit in the graph and choose Edit History from Here…"
  And no list opens

Scenario: HISTORY-007.6 The command with no repository or no branch
  Given no folder in a git repository is open, or HEAD is detached, or an operation is in progress
  When I open the command palette
  Then "Git: Edit History…" is greyed out

Scenario: HISTORY-007.7 Uncommitted changes
  Given I have 2 uncommitted changes to tracked files
  When I choose "Edit History from Here…"
  Then the dialog "Commit or discard your changes first" is shown and no list opens

Scenario: HISTORY-007.8 Too many commits
  Given the chosen commit has 150 commits after it
  When I choose "Edit History from Here…"
  Then a message says "That is 151 commits. The list takes at most 100: pick a more recent commit."
  And no list opens

Scenario: HISTORY-007.9 From the first commit
  When I choose "Edit History from Here…" on the repository's first commit
  Then the list holds every commit of the branch and the line under the rows says "This is the whole history of main"

Scenario: HISTORY-007.10 The rest of the application stays usable
  Given the list is open
  When I switch to another tab and come back
  Then the list is still there with my choices
  But after closing the graph tab or restarting Quarry it is gone and nothing was changed
```

## HISTORY-008: Plan the changes in the list

- Status: draft
- Commands: none
- Files:
  - `src/components/HistoryEditList.tsx` — rows (drag handle with pointer drag, action `Select`, message boxes), problem markers, "Reset List"; key handling in the list's own `onKeyDown`, only while the list element itself (not a message box or the action picker inside it) has the focus: the keys are not registered as commands
  - `src/App.tsx` — the global shortcut handler leaves Alt+Up / Alt+Down, Ctrl+Enter and Escape alone inside `[data-history-keys]` (as it does for the Explorer tree's `data-file-keys`), so Alt+Up / Alt+Down do not also run `edit.moveLineUp` / `edit.moveLineDown`
  - `src/components/Select.tsx` — the action picker (no native select); an option can be `disabled` with the reason as its tooltip, and a `hint` is also the option's tooltip
  - `src/lib/historyEdit.ts` — `PlanRow`, `ROW_ACTIONS`, `moveRow`, `setAction`, `setMessage`, `squashTarget` (nearest row below that is kept as a commit), `foldedInto`, `groupMessage`, `boxMessage`, `finalMessage`, `planProblems`, `allDropped`, `planChanged`
- Tests: `src/__tests__/historyEdit.test.ts`, `src/__tests__/historyEditList.test.tsx`
- Docs: `docs/git.md`

**As a** developer with the Edit History list open
**I want** to reorder the commits and mark each one pick, reword, squash, fixup or drop, by mouse or keyboard
**So that** I can shape the branch exactly before anything is rewritten

```gherkin
Scenario: HISTORY-008.1 Choose an action
  Given the list shows e5f6a7b, d4e5f6a and c3d4e5f, all "Pick"
  When I open the action of d4e5f6a
  Then it offers "Pick", "Reword", "Squash", "Fixup" and "Drop"
  When I choose "Drop"
  Then the row is struck through and dimmed
  And "Run" becomes enabled

Scenario: HISTORY-008.2 Reorder by dragging
  When I drag the row e5f6a7b by its handle and drop it below d4e5f6a
  Then the order is d4e5f6a, e5f6a7b, c3d4e5f
  And a line shows where the row will land while I drag
  And the list scrolls when I drag near its top or bottom edge

Scenario: HISTORY-008.3 Reorder by keyboard
  Given the list has focus and the row e5f6a7b is selected at the top
  When I press Alt+Down
  Then it moves down one place and stays selected
  And Alt+Up moves it back
  And Alt+Up on the top row and Alt+Down on the bottom row do nothing

Scenario: HISTORY-008.4 Move and mark with keys only
  Given the list has focus
  When I press Down or Up
  Then the selection moves between rows
  And P, R, S, F and D set the selected row to Pick, Reword, Squash, Fixup and Drop
  And Ctrl+Enter presses "Run" when it is enabled, and Escape presses "Cancel"

Scenario: HISTORY-008.5 Reword in place
  When I set d4e5f6a "Fix typo" to "Reword"
  Then a multi-line message box opens under the row holding its whole message, with focus
  When I type "Fix a typo in the tab limit dialog" and press Ctrl+Enter or click outside the box
  Then the box closes and the row shows the new message with a "reworded" mark, and the old one in its tooltip
  And Enter on the selected row, or a double-click on its message, opens the box again
  And letter keys typed in the box are text, not actions

Scenario: HISTORY-008.6 Reword with the message unchanged
  Given a row is set to "Reword" and its message is left as it was
  When I look at the row
  Then it counts as "Pick": on its own it does not enable "Run"

Scenario: HISTORY-008.7 Squash folds into the row below
  Given the order e5f6a7b, d4e5f6a "Fix typo", c3d4e5f "Add tab limit"
  When I set d4e5f6a to "Squash"
  Then the row is indented with an arrow and the short id c3d4e5f
  And c3d4e5f shows a message box containing "Add tab limit", a blank line, then "Fix typo", which I can edit
  And the tooltip of "Squash" says "Fold into the commit below and join the messages"

Scenario: HISTORY-008.8 Fixup throws its message away
  When I set d4e5f6a to "Fixup"
  Then the row is indented with an arrow and the short id c3d4e5f
  And c3d4e5f keeps the message "Add tab limit" with no message box
  And the tooltip of "Fixup" says "Fold into the commit below and discard this message"

Scenario: HISTORY-008.9 Several rows fold into one
  Given e5f6a7b and d4e5f6a are both set to "Squash"
  When I look at c3d4e5f
  Then its message box holds the three messages, oldest first, separated by blank lines

Scenario: HISTORY-008.10 The bottom row cannot be squashed
  When I open the action of the bottom (oldest) row
  Then "Squash" and "Fixup" are disabled with the tooltip "There is no commit below to fold into"

Scenario: HISTORY-008.11 A squash that ends up with nothing below it
  Given d4e5f6a is set to "Squash" and c3d4e5f is the bottom row
  When I set c3d4e5f to "Drop", or move d4e5f6a to the bottom
  Then d4e5f6a is marked with "Nothing below to fold into: choose Pick or move it up"
  And "Run" is disabled until that is fixed

Scenario: HISTORY-008.12 A squash skips dropped rows
  Given the order e5f6a7b (Squash), d4e5f6a (Drop), c3d4e5f (Pick)
  When I look at e5f6a7b
  Then its arrow points at c3d4e5f

Scenario: HISTORY-008.13 Dropping everything is not a rebase
  When I set every row to "Drop"
  Then "Run" is disabled and a note says "To remove all of these commits, use Reset main to Here on b2c3d4e"

Scenario: HISTORY-008.14 Run only when something changes
  Given every row is "Pick" in its original order
  Then "Run" is disabled
  When I move a row and then move it back
  Then "Run" is disabled again

Scenario: HISTORY-008.15 Start over
  Given I have reordered and marked rows
  When I click "Reset List"
  Then every row is back to "Pick" in its original order with its original message

Scenario: HISTORY-008.16 An empty reword or squash message
  When I clear the message box of a reworded row or of a squash target
  Then the row is marked "A commit needs a message" and "Run" is disabled

Scenario: HISTORY-008.17 The keys only act while the list has focus
  Given the Edit History list is open with the row d4e5f6a selected and set to "Pick"
  When I click into the Source Control panel's message box, or switch to a text tab, and press D, S or Alt+Down there
  Then no row of the list changes its action or its place
  And with the focus on a row's action picker the letters are that picker's type-ahead (they choose an action for that row only)
  And the letters are typed as text, and Alt+Down in the text tab moves the editor's line down as usual
  And with the focus in the list, Alt+Down moves the selected row and no line in any editor
```

## HISTORY-009: Run or cancel the Edit History list

- Status: draft
- Commands: none
- Files:
  - `src/components/HistoryEditList.tsx` — "Run" / "Cancel", closes on success or a stop, stays open on a refusal, reloads when the branch moved
  - `src/lib/historyEdit.ts` — `planTodo` (rows → steps, oldest first, starting at the lowest changed row), `historyConfirm("plan", …)` (one line per commit: new id / moved / reworded / folded into / dropped), `historyDone`
  - `src/lib/git.ts` — `runHistoryEdit(root, opened, rows)` (`historyGuard`, pushed flags read fresh, busy label "Rewriting history…", `checkExternalChanges`, graph reload through the status)
  - `src/lib/gitApi.ts` — `git.historyRewrite(root, "plan", expectedTip, base, steps)`
  - `src-tauri/src/git/history.rs` — `history_rewrite` → `run_plan`: writes the todo (`todo_text`) to a file in a temporary folder, runs `rebase -i --empty=keep` with `GIT_SEQUENCE_EDITOR` = `cp '<that file>'` and `GIT_EDITOR=true`, with autoStash / rebaseMerges / updateRefs / autoSquash / missingCommitsCheck switched off; messages are `exec` lines of the todo; the temporary folder is removed when the command returns
- Tests: `src/__tests__/historyEdit.test.ts`, `src/__tests__/historyEditList.test.tsx`, `src-tauri/src/git/history.rs`
- Docs: `docs/git.md`

**As a** developer who has planned changes in the Edit History list
**I want** to see the outcome spelled out, then run it or walk away
**So that** the rewrite does exactly what I planned, or nothing at all

```gherkin
Scenario: HISTORY-009.1 Run shows the plan first
  Given the list, newest first, is e5f6a7b (Pick), d4e5f6a "Fix typo" (Fixup), c3d4e5f "Add tab limit" (Reword to "Add a limit on open tabs"), and nothing is pushed
  When I click "Run"
  Then a dialog "Rewrite 3 commits on main?" lists, oldest first: c3d4e5f "Add tab limit" (reworded to "Add a limit on open tabs"); d4e5f6a "Fix typo" (folded into c3d4e5f, its message discarded); e5f6a7b "Add tab limit tests" (new id)
  And it says "main is now at e5f6a7b: Reset main to Here on that commit puts it back." and "b2c3d4e and earlier commits are not changed."
  And its buttons are "Cancel" (default) and "Rewrite 3 Commits"

Scenario: HISTORY-009.2 Run
  When I confirm with "Rewrite 3 Commits"
  Then "main" has, after b2c3d4e, "Add a limit on open tabs" holding the changes of c3d4e5f and d4e5f6a, then "Add tab limit tests"
  And the files in my working folder are exactly as before
  And the list closes, the graph reloads, and a notification says "Rewrote 3 commits on main. It was at e5f6a7b."
  And no editor opened and the Source Control panel shows no operation

Scenario: HISTORY-009.3 Reordered commits
  Given I moved e5f6a7b below d4e5f6a and the two do not touch the same lines
  When I run and confirm
  Then the branch has the two commits in the new order, each with its own message and changes

Scenario: HISTORY-009.4 Rows below the lowest change keep their ids
  Given the list has 5 rows and I only reworded the top one
  When I click "Run"
  Then the dialog reads "Rewrite 1 commit on main?" and lists only that commit
  And after running, the other 4 commits have the ids they had before

Scenario: HISTORY-009.5 Pushed commits in the plan
  Given the plan changes c3d4e5f, which is on "origin/main"
  When I click "Run"
  Then the dialog is the pushed-commits warning of HISTORY-006.3 with the plan's list, and its confirm button reads "Rewrite Pushed Commits"

Scenario: HISTORY-009.6 Cancelling the dialog keeps the plan
  When I cancel the confirmation dialog
  Then git is not run and the list is still open with my choices

Scenario: HISTORY-009.7 Cancel an untouched list
  Given I changed nothing in the list
  When I click "Cancel" or press Escape
  Then the list closes at once and the graph's commit rows are back

Scenario: HISTORY-009.8 Cancel a list with changes
  Given I have reordered or marked rows
  When I click "Cancel" or press Escape
  Then a dialog "Discard this plan?" has the buttons "Keep Editing" (default) and "Discard"
  And "Discard" closes the list with nothing rewritten, and "Keep Editing" returns to it

Scenario: HISTORY-009.9 The branch changed while the list was open
  Given the list was opened with "main" at e5f6a7b and a commit has since been added to "main"
  When I click "Run"
  Then nothing is rewritten and an error says "main has changed since this list was opened. Nothing was rewritten." (before the confirmation when the change is already there, after it when the commit arrived while the dialog was open)
  And the list reloads from the same base with every row "Pick"

Scenario: HISTORY-009.10 Uncommitted changes appeared
  Given I edited and saved a tracked file after opening the list
  When I click "Run"
  Then the dialog "Commit or discard your changes first" is shown, nothing is rewritten, and the list keeps my choices

Scenario: HISTORY-009.11 Run is disabled while git is busy
  Given another git action is running
  When I look at the list
  Then "Run" is disabled until it finishes

Scenario: HISTORY-009.12 A failure that is not a conflict
  Given git refuses to start the rebase
  When I run and confirm
  Then an error shows git's message without its "hint:" lines
  And the branch is where it was, no rebase is left in progress, and the list keeps my choices
```

## HISTORY-010: A history edit that stops on a conflict

- Status: draft
- Commands: none
- Files:
  - `src/lib/git.ts` — `historyRun` → `runStart` (reports a stop through `gitErrorText` and shows Source Control with `showPanel("git")`, as `startMerge` / `startRebase` do in MERGE-007); `continueOperation`, `abortOperation` (existing)
  - `src/lib/gitStatus.ts` — `gitErrorText` ("Stopped on a conflict…"), `operationWords("rebase")`, `operationDone`
  - `src/components/panels/GitPanel.tsx` — existing badge "Rebasing 2 of 4", Continue Rebase, Skip, Abort
  - `src/components/GraphView.tsx` — existing stopped-operation strip
  - `src/components/GraphHistory.tsx` — closes the Edit History list and the message strip when an operation is stopped
  - `src/components/HistoryEditList.tsx` — closes on a stop
  - `src-tauri/src/git/history.rs` — `todo_text` (messages live in the todo as `exec` lines, so `continue_operation` with `GIT_EDITOR=true` still applies them), `rebase_step` (the badge counts commits, not the `exec` lines)
  - `src-tauri/src/git.rs` — `operation`, `operation_step` (uses `history::rebase_step` for an interactive rebase), `continue_operation`, `abort_operation`
- Tests: `src-tauri/src/git/history.rs`, `src/__tests__/historyEdit.test.ts`, `src/__tests__/historyEditList.test.tsx`, `src/__tests__/graphHistory.test.tsx`
- Docs: `docs/git.md`

**As a** developer whose history edit hit a conflict part-way
**I want** it to stop in the same way as any rebase, with the same buttons
**So that** I can resolve and continue, skip, or go back, without a second way of doing things to learn

```gherkin
Scenario: HISTORY-010.1 The edit stops
  Given I drop d4e5f6a and the later commit e5f6a7b changes the same lines
  When I confirm
  Then an error says "Stopped on a conflict. Resolve the files under Merge Changes in Source Control and commit, or press Abort to go back." followed by git's CONFLICT lines (the sentence every stopped operation uses, GRAPH-012.5)
  And the Source Control panel is showing (it opens when it was not), with the badge "Rebasing 1 of 1", "Skip" and "Abort", and the file under Merge Changes
  And the graph tab shows the stopped-operation strip with "Abort"

Scenario: HISTORY-010.2 The list closes when a run stops
  Given I ran a plan of 4 commits from the Edit History list and the second one conflicts
  When the rebase stops
  Then the list closes and the graph's commit rows are back under the stopped-operation strip
  And the badge reads "Rebasing 2 of 4"

Scenario: HISTORY-010.3 The sides are explained
  Given the edit is stopped and I open the conflicted file
  When I look at its conflict bars
  Then each says "Rebasing: Current is the branch you are rebasing onto, Incoming is your own commit."

Scenario: HISTORY-010.4 Continue
  Given I resolved the file and marked it resolved
  When I click "Continue Rebase"
  Then the remaining commits are replayed and a notification says "The rebase is finished."
  And the branch has the planned commits

Scenario: HISTORY-010.5 Messages typed before the run survive a stop
  Given my plan reworded the fourth commit to "Add a limit on open tabs" and the rebase stopped on the second
  When I resolve the conflict and click "Continue Rebase"
  Then the fourth commit ends up with the message "Add a limit on open tabs"
  And a squash planned after the stop ends up with the combined message I typed
  And no editor opens

Scenario: HISTORY-010.6 It stops again
  Given the third commit conflicts too
  When I click "Continue Rebase"
  Then an error says "Stopped on a conflict." and the badge reads "Rebasing 3 of 4"

Scenario: HISTORY-010.7 Skip
  Given the edit is stopped with no file left in conflict
  When I click "Skip" and confirm with "Skip Commit"
  Then the commit it stopped on is left out and the rest of the plan carries on

Scenario: HISTORY-010.8 Abort puts everything back
  Given the edit is stopped on the second of 4 commits
  When I click "Abort" and confirm with "Abort Rebase"
  Then "main" is at the commit it was at before the edit, with every original commit and id
  And my files match it and a notification says "Aborted the rebase."

Scenario: HISTORY-010.9 No new edit while stopped
  Given a history edit is stopped on a conflict
  When I right-click a commit in the graph
  Then every edit-history entry is disabled with the tooltip "Finish or abort the rebase first"
  And "Git: Edit History…" and "Git: Undo Last Commit…" are greyed out in the command palette

Scenario: HISTORY-010.10 Quarry is closed while stopped
  Given a history edit is stopped and I restart Quarry
  When I open the Source Control panel
  Then the rebase is still shown as in progress and Continue Rebase, Skip and Abort work as before
```

## HISTORY-011: Force Push is offered after a history edit of pushed commits

- Status: draft
- Commands: `git.forcePush`
- Files:
  - `src/lib/git.ts` — `historyFinish`: after a confirmed edit that rewrote pushed commits, `markRewritten` (the `rewrotePushed` marker of MERGE-009) when it finished, `pendingRewrite` when it stopped (the marker is then set by Continue Rebase, forgotten by Abort); nothing else is added here: `forcePush`, its dialog, the status-line wording and the `"push-force"` remote operation are MERGE-009's
  - `src/lib/historyEdit.ts` — `historyDone` (the finished notification's extra sentence after a rewrite of pushed commits), `historyConfirm` (`pushed`: the danger dialog was shown)
  - `src/lib/gitStatus.ts` — `syncLine` (the rewritten case of MERGE-009 also shows when the branch is only behind its upstream, as after Undo Last Commit)
  - `src/lib/gitMerge.ts` — `isRewritten`
- Tests: `src/__tests__/historyEdit.test.ts`
- Docs: `docs/git.md`

**As a** developer who knowingly edited commits that were already pushed
**I want** the same guarded Force Push offer as after a rebase of pushed commits
**So that** I am not left with only Pull, which would bring the old commits back

```gherkin
Scenario: HISTORY-011.1 Offered after rewriting pushed commits
  Given I am on "main" tracking "origin/main" and I confirmed "Rewrite Pushed Commits" for an edit that rewrote 2 commits of "origin/main"
  When the rewrite finishes
  Then the notification ends "origin/main still has the old commits: use Force Push… in Source Control to replace them."
  And the Source Control status line offers "Force Push…" exactly as after a rebase of pushed commits (MERGE-009.1), with no Pull buttons
  And nothing is pushed by the rewrite itself and no dialog about pushing opens on its own

Scenario: HISTORY-011.2 The same Force Push
  Given the status line offers "Force Push…" after a history edit
  When I click it
  Then the danger dialog "Replace origin/main with your main?" of MERGE-009.2 opens, with "Cancel" the default
  And confirming, cancelling and a refusal behave as in MERGE-009

Scenario: HISTORY-011.3 Undo of a pushed commit
  Given the tip e5f6a7b is on "origin/main" and I confirmed "Undo Pushed Commit"
  When the undo has finished
  Then "main" is 1 commit behind "origin/main" with the undone changes staged
  And the status line offers "Force Push…" and not "Pull", which would bring the undone commit back

Scenario: HISTORY-011.4 Not offered when nothing pushed was rewritten
  Given I rewrote only commits that were never pushed
  When the rewrite finishes
  Then the status line counts the commits to push as usual, with no "Force Push…", and the ordinary "Push" works
  And when the pushed commits are on another remote branch and "main" has no upstream, the notification ends "origin/release still has the old commits." and no Force Push is offered (there is no upstream to replace)

Scenario: HISTORY-011.5 An edit that stopped on a conflict
  Given I confirmed "Rewrite Pushed Commits" and the rebase stopped on a conflict
  When I look at the status line while it is stopped
  Then it does not offer "Force Push…"
  And after "Continue Rebase" finishes the edit it does
  And after "Abort" it does not, because nothing was rewritten
```
