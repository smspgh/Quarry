# Live checks collected from the build agents (git roadmap items 0-9)

Each check: do it in the dev build on a throwaway repo, look at a screenshot, record PASS / FAIL (with what you saw) / NOT CHECKED (with why).

## Group A: item 0 (verification debt) and item 3 (merge / rebase / force push)

Item 0 (stories CONFLICT-008, CONFLICT-012, CONFLICT-013, GRAPH-019):
A0.1 A rebase that stops on a conflict twice: Continue must stop again with a clear message and the step count must advance ("Rebasing 1 of 2" -> "2 of 2").
A0.2 Skip during a rebase.
A0.3 A file changed by us and deleted by the incoming commit: Current keeps it, Incoming deletes it.
A0.4 With no repository open: Git menu "Show Commit Graph" is not greyed out; running it (menu and palette) shows "Open a folder in a git repository" and opens no tab.

Item 3 (specs/git-merge-rebase.md), repo with a local bare remote:
A3.1 Graph: right-click a commit: the two entries (Merge into <current>…, Rebase <current> onto This…), position and wording. Right-click a branch, remote and tag label in a row and in the details pane: heading, the commit menu does not also open, Escape / outside click closes it.
A3.2 Hover disabled entries and the disabled panel button: do the reason tooltips show in WebView2?
A3.3 Panel "Merge or Rebase" button: menu position, look in a narrow panel, closes on outside click.
A3.4 Git menu layout and greying (compare with the planned layout in the Decisions of specs/git-merge-rebase.md: all groups from all features); palette prompts for merge and rebase; "No matches" on a made-up name.
A3.5 Merge clean, fast-forward and merge-commit: the three-button dialog, Enter and Escape both cancel, "Merging…" beside the branch, graph reloads.
A3.6 Merge with a conflict: Source Control opens by itself, an open clean tab reloads with conflict bars, graph strip appears, Commit and Abort work.
A3.7 Rebase clean, and with a conflict: "Rebasing 1 of 2", Skip / Continue / Abort, the sides note in the bars.
A3.8 Rebase of pushed commits: danger dialog and its list, then status line with only "Force Push…"; the offer disappears after a force push, a branch switch and a restart.
A3.9 Force push refused after another clone pushed: the message, their commit still on the remote; the panel's background remote check does not confuse this.
A3.10 Dirty tracked file: refusal dialog and its Show Source Control button; an untracked-only tree is not blocked.
A3.11 Macro: record `git.mergeRef` and replay it during a stopped operation.

## Group B: item 1 (hunk / line staging) and item 2 (stash)

Item 1 (specs/git-staging.md):
B1.1 Side by side: bars sit above each change, left side stays level with the right (gap), nothing drifts after scrolling. NEVER SEEN RENDERED: look closely.
B1.2 Inline layout: bar above the removed-lines block of each change.
B1.3 A change that only removes lines, incl. at the very start and end of the file: bar position, Stage / Discard.
B1.4 Three changes: stage one, discard one, leave one; check `git diff --cached` and `git diff` in a shell, the file in both panel sections, "Commit 1 Staged".
B1.5 After a staging action the view does not jump and focus stays in the editor; F7 then Ctrl+K S repeatedly works; the chord's second key is never typed.
B1.6 Selected lines: Shift+Down then Ctrl+K L; toolbar buttons enable / disable as the selection moves; a selection in the left side has no effect.
B1.7 Dirty tab: Stage saves it silently (dot goes away); Discard dialog shows the "saved first" sentence, Enter and Escape cancel; after a discard the tab shows the restored lines with no reload question.
B1.8 Type in the file's tab after opening the comparison, then Stage: nothing staged or saved, comparison reloads, message appears.
B1.9 `git add` in a shell, then Stage Change: stale message, tab reloads; Reload button re-reads the index.
B1.10 Real CRLF file, and a repo with core.autocrlf=true: no whole-file diff afterwards.
B1.11 A UTF-16 file: refusal message is readable.
B1.12 Deleted file comparison, a staged new file edited again, a staged rename: bars do the right thing.
B1.13 Swap sides hides the controls, swapping back restores them; during a pull or commit the buttons are greyed out.
B1.14 Git › Stage Part of a File: enabled states, shortcut labels, greyed out on a text tab.
B1.15 Toolbar width with the two extra text buttons in a narrow window.
B1.16 Dark theme: bar and button colours.

Item 2 (specs/git-stash.md):
B2.1 Stash Changes… from the heading, Git › Stash and the palette: form opens and the message box has focus (from the palette, returning editor focus may steal it).
B2.2 Stash with and without "Include untracked files": untracked files leave or stay, an ignored file stays, open tabs reload the committed text, gutter markers clear.
B2.3 Row hover shows Apply / Pop / Drop without clipping at the 280 px minimum panel width; disabled-button tooltips appear.
B2.4 Show Stashes with the panel closed: section opens, first row focused; Delete on a focused row opens the drop dialog; Enter in that dialog cancels.
B2.5 Make a stash in a shell, refocus Quarry: it appears in the list.
B2.6 Apply onto a dirty file the stash touches, and with an existing untracked file: error sentence, nothing changes, stash kept.
B2.7 Conflicted pop: warning toast, Source Control opens, "Stash conflicts" badge with no Abort / Skip; bar note "Stash: Current is your files as they are now, Incoming is the stash."; row marked "applied with conflicts"; resolving the last file gives the "offers to drop the stash" sentence, then the drop offer with Keep Stash default; Drop Stash drops without a second question.
B2.8 "Current" on the conflicted row restores the pre-pop file.
B2.9 Restart mid-conflict: files still under Merge Changes, badge still there, no drop offer.
B2.10 Conflicted apply: same flow, no offer.
B2.11 Graph, All branches: stash row with hollow dot and label in the stash colour (light and dark); above its base (tip and older commit); right-click menu, details pane files and Compare tab; graph reloads after stash / pop / drop from the panel; no stash rows in Current branch; warning strip during a stash conflict.
B2.12 A repo with more than 300 commits and a stash: scrolling loads further pages with no gap or duplicate.
B2.13 Stash, apply and pop disabled during a stopped rebase or cherry-pick; drop still works.

## Group C: item 4 (branch / tag housekeeping), item 5 (compare commits), item 7 (graph polish)

Item 4 (specs/git-branches.md):
C4.1 Graph: right-click local, current, remote and tag labels: entry order, separators, icons, hover / menu-open outline in both themes.
C4.2 Delete a merged branch: Enter and Escape must not delete; graph and picker update.
C4.3 Delete an unmerged branch: second red dialog, Cancel default, Delete Anyway.
C4.4 Rename strip: name prefilled and selected, Rename disabled until changed; rename the current branch and watch the panel button and status bar.
C4.5 Case-only rename (Feature -> feature).
C4.6 Picker row menu: "⋯" on hover / active row; Shift+F10 opens it without WebView2's native context menu on top; Up / Down / Enter work; Escape returns to the list rather than closing the palette; menu stays on screen for bottom rows.
C4.7 Rename from the row menu: picker reopens as `New name for "x"…` with the name selected and focus in the box.
C4.8 Set Upstream…: same-name branch first, "tracking" label, Stop tracking, the "No remote branches yet" note with its push row; status line follows.
C4.9 Push a non-current branch to a local bare remote: "Pushing x…" in panel and status bar, `origin/x` label moves, you stay on your branch.
C4.10 Rejected push: dialog, then Switch to x lands on x with Source Control showing what to pull.
C4.11 Delete a remote branch: dialog names remote and address; label disappears; on the tracking branch the status line shows "Push to Recreate It".
C4.12 Delete a stale remote label (branch already removed from the bare repo): "already gone" notification.
C4.13 Delete / push a tag from the label and from Git › Branches and Tags; push an already-pushed tag; a moved tag is refused.
C4.14 No-remote repository: Push and Set Upstream entries open the Add Remote form.
C4.15 Git › Branches and Tags greyed out with no repository; all seven appear in the palette.
C4.16 Right-click a label in the details pane's Refs line.
C4.17 A graph tab for a repository that is not the Source Control context: actions hit the graph's repository.

Item 5 (specs/git-compare-commits.md):
C5.1 Ctrl+click two commits: both rows highlighted, dashed outline on the second, visible in light and dark; Escape, arrow keys and a plain click end it.
C5.2 Pick the newer commit first: heading flips to older ↔ newer once git answers; is the flicker acceptable.
C5.3 Swap Sides, then click a file: sides and labels follow.
C5.4 Compare two commits beyond page 1, open a file, return to the graph tab: pane still there, Show in Graph on unloaded sides.
C5.5 Compare with Working Tree with one staged, one unstaged change and three untracked files; edit and save a file: it appears without a reload; `git status` before and after identical.
C5.6 Working-tree file not open: right side editable and Ctrl+S writes it. Open with unsaved edits: "(unsaved)", read-only.
C5.7 Git › Compare with Branch… on a feature branch, pick main: graph tab opens with "… main ↔ … feature"; also from a commit's menu, on a detached HEAD, picking the current branch, Escape in the picker.
C5.8 A branch whose commit is far back: pane shows at once, Show in Graph loads back to it.
C5.9 During a stopped merge or rebase: compare, click a conflicted "!" file (opens with conflict bars), operation unchanged.
C5.10 A large diff (thousands of files): scrolling smooth, "Loading…" shows while git works.
C5.11 Graph tab of a repository other than the current one: Compare with Branch… lists that repository's branches.

Item 7 (specs/git-graph.md GRAPH-015..018):
C7.1 Dirty repo: first row with hollow dot and dashed line, no strip. Clean repo: no row.
C7.2 Upstream 2 commits ahead plus one change: row on top, incoming commits in lane 2, dashed line ending at main.
C7.3 All branches with HEAD far down (over 300 rows): dashed line never cut, reaches HEAD after scrolling.
C7.4 Select the row: groups and letters match Source Control. Click a modified file (Compare tab with staging bars), a new file (opens the file), a conflicted file during a stopped cherry-pick (conflict bars). Double-click opens the file. "Based on" jumps to the commit.
C7.5 Save, stage, discard while scrolled 200 rows down with a commit selected: count updates with no reload or jump. Commit everything with the row selected: row and pane go.
C7.6 Right-click and Ctrl+click on the row; Up / Home / Down; Find "uncommitted" gives "0 in N loaded".
C7.7 Empty repo with new files: row above "No commits yet.".
C7.8 Results divider: drag up to the 80 px stop and down until the list keeps 6 rows; 2 results don't grow; pick a result after a drag; Show Fewer / Show More; double-click reset; shrink the window; the details-pane divider still works.
C7.9 Lane scrolling on the large fixtures, opened as GRAPH TABS ONLY, never as a folder with Source Control: `git clone --filter=tree:0 --no-checkout https://github.com/git/git.git` (and rust-lang/rust if time allows), All branches: column stays 198 px, scroll bar appears when a wide page loads without lanes jumping; Shift+wheel moves only the lanes; fades on the correct sides; selecting a commit in a high lane reveals its dot; scroll-bar thumb usable inside the 24 px heading.
C7.10 Date order in a small repo with a merged branch: rows interleave by date, main stays in lane 1, selected commit stays in view, a reload keeps it; disabled tooltip shows; switch to All branches with more than 300 commits: falls back with one notification.
C7.11 Repos of exactly 300 and 301 commits: "300 commits" with the toggle enabled versus "300+" with it disabled.

## Group D: item 6 (edit history), item 8 (buffer-aware safety), item 9 (Claude git helpers)

Item 6 (specs/git-history-edit.md):
D6.1 Menu group on tip, middle, root, merge, below-a-merge, other-branch and detached commits: tooltips and danger styling.
D6.2 Undo Last Commit: files staged, message lands in an empty commit box, a typed message is left alone; also with the panel closed and opened afterwards.
D6.3 Reword strip: text selected, Ctrl+Enter, Enter adds a line, Escape; tip reword with staged files.
D6.4 Drop a middle commit and the tip; untracked files kept; open tabs reload.
D6.5 Squash into parent, including into the root commit (no Rust test covers root).
D6.6 List layout: hidden rows, search box and details pane; row widths; message boxes; pushed badge; warning strip. ALSO: open Edit History while Search All History results are showing: the list must be visible (a CSS-only merge fix, untested).
D6.7 Pointer drag: drop line, auto-scroll near the edges, landing index (no test exists).
D6.8 Keys: P/R/S/F/D, Alt+Up/Down in the list, and Alt+Down still moving a line in a text tab; Ctrl+Enter and Escape in the list and the strip.
D6.9 Action picker: disabled Squash/Fixup on the bottom row; focus returns to the list after a pick.
D6.10 Conflict stop from a drop: Source Control opens, badge counts commits ("Rebasing 1 of 1", "2 of 4"), list closes, Continue applies typed messages, Skip, Abort, restart while stopped.
D6.11 Pushed commits: danger dialog, then the Force Push… status line; undo of a pushed tip shows Force Push and not Pull; after stop + Continue it is offered, after Abort it is not.
D6.12 Palette and Git › Edit History: greyed out when detached, mid-operation, or (Undo) on a root or merge tip; the "every commit is already pushed" message.
D6.13 A commit made in a shell while a dialog or the list is open: "main has changed…" and the list reloads.
D6.14 A repo with a pre-commit hook and commit.gpgsign: what the hook-skipping and signing actually do.

Item 8 (specs/git-safety.md):
D8.1 Switch branch with two unsaved tabs: dialog text, Enter = Save All, Escape = Cancel, list layout with more than 10 files.
D8.2 Continue Without Saving on a switch: one warning, no question on window refocus, Ctrl+S overwrites silently.
D8.3 Save All with a read-only file: "Not switched: … could not be saved."
D8.4 Pull with a kept unsaved tab (focus leaving and returning mid-pull if you can arrange it): no "changed on disk" question.
D8.5 Cherry-pick and pull that stop on a conflict: the open tab shows markers and conflict bars at once, without refocusing.
D8.6 Merge with an unsaved tab: Save leads to "Commit or discard your changes first"; Continue Without Saving leads to the merge dialog.
D8.7 Hard reset and Abort with two unsaved tabs, only one file rewritten: one tab reloads, the other keeps its edits.
D8.8 Discard of a file with unsaved tab edits; discard of an untracked open file (tab closes).
D8.9 Take Incoming on a conflicted file open as a large-file tab and as a Compare tab.
D8.10 Switch to a branch lacking two open files, then back: one warning, tabs come back clean.
D8.11 Stash with unsaved edits: Save puts them in the stash; Cancel keeps the form and message.
D8.12 Split editor: both panes reload after a pull.
D8.13 A Compare tab with a file side reloads after a switch; an edited comparison is left alone.
D8.14 A "changed on disk" question left open while a pull finishes: reloads happen after answering.
D8.15 Macro "Switch to Branch" with an unsaved tab.

Item 9 (specs/git-claude.md). These make REAL Claude requests on the owner's plan: keep to the minimum needed (aim for at most 8 requests in total, tiny repos, the default Haiku git model):
D9.1 Draft with 3 staged files: dialog wording, spinner, read-only box, draft lands with the cursor in it, nothing committed; the status-bar counter and the ways to stop.
D9.2 Draft with nothing staged and an untracked file plus an ignored file: the dialog names the untracked one (cancel the dialog: no request needed).
D9.3 Draft with Amend ticked; with existing text (Replace dialog, Keep default); during a rebase and with conflicts (disabled tooltips).
D9.4 A large change (one file over 20,000 characters): the note in the dialog and under the box (cancel before sending if the note is visible in the dialog).
D9.5 Explain on a merge conflict: the panel's look in light and dark, Apply Suggestion, Ctrl+Z, the last conflict leading to "Save and Mark Resolved", Discard, Escape.
D9.6 Explain during a rebase: the note in the panel, and whether Claude keeps Current / Incoming straight.
D9.7 Edit the conflict while Claude is reading (stale message) and after the answer (Apply disabled).
D9.8 Summarise Branch from the menu (base picker with main first) and from a graph branch label; tab name, Markdown mode, heading lines.
D9.9 Switch Claude Code off with a panel open; switch it back on: Explain reappears without reopening the file; with it off, no Draft button, no menu items, no palette commands.
D9.10 Failure path: a wrong Claude Code location (Open Settings dialog). Quitting mid-request leaves no `claude.exe`.
D9.11 "Model for git helpers" row: Haiku default, Restore default; a Claude tab still uses its own Model.
