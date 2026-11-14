# Live results, Group B (dev build over CDP, 2026-11-14)

Window 1536 x 816 CSS px (250 % scaling), light theme unless said. Screenshots: live-B/shots/. Repos: live-B/repos/* (fresh, each with a local bare remote in live-B/remotes).
Clicks, right-clicks and keys were real input through CDP Input.* unless a line says "internal". Source Control was pinned for the whole run (so the floating-panel click loss of open issue 3 does not get in the way).

## B1.1 FAIL, fixed (0dad0a5), then PASS
- st1/long.txt (9 changes of different shapes), side by side. Before the fix: after every change that only removes lines the right side was one bar (22 px) lower than the left, and after a change that only adds lines the left side was 22 px lower; the offset stayed for the rest of the file (B1.1-01-BEFORE-FIX-long-top.png: "row 36" at different heights; in rem.txt every line was off, B1.3-01-BEFORE-FIX-rem.png). Cause: @codemirror/merge levels the sides at the first line after a change and measures that line together with block widgets above it; the bar (or gap) of a change with no lines on that side sat above that line.
- Fix: `barPlace` in gitHunks.ts (the widget of an empty side hangs below the line before the change; at the very start of the file both widgets go directly above the first remaining line). New scenario STAGE-001.10, unit tests in gitHunks.test.ts.
- After the fix, measured in the DOM (y of every unchanged line on both sides, gaps and bars) at scroll 0, 700, 1500 and the end: 0 lines off, every gap level with its bar (B1.1-02-long-top.png, B1.1-03-long-bottom.png). Bars sit above each change with Stage Change (accent) / Discard Change (red).

## B1.2 PASS
- Inline layout: the bar sits above the removed-lines block of each change, also for replaced lines (bar, removed, added) (B1.2-01-long-inline-top.png, B1.2-02-rem-inline.png).

## B1.3 PASS (after the B1.1 fix)
- st1/rem.txt: lines removed at the very start (2), in the middle (4) and at the very end (2). Side by side: bar above the blank space the removed lines leave; at the very start the bar and the left gap sit directly above the first remaining line, below the blank space (B1.3-02-rem-side-by-side.png). Inline: bar above each removed block (B1.2-02-rem-inline.png).
- Stage Change on the start change: `git diff --cached` = exactly "-item 1 / -item 2"; tab became "rem.txt (staged) ↔ rem.txt", "2 changes".
- Discard Change on the end change: dialog "Discard this change?" / "The 2 lines removed after line 22 of rem.txt are put back." with Discard Change (red) and Cancel (focused) (B1.3-03-discard-dialog-end.png). Enter cancelled (file unchanged). Confirmed: item 29 / item 30 are back on disk, "1 change", sides level (B1.3-04-after-stage-start-discard-end.png).

## B1.4 PASS
- st1/app.txt, changes at line 3, lines 20-22 and line 40 ("3 changes", three bars: B1.4-01-app-3-changes.png). Stage Change on the first: no dialog, tab becomes "app.txt (staged) ↔ app.txt", "2 changes".
- Discard Change on lines 20-22: dialog "Lines 20–22 of app.txt go back to the staged version. Your edits to those lines will be lost.", Cancel focused (B1.4-02-discard-dialog.png); Escape cancelled (file unchanged); confirmed with Discard Change.
- Shell: `git diff --cached` = only "line 3 → line 3 CHANGED"; `git diff app.txt` = only line 40; lines 20-22 on disk are the committed text.
- Panel: app.txt under Staged Changes and under Changes, button "Commit 1 Staged" (B1.4-03-one-staged-one-discarded.png).
- Also seen (STAGE-002): the row under Staged Changes opens "rem.txt (HEAD) ↔ rem.txt (staged)" with one bar "Unstage Change" and a toolbar button "Unstage Selected Lines" only (B1.x-staged-compare-unstage-bar.png); Unstage Change emptied the index, tab reads "No differences", the other comparison's tab title went back to "rem.txt (HEAD) ↔ rem.txt".

## B1.5 PASS after a fix (6ac3e23); one limit noted
- st1/long.txt, clicked into the right side, F7 to change 5, Ctrl+K S: staged (shell: only rows 150-151 in `git diff --cached`), "8 changes", focus still in the right editor; F7 + Ctrl+K S three more times each staged the next change. The "s" never reached the text (no "edited" tag, file unchanged). A toast "Ctrl+K pressed, waiting for second key…" shows each time.
- Cursor on an unchanged line: Ctrl+K S gives "Stage Change at Cursor is not available here" (B1.5-03-not-available-toast.png), Ctrl+K U "Unstage Change at Cursor is not available here", Ctrl+K X "Ctrl+K X is not a shortcut"; nothing typed.
- FAIL before the fix: after each staging action the view moved by 1 to 7 lines (first visible line row 37 at +20 px before, +121 px after; B1.5-01-before.png / B1.5-02-after-ctrlK-S.png), because the merge view adds its levelling spacers after the scroll position was restored. Fix: `placeOf` / `restorePlace` in DiffView.tsx keep the pixel offset of the first visible line and put it back again once the spacers are in. After the fix: same line at the same pixel for three actions in a row. No unit test (jsdom has no layout).
- Limit, not fixed: staging the last change near the end of the file still moves the view when the file becomes shorter than the old scroll position (the staged change folds into "N unchanged lines").

## B1.6 PASS
- st1/add.txt (lines 10-15 added). Cursor on "new 11", Shift+Down, Ctrl+K L: shell shows exactly "+new 11 / +new 12" staged and new 10, 13, 14, 15 unstaged; the comparison shows two smaller changes (B1.6-01-selection.png, B1.6-02-after-ctrlK-L.png).
- Toolbar: cursor on an unchanged line of the right side: both buttons disabled; cursor inside a change: enabled.
- A selection made in the left side (click + Shift+Down there) changes nothing: the buttons stay as the right side's cursor says (disabled with the right cursor on an unchanged line, B1.6-03-left-selection.png; enabled with it inside a change).

## B1.7 PASS
- st1/app.txt open in a text tab, typed into line 10 (tab dirty); its row under Changes opened "app.txt (staged) ↔ app.txt (unsaved)" with 2 changes (B1.7-01-unsaved-compare.png). Stage Change: no question, a "Saved app.txt" toast, the tab's dot gone, label back to "app.txt", the typed line staged (shell) (B1.7-02-after-stage-saved.png).
- Typed again (line 50), Discard Change: dialog "Line 50 of app.txt goes back to the staged version. Your edits to that line will be lost." + "app.txt has unsaved changes; they are saved first.", Cancel focused (B1.7-03-discard-dialog-saved-first.png). Enter: cancelled, tab still dirty, disk unchanged. Escape: the same.
- Discard Change confirmed: tab saved, line 50 back to "line 50" on disk and in the text tab, no reload question, the other change (line 40) kept (B1.7-04-tab-after-discard.png).

## B1.8 PASS
- With the comparison of app.txt open, typed in the file's own tab (line 55), went back to the comparison by its tab and clicked Stage Change: nothing staged (index unchanged in the shell), the tab still dirty and the file on disk unchanged, the comparison reloaded as "app.txt (staged) ↔ app.txt (unsaved)" with 2 changes, warning toast "app.txt changed since this comparison was loaded. It was reloaded: check the change and try again." (B1.8-01-stale-message.png).
- SEEN (small, open): after that tab was then saved (Save All), the comparison kept the label and tab title "app.txt (unsaved)" although nothing is unsaved any more, also when its tab was shown again; only a click on the row (or an action) brings it up to date.

## B1.9 PASS
- rem.txt comparison open (HEAD ↔ rem.txt, 2 changes); `git add rem.txt` in a shell; Stage Change clicked: nothing done by Quarry, tab reloaded to "rem.txt (staged) ↔ rem.txt", "No differences", the same warning toast (B1.9-01-stale-after-git-add.png).
- `git reset rem.txt` in a shell: the panel followed by itself, the comparison did not (still "(staged)", "No differences"); the toolbar's "Reload the files from disk" then gave "rem.txt (HEAD)" and 2 changes again.

## B1.13 PASS
- Swap sides: the bars and both selected-lines buttons are gone (B1.13-01-swapped.png); swapping back brings them back.
- Busy: a pre-commit hook with `sleep 6` in the throwaway repo made a real commit last 6 s. While "Committing…" showed, every bar button and both toolbar buttons were greyed out and a click on Stage Change did nothing (B1.13-02-busy-during-commit.png); enabled again afterwards. (A pull was not tried: same `busy` flag.)

## B1.14 PASS
- Git › Stage Part of a File (after Stash; the planned order is the reverse, known issue 7), from a Changes comparison with the cursor in a change: Stage Change at Cursor (Ctrl+K S), Discard Change at Cursor…, Stage Selected Lines (Ctrl+K L), Discard Selected Lines… enabled; Unstage Change at Cursor (Ctrl+K U) and Unstage Selected Lines (Ctrl+K N) greyed; the Discard entries show no shortcut (B1.14-01-menu-changes-cursor-in-change.png).
- Cursor on an unchanged line: all six greyed (B1.14-02-unchanged-line.png). Staged comparison: only the two Unstage entries enabled (B1.14-03-staged-compare.png). Text tab: the submenu entry itself is greyed and all six inside (B1.14-04-text-tab.png); Ctrl+K S there gives "Stage Change at Cursor is not available here".

## B1.15 FAIL (open, layout decision)
- The window itself was not resized (it is maximised and CDP cannot size a Tauri window); instead the editor area was narrowed by widening the pinned Source Control panel through the store (internal), which gives the toolbar the same width as a narrow window would.
- Editor area 1052 px (normal state here): everything fits. 792 px: the two file labels are cut to "rem." and "r" (B1.15-toolbar-editor-788.png). 592 px: the labels are gone (zero width), the swap icon sits on top of "1 change", the Side by side / Inline switch is squashed to a 39 px stub reading "S I" (B1.15-toolbar-editor-588.png). "Stage Selected Lines" + "Discard Selected Lines" never shrink (269 px together) and nothing wraps, so everything else pays. The toolbar needs about 1000 px to show two short file names. Not fixed: needs a choice (wrap to a second row, icon buttons, or an overflow menu).

## B1.16 PASS
- Dark theme (set through the store, internal): bar is a slightly lighter strip with a top divider, Stage Change light blue, Discard Change pink-red, hover outline visible, the left gap the same strip; side by side level (B1.16-01-dark-side-by-side.png), inline (B1.16-02-dark-inline.png). Disabled toolbar buttons are dim but readable.

## B1.10 PASS
- st3/win.txt (CRLF on disk and in the commit, core.autocrlf=false), Stage Change on the first of 2 changes: `git diff --cached --stat` = 1 insertion, 1 deletion; the staged line is "win 3 CHANGED\r"; the index blob is "ASCII text, with CRLF line terminators"; `git diff --stat` = the other change only; the file on disk byte-identical (cmp).
- st4/win.txt (core.autocrlf=true, LF in the repository, CRLF on disk), 3 changes: see the lines below.

## B1.11 PASS
- st3/wide.txt (UTF-16 LE with BOM): the comparison opens readable with one change and a bar; Stage Change: nothing staged, error toast "This is a binary file (or UTF-16 text, which git treats as binary): only the whole file can be staged, unstaged or discarded." (B1.11-01-utf16-refusal.png). The bar and buttons stay (they are offered although they can never work for this file).
- st4: Stage Change on line 3, Discard Change on line 20 (dialog "Line 20 of win.txt goes back to the staged version…", confirmed), line 35 left. Shell: `git diff --cached` = only "-win 3 / +win 3 CHANGED" with LF (`git ls-files --eol`: i/lf w/crlf); `git diff` = only line 35, no whole-file diff and no warning; all 40 lines on disk still end in CRLF (B1.10-01-autocrlf-after.png).

## B1.12 PASS
- Deleted file (st2/old.txt): "old.txt (HEAD) ↔ old.txt (deleted)", one change, bar with Stage Change / Discard Change, selected-lines buttons disabled (B1.12-01-deleted-file.png). Discard Change asks the file-level question "Discard changes? Your changes to old.txt will be lost. Open tabs reload the committed text." (Cancel focused; Enter cancelled, B1.12-02-deleted-discard-dialog.png). Stage Change staged the deletion (`D  old.txt`); in the staged comparison Unstage Change took it back (` D old.txt`).
- Staged new file edited again (new.txt, `AM`): the row under Changes opens "new.txt (staged) ↔ new.txt" with 2 changes and bars (B1.12-03-staged-new-file-edited.png); Stage Change on the first left only "fresh 25" in `git diff`. From Staged Changes its whole text is one change; Unstage Change made it untracked again (`?? new.txt`, file still on disk).
- Staged rename with 2 edits (ren-old.txt → ren-new.txt): staged comparison with 2 bars "Unstage Change" (B1.12-04-staged-rename.png); unstaging the second: status `RM ren-old.txt -> ren-new.txt`, `git diff --cached -M` still shows the rename with one changed line, `git diff` shows the line 35 edit.
- Small: the left label of the rename comparison reads "ren-new.txt (HEAD)" although the file is called ren-old.txt in HEAD.

## B2.1 PASS
- sh1 (2 modified, 1 staged, 2 untracked, 1 ignored file). "Stash Changes…" on the Stashes heading: form at the top of the section, empty box with the focus and the placeholder "Stash message (optional)", ticked "Include untracked files (2)", Stash / Cancel (B2.1-01-form-from-heading.png). Escape closes it.
- Git › Stash (Stash Changes…, Apply / Pop / Drop Latest Stash… greyed with no stash, Show Stashes; B2.1-02-git-stash-menu.png) with the cursor in a text tab: form opens, focus in the message box.
- Palette "Git: Stash Changes…" from a text tab: focus in the message box, also with Source Control unpinned and closed beforehand (the panel opens, B2.1-05-palette-panel-closed.png); typing went into the box, not into the document.

## B2.2 PASS
- With "Include untracked files (2)" ticked, message "typed here", Enter in the box: toast "Stashed 5 files: typed here"; panel "No uncommitted changes.", status line "Everything is committed and matches origin/main."; Stashes (1) lists "typed here / main · just now"; draft.txt and notes.txt gone from the folder, the ignored build\out.log still there (`git status --ignored`: only `!! build/`); the open a.txt tab shows the committed "a 3" again (toast "a.txt changed on disk and was reloaded."), its gutter marker gone (B2.2-01-before.png, B2.2-02-after-stash-untracked.png).
- Unticked: see the line under B2.6 below (done after the pop).

## B2.3 PASS for the layout (one fix, dedf033); tooltips NOT CHECKED with the real pointer
- Panel at 280 px (width set through the store, internal), real hover on the row: Apply / Pop / Drop (Drop red) all inside the panel, right edge 315 of 324 (B2.3-01-row-hover-280.png).
- FAIL, fixed: the row grew from 41.6 to 50.1 px while hovered (`.btn.small` is 26 px high), so everything below jumped on every hover. Fix dedf033: 20 px buttons and a fixed line height in a stash row; row is 44.1 px hovered or not (B2.3-02-row-hover-280-fixed.png). CSS only, no test.
- Disabled-button tooltips: NOT CHECKED on screen. The real-pointer method of run A could not be used: the owner's screen was showing a full-screen game, so I stopped after one pointer move (pointer put back; the two screen captures were deleted). What is known: the disabled "Stash Changes…" button has the title "There are no uncommitted changes to stash" and computed `pointer-events: none`, which is exactly the cause of known open issue 2 (no tooltip in WebView2). So the stash buttons (Stash Changes…, Apply, Pop while disabled) are affected by issue 2.

## B2.4 PASS
- Source Control unpinned and closed, the Stashes section collapsed beforehand; palette "Git: Show Stashes": the panel opens, the section is open, the focus is on the first stash row (B2.4-01-show-stashes.png).
- Delete on the focused row: dialog "Drop this stash?" / "\"typed here\" (5 files, made on main 1 minute ago) will be deleted. Its changes are not in your files or in any commit, and Quarry cannot bring it back." with Drop Stash (red) and Cancel (focused) (B2.4-02-drop-dialog.png). Enter closed it; the stash was still there (`git stash list`).

## B2.5 PASS (without a real refocus)
- `git stash push -m "from shell"` in a shell: the row "from shell / main · just now" was in the list 2.5 s later, before any focus change (the folder watcher picks it up). The window could not really be refocused (the owner's full-screen game had the screen); a synthetic `focus` event (internal) changed nothing further (B2.5-01-shell-stash-listed.png).

## B2.6 PASS
- Own uncommitted change to a.txt, Apply on "typed here" (which changes a.txt and holds 2 untracked files): error toast "a.txt has uncommitted changes that this stash would overwrite. Commit or stash them first, then apply again."; `git status` unchanged (only ` M a.txt`), no untracked file restored, both stashes kept (B2.6-01-apply-dirty-file.png).
- Clean tracked files but an own untracked notes.txt: error "notes.txt is already in the folder, and this stash holds an untracked file with that name. Move or delete it, then apply again."; notes.txt still "mine, keep", nothing else changed, stash kept (B2.6-02-apply-untracked-exists.png). Pop gives the same with "then pop again".
- Then (clean): expanded the row: a.txt M, b.txt M, c.txt M, draft.txt U, notes.txt U; a file opens the preview Compare tab "a.txt @ 2cde0d8 ↔ a.txt @ stash 77e9d0a" (read-only both sides, no staging bars), the next click replaced it (B2.x-stash-files-compare.png). Pop: toast "Popped stash: typed here", all five files back under Changes (the staged one unstaged), stash gone.
- B2.2 second half: box unticked, no message: toast "Stashed 3 files", row "WIP at 2cde0d8 Fix tab order", draft.txt and notes.txt still in the folder and under Changes (B2.2-03-form-unticked.png, B2.2-04-after-stash-tracked-only.png). Opening the form again: the box is ticked again; with only untracked files left and the box unticked, Stash is disabled with the note "Only untracked files have changed: tick the box to stash them." (B2.2-05-only-untracked-unticked.png).

## B2.7 PASS
- shc1 (stash "WIP parser" changes app.txt line 3 and store.txt; app.txt line 3 was committed differently afterwards). app.txt open in a tab, Source Control unpinned and closed, palette "Git: Pop Latest Stash".
- Seen at once (B2.7-01-conflicted-pop.png): warning toast "Stash WIP parser conflicts with your files in 1 file. Resolve it under Merge Changes. The stash is kept until you drop it." (no Abort mentioned); Source Control opened by itself; app.txt "!" under Merge Changes, store.txt under Staged Changes; badge "Stash conflicts" beside Merge or Rebase, no Abort and no Skip; button "Resolve 1 Conflict First" (disabled); message box empty; stash row "WIP parser / main · 24 minutes ago · applied with conflicts"; Stash Changes…, Apply and Pop disabled with the title "Resolve the conflicts first", Drop enabled; the tab reloaded with the bar "Conflict 1 of 1 · Accept Current · Accept Incoming · Accept Both · Compare · Explain" and the note "Stash: Current is your files as they are now, Incoming is the stash."
- Accept Incoming: dialog "No conflicts left in app.txt" / "Save app.txt and mark it resolved? It is the last file: after this, Quarry offers to drop the stash." (B2.7-02-no-conflicts-left-dialog.png). Save and Mark Resolved: dialog "Conflicts resolved: drop the stash?" / "The changes of "WIP parser" are now in your files. The stash itself is still in the list: drop it if you no longer need it." with Drop Stash (red) and Keep Stash (focused) (B2.7-03-drop-offer.png). Drop Stash: toast "Dropped stash: WIP parser", no second question, badge gone, both files under Staged Changes, "Commit 2 Staged", nothing committed, nothing of Quarry's in .git (B2.7-04-after-drop.png).
- SEEN (small, open): a stash form left open in another repository was still open here, during the conflict, with its Stash button disabled (visible in B2.7-01): the form survives a change of folder / repository.

## B2.8 PASS
- shc2, Pop from the row (conflict as in B2.7). Row buttons under Merge Changes: Current ("Resolve by keeping the whole file as it is now, without the stash's changes to it. Stash: Current is your files as they are now, Incoming is the stash."), Incoming ("…taking the stash's version of the whole file…") (titles read from the DOM; B2.8-01-row-buttons.png).
- Current: toast "app.txt: took the current version."; app.txt on disk and in its tab has "app 3 committed later" again (= HEAD, `git diff HEAD` shows only store.txt), no conflict left, store.txt still staged (B2.8-02-after-current.png). The drop offer followed; Enter chose Keep Stash: stash still listed, without the "applied with conflicts" mark, badge gone, no second offer after a refresh.
- FOR THE OWNER (wording, not changed): after "Current" the offer still says "The changes of "WIP parser" are now in your files" (B2.8-03-drop-offer-after-current.png). That is not true for the file where Current was taken: the stash's change to app.txt is in no file, and Drop Stash would lose it for good. Keep Stash is the default, so nothing is lost by Enter, but the sentence invites the drop.

## B2.10 PASS
- shc4, Apply from the row: same picture as the pop (Merge Changes, "Stash conflicts" badge, bar note, row marked "applied with conflicts"); the warning ends "The stash stays in the list." (B2.10-01-conflicted-apply.png). Accept Both: the dialog says "It is the last file: after this the stash's changes are in your files (nothing is committed for you)." Save and Mark Resolved: no drop offer, the mark is gone from the row, both files staged, the stash still there (B2.10-02-resolved-no-offer.png).

## B2.11 PASS (one cosmetic fix, 7a40fec)
- sg (3 stashes: two on the tip, one with a staged change + an untracked file on the older commit "two"; a feature branch; one uncommitted change).
- Current branch: no stash rows (B2.11-01-current-branch.png). All branches: one row per stash with a hollow teal dot, a teal "stash" label and an italic title, joined to its base; the two tip stashes directly above "seven" (newest first), "try new layout" directly above "two" in its own lane, main stays in the first lane; no "index on…" / "untracked files on…" rows (B2.11-02-all-branches-light.png, dark: B2.11-08-all-branches-dark.png, label and dot readable in both).
- FAIL, fixed (7a40fec): the last letter of each italic stash title (and of "Uncommitted changes (1)") was cut by the cell's overflow ("WIP parse", B2.11-02b-crop.png); 3 px of padding, B2.11-03b-crop.png.
- Right-click on a stash row and on its "stash" label: one menu with Apply Stash, Pop Stash, Drop Stash…, Copy Message only (B2.11-04-stash-row-menu.png); Escape closes it.
- Details pane: message, "Stashed Live Test … date", Parent link 7edfaa7, Refs "stash", "3 files in this stash": f.txt M, g.txt M, notes.txt U (B2.11-05-stash-details.png). A file opens "notes.txt @ 7edfaa7 ↔ notes.txt @ stash f28ce78" (B2.11-07-stash-file-compare.png).
- With the graph tab in front: Drop from the panel row (dialog, Drop Stash) removed the row; Stash Changes… ("graph stash") added a row on top and the uncommitted row went; Pop removed it again, each without a manual reload (B2.11-06-after-stash-from-panel.png).
- Small: the heading counts stash rows as commits ("11 commits" for 9 commits + 2 stashes... it showed 11 with 3 stashes and 8 commits).
- Warning strip during a stash conflict: see B2.9.

## B2.9 PASS
- shc3, graph tab on All branches, Pop Stash from the stash row's right-click menu: conflict as before; the graph shows the warning strip "A stash was applied with conflicts: 1 file has conflicts. Resolve it in Source Control." with no Abort button, first row "Uncommitted changes (2)", the stash row below the newer tip commit and directly above its base "base" (B2.9-01-graph-strip.png). The stash menu then has Apply Stash / Pop Stash disabled ("Resolve the conflicts first"), Drop Stash… enabled.
- Closed the app with its own close button and started the dev build again: the session reopened shc3; app.txt still under Merge Changes, store.txt staged, badge "Stash conflicts", bar note "Stash: Current is your files as they are now, Incoming is the stash.", the stash row without the "applied with conflicts" mark (B2.9-02-after-restart.png).
- Accept Incoming: the dialog says "It is the last file: after this the stash's changes are in your files (nothing is committed for you)."; Save and Mark Resolved: no drop offer, badge gone, the stash still listed (B2.9-03-resolved-after-restart.png).
- SEEN (known issue 3, same cause): with the Explorer floating after a folder was opened, the first click on the graph's "All branches" only closed the Explorer and did not press the button (twice).

## B2.12 PASS
- big (340 commits on main, a stash made at commit 100, two stashes on the tip), graph on All branches: heading "303+ commits" at first. Scrolled the list in steps to the end while collecting every row from the DOM (internal script, real scrolling of the list): the further page loaded (list height 7878 → 8918 px), 343 rows = 340 commits + 3 stash rows, "commit 340" down to "commit 1" with none missing, none repeated, strictly in order; the old stash sits directly above "commit 100", the two tip stashes above "commit 340" (B2.12-01-top.png, B2.12-02-bottom.png).
- Small: the heading then reads "343 commits": the 3 stash rows are counted as commits.

## B2.13 PASS
- sop1 (a rebase stopped on a conflict, started in a shell) and sop2 (a cherry-pick stopped likewise), each with two stashes: "Stash Changes…" disabled with the title "Finish or abort the rebase first" / "… the cherry-pick first"; on every row Apply and Pop disabled with the same title, Drop enabled (B2.13-01-sop1-stopped.png, B2.13-01-sop2-stopped.png; titles read from the DOM).
- sop2: Drop on "drop me" + Drop Stash: toast "Dropped stash: drop me", the other stash still there, the cherry-pick still stopped (badge "Cherry-picking", `UU notes.txt`).
- Palette during the stopped cherry-pick: Stash Changes…, Apply Latest Stash, Pop Latest Stash each gave "Finish or abort the cherry-pick first." and did nothing (no form, stash list and files unchanged).
- Drop during the stopped rebase (sop1) was not clicked (same code path).

# Bugs fixed (each its own commit in C:\coding_projects\Quarry, branch main, not pushed)
1. 0dad0a5 "Fix: the two sides of a staging comparison were not level after a change that only removes or only adds lines" (B1.1 / B1.3). `barPlace` in src/lib/gitHunks.ts, used by `hunkBars` in DiffView.tsx; scenario STAGE-001.10; 8 unit tests in gitHunks.test.ts. Re-checked live, light and dark, side by side and inline, after scrolling.
2. 6ac3e23 "Fix: a staging comparison moved by several lines after each staging action" (B1.5). `placeOf` / `restorePlace` in DiffView.tsx. No unit test (needs layout). Re-checked live.
3. dedf033 "Fix: a stash row grew taller while the pointer was over it" (B2.3). CSS only.
4. 7a40fec "Fix: the last letter of a stash row and of the uncommitted-changes row was cut in the graph" (B2.11). CSS only; also touches the uncommitted-changes row of item 7.
5. c4ea84e "Fix: the stash form stayed open after Escape on its checkbox and after a change of repository" (seen in B2.7). StashSection.tsx; scenarios STASH-001.6 (extended) and STASH-001.8 (new); one new test in stashSection.test.tsx. Re-checked live.
After each: `npx tsc --noEmit`, `pnpm test` (74 files, 1305 tests at the end), `pnpm specs` 0 problems. No Rust changed. docs/ and CLAUDE.md not touched.

# Open (not fixed)
1. B1.15: the Compare toolbar does not fit below about 1000 px of editor width once the two text buttons are there: file labels are cut to nothing, the layout switch is squashed, the swap icon overlaps the count. Needs a layout decision.
2. B2.8: the drop offer after a conflicted pop says the stash's changes "are now in your files" also when a file was resolved with "Current" (then they are not, and Drop Stash loses them). Wording / logic for the owner.
3. B1.8: a Source Control comparison keeps "(unsaved)" in its label and tab title after the file's tab was saved, until the row is clicked again or an action runs.
4. B1.5: staging the last change near the end of a file still moves the view when the file gets shorter than the scroll position.
5. B1.11: a UTF-16 / binary file still gets bars and buttons that can only ever answer with the refusal toast.
6. B1.12: the left label of a staged rename's comparison uses the new name with "(HEAD)".
7. B2.11 / B2.12: the graph heading counts stash rows as commits ("343 commits" for 340 commits + 3 stashes).
8. Known issues that touch these features: issue 2 (no tooltip on the disabled Stash Changes… / Apply / Pop buttons: `pointer-events: none` confirmed on them, not looked at on screen), issue 3 (first click lost while a panel floats: seen on the graph's All branches button), issue 7 (Stash before Stage Part of a File in the Git menu), issue 1 (Git menu taller than the window; the Stash and Stage Part of a File entries are above the fold and were reachable).
9. Every stash / pop / staging-save gives an extra info toast "<file> changed on disk and was reloaded." (same as issue 7's extra toast).

# Not verified through the real UI
- Folders and files were opened with `__shi.openFolder` / `openPath`; tabs closed with `runCommand('file.closeAll')`; the theme, the panel width (280 / 700 / 900) and pinning / closing of Source Control were set through the store; `git.refresh` and `git.graph` were run through `runCommand` a few times; one Save All through `__shi.saveAll()`.
- B1.15: the window was not resized; the editor area was narrowed with the panel width instead.
- B1.13: "busy" was produced with a slow pre-commit hook in the throwaway repo (a real commit from the panel); a pull was not tried.
- B2.5: no real window refocus (the stash appeared without one).
- B2.12: the scroll-and-collect loop was a script inside the page.
- B2.13: the stopped rebase / cherry-pick were started in a shell.
- Tooltips: read as `title` attributes only; nothing was looked at with the real pointer (see B2.3).
- Not done at all: STAGE-005.2 (save cancelled), STAGE-005.3 (typing in the comparison's right side, then Stage), STAGE-006.4-.6 (no final newline, Windows-1252, BOM), STAGE-007.10, STAGE-009.4, STASH-003.5 (repo with no commits), STASH-006.10 / .11 and STASH-008.7 (stale list), STASH-009.16, STASH-010.10 / .11 / .13, STASH-005.6 / .7.

# Incident
- For one tooltip check I moved the real pointer once with run A's hover.ps1 and took two screen captures; they showed that the owner's screen had a full-screen game on it, not Quarry. The pointer was put back by the script, both captures were deleted, and no further real-pointer or screen-capture step was run.

# End state
- Dev app closed with its own close button both times (nothing killed); no quarry.exe, no msedgewebview2 with the live-B\wv profile, ports 1420 / 9333 free.
- %APPDATA%\com.quarry.app: session.json, settings.json, search-history.json and .window-state.json restored from live-B\backup and verified by SHA-256 (92024e90…, 16c4dbe3…, 1f6f36dd…, a62f4c6c…). During the run a scratch session (no folder, empty recent lists) and autoUpdateCheck=false were in place so that the owner's Quarry folder was never opened and no update check ran.
- C:\coding_projects\Quarry: clean tree, five "Fix:" commits on main after 42be045, nothing pushed. GIT-ROADMAP.md not touched.
