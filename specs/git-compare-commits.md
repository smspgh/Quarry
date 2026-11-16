---
area: Compare Commits
prefix: COMMITCMP
---

# Compare Commits

Comparing two points of a repository from the commit graph tab: two commits picked with Ctrl+click, a commit against the working tree, or a commit against a branch. The details pane becomes a comparison pane listing the files that differ, and each file opens in a Compare tab. Roadmap item 5 in `GIT-ROADMAP.md`; user documentation is in `docs/git.md` ("Comparing commits") and `docs/compare.md`. Selecting one commit and opening one commit's files are in `specs/git-graph.md` (GRAPH-009, GRAPH-010); Compare tabs themselves are in `specs/compare.md`.

Decisions (the roadmap left these open):

- **Where the result shows.** The graph's details pane switches to a comparison pane (same place, same resizer). There is no new tab kind and no new side panel.
- **Selection model.** A plain click selects one commit, as today. Ctrl+click on another row adds it as the second commit. At most two: a third Ctrl+click replaces the second commit and keeps the first. Ctrl+click on either selected commit takes it out, leaving the other selected alone. A plain click, an arrow key or Escape ends the comparison. Ctrl+click only works on commit rows of the graph: not on Search All History results (Show in Graph first), not on a stash row (STASH-010) and not on the uncommitted-changes row (GRAPH-015; Compare with Working Tree is the way to compare with uncommitted work). On those a Ctrl+click is a plain click.
- **Graph menu.** The three entries (Compare with <short id>, Compare with Working Tree, Compare with Branch…) form one group in the commit's right-click menu, after Check Out This Commit… and before Cherry-pick (the planned order of the whole menu is in `specs/git-merge-rebase.md`, Decisions). They are not on a stash row or the uncommitted-changes row, and not in the ref-label menu of MERGE-002. A right-click still selects the commit it is on (GRAPH-011.1), which ends a comparison that was showing; "Compare with <short id>" names the commit that was selected before the right-click.
- **Which side is which.** Left = the older state, right = the newer one. When one commit is an ancestor of the other, the ancestor is on the left whatever the click order. When neither is (two branches), the first selected commit is on the left and the Ctrl+clicked one on the right. A Swap Sides button flips them. The working tree is always on the right. Until git has answered, the heading shows the two ids in the order they were picked.
- **What "differs" means.** The direct difference between the two snapshots (`git diff A B`), not "changes since the common ancestor" (`A...B`). The pane's header says how many commits each side has that the other lacks, so a diverged pair is not misread.
- **Letters** (A, M, D, R) read left to right: A = only in the right side. Renames are detected (`-M`) and shown as one R row with the old path.
- **Compare tabs** follow the existing commit-file tabs (GRAPH-010, DIFF-014): labels `name @ shortid`, both sides read-only, opened as preview tabs that replace each other. A working-tree side behaves as in Compare with Last Commit (DIFF-006): the open tab's text (read-only snapshot) or the file on disk (editable).
- **Binary files** are listed like any other file; clicking one opens no tab and says "This file is binary.", as today.
- **Long lists** are never cut off: every differing file is listed, and only the rows on screen are drawn.
- **Reloads keep the comparison.** The graph reloads its first page whenever the repository moves and every time its tab comes back to the front (after looking at a Compare tab, for one). A comparison stays through that, also when one of its commits is then not among the loaded rows: that side simply has no highlighted row and offers Show in Graph. (The first draft closed the pane then, which lost the comparison on every return from a Compare tab for commits beyond the first page.)
- **Working tree** means tracked files as they are on disk, staged or not. Untracked files are not listed; the pane says how many there are.
- **Compare with Branch…** (Git menu, palette, graph right-click) reuses the branch picker. From the menu or palette it compares the picked branch's tip with the current commit (HEAD), not with uncommitted work. The picked branch is on the left unless it is ahead of the other commit. In the Git menu it sits directly after Compare with Last Commit (HEAD) (group 2 of the planned Git menu, `specs/git-merge-rebase.md` Decisions).
- **Branch picker.** There is one branch picker: palette mode `branch`, opened by `pickBranch(purpose)` in `src/lib/git.ts` (the purpose is introduced by MERGE-003; the table of all purposes is in `specs/git-merge-rebase.md`, Decisions). This area adds the purpose `compare`: local branches, then remote ones, the current branch included, with the prompt "Compare with a branch…". As with every purpose other than `switch` there is no "Create branch" row and no row menu, and the picked row runs a hidden command (`git.compareBranchPick`) with the name. There is no separate palette mode for it.
- **Read-only.** No comparison checks anything out, moves a branch, stages a file or writes inside `.git`. git runs with `GIT_OPTIONAL_LOCKS=0`; that alone is not enough, because `git diff` against the working tree rewrites the index it reads when it meets files whose cached times are stale, so a working-tree comparison gives git a scratch copy of the index in the temp folder (`GIT_INDEX_FILE`) and the repository's own index is never touched.

## COMMITCMP-001: Pick a second commit with Ctrl+click

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — row `onClick` (Ctrl key → `ctrlClick`), `compare` state beside `selected` (`setSelected` = a plain selection, which ends the comparison; `comparePair` sets both), row classes / `aria-selected` for both commits, `onKeyDown` (Escape; arrows go through `select`), `noteMenuOther` + the commit menu's entry "Compare with <short id>", `rowOf` (a stash row is never a side)
  - `src/lib/gitCompare.ts` — pure: `compareClick` (selection reducer: add, replace the second, remove one), `orderSides` (ancestor left, else first selected left), `WORKTREE`
  - `src/styles/app.css` — `.graph-row.compare` (dashed outline on the second commit; colours from `src/styles/tokens.css`)
- Tests: `src/__tests__/gitCompare.test.ts`, `src/__tests__/graphView.test.tsx`
- Docs: `docs/git.md`

**As a** developer reading a repository's history
**I want** to pick two commits in the graph with Ctrl+click
**So that** I can ask what differs between any two points without typing commit ids

```gherkin
Scenario: COMMITCMP-001.1 Ctrl+click adds a second commit
  Given commit "a1b2c3d" is selected in the graph and its details pane is open
  When I Ctrl+click the row of commit "18bc71d"
  Then both rows are highlighted, and the row of "18bc71d" carries a compare mark
  And the details pane is replaced by a comparison pane headed "a1b2c3d ↔ 18bc71d"

Scenario: COMMITCMP-001.2 Ctrl+click with nothing selected
  Given no commit is selected
  When I Ctrl+click a commit
  Then it is selected like a plain click and its details pane opens

Scenario: COMMITCMP-001.3 A third Ctrl+click replaces the second commit
  Given "a1b2c3d" and "18bc71d" are being compared, "a1b2c3d" selected first
  When I Ctrl+click commit "77e0f12"
  Then "a1b2c3d" and "77e0f12" are compared
  And the row of "18bc71d" is no longer highlighted
  And never more than 2 rows are highlighted

Scenario: COMMITCMP-001.4 Ctrl+click a selected commit takes it out
  Given "a1b2c3d" and "18bc71d" are being compared
  When I Ctrl+click the row of "18bc71d"
  Then only "a1b2c3d" is selected and its ordinary details pane is back
  And Ctrl+clicking "a1b2c3d" instead leaves "18bc71d" selected alone

Scenario: COMMITCMP-001.5 A plain click ends the comparison
  Given two commits are being compared
  When I click any commit without Ctrl
  Then only that commit is selected and its details pane shows

Scenario: COMMITCMP-001.6 Escape and the arrow keys end the comparison
  Given "a1b2c3d" and "18bc71d" are being compared, "a1b2c3d" selected first, and the commit list has focus
  When I press Escape
  Then only "a1b2c3d" is selected and its details pane is back
  And pressing Down instead selects the row below "a1b2c3d" alone

Scenario: COMMITCMP-001.7 Close the pane
  Given two commits are being compared
  When I click the comparison pane's close button
  Then no commit is selected and the pane is hidden

Scenario: COMMITCMP-001.8 From the right-click menu
  Given "a1b2c3d" is selected
  When I right-click the row of "18bc71d"
  Then the menu has "Compare with a1b2c3d"
  And choosing it compares the two exactly as Ctrl+click does
  And the entry is not in the menu when I right-click "a1b2c3d" itself or when nothing else was selected

Scenario: COMMITCMP-001.9 Search results are not Ctrl+clickable
  Given the Search All History results are showing and "a1b2c3d" is selected
  When I Ctrl+click a result
  Then it is selected alone, like a plain click

Scenario: COMMITCMP-001.10 The pair survives a reload
  Given two commits on the first page are being compared
  When the graph reloads after a fetch
  Then both are still highlighted and the comparison pane is unchanged
  And when either commit is no longer among the loaded rows the comparison pane stays as it is, that commit's row is simply not highlighted, and its side has a "Show in Graph" button

Scenario: COMMITCMP-001.11 Selecting does not touch the repository
  Given I am on "main" with 2 uncommitted changes
  When I Ctrl+click, replace and clear compared commits
  Then I am still on "main", the 2 uncommitted changes are as they were and no dialog asks anything

Scenario: COMMITCMP-001.12 Rows that are not commits cannot be picked
  Given "a1b2c3d" is selected and "All branches" shows a stash row "WIP parser"
  When I Ctrl+click the stash row
  Then the stash row is selected alone, like a plain click, and no comparison pane opens
  And its right-click menu has no "Compare with a1b2c3d" entry
```

## COMMITCMP-002: See which files differ between two commits

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphCompare.tsx` — comparison pane (heading, both commits with labels and first message line, counts line, Swap Sides, close), windowed file rows (`CompareFile`, 24 px, `OVERSCAN`), empty / loading / error states; a late answer for a changed pair is dropped
  - `src/components/GraphView.tsx` — renders `GraphCompare` instead of the details pane while `selected` and `compare` are set; shares `startResize` / `detailH`
  - `src/lib/gitCompare.ts` — `arrange` (`orderSides`, then Swap Sides), `swapCompare` / `swapFile` (A ↔ D, rename direction, insertions ↔ deletions), `compareHeading`, `countsLine` (ahead / behind wording), `compareSummary`, `noDifferences`, `compareFileKind`
  - `src/lib/gitStatus.ts` — `commitFileKind`, `KIND_LETTER`, `KIND_LABEL` (reused for the letters), `gitErrorText`
  - `src-tauri/src/git.rs` — `diff_files` / `git_diff_files`: `diff --name-status -z -M A B` through `parse_commit_files`, `--shortstat` (as `insertions` / `deletions`), `rev-list --left-right --count A...B` (`behind == 0` means the left commit is an ancestor, so no separate `merge-base` call), `compare_commit` (each side's labels and message); sides checked by `compare_side`
  - `src-tauri/src/lib.rs` — registers `git_diff_files`
  - `src/lib/gitApi.ts` — `git.diffFiles`, `GitCompare` (`left`, `right`, `head`, `files`, `insertions`, `deletions`, `ahead`, `behind`, `untracked`)
  - `src/styles/app.css` — `.graph-compare-*`
- Tests: `src/__tests__/gitCompare.test.ts`, `src/__tests__/graphCompare.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer comparing two commits
**I want** a list of every file that differs between them, marked added, modified, deleted or renamed
**So that** I can see the size and shape of the difference before opening anything

```gherkin
Scenario: COMMITCMP-002.1 The list of differing files
  Given commit "18bc71d" is 3 commits after "a1b2c3d" on the same branch
  And between them "store.ts" was changed, "new.ts" added, "old.ts" deleted and "util.ts" renamed to "helpers.ts"
  When I select "18bc71d" and Ctrl+click "a1b2c3d"
  Then the comparison pane lists 4 files: "store.ts" with M, "new.ts" with A, "old.ts" with D and "helpers.ts" with R
  And the summary reads like "4 files changed, 25 insertions(+), 9 deletions(-)"
  And each row shows the file name, then its folder with backslashes, as in a commit's file list

Scenario: COMMITCMP-002.2 The older commit is on the left whatever the click order
  Given "a1b2c3d" is an ancestor of "18bc71d"
  When I select "18bc71d" first and Ctrl+click "a1b2c3d", or the other way round
  Then the header reads "a1b2c3d ↔ 18bc71d" with each commit's first message line and labels
  And the counts line says "18bc71d is 3 commits ahead of a1b2c3d"
  And a file that exists only in "18bc71d" has the letter A

Scenario: COMMITCMP-002.3 Commits on two branches
  Given "a1b2c3d" on "main" and "18bc71d" on "feature" where neither is an ancestor of the other
  When I select "a1b2c3d" and Ctrl+click "18bc71d"
  Then "a1b2c3d" is on the left and "18bc71d" on the right
  And the counts line says "18bc71d has 4 commits that a1b2c3d does not; a1b2c3d has 2 that 18bc71d does not"
  And the list is everything that differs between the two snapshots, including what changed only on "main"

Scenario: COMMITCMP-002.4 A renamed file
  Given "src/util.ts" was renamed to "src/lib/helpers.ts" with small edits between the two commits
  When I compare them
  Then one row "helpers.ts" with R is listed, not a deleted and an added row
  And its tooltip says "Renamed (from src/util.ts)"

Scenario: COMMITCMP-002.5 Swap Sides
  Given a comparison "a1b2c3d ↔ 18bc71d" listing "new.ts" with A and "helpers.ts" renamed from "util.ts"
  When I click "Swap Sides"
  Then the header reads "18bc71d ↔ a1b2c3d"
  And "new.ts" now has D, and the rename row is "util.ts" renamed from "helpers.ts"
  And the summary's insertions and deletions are exchanged

Scenario: COMMITCMP-002.6 No differences
  Given two different commits whose files are identical (a commit and the revert of its revert)
  When I compare them
  Then the pane says "No differences: the files of a1b2c3d and 18bc71d are identical."
  And the list is empty and no notification or dialog appears

Scenario: COMMITCMP-002.7 A binary file is listed
  Given "logo.png" differs between the two commits
  When I compare them
  Then "logo.png" is in the list with its letter like any other file

Scenario: COMMITCMP-002.8 A very long list
  Given 12,400 files differ between the two commits
  When I compare them
  Then the summary starts "12400 files changed" and the list can be scrolled through all 12,400 rows
  And only the rows on screen, plus a few above and below, exist in the list
  And the graph and the rest of the editor stay responsive while the list loads, with "Loading…" in the pane until it arrives

Scenario: COMMITCMP-002.9 A merge commit is compared as a snapshot
  Given I compare a merge commit with a commit before the merged branch forked
  When the list arrives
  Then it holds every file that differs between those two snapshots, with no "(against the first parent)" note

Scenario: COMMITCMP-002.10 Changing the pair discards a late answer
  Given the list for "a1b2c3d ↔ 18bc71d" is still loading
  When I Ctrl+click "77e0f12" to replace the second commit
  Then only the list for "a1b2c3d ↔ 77e0f12" is shown when it arrives

Scenario: COMMITCMP-002.11 git fails
  Given git cannot compare the two commits
  When I compare them
  Then the pane says "Could not compare:" followed by git's message without its hint lines
  And the two commits stay selected so I can pick another

Scenario: COMMITCMP-002.12 Resize
  When I drag the top edge of the comparison pane
  Then its height follows between 120 px and 70% of the window height, and the details pane uses the same height afterwards
```

## COMMITCMP-003: Open a differing file in a Compare tab

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphCompare.tsx` — `CompareFile`: click / Enter opens the comparison, double-click opens the file itself, Up / Down move between rows
  - `src/lib/git.ts` — `openCompareFile(left, right, file)`: `git.show` of each side (`origRel` on the left for a rename), binary check, labels, `preview: true`; a working-tree right side as in `compareWithHead`
  - `src/lib/gitCompare.ts` — `sideLabel` (`name @ shortid`, old name on the left of a rename)
  - `src/lib/diff.ts` — `openCompare(a, b, { preview: true })` (unchanged: replaces the previous clean preview Compare tab)
  - `src-tauri/src/git.rs` — `show` / `git_show` (unchanged)
- Tests: `src/__tests__/gitCompare.test.ts`, `src/__tests__/graphCompare.test.tsx`
- Docs: `docs/git.md`, `docs/compare.md`

**As a** developer comparing two commits
**I want** to click a file in the list and see its two versions side by side
**So that** I can review the difference file by file without piling up tabs

```gherkin
Scenario: COMMITCMP-003.1 Click a modified file
  Given the comparison "a1b2c3d ↔ 18bc71d" lists "store.ts" with M
  When I click "store.ts"
  Then a Compare tab opens with "store.ts @ a1b2c3d" on the left and "store.ts @ 18bc71d" on the right
  And both sides are tagged "read-only"
  And the graph tab still shows the same two commits selected when I return to it

Scenario: COMMITCMP-003.2 After Swap Sides
  Given I clicked "Swap Sides" so the header reads "18bc71d ↔ a1b2c3d"
  When I click "store.ts"
  Then "store.ts @ 18bc71d" is on the left and "store.ts @ a1b2c3d" on the right

Scenario: COMMITCMP-003.3 The next file reuses the tab
  Given that Compare tab is open and untouched
  When I click another file in the comparison pane, or a file in a single commit's details pane
  Then its comparison replaces the previous one instead of adding a tab

Scenario: COMMITCMP-003.4 Keep a comparison
  Given a Compare tab opened from the comparison pane
  When I double-click its tab and then click another file in the pane
  Then the first Compare tab stays and a second one opens

Scenario: COMMITCMP-003.5 Added and deleted files
  Given the list has "new.ts" with A and "old.ts" with D
  When I click "new.ts"
  Then the left side is empty and the right side is "new.ts @ 18bc71d"
  And clicking "old.ts" shows "old.ts @ a1b2c3d" on the left and an empty right side

Scenario: COMMITCMP-003.6 A renamed file
  Given "util.ts" was renamed to "helpers.ts" between the two commits
  When I click the "helpers.ts" row
  Then the left side is "util.ts @ a1b2c3d" and the right side is "helpers.ts @ 18bc71d"
  And only the lines that were edited are marked as changes

Scenario: COMMITCMP-003.7 A binary file
  When I click "logo.png", a binary file, in the comparison pane
  Then no tab opens and a notification says "This file is binary."

Scenario: COMMITCMP-003.8 Keyboard
  Given a file row in the comparison pane has focus
  When I press Enter
  Then its Compare tab opens as with a click

Scenario: COMMITCMP-003.9 Open the file as it is now
  When I double-click a file in the comparison pane
  Then the file itself opens from the working folder, in front of the Compare tab the first click opened, however long that comparison took to read
  And the double-click's second click does not open a second Compare tab
  But a file with the letter D is not opened

Scenario: COMMITCMP-003.10 Opening files changes nothing on disk
  Given I am on "main" and "store.ts" has unsaved edits in a tab
  When I open several files from the comparison pane
  Then no file in the working folder is written, the tab of "store.ts" keeps its edits and I am still on "main"
```

## COMMITCMP-004: Compare a commit with the working tree

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — commit menu entry "Compare with Working Tree" (`comparePair(sha, WORKTREE)`), passes the repository's status object as `tick`
  - `src/components/GraphCompare.tsx` — "Working tree" side in the header (no Swap Sides), untracked-files note, reads again 250 ms after `tick` changes while keeping the list on screen
  - `src/lib/git.ts` — `openCompareFile` with a working-tree right side (`right` null): open tab → `tab` source, file on disk → `file` source, missing → "(deleted)"; conflicted file → `openPath`
  - `src/lib/gitCompare.ts` — `compareHeading` / `countsLine` / `noDifferences` for a working-tree side, `untrackedNote`
  - `src-tauri/src/git.rs` — `diff_files` with no right-hand commit: `diff --name-status -z -M <sha>` (tracked files, staged and unstaged) over a scratch copy of the index (`scratch_index`), files unmerged in the index (`ls-files -u`) marked "U", untracked files counted with `ls-files --others --exclude-standard`, `head` and the counts taken against HEAD
  - `src/lib/gitApi.ts` — `git.diffFiles(root, left, right?)`
- Tests: `src/__tests__/gitCompare.test.ts`, `src/__tests__/graphCompare.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`, `docs/compare.md`

**As a** developer with work in progress
**I want** to compare any commit with my files as they are now
**So that** I can see everything I have changed since that point, committed or not

```gherkin
Scenario: COMMITCMP-004.1 Compare with Working Tree
  Given commit "a1b2c3d" is 2 commits behind my current commit
  And I have 1 staged change to "app.ts" and 1 unstaged change to "store.ts"
  When I right-click "a1b2c3d" and choose "Compare with Working Tree"
  Then the comparison pane is headed "a1b2c3d ↔ Working tree"
  And it lists "app.ts", "store.ts" and every tracked file the 2 commits changed
  And only the row of "a1b2c3d" is highlighted in the graph

Scenario: COMMITCMP-004.2 The working tree is always on the right
  Given the comparison "a1b2c3d ↔ Working tree" is showing
  When I look at the pane's header
  Then it has no "Swap Sides" button
  And a tracked file I created after "a1b2c3d" has the letter A

Scenario: COMMITCMP-004.3 Open a file that is not open in a tab
  Given "store.ts" is listed and not open in any tab
  When I click it
  Then a Compare tab opens with "store.ts @ a1b2c3d" on the left, read-only, and "store.ts" from disk on the right
  And the right side can be edited and saved

Scenario: COMMITCMP-004.4 Open a file that is open with unsaved edits
  Given "app.ts" is listed and open in a tab with unsaved edits
  When I click it
  Then the right side is labelled "app.ts (unsaved)", shows the unsaved text and is tagged "read-only"

Scenario: COMMITCMP-004.5 A file deleted in the working tree
  Given "old.ts" exists in "a1b2c3d" and I deleted it from the folder
  When I click its row, which has the letter D
  Then the left side is "old.ts @ a1b2c3d" and the right side "old.ts (deleted)" is empty

Scenario: COMMITCMP-004.6 A file renamed since the commit
  Given "util.ts" in "a1b2c3d" is now "helpers.ts" in the folder
  When I click the "helpers.ts" row
  Then the left side is "util.ts @ a1b2c3d" and the right side is "helpers.ts" from disk

Scenario: COMMITCMP-004.7 Untracked files are not compared
  Given 3 untracked files are in the folder
  When the comparison with the working tree is showing
  Then none of the 3 is in the list
  And a note under the summary says "3 untracked files are not compared."

Scenario: COMMITCMP-004.8 The list follows my work
  Given the comparison "a1b2c3d ↔ Working tree" is showing and "notes.md" matches the commit
  When I edit "notes.md" in a tab and save it
  Then "notes.md" appears in the list with M without my reloading anything

Scenario: COMMITCMP-004.9 The current commit with a clean folder
  Given I have no uncommitted changes
  When I right-click the commit labelled with my current branch and choose "Compare with Working Tree"
  Then the pane says "No differences: your files match a1b2c3d."

Scenario: COMMITCMP-004.10 A conflicted file during a stopped merge
  Given a merge stopped with "store.ts" in conflict
  When I compare a commit with the working tree and click "store.ts", shown with "!"
  Then the file itself opens with its conflict bars instead of a Compare tab

Scenario: COMMITCMP-004.11 Ctrl+click while comparing with the working tree
  Given the comparison "a1b2c3d ↔ Working tree" is showing
  When I Ctrl+click commit "18bc71d"
  Then the comparison becomes "a1b2c3d" with "18bc71d", ordered as for any two commits

Scenario: COMMITCMP-004.12 Nothing is staged, stashed or checked out
  Given 1 staged and 1 unstaged change
  When I compare a commit with the working tree and open files from the list
  Then the same 1 change is staged and 1 unstaged afterwards, and I am on the same branch and commit

Scenario: COMMITCMP-004.13 A binary file in the working tree
  Given "logo.png" is binary in the commit
  When I click its row
  Then no tab opens and a notification says "This file is binary."
  But for a binary file that only exists in the folder (letter A) the notification is the Compare tab's own: "Can't compare: logo.png looks like a binary file"

Scenario: COMMITCMP-004.14 How the folder relates to the commit
  Given my current commit "e4f5a6b" is 2 commits after "a1b2c3d"
  When I compare "a1b2c3d" with the working tree
  Then the counts line says "Your files are on e4f5a6b, 2 commits ahead of a1b2c3d."
  And comparing my current commit itself says "e4f5a6b is the commit you are on."
```

## COMMITCMP-005: Compare with a branch

- Status: draft
- Commands: `git.compareWithBranch`, `git.compareBranchPick`
- Files:
  - `src/lib/gitCommands.ts` — registers `git.compareWithBranch` ("Compare with Branch…", enabled only with a repository) and hidden `git.compareBranchPick` (run with the picked branch name, like `git.checkoutTo`)
  - `src/lib/git.ts` — `pickBranch("compare", { root, sha })`: the shared picker of MERGE-003 with the purpose `compare` (the graph commit to compare with is kept in the module's `compareFrom`; without it the current commit is used); `compareWithBranch(name)`: asks `git.diffFiles(root, sha ?? "HEAD", name)`, opens / reuses the graph tab (`openGraph`) and hands it the two commits with git's answer (`store.graphCompare`)
  - `src/lib/gitRefs.ts` — `branchPick` / `pickList` for the purpose `compare`: every branch, placeholder "Compare with a branch…", no "Create branch" row, picked row runs `git.compareBranchPick`
  - `src/components/CommandPalette.tsx` — `mode === "branch"` renders whatever the purpose gives (unchanged by this story)
  - `src/components/GraphView.tsx` — commit menu entry "Compare with Branch…"; the `pending` effect takes over `store.graphCompare` for its repository, whose commits need not be among the loaded rows; `goTo(sha, keep)` for Show in Graph
  - `src/components/GraphCompare.tsx` — branch name beside a side's short id (`names`), `initial` (git's answer already in hand), "Show in Graph" for a side that is not loaded
  - `src/lib/gitCompare.ts` — `orderSides(…, picked)` (picked branch left unless it is ahead of the other commit), `noDifferences` for the same commit on both sides
  - `src/components/MenuBar.tsx` — Git menu item directly after Compare with Last Commit (HEAD)
  - `src/lib/store.ts` — `graphCompare`: the pending comparison for a graph tab (no new palette mode)
  - `src-tauri/src/git.rs` — `compare_side` resolves "HEAD" or a branch name to its commit (name checked with `valid_ref_name`, then `refs/heads/<name>` or `refs/remotes/<name>` through `rev-parse --verify`)
- Tests: `src/__tests__/gitCompare.test.ts`, `src/__tests__/graphCompare.test.tsx`, `src/__tests__/graphView.test.tsx`, `src/__tests__/branchPicker.test.tsx`, `src/__tests__/gitRefs.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer working on a branch
**I want** to compare my current commit, or any commit in the graph, with a branch I pick by name
**So that** I can see what differs from "main" without hunting for its commit in the graph

```gherkin
Scenario: COMMITCMP-005.1 Compare with Branch… from the Git menu
  Given I am on "feature" at commit "18bc71d", 4 commits ahead of "main" at "a1b2c3d"
  When I choose Git › Compare with Branch…
  Then a picker lists the local branches, then the remote ones, with the placeholder "Compare with a branch…"
  When I pick "main"
  Then the graph tab of the repository opens or comes to the front
  And the comparison pane is headed "a1b2c3d main ↔ 18bc71d feature"
  And the counts line says "18bc71d is 4 commits ahead of a1b2c3d"
  And the files that differ are listed and open as in any comparison of two commits
  And with a graph tab of another repository in front, the picker lists that repository's branches and the comparison is made there (not in Source Control's repository)

Scenario: COMMITCMP-005.2 My uncommitted changes are not part of it
  Given I have 2 uncommitted changes on "feature"
  When I run Compare with Branch… and pick "main"
  Then the list holds only what differs between the two commits
  And the graph still shows my 2 uncommitted changes as uncommitted work on "feature", outside the comparison

Scenario: COMMITCMP-005.3 The picked branch has moved on too
  Given "main" has 2 commits that "feature" does not and "feature" has 4 that "main" does not
  When I compare with "main"
  Then "main" is on the left and my commit on the right
  And the counts line says "18bc71d has 4 commits that a1b2c3d does not; a1b2c3d has 2 that 18bc71d does not"

Scenario: COMMITCMP-005.4 The picked branch is ahead of me
  Given "origin/main" is 3 commits ahead of my current commit "a1b2c3d"
  When I compare with "origin/main"
  Then my commit is on the left and "origin/main" on the right, so the incoming files show as added or modified

Scenario: COMMITCMP-005.5 From a commit's right-click menu
  Given I right-click commit "77e0f12" in the graph
  When I choose "Compare with Branch…" and pick "main"
  Then "77e0f12" is compared with the commit "main" points at, ordered by the same rule

Scenario: COMMITCMP-005.6 The branch's commit is not loaded in the graph
  Given "old-release" points at a commit 5,000 rows down and 300 commits are loaded
  When I compare with "old-release"
  Then the comparison pane shows at once without loading more pages
  And that side has a "Show in Graph" button that loads back to the commit

Scenario: COMMITCMP-005.7 The branch I am on
  Given I am on "main" and run Compare with Branch… from the Git menu
  When I pick "main"
  Then the pane says "No differences: main is the commit you are on."

Scenario: COMMITCMP-005.8 No branch is created from the picker
  Given the picker is open
  When I type "does-not-exist"
  Then the list says "No matches" and offers no "Create branch" row
  And pressing Enter does nothing

Scenario: COMMITCMP-005.9 Cancel
  When I press Escape in the picker
  Then the picker closes, no graph tab opens and any comparison already showing is unchanged

Scenario: COMMITCMP-005.10 No repository
  Given nothing open is inside a git repository
  When I open the Git menu or the command palette
  Then "Compare with Branch…" is greyed out

Scenario: COMMITCMP-005.11 Detached HEAD
  Given HEAD is detached on "77e0f12"
  When I run Compare with Branch… and pick "main"
  Then "77e0f12" is compared with "main" and its side carries the label "HEAD"

Scenario: COMMITCMP-005.12 I stay where I am
  Given I am on "feature"
  When I compare with "main" and open files from the list
  Then I am still on "feature", "main" has not moved and nothing was fetched

Scenario: COMMITCMP-005.13 The branch points at the commit I right-clicked
  Given "main" points at commit "77e0f12" and I am on another commit
  When I right-click "77e0f12", choose "Compare with Branch…" and pick "main"
  Then the pane says "No differences: both sides are the commit 77e0f12."
```

## COMMITCMP-006: Comparing never changes the repository

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/git.rs` — `diff_files`: read-only git commands only (`diff`, `rev-list`, `rev-parse`, `log`, `ls-files`) through `compare_git` (`GIT_OPTIONAL_LOCKS=0`); a working-tree comparison reads a scratch copy of the index (`scratch_index`, `GIT_INDEX_FILE`) because `git diff` would otherwise rewrite the index; `compare_side`: ids through `is_sha`, names through `valid_ref_name`, and git is only ever given the id, "HEAD" or the full `refs/…` name, so a name can't be read as an option
  - `src/lib/git.ts` — `openCompareFile`, `compareWithBranch`: no call to `git.checkout`, `git.stage`, `commitAction` or any write
  - `src/components/GraphCompare.tsx` — no button that acts on the repository
- Tests: `src-tauri/src/git.rs`, `src/__tests__/graphCompare.test.tsx`
- Docs: `docs/git.md`

**As a** developer with uncommitted work or a stopped operation
**I want** every comparison to be strictly read-only
**So that** I can look at differences at any moment without risk to my branch, my index or my files

```gherkin
Scenario: COMMITCMP-006.1 Branch, commit and index are untouched
  Given I am on "main" at "18bc71d" with 1 staged change, 1 unstaged change and 1 untracked file
  When I compare two commits, a commit with the working tree and a commit with a branch
  Then I am still on "main" at "18bc71d"
  And the same 1 change is staged, 1 unstaged and 1 file untracked
  And no branch, tag or stash was created

Scenario: COMMITCMP-006.2 Nothing is written inside .git
  Given a repository whose .git folder I have listed with file times
  When I compare a commit with the working tree
  Then no file inside .git has changed, the index included

Scenario: COMMITCMP-006.3 During a stopped rebase
  Given a rebase stopped on a conflict at step 2 of 5
  When I compare two commits and open a file from the list
  Then the rebase is still stopped at step 2 of 5 with the same conflicted files

Scenario: COMMITCMP-006.4 No confirmation is needed
  When I start any comparison
  Then no dialog asks me to confirm, because nothing can be lost

Scenario: COMMITCMP-006.5 Only the editable working-tree side can change a file
  Given a Compare tab opened from "a1b2c3d ↔ Working tree" whose right side is "store.ts" from disk
  When I edit the right side and press Ctrl+S
  Then "store.ts" in the folder is written, as in any Compare tab
  And a Compare tab of two commits has no editable side and no Save button

Scenario: COMMITCMP-006.6 A hostile branch name is not run as an option
  Given a comparison is requested with the name "--output=x"
  When git would be started
  Then nothing is run and an error says the name is not valid
```
