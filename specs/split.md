---
area: Split Editor
prefix: SPLIT
---

# Split Editor

Two editor panes side by side under one shared tab strip: splitting and closing the split, which pane has the keyboard, what each pane can show, the same document in both panes with one undo history, and resizing. User documentation: `docs/editing.md` (Window layout › Split editor).

## SPLIT-001: Split the editor and close the split

- Status: draft
- Commands: `view.splitEditor`
- Files:
  - `src/lib/split.ts` — `toggleSplit` (split: right pane shows the active text document and gets the keyboard; again: `split: null`)
  - `src/lib/commands.ts` — `view.splitEditor` (Ctrl+\, `dynamicTitle` "Split Editor" / "Close Split Editor", enabled with a text tab or an existing split)
  - `src/lib/store.ts` — `SplitState`, `split`, `paneDocId`
  - `src/App.tsx` — `.editor-panes.split` grid, second `CodeEditor pane={1}` and `SplitDivider`
  - `src/components/CodeEditor.tsx` — one pane (`pane` 0 or 1), mount / unmount of its view
  - `src/editor/manager.ts` — `mount`, `unmount` (keeps the right pane's document state), `syncPanes`
  - `src/components/MenuBar.tsx` — View › Split Editor
  - `src/styles/app.css` — `.editor-panes.split`, `.editor-stack.pane.focused::before` (accent line)
- Tests: `src/__tests__/splitGit.test.ts`
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** developer who needs two places in view at once
**I want** to split the editor into two panes
**So that** I can read one part of my work while editing another

```gherkin
Scenario: SPLIT-001.1 Split the editor
  Given "a.ts" is the active tab and the editor is not split
  When I press Ctrl+\
  Then a second pane appears to the right showing "a.ts" as well
  And the two panes are equally wide
  And the right pane has the keyboard, marked by the accent line along its top

Scenario: SPLIT-001.2 Close the split
  Given the editor is split with "a.ts" on the left and "b.ts" on the right, and the right pane has the keyboard
  When I press Ctrl+\
  Then one pane remains, showing "b.ts"
  And both "a.ts" and "b.ts" are still open as tabs with their text, cursor and unsaved changes intact

Scenario: SPLIT-001.3 The command name follows the state
  Given the editor is split
  When I open the View menu
  Then the item reads "Close Split Editor"
  And it reads "Split Editor" when the editor is not split

Scenario: SPLIT-001.4 Only a text document can be split
  Given the active tab is a large-file tab and the editor is not split
  When I open the View menu
  Then Split Editor is disabled
  And pressing Ctrl+\ does nothing

Scenario: SPLIT-001.5 One tab strip for both panes
  Given the editor is split
  When I look at the tab strip
  Then there is a single row of tabs, not one per pane
```

## SPLIT-002: Choose which pane has the keyboard

- Status: draft
- Commands: `view.focusLeftPane`, `view.focusRightPane`
- Files:
  - `src/lib/split.ts` — `focusPane` (then `editor.focus()` on the next frame)
  - `src/lib/store.ts` — `focusPane` (swaps `activeId` and `split.otherId`), `activePatch` (picking the other pane's tab moves the focus there), `paneDocId`
  - `src/lib/commands.ts` — `view.focusLeftPane` (Ctrl+1), `view.focusRightPane` (Ctrl+2), enabled only while split
  - `src/App.tsx` — `onMouseDownCapture` on each pane calls `focusPane`
  - `src/editor/manager.ts` — `focusedPane`, `view` / `currentDocId` follow it; `onUpdate` moves the store's focus when a pane's editor gains focus; `publishCursor`
  - `src/components/CodeEditor.tsx` — `FindBar` only in the focused pane, focus on a new document, `aria-label` "… editor (right)"
  - `src/components/TitleBar.tsx` — `.tab.other-pane` and its "Shown in the other pane" tooltip
  - `src/styles/app.css` — `.tab.other-pane:not(.active)` (lighter accent line)
- Tests: `src/__tests__/splitGit.test.ts`
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** developer working in a split editor
**I want** to move between the panes and always see which one is active
**So that** tabs I pick, commands and typing go where I expect

```gherkin
Scenario: SPLIT-002.1 Ctrl+1 and Ctrl+2
  Given the editor is split with "a.ts" on the left and "b.ts" on the right, and the right pane has the keyboard
  When I press Ctrl+1
  Then the left pane has the keyboard and "a.ts" is the active tab
  And "b.ts" is still shown on the right
  And Ctrl+2 moves the keyboard back to the right pane

Scenario: SPLIT-002.2 Click in a pane
  Given the editor is split and the left pane has the keyboard
  When I click in the text of the right pane
  Then the right pane has the keyboard and its document's tab is the active tab

Scenario: SPLIT-002.3 Picking a tab changes the focused pane only
  Given the editor is split with "a.ts" on the left and "b.ts" on the right, the left pane has the keyboard, and "c.ts" is also open
  When I click the "c.ts" tab
  Then the left pane shows "c.ts" and the right pane still shows "b.ts"

Scenario: SPLIT-002.4 Picking the tab the other pane shows moves the keyboard there
  Given the editor is split with "a.ts" on the left and "b.ts" on the right, and the left pane has the keyboard
  When I click the "b.ts" tab
  Then the keyboard moves to the right pane
  And the left pane still shows "a.ts"

Scenario: SPLIT-002.5 Both panes' tabs are marked
  Given the editor is split with "a.ts" on the left and "b.ts" on the right, and the left pane has the keyboard
  When I look at the tab strip
  Then "a.ts" is the active tab
  And "b.ts" has a lighter accent line and its tooltip adds "Shown in the other pane"

Scenario: SPLIT-002.6 Status bar and find bar follow the focused pane
  Given the editor is split with different cursor positions in each pane
  When I move the keyboard to the other pane and press Ctrl+F
  Then the status bar shows that pane's cursor position
  And the find bar opens in that pane only

Scenario: SPLIT-002.7 Not available without a split
  Given the editor is not split
  When I open the command palette
  Then "Focus Left Editor Pane" and "Focus Right Editor Pane" are not offered
  And Ctrl+1 and Ctrl+2 do nothing
```

## SPLIT-003: Open a document to the side

- Status: draft
- Commands: none
- Files:
  - `src/lib/split.ts` — `openToSide` (splits if needed; otherwise shows the document in the pane that is not focused and focuses it)
  - `src/components/TitleBar.tsx` — "Open to the Side" in the tab menu, text documents only
  - `src/lib/store.ts` — `SplitState`
- Tests: none
- Docs: `docs/editing.md`

**As a** developer comparing two files by eye
**I want** to send a tab to the other pane from its right-click menu
**So that** I can put two documents next to each other in one step

```gherkin
Scenario: SPLIT-003.1 Open to the Side splits the editor
  Given "a.ts" is the active tab, "b.ts" is open and the editor is not split
  When I right-click the "b.ts" tab and choose Open to the Side
  Then the editor splits with "a.ts" on the left and "b.ts" on the right
  And the right pane has the keyboard

Scenario: SPLIT-003.2 With a split, it goes to the pane that is not focused
  Given the editor is split with "a.ts" on the left and "b.ts" on the right, the left pane has the keyboard, and "c.ts" is open
  When I choose Open to the Side on the "c.ts" tab
  Then the right pane shows "c.ts" and has the keyboard
  And the left pane still shows "a.ts"

Scenario: SPLIT-003.3 Only for text documents
  Given a Claude Code tab and a large-file tab are open
  When I right-click either tab
  Then the menu has no Open to the Side item
```

## SPLIT-004: The right pane shows text documents only

- Status: draft
- Commands: none
- Files:
  - `src/lib/store.ts` — `activePatch` (a non-text tab picked while the right pane is focused opens on the left and takes the focus there), `addDoc` using it
  - `src/App.tsx` — the left pane hosts `BigFileView`, `ClaudeView`, `TerminalView`, `DiffView`, `GraphView` and `Welcome`; the right pane only a `CodeEditor`
  - `src/editor/manager.ts` — `syncPanes` (`textId`: a pane's text view shows nothing for other kinds)
- Tests: `src/__tests__/splitGit.test.ts`
- Docs: `docs/editing.md`

**As a** developer using Claude, terminal, Compare or large-file tabs with a split editor
**I want** those tabs to open in the left pane and my right-hand document to stay put
**So that** the split keeps working whatever kind of tab I pick

```gherkin
Scenario: SPLIT-004.1 Picking a non-text tab from the right pane
  Given the editor is split with "a.ts" on the left and "b.ts" on the right, and the right pane has the keyboard
  And a Claude Code tab is open
  When I click the Claude Code tab
  Then the Claude tab shows in the left pane, which now has the keyboard
  And the right pane still shows "b.ts"

Scenario: SPLIT-004.2 Opening a large file while the right pane is focused
  Given the editor is split and the right pane has the keyboard
  When I open a file above the large-file threshold
  Then its large-file view opens in the left pane and the right pane keeps its document

Scenario: SPLIT-004.3 Picking a non-text tab from the left pane
  Given the editor is split and the left pane has the keyboard
  When I click a Compare tab
  Then it replaces what the left pane shows and the right pane is unchanged
```

## SPLIT-005: Edit the same document in both panes

- Status: draft
- Commands: none
- Files:
  - `src/editor/manager.ts` — `show` (the second pane gets a copy of the state; hands the undo history over when the owning pane leaves the document), `dispatchIn` and the `paneSync` annotation (copies edits across, into the owner's history), `owner`, `historyView`, the Undo / Redo key bindings routed `viaOwner`, `onUpdate` ignoring copied edits
  - `src/lib/commands.ts` — `cmCommand` runs `edit.undo` / `edit.redo` on `editor.historyView(editor.view)`
  - `src/lib/split.ts` — `toggleSplit` puts the same document in both panes
- Tests: none
- Docs: `docs/editing.md`

**As a** developer editing a long file
**I want** to see two parts of it at once and edit in either
**So that** I can, for example, keep a function's definition in view while changing its callers

```gherkin
Scenario: SPLIT-005.1 Each pane has its own position
  Given "a.ts" is shown in both panes
  When I scroll the right pane to line 400 and put the cursor there
  Then the left pane stays where it was, with its own cursor

Scenario: SPLIT-005.2 An edit in one pane appears in the other
  Given "a.ts" is shown in both panes
  When I type "// todo" on line 10 in the right pane
  Then line 10 in the left pane reads "// todo" at once
  And the tab shows a single unsaved-changes dot

Scenario: SPLIT-005.3 One undo history
  Given "a.ts" is shown in both panes
  And I typed "one" in the left pane and then "two" in the right pane
  When I press Ctrl+Z twice in the right pane
  Then first "two" and then "one" are undone, in both panes
  And Ctrl+Y in the left pane brings "one" back in both panes

Scenario: SPLIT-005.4 Undo history survives changing what a pane shows
  Given "a.ts" is shown in both panes and I made 3 edits
  When I pick another tab in the pane that showed "a.ts" first, then press Ctrl+Z in the remaining "a.ts" pane
  Then the last of the 3 edits is undone

Scenario: SPLIT-005.5 Undo history survives closing the split
  Given "a.ts" is shown in both panes and I made edits in each
  When I press Ctrl+\ to close the split and then press Ctrl+Z
  Then the most recent edit is undone
```

## SPLIT-006: Resize the panes

- Status: draft
- Commands: none
- Files:
  - `src/components/SplitDivider.tsx` — `SplitDivider`: drag sets `split.ratio` (clamped 0.15–0.85), double-click resets to 0.5, `role="separator"`
  - `src/App.tsx` — `gridTemplateColumns` from `split.ratio`
  - `src/lib/store.ts` — `SplitState.ratio`
  - `src/styles/app.css` — `.split-divider`, `.split-divider.dragging`
- Tests: none
- Docs: `docs/editing.md`

**As a** developer with one wide and one narrow document
**I want** to drag the bar between the panes
**So that** each pane gets the width its content needs

```gherkin
Scenario: SPLIT-006.1 Drag the divider
  Given the editor is split half and half
  When I drag the bar between the panes to one third of the editor's width
  Then the left pane takes about one third and the right pane the rest

Scenario: SPLIT-006.2 Neither pane can be squeezed away
  Given the editor is split
  When I drag the divider all the way to the left edge
  Then the left pane keeps 15% of the width
  And dragging all the way right leaves the right pane 15%

Scenario: SPLIT-006.3 Double-click for half and half
  Given the left pane takes 30% of the width
  When I double-click the divider
  Then both panes are equally wide

Scenario: SPLIT-006.4 The divider explains itself
  Given the editor is split
  When I hover the divider
  Then its tooltip reads "Drag to resize; double-click to split evenly"
```

## SPLIT-007: Keep the split sensible when tabs close and across restarts

- Status: draft
- Commands: none
- Files:
  - `src/lib/store.ts` — `removeDoc` (closing the other pane's document or the last tab closes the split; closing the right pane's document shows the nearest text tab there, else closes the split)
  - `src/lib/actions.ts` — `buildSession` / `sessionDocs` (`split: { otherIndex, focused, ratio }`), `restoreSessionTabs` (split restored when both documents came back and the right one is text; ratio clamped 0.15–0.85)
  - `src/App.tsx` — `saveSession` when `split` changes
  - `src/editor/manager.ts` — `unmount`, `dispose`
- Tests: `src/__tests__/splitGit.test.ts`
- Docs: `docs/editing.md`

**As a** developer who works in a split editor all day
**I want** the split to adapt when I close tabs and to come back after a restart
**So that** I never end up with an empty pane or have to rebuild my layout

```gherkin
Scenario: SPLIT-007.1 Closing the document of the pane without the keyboard closes the split
  Given the editor is split with "a.ts" on the left and "b.ts" on the right, and the left pane has the keyboard
  When I middle-click the "b.ts" tab
  Then the split closes and the single pane shows "a.ts"

Scenario: SPLIT-007.2 Closing the right pane's document shows the nearest text tab there
  Given tabs "a.ts", "b.ts", "c.ts" are open, the editor is split with "a.ts" on the left and "b.ts" on the right, and the right pane has the keyboard
  When I press Ctrl+W
  Then the right pane shows "c.ts" and the split stays open
  And the left pane still shows "a.ts"

Scenario: SPLIT-007.3 No other text tab for the right pane
  Given the only tabs are "a.ts" and a Claude Code tab, the left pane shows the Claude tab and the right pane, with the keyboard, shows "a.ts"
  When I press Ctrl+W
  Then the split closes and the Claude tab is shown

Scenario: SPLIT-007.4 Closing the last tab
  Given "a.ts" is the only tab and is shown in both panes
  When I close it
  Then the split closes and the Welcome screen is shown

Scenario: SPLIT-007.5 The split comes back with the session
  Given Restore session on start is on
  And the editor is split with "a.ts" on the left at 40% width and "b.ts" on the right, and the right pane has the keyboard
  When I close and restart Quarry
  Then the editor is split the same way, 40% to 60%, with the right pane focused

Scenario: SPLIT-007.6 The split is dropped when one of its documents cannot be restored
  Given the session has a split with "a.ts" and "b.ts", and "b.ts" has since been deleted
  When Quarry starts
  Then "a.ts" opens in a single pane
```
