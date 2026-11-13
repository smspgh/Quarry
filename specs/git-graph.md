---
area: Commit Graph
prefix: GRAPH
---

# Commit Graph

The commit graph tab (`kind: "graph"`): a repository's history as a lane graph with branch and tag labels, paging, search, a details pane and the right-click actions on a commit. User documentation: `docs/git.md` ("Commit graph"). The Source Control panel itself is in `specs/git.md`; conflicts and stopped operations are in `specs/git-conflicts.md`.

## GRAPH-001: Open the commit graph in a tab

- Status: draft
- Commands: `git.graph`
- Files:
  - `src/lib/gitCommands.ts` — registers `git.graph` (enabled only with a repository)
  - `src/lib/git.ts` — `openGraph()`: reuses the repository's open graph tab, tab name `Graph · <folder>`
  - `src/components/GraphView.tsx` — `GraphView`, toolbar (Fetch, Reload), reload effect keyed on the repository `stamp`, `editor.registerFocus`
  - `src/components/panels/GitPanel.tsx` — graph button in `CommitsSection`
  - `src/components/MenuBar.tsx` — Git menu item
  - `src/components/TitleBar.tsx` — `DocIcon` for graph tabs
  - `src/App.tsx` — renders one `GraphView` per graph doc
  - `src/lib/store.ts` — `Doc.graph`
  - `src/lib/actions.ts` — `sessionDocs()` keeps only text and Claude tabs, so graph tabs are not saved
- Tests: `src/__tests__/graphView.test.tsx`
- Docs: `docs/git.md`

**As a** developer working in a git repository
**I want** to open the repository's history as a graph in a full-width tab
**So that** I can read branches and merges without squeezing them into the side panel

```gherkin
Scenario: GRAPH-001.1 Open from the menu
  Given the folder "C:\work\quarry" is a git repository
  When I choose Git › Show Commit Graph
  Then a tab named "Graph · quarry" opens and becomes the active tab
  And it lists the commits with the columns Commit, Author, Date and Id

Scenario: GRAPH-001.2 Open from the Source Control panel
  Given the Source Control panel shows the Commits section
  When I click the graph button in the Commits heading
  Then the graph tab of that repository opens

Scenario: GRAPH-001.3 An open graph is reused
  Given a graph tab for "C:\work\quarry" is already open behind another tab
  When I run Show Commit Graph again
  Then that tab is brought to the front
  And no second graph tab is created

Scenario: GRAPH-001.4 No repository
  Given nothing open is inside a git repository
  When I open the Git menu or the command palette
  Then Show Commit Graph is greyed out in the menu and the palette

Scenario: GRAPH-001.5 The graph follows the repository
  Given the graph tab is showing
  When I make a commit, pull, push, fetch or switch branch
  Then the graph is loaded again from the first page
  And clicking "Reload the graph" does the same on demand
  And "Fetch from all remotes" fetches and then reloads

Scenario: GRAPH-001.6 Not restored after a restart
  Given a graph tab is open
  When I close and start Quarry again
  Then the graph tab is not among the restored tabs
```

## GRAPH-002: Read branches and merges as lanes with labels

- Status: draft
- Commands: none
- Files:
  - `src/lib/gitGraph.ts` — `layoutGraph` (first parent keeps the lane, lowest free lane reused, carried `GraphState`), `refLabels`
  - `src/components/GraphView.tsx` — `RowGraph` (SVG lines and dot), `RefBadge`, `MAX_LANES` = 16, `LANE_COLORS` = 8, `ROW` = 26
  - `src-tauri/src/git.rs` — `graph` (`log --topo-order --decorate=full`), `parse_graph`, command `git_graph`
  - `src/lib/gitApi.ts` — `git.graph`, `GitGraphCommit`
  - `src/styles/app.css` — `.graph-*`, `.gl-*` lane colours
- Tests: `src/__tests__/gitGraph.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer reading a repository's history
**I want** each branch drawn as its own line with its branch and tag names on the commits
**So that** I can see where branches fork, where they merge and what is still to push or pull

```gherkin
Scenario: GRAPH-002.1 A straight history stays in one lane
  Given a branch with 3 commits and no merges
  When I open the graph
  Then all 3 dots sit in the first lane, joined by one line

Scenario: GRAPH-002.2 A merged branch gets a second lane, then frees it
  Given "main" has a merge commit that merged branch "feature" with 1 commit
  When I open the graph
  Then the merge commit sits in the first lane with a line to each parent
  And the "feature" commit sits in the second lane
  And both lines join at the commit the branch forked from
  And the graph is 1 lane wide again below the fork

Scenario: GRAPH-002.3 The first parent keeps the lane
  Given a side branch forked from an older commit of "main"
  When I open the graph
  Then the commits of "main" stay in the first lane all the way down
  And the side branch runs beside it until its fork point

Scenario: GRAPH-002.4 A freed lane is reused
  Given two side branches that were merged one after the other
  When I open the graph
  Then the second branch uses the lane the first one left
  And the graph never needs more than 2 lanes

Scenario: GRAPH-002.5 Commits are listed branch by branch
  Given a merged branch whose commits are older than later commits on "main"
  When I open the graph
  Then the branch's commits are listed together under the merge, not interleaved by date

Scenario: GRAPH-002.6 Labels
  Given I am on "main", which is on the same commit as "origin/main", and tag "v1.0" and branch "feature" exist
  When I open the graph
  Then the commit of "main" shows a filled label "main" and a larger dot
  And "feature" shows an outlined label, "origin/main" a remote label and "v1.0" a tag label
  And the labels are ordered: current branch, other local branches, remote branches, tags
  And no label is shown for "origin/HEAD"

Scenario: GRAPH-002.7 Detached HEAD
  Given HEAD is detached on a commit
  When I open the graph
  Then that commit shows a label "HEAD" whose tooltip says "You are here (detached: not on a branch)"

Scenario: GRAPH-002.8 Very wide histories
  Given a history that needs more than 16 lanes at once
  When I open the graph
  Then the graph column stops growing at 16 lanes
  And the lanes beyond share the last one
```

## GRAPH-003: Long branch lines are cut short

- Status: draft
- Commands: none
- Files:
  - `src/lib/gitGraph.ts` — `MAX_SPAN` = 40, `GraphRow.cut` / `GraphRow.from`, `GraphState.cut`; lane 0 is never cut
  - `src/components/GraphView.tsx` — `RowGraph` arrows, "Continues" row of the details pane
- Tests: `src/__tests__/gitGraph.test.ts`
- Docs: `docs/git.md`

**As a** developer looking at a history with many long-lived branches
**I want** a line that would run a long way to its commit to be cut with arrows
**So that** the graph stays a few lanes wide instead of over a hundred

```gherkin
Scenario: GRAPH-003.1 A line that runs 40 rows is cut
  Given a branch that forked from a commit more than 40 rows further down
  When I scroll through the graph
  Then its line ends in a small down arrow after running 40 rows
  And its lane is free for other branches from there on
  And the commit it leads to shows an up arrow where the line comes back in

Scenario: GRAPH-003.2 Follow a cut line from the far end
  Given I select the commit a cut line leads to
  Then the details pane has a "Continues" row listing the short id of each commit whose line was cut
  When I click one of those ids
  Then that commit is selected and scrolled into view

Scenario: GRAPH-003.3 Follow a cut line from the near end
  Given I select the commit a cut line started at
  When I click its Parent link in the details pane
  Then the graph jumps to the commit at the other end of the line

Scenario: GRAPH-003.4 The first lane is never cut
  Given the branch in the first lane runs for 200 rows
  When I open the graph
  Then its line is drawn unbroken for all 200 rows

Scenario: GRAPH-003.5 Paging does not change the picture
  Given a history laid out in one go
  When the same history is loaded in several pages instead
  Then every commit has the same lane, lines and arrows
```

## GRAPH-004: Show the current branch or all branches

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — "Current branch" / "All branches" segmented control (`all` state, starts on Current branch)
  - `src-tauri/src/git.rs` — `graph_scope` (HEAD + `@{upstream}`, or `--all` without `refs/stash`)
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer
**I want** to switch the graph between my branch and every branch
**So that** I can focus on what I am working on or look across the whole repository

```gherkin
Scenario: GRAPH-004.1 Current branch is the default
  Given "main" tracks "origin/main", which has 2 commits I have not pulled
  When I open the graph
  Then "Current branch" is selected
  And the graph shows the commits of "main" and of "origin/main", including the 2 incoming ones
  And commits that are only on other branches are not shown

Scenario: GRAPH-004.2 All branches
  When I click "All branches"
  Then the graph is loaded again with every local branch, remote branch and tag
  And stash entries are not shown

Scenario: GRAPH-004.3 A branch with no remote branch
  Given the current branch has no upstream
  When "Current branch" is selected
  Then only the commits reachable from the current commit are shown
```

## GRAPH-005: Load a long history in pages

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `load()`, `PAGE` = 300, `SLOW_PAGE_MS` = 400, `MAX_PAGE` = 4800, `generation` guard, reload on the `stamp` (head, branch, ahead / behind, upstream, operation) keeping `selected` and the scroll offset, windowed rows (`first` / `last`, 8 rows of overscan), next page when within 40 rows of the end
  - `src/lib/gitGraph.ts` — `GraphState` carried from page to page
  - `src-tauri/src/git.rs` — `graph` (`--skip`, `--max-count` clamped to 5000; no commits before the first commit)
- Tests: `src/__tests__/gitGraph.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer with a repository of many thousands of commits
**I want** the graph to load as I scroll
**So that** it opens at once and never holds up the rest of the editor

```gherkin
Scenario: GRAPH-005.1 The first page
  Given a repository with 5,000 commits
  When I open the graph
  Then the first 300 commits are listed
  And the toolbar says "300+ commits"

Scenario: GRAPH-005.2 More commits load while scrolling
  Given 300 commits are loaded and more exist
  When I scroll to within 40 rows of the end of the list
  Then the next 300 commits are added below, with the lanes continuing unbroken
  And "Loading…" shows in the toolbar while git works

Scenario: GRAPH-005.3 The end of the history
  Given a repository with 120 commits
  When I open the graph
  Then the toolbar says "120 commits" with no plus sign
  And nothing more is requested when I scroll to the end

Scenario: GRAPH-005.4 Slow pages grow
  Given a page of 300 commits took git longer than 400 ms
  When I keep scrolling down
  Then the next page asks for 1,200 commits, and after further slow pages 4,800
  And a page never asks for more than 4,800 commits

Scenario: GRAPH-005.5 Only visible rows are drawn
  Given 10,000 commits are loaded
  When I scroll through the list
  Then only the rows on screen, plus a few above and below, exist in the list
  And the scroll bar still reflects all 10,000 rows of 26 px

Scenario: GRAPH-005.6 A repository without commits
  Given a repository in which nothing has been committed yet
  When I open the graph
  Then the list says "No commits yet."

Scenario: GRAPH-005.7 git fails
  Given git cannot read the history
  When I open the graph
  Then the list says "Could not read the history:" followed by git's message

Scenario: GRAPH-005.8 A reload discards late pages
  Given a page is still being loaded
  When the graph is reloaded
  Then the late page's commits are not added to the new list

Scenario: GRAPH-005.9 What a reload keeps
  Given commit 150 of the list is selected and on screen
  When the repository changes (a commit, pull, push, checkout, a fetch that moves the upstream, or an operation starting or ending) and the graph reloads from the first page
  Then the scroll position, the selected commit and its details pane are kept
  And a selected commit beyond the first page (300 rows, or the grown page size) is no longer shown: its details pane closes and the list is left at the end of the first page, where scrolling loads the next page
```

## GRAPH-006: Speed up a very large history

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — Speed Up strip (`slowMs`, `indexed`, `indexing`, `hideSpeedUp`)
  - `src-tauri/src/git.rs` — `has_commit_graph` / `git_graph_indexed`, `write_commit_graph` / `git_graph_index` (`commit-graph write --reachable`)
  - `src/lib/gitApi.ts` — `git.graphIndexed`, `git.graphIndex`
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer with a very large repository
**I want** Quarry to offer to have git index the history
**So that** pages of the graph load several times faster, and only when I agree to it

```gherkin
Scenario: GRAPH-006.1 The offer appears for a slow, unindexed history
  Given the repository has no commit-graph file
  And the last page took git 1.8 seconds
  When that page has been added to the graph
  Then a strip says "This is a large history: git needed 1.8 s for the last page." and explains the index
  And it has a "Speed Up" button and a "Not now" close button

Scenario: GRAPH-006.2 Speed Up writes the index
  When I click "Speed Up"
  Then the button reads "Indexing…" and is disabled while git works
  And git writes its commit-graph file inside .git
  And a notification says "History indexed."
  And the strip disappears and pages are 300 commits again

Scenario: GRAPH-006.3 Never without being asked
  Given a slow history without a commit-graph file
  When I open, scroll, search and reload the graph without pressing "Speed Up"
  Then no commit-graph file is written

Scenario: GRAPH-006.4 Not now
  When I click the strip's "Not now" button
  Then the strip stays hidden for as long as this graph tab is open

Scenario: GRAPH-006.5 Already indexed
  Given the repository already has a commit-graph file
  When a page takes git longer than 400 ms
  Then the strip is not shown even after a slow page

Scenario: GRAPH-006.6 Indexing fails
  Given git cannot write the file
  When I click "Speed Up"
  Then git's error is shown as a notification
  And the strip stays so I can try again
```

## GRAPH-007: Find among the loaded commits

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — search box, `matches` / `matchCount`, `nextMatch`, dimmed rows, Ctrl+F in `onKeyDown`
  - `src/lib/gitGraph.ts` — `commitMatches` (message, author, email, id prefix, ref names; case-insensitive)
- Tests: `src/__tests__/gitGraph.test.ts`
- Docs: `docs/git.md`

**As a** developer looking for a commit
**I want** to filter the loaded commits by message, author, id or branch name
**So that** I can step through the ones that match

```gherkin
Scenario: GRAPH-007.1 Typing marks the matches
  Given 1,200 commits are loaded and 6 of them mention "updater"
  When I type "updater" in the Find box
  Then the count next to the box says "6 in 1200 loaded"
  And the 6 matching rows stay bright while the others are dimmed

Scenario: GRAPH-007.2 What is matched
  When I type text in the Find box
  Then a commit matches when the text is in its message, author name, author email or a branch / tag name on it, ignoring case
  And a commit matches when its full id starts with the text

Scenario: GRAPH-007.3 Step through the matches
  Given 6 commits match
  When I press Enter in the Find box
  Then the next match below the selected commit is selected and scrolled into view
  And Shift+Enter selects the previous one
  And stepping past the last match wraps to the first
  And the up and down arrow buttons beside the count do the same

Scenario: GRAPH-007.4 Focus the Find box
  Given the commit list has the keyboard focus
  When I press Ctrl+F
  Then the Find box is focused

Scenario: GRAPH-007.5 Escape clears the search
  Given "updater" is in the Find box
  When I press Escape in the box
  Then the box is emptied, no row is dimmed and focus returns to the commit list

Scenario: GRAPH-007.6 Nothing matches
  Given no loaded commit matches the text
  When I have typed it in the Find box
  Then the count says "0 in 1200 loaded"
  And the previous / next match buttons are disabled
```

## GRAPH-008: Search the whole history and go to a result

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `searchAll`, results list (`hits`, `hitsOpen`, `pickHit`), `goTo` (loads pages of 4,800 until the commit is in the graph, then centres it), "Show in Graph"
  - `src-tauri/src/git.rs` — `graph_search` / `git_graph_search` (`--grep`, `--author`, `-i --fixed-strings`, branch / tag names via `for-each-ref` + `--simplify-by-decoration --decorate-refs`, an id of 4-64 hex digits; newest first, de-duplicated)
  - `src/lib/gitApi.ts` — `git.graphSearch`
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer looking for an old commit
**I want** git to search every commit, not just the pages loaded so far
**So that** I can find a commit thousands of rows back and jump to it in the graph

```gherkin
Scenario: GRAPH-008.1 Search All History
  Given 300 commits are loaded, more exist, and "tokenizer" is in the Find box
  When I click "Search All History"
  Then a results list appears headed '3 commits in the whole history match "tokenizer" (message, author, branch / tag or id)'
  And the results are listed newest first with id, message, author and date

Scenario: GRAPH-008.2 Keyboard
  Given text is in the Find box
  When I press Ctrl+Enter
  Then the whole history is searched
  And plain Enter also searches the whole history when no loaded commit matches

Scenario: GRAPH-008.3 The button is only offered while commits remain unloaded
  Given every commit of the history is already loaded
  When I type text in the Find box
  Then "Search All History" is not shown

Scenario: GRAPH-008.4 At most 200 results
  Given 450 commits match
  When I search the whole history
  Then 200 results are listed and the heading says "200+ commits"

Scenario: GRAPH-008.5 Search by id
  Given a commit with id "18bc71d…" exists
  When I search the whole history for "18bc71d"
  Then that commit is among the results

Scenario: GRAPH-008.6 The scope follows Current branch / All branches
  Given "Current branch" is selected and the text only matches a commit on another branch
  When I search the whole history
  Then the heading says 'No commit on this branch matches "…". Try All branches.'

Scenario: GRAPH-008.7 Click a result for its details
  Given a result that is not among the loaded commits
  When I click it
  Then the details pane shows that commit with a "Show in Graph" button
  And the results list shrinks to a few rows ("Show More" opens it again)

Scenario: GRAPH-008.8 Go to a result in the graph
  When I double-click a result, or click "Show in Graph"
  Then the toolbar says "Loading back to that commit…" while older pages are loaded
  And the commit is then selected and centred in the graph

Scenario: GRAPH-008.9 The commit is not in the graph shown
  Given "Current branch" is selected and I ask to go to a commit that is not on it
  When the graph has loaded to the end without finding it
  Then after loading to the end a notification says "That commit is not on this branch. Switch to All branches to see it."

Scenario: GRAPH-008.10 Editing the text closes the results
  Given the results list is showing
  When I change the text in the Find box, or click the list's close button
  Then the results list disappears

Scenario: GRAPH-008.11 Search by branch or tag name
  Given tag "v0.3.0" points at a commit far back in the history and branch "Release-2" at another
  When I search the whole history for "v0.3" or for "release"
  Then the commit the tag or branch points at is among the results, ignoring case
  And with "Current branch" selected a branch or tag on another branch's commits is not listed
```

## GRAPH-009: See a commit's details

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — selection (`select`, `onKeyDown`: arrows, PageUp / PageDown, Home / End), details pane, `startResize` (120 px to 70% of the window), `copy`
  - `src-tauri/src/git.rs` — `commit_detail` / `git_commit_detail` (`--shortstat --diff-merges=first-parent`), `commit_files`
  - `src/lib/gitApi.ts` — `git.commitDetail`, `GitCommitDetail`
  - `src/lib/gitStatus.ts` — `commitFileKind`, `KIND_LETTER`, `KIND_LABEL`
- Tests: `src-tauri/src/git.rs`, `src/__tests__/graphView.test.tsx`
- Docs: `docs/git.md`

**As a** developer inspecting a commit
**I want** its full message, people, parents and changed files in a pane under the graph
**So that** I understand what it did without leaving the graph

```gherkin
Scenario: GRAPH-009.1 Select a commit
  When I click a commit in the graph
  Then a details pane opens below with the full commit id, the whole message, the author with e-mail and date, its parents, its branch and tag labels
  And it lists the changed files with their letter (A, M, D, R) under a summary such as "3 files changed, 10 insertions(+), 2 deletions(-)"

Scenario: GRAPH-009.2 Move with the keyboard
  Given the commit list has focus and a commit is selected
  When I press Down, Up, PageDown, PageUp, Home or End
  Then the selection moves by one row, by one screen, or to the first / last loaded commit
  And the selected row is scrolled into view and the details follow

Scenario: GRAPH-009.3 Copy the id
  When I click the copy button beside the full id
  Then the full commit id is on the clipboard
  And a notification says "Copied the commit id"

Scenario: GRAPH-009.4 Jump to a parent
  Given a commit with one parent
  When I click the short id after "Parent"
  Then the parent is selected in the graph, loading older pages first if needed

Scenario: GRAPH-009.5 A merge commit
  Given I select a merge commit
  When I look at the details pane
  Then the row is labelled "Parents" and lists both ids
  And the file summary ends with "(against the first parent)"

Scenario: GRAPH-009.6 The first commit
  Given I select the repository's first commit
  When I look at the details pane
  Then Parent says "none (the first commit)"

Scenario: GRAPH-009.7 Committer differs from author
  Given a commit whose committer or commit date differs from the author's
  When I look at the details pane
  Then a "Committed" row shows the committer, e-mail and date

Scenario: GRAPH-009.8 Resize and close
  When I drag the top edge of the details pane
  Then its height follows, between 120 px and 70% of the window height
  And the pane's close button clears the selection and hides the pane
```

## GRAPH-010: Open what a commit changed in a file

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `DetailFile` (click / Enter, double-click)
  - `src/lib/git.ts` — `openCommitFile` (parent's text vs the commit's, `preview: true`)
  - `src/lib/diff.ts` — `openCompare` replaces the previous clean preview Compare tab
  - `src-tauri/src/git.rs` — `show` / `git_show`
- Tests: none
- Docs: `docs/git.md`, `docs/compare.md`

**As a** developer reviewing a commit
**I want** to click a file in the details pane and see what the commit changed in it
**So that** I can review a commit file by file without piling up tabs

```gherkin
Scenario: GRAPH-010.1 Click a file
  Given commit "18bc71d" modified "store.ts"
  When I click "store.ts" in the details pane
  Then a Compare tab opens with "store.ts @ 18bc71d^" on the left and "store.ts @ 18bc71d" on the right
  And both sides are read-only

Scenario: GRAPH-010.2 The next file reuses the tab
  Given that Compare tab is open and untouched
  When I click another file of the commit
  Then its comparison replaces the previous one instead of adding a tab

Scenario: GRAPH-010.3 Keep a comparison
  Given a Compare tab opened from the graph
  When I double-click its tab and then click another file in the graph
  Then the first Compare tab stays and a second one opens

Scenario: GRAPH-010.4 Added and deleted files
  Given a commit added "new.ts" and deleted "old.ts"
  When I click "new.ts"
  Then the left side is empty
  And clicking "old.ts" shows its text on the left and an empty right side

Scenario: GRAPH-010.5 Binary file
  When I click a binary file in the details pane
  Then no tab opens and a notification says "This file is binary."

Scenario: GRAPH-010.6 Open the file as it is now
  When I double-click a file in the details pane
  Then the file itself opens from the working folder
  But a file the commit deleted is not opened
```

## GRAPH-011: Copy, switch, branch and tag from a commit's right-click menu

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `GraphMenu` (kept inside the window; closes on outside click, Escape, window blur), naming strip (`Naming`, `commitNaming`), `act`
  - `src/lib/gitGraph.ts` — `actionDone` (success notifications)
  - `src/lib/git.ts` — `commitAction`, `checkoutRef`
  - `src-tauri/src/git.rs` — `commit_action` / `git_commit_action` (`branch` = `branch`, `branch-switch` = `switch -c`, `tag`), `valid_ref_name`, `checkout`
  - `src/lib/gitApi.ts` — `GitCommitAction`, `git.commitAction`
- Tests: `src-tauri/src/git.rs`, `src/__tests__/gitGraph.test.ts`, `src/__tests__/graphView.test.tsx`
- Docs: `docs/git.md`

**As a** developer
**I want** to copy a commit's id, switch to a branch on it, or start a branch or tag there
**So that** I can act on the commit I am looking at

```gherkin
Scenario: GRAPH-011.1 The menu
  When I right-click a commit
  Then the commit is selected
  And a menu opens headed by its short id and message
  And it offers Copy Commit Id, Copy Message, Create Branch Here…, Create Branch Here (Don't Switch)…, Create Tag Here…, Check Out This Commit…, Cherry-pick, Revert This Commit… and three Reset entries
  And it closes on Escape or a click elsewhere

Scenario: GRAPH-011.2 Copy
  When I choose "Copy Commit Id"
  Then the full id is on the clipboard and a notification says "Copied the commit id"
  And "Copy Message" copies the commit's first line and says "Copied the message"

Scenario: GRAPH-011.3 Switch to a branch on the commit
  Given the commit carries the labels "feature" and "origin/review"
  Then the menu has "Switch to feature" and "Switch to origin/review"
  When I choose "Switch to origin/review"
  Then a local branch "review" tracking it is checked out
  And open files that changed on disk are re-checked

Scenario: GRAPH-011.4 No switch entry for the branch I am on
  Given the commit carries only the label of the current branch
  When I right-click it
  Then the menu has no "Switch to" entry

Scenario: GRAPH-011.5 Create a branch
  When I choose "Create Branch Here…"
  Then a strip "New branch at 18bc71d:" appears with a name box and a disabled "Create and Switch" button
  When I type "hotfix" and press Enter
  Then branch "hotfix" is created at that commit and checked out
  And a notification says "On new branch hotfix"

Scenario: GRAPH-011.6 Create a tag
  When I choose "Create Tag Here…", type "v1.2.0" and click "Create"
  Then tag "v1.2.0" is created on that commit
  And a notification says "Created tag v1.2.0" and the graph reloads showing the tag label

Scenario: GRAPH-011.7 Cancel naming
  Given the naming strip is open
  When I press Escape or click its Cancel button
  Then the strip closes and nothing is created

Scenario: GRAPH-011.8 Invalid name
  When I enter the name "bad name" or "-D"
  Then nothing is created and an error says the name is not valid

Scenario: GRAPH-011.9 Create a branch without switching
  Given I am on branch "main"
  When I choose "Create Branch Here (Don't Switch)…"
  Then a strip "New branch at 18bc71d:" appears with a name box and a disabled "Create" button
  When I type "keep-this" and press Enter
  Then branch "keep-this" is created at that commit
  And I am still on "main" and my files are not touched
  And a notification says "Created branch keep-this" and the graph reloads showing the new label
```

## GRAPH-012: Check out, cherry-pick or revert a commit

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `act()`
  - `src/lib/gitGraph.ts` — `actionConfirm` (the dialogs), `actionDone` (success notifications)
  - `src/lib/git.ts` — `commitAction` (busy label, error via `gitErrorText`, `checkExternalChanges`)
  - `src/lib/gitStatus.ts` — `gitErrorText` ("Stopped on a conflict…")
  - `src/lib/actions.ts` — `askDialog`
  - `src-tauri/src/git.rs` — `commit_action` (`checkout --detach`, `cherry-pick`, `revert --no-edit`; merges with `-m 1`; `GIT_EDITOR=true`)
- Tests: `src-tauri/src/git.rs`, `src/__tests__/gitRemote.test.ts`, `src/__tests__/gitGraph.test.ts`
- Docs: `docs/git.md`

**As a** developer
**I want** to check out, cherry-pick or revert a commit from the graph
**So that** I can look at an old state or move a change without the command line

```gherkin
Scenario: GRAPH-012.1 Check out asks first
  When I choose "Check Out This Commit…"
  Then a dialog "Check out this commit?" explains that I will be on no branch ("detached")
  When I confirm with "Check Out"
  Then my files become that commit and a notification says "Checked out 18bc71d"
  And the graph shows the label "HEAD" on that commit

Scenario: GRAPH-012.2 Cherry-pick
  Given I am on "main"
  Then the menu entry reads "Cherry-pick onto main…"
  When I choose it and confirm "Cherry-pick this commit?" with "Cherry-pick"
  Then a new commit with that commit's changes is on "main"
  And a notification says "Cherry-picked 18bc71d"

Scenario: GRAPH-012.3 Revert
  When I choose "Revert This Commit…" and confirm with "Revert"
  Then a new commit that undoes it is added on the current branch, without asking for a message
  And a notification says "Reverted 18bc71d"

Scenario: GRAPH-012.4 Cancelling does nothing
  When I cancel any of these dialogs
  Then git is not run and nothing changes

Scenario: GRAPH-012.5 A conflict stops the operation
  Given the commit's changes conflict with my branch
  When I confirm the cherry-pick
  Then an error says "Stopped on a conflict. Resolve the files under Merge Changes in Source Control and commit, or press Abort to go back." followed by git's CONFLICT lines
  And the graph shows the stopped-operation strip

Scenario: GRAPH-012.6 A merge commit
  When I cherry-pick or revert a merge commit
  Then its changes against its first parent are picked or undone

Scenario: GRAPH-012.7 Detached HEAD wording
  Given HEAD is detached
  When I right-click a commit
  Then the menu entry reads "Cherry-pick onto Here…"
  And the dialog says the commit is copied onto "the current commit (not on a branch)"
```

## GRAPH-013: Reset the branch to a commit

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — Reset menu entries (hard one styled as dangerous), `act()`
  - `src/lib/gitGraph.ts` — `actionConfirm` (the dialogs; the hard reset counts the changes it loses)
  - `src/lib/git.ts` — `commitAction`
  - `src-tauri/src/git.rs` — `commit_action` (`reset --soft` / `--mixed` / `--hard`)
- Tests: `src-tauri/src/git.rs`, `src/__tests__/gitGraph.test.ts`
- Docs: `docs/git.md`

**As a** developer who wants to take commits back
**I want** to move my branch to an earlier commit, choosing what happens to the later changes
**So that** I can redo commits, and never lose work without being told

```gherkin
Scenario: GRAPH-013.1 The entries name the branch
  Given I am on "main"
  When I right-click a commit
  Then the menu has "Reset main to Here (Soft)…", "Reset main to Here (Mixed)…" and "Reset main to Here (Hard)…"
  And with a detached HEAD they read "Reset HEAD to Here (…)…"

Scenario: GRAPH-013.2 Soft
  When I choose the Soft entry and confirm "Reset (soft)?" with "Reset (Soft)"
  Then "main" points at that commit
  And the changes of the commits after it are staged, and my files are untouched
  And a notification says "Reset to 18bc71d"

Scenario: GRAPH-013.3 Mixed
  When I choose the Mixed entry and confirm with "Reset (Mixed)"
  Then "main" points at that commit and the later changes are in my files, unstaged

Scenario: GRAPH-013.4 Hard warns about uncommitted work
  Given I have 3 uncommitted changes
  When I choose the Hard entry
  Then a dialog "Reset (hard) and discard changes?" says the later commits leave the branch, "and your 3 uncommitted changes to tracked files are lost", and that it can't be undone from Quarry
  When I confirm with "Reset and Discard"
  Then every tracked file matches that commit
  And open tabs of files that changed are re-checked against the disk

Scenario: GRAPH-013.5 Cancel
  When I cancel a reset dialog
  Then the branch and files are unchanged
```

## GRAPH-014: See uncommitted work and a stopped operation above the graph

- Status: draft
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `.graph-strip` rows, `openSourceControl()` (focuses the first Merge Changes row, else the first change), Abort button
  - `src/lib/git.ts` — `abortOperation`
  - `src/lib/panels.ts` — `isPanelShown`, `showPanel`
- Tests: none
- Docs: `docs/git.md`

**As a** developer looking at the graph
**I want** to be told about work that is not in it and about an operation that stopped part-way
**So that** I am not misled by the graph and can get to the fix

```gherkin
Scenario: GRAPH-014.1 Uncommitted changes
  Given I have 4 uncommitted changes on "main" and nothing is in progress
  When I look at the graph tab
  Then a strip under the toolbar says "4 uncommitted changes on main: not in the graph until committed."

Scenario: GRAPH-014.2 A stopped operation
  Given a cherry-pick stopped with 1 conflicted file
  When I look at the graph tab
  Then a warning strip says "The cherry-pick stopped part-way: 1 file has conflicts. Resolve them in Source Control and commit, or abort to go back to how things were."
  And it has an "Abort" button
  And the uncommitted-changes strip is not shown at the same time

Scenario: GRAPH-014.3 Open Source Control from the strip
  Given the Source Control panel is not showing
  When I click "Open Source Control" in the strip
  Then the panel opens with focus on the first file under Merge Changes, or on the first changed file

Scenario: GRAPH-014.4 The button is hidden when it would do nothing
  Given the Source Control panel is already showing
  When I look at the graph tab
  Then the strips have no "Open Source Control" button

Scenario: GRAPH-014.5 Abort from the strip
  When I click "Abort" in the strip
  Then I am asked "Abort the cherry-pick?" before anything is undone
```
