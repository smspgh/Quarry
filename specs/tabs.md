---
area: Tabs
prefix: TAB
---

# Tabs

The tab strip: what a tab shows, switching and closing tabs, the right-click menu, preview tabs and the open-tab limit. Tabs keep the order they were opened in; there is no drag reordering, no "reopen closed tab" and no back / forward navigation history. User documentation: `docs/editing.md` (Window layout) and `docs/keyboard-shortcuts.md`.

## TAB-001: See the open documents in the tab strip

- Status: draft
- Commands: none
- Files:
  - `src/components/TitleBar.tsx` — `TitleBar` (tab row above the title bar with `menuPosition: "titlebar"`, tabs inside the title bar otherwise; window title), `Tab`, `DocIcon`, `ClaudeBadge`
  - `src/lib/store.ts` — `docs`, `activeId`, `Doc.kind`, `addDoc` (new tabs go at the end)
  - `src/styles/app.css` — `.tabbar`, `.tabs` (wrapping rows), `.tab`, `.tab.active`
- Tests: none
- Docs: `docs/editing.md`

**As a** person with several documents open
**I want** one tab per document, with the active one clearly marked
**So that** I can see what is open and where I am

```gherkin
Scenario: TAB-001.1 A tab per document, in opening order
  Given no tabs are open
  When I open "a.txt", then "b.json", then a new untitled file
  Then the tab strip shows "a.txt", "b.json", "Untitled-1" from left to right
  And "Untitled-1" is the active tab
  And each tab has an icon for its kind (JSON, plain text, code, large file, Claude, terminal, Compare, commit graph)

Scenario: TAB-001.2 Where the tab strip sits
  Given Settings › Menu bar is "Title bar" (the default)
  When the first document opens
  Then a tab row appears above the title bar, with the window buttons at its right end
  And with the menu bar set to Top or Hidden the tabs are inside the title bar instead

Scenario: TAB-001.3 More tabs than fit wrap
  Given the window is 1000 px wide
  When I open 40 files
  Then the tabs continue on further rows and every tab is visible without scrolling

Scenario: TAB-001.4 Tooltip and window title
  Given "C:\work\a.txt" is the active tab
  When I hover its tab
  Then the tooltip shows "C:\work\a.txt"
  And the window title is "a.txt — Quarry"

Scenario: TAB-001.5 No tabs
  Given one tab is open
  When I close it
  Then the tab row disappears and the window title is "Quarry"
```

## TAB-002: Switch between tabs

- Status: draft
- Commands: `file.nextTab`, `file.prevTab`, `file.nextTabPg`, `file.prevTabPg`
- Files:
  - `src/lib/actions.ts` — `nextTab` (tab-strip order, wraps, nothing with fewer than 2 tabs)
  - `src/lib/commands.ts` — the four registrations (Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PageDown, Ctrl+PageUp)
  - `src/lib/store.ts` — `setActive` / `activePatch`
  - `src/components/TitleBar.tsx` — `Tab` `onMouseDown` (left button activates)
  - `src/editor/manager.ts` — `syncPanes` shows the document with its own state, cursor and scroll; `focus`, `registerFocus`
  - `src/components/CodeEditor.tsx` — gives the editor the keyboard when its pane gets a new document
  - `src/App.tsx` — the global key handler lets Ctrl+Tab / Ctrl+Shift+Tab through from a terminal tab
- Tests: none
- Docs: `docs/keyboard-shortcuts.md`

**As a** person working in several files
**I want** to move between tabs with the mouse or the keyboard
**So that** I can get to another document quickly

```gherkin
Scenario: TAB-002.1 Click a tab
  Given "a.txt" is active and "b.txt" is open
  When I click the "b.txt" tab
  Then "b.txt" is shown and its tab is the active one
  And the cursor and scroll position in "b.txt" are where I left them
  And typing goes into "b.txt"

Scenario: TAB-002.2 Next and previous tab
  Given tabs "a.txt", "b.txt", "c.txt" are open and "a.txt" is active
  When I press Ctrl+Tab
  Then "b.txt" is active
  And Ctrl+Shift+Tab makes "a.txt" active again
  And Ctrl+PageDown and Ctrl+PageUp do the same as Ctrl+Tab and Ctrl+Shift+Tab

Scenario: TAB-002.3 Wrap around
  Given tabs "a.txt", "b.txt", "c.txt" are open and "c.txt" is active
  When I press Ctrl+Tab
  Then "a.txt" is active

Scenario: TAB-002.4 From a terminal tab
  Given a Claude CLI terminal tab is active and has the keyboard
  When I press Ctrl+Tab
  Then the next tab becomes active instead of the key going to the terminal program

Scenario: TAB-002.5 Not while a dialog is open
  Given a "Save changes to a.txt?" dialog is open
  When I press Ctrl+Tab
  Then the active tab does not change
```

## TAB-003: Use the tab strip from the keyboard

- Status: draft
- Commands: none
- Files:
  - `src/components/TitleBar.tsx` — `tabStripKey`, `focusTabAt`, `Tab` `onKeyDown`, roles `tablist` / `tab`, `aria-selected`, roving `tabIndex`
  - `src/App.tsx` — the global key handler leaves Delete and Ctrl+W to a focused tab
- Tests: `src/__tests__/ui.test.ts`
- Docs: `docs/editing.md`

**As a** keyboard or screen-reader user
**I want** to move through the tabs and act on the one that has focus
**So that** I can manage tabs without a mouse

```gherkin
Scenario: TAB-003.1 Arrow keys move focus along the strip
  Given tabs "a.txt", "b.txt", "c.txt" are open and keyboard focus is on the "a.txt" tab
  When I press Right Arrow
  Then focus is on the "b.txt" tab and the active document has not changed
  And Left Arrow from "a.txt" wraps to "c.txt", Home goes to the first tab and End to the last

Scenario: TAB-003.2 Enter or Space activates the focused tab
  Given focus is on the "b.txt" tab and "a.txt" is the active document
  When I press Enter
  Then "b.txt" becomes the active document

Scenario: TAB-003.3 Delete or Ctrl+W closes the focused tab, not the active one
  Given "a.txt" is the active document and focus is on the "c.txt" tab
  When I press Delete
  Then "c.txt" is closed and "a.txt" stays open and active
  And focus moves to the tab now at that position

Scenario: TAB-003.4 The menu key opens the tab's menu
  Given focus is on the "b.txt" tab
  When I press the Menu key
  Then the tab's right-click menu opens below the tab with Close focused

Scenario: TAB-003.5 Only the active tab is a Tab stop
  Given 5 tabs are open
  When I move through the window with the Tab key
  Then the tab strip takes one stop, on the active tab
```

## TAB-004: See which tabs have unsaved changes

- Status: draft
- Commands: none
- Files:
  - `src/components/TitleBar.tsx` — `.tab.dirty` class, `tab-dirty` dot, `aria-label` with ", unsaved changes", "● " prefix in the window title
  - `src/lib/store.ts` — `Doc.dirty`
  - `src/lib/actions.ts` — the snapshot listener that clears `dirty` when the text is back to the saved version
  - `src/styles/app.css` — `.tab-dirty`, `.tab.dirty:hover .tab-dirty`
- Tests: none
- Docs: `docs/editing.md`

**As a** person editing several files
**I want** tabs with unsaved changes to be marked
**So that** I know what still needs saving

```gherkin
Scenario: TAB-004.1 A dot marks unsaved changes
  Given "a.txt" is open with no unsaved changes
  When I type in it
  Then its tab shows a dot
  And a screen reader announces the tab as "a.txt, unsaved changes"

Scenario: TAB-004.2 The window title shows it for the active tab
  Given "a.txt" is the active tab and has unsaved changes
  When I look at the window title in the taskbar
  Then it reads "● a.txt — Quarry"

Scenario: TAB-004.3 Saving clears the dot
  Given "a.txt" shows the unsaved-changes dot
  When I press Ctrl+S
  Then the dot disappears and the window title is "a.txt — Quarry"

Scenario: TAB-004.4 Background tabs keep their dot
  Given "a.txt" has unsaved changes
  When I switch to "b.txt"
  Then the "a.txt" tab still shows its dot
```

## TAB-005: Close a tab

- Status: draft
- Commands: `file.close`, `file.closeF4`
- Files:
  - `src/lib/actions.ts` — `closeDocument` (Save / Don't Save / Cancel via `askSaveChanges`, busy Claude and running-terminal confirmations, disposal per kind, `saveSession`)
  - `src/lib/store.ts` — `removeDoc` (which tab becomes active next)
  - `src/lib/commands.ts` — `file.close` (Ctrl+W), `file.closeF4` (Ctrl+F4, hidden); default `enabled` (`docOnly`)
  - `src/components/TitleBar.tsx` — close button, middle-click, Delete / Ctrl+W on a focused tab
  - `src/editor/manager.ts` — `dispose`
  - `src/lib/claude.ts` — `claudeBusy`, `disposeClaude`
  - `src/lib/terminal.ts` — `terminalPty`, `disposeTerminal`
  - `src/lib/diff.ts` — `disposeDiff`
  - `src/lib/ipc.ts` — `big.close`
  - `src/App.tsx` — Ctrl+F4 is let through from a terminal tab
- Tests: none
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** person finished with a document
**I want** to close its tab without losing unsaved work by accident
**So that** the tab strip only holds what I am using

```gherkin
Scenario: TAB-005.1 Close a saved tab
  Given tabs "a.txt", "b.txt", "c.txt" are open and "b.txt" is active with no unsaved changes
  When I press Ctrl+W
  Then "b.txt" closes without a question
  And "c.txt", the tab that moved into its place, becomes active

Scenario: TAB-005.2 Closing the last tab in the strip
  Given tabs "a.txt", "b.txt", "c.txt" are open and "c.txt" is active
  When I click the × on the "c.txt" tab
  Then "b.txt" becomes active

Scenario: TAB-005.3 Unsaved changes ask first
  Given "notes.txt" has unsaved changes
  When I close its tab
  Then Quarry asks "Save changes to notes.txt?" with Save, Don't Save and Cancel
  And Save writes the file and closes the tab
  And Don't Save closes the tab without writing
  And Cancel, or Escape, leaves the tab open with its changes

Scenario: TAB-005.4 A save that does not happen keeps the tab
  Given "Untitled-1" has unsaved changes and I chose Save when closing it
  When I cancel the "Save" file dialog
  Then "Untitled-1" stays open

Scenario: TAB-005.5 Close a background tab with the mouse
  Given "a.txt" is active and "b.txt" is open
  When I middle-click the "b.txt" tab
  Then "b.txt" closes and "a.txt" stays active

Scenario: TAB-005.6 A tab with something running asks first
  Given a Claude Code tab is still working on a task
  When I close its tab
  Then Quarry asks whether to stop Claude Code, with "Close tab" and Cancel
  And a terminal tab with a program still running asks "Stop <tab name>?" in the same way

Scenario: TAB-005.7 Ctrl+F4 also closes
  Given "a.txt" is the active tab
  When I press Ctrl+F4
  Then "a.txt" closes
  And the command palette lists "Close Tab" once, with Ctrl+W
```

## TAB-006: Close other tabs or all tabs

- Status: draft
- Commands: `file.closeOthers`, `file.closeAll`
- Files:
  - `src/lib/actions.ts` — `closeOthers`, `closeAll` (tab order, each through `closeDocument`, stop at the first Cancel)
  - `src/lib/commands.ts` — `file.closeOthers`, `file.closeAll`; default `enabled` (`docOnly`)
  - `src/components/TitleBar.tsx` — "Close Others" in the tab menu
  - `src/components/MenuBar.tsx` — File › Close Other Tabs / Close All Tabs
- Tests: none
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** person with many tabs open
**I want** to close all of them, or all but one, in one step
**So that** I can clear the tab strip quickly

```gherkin
Scenario: TAB-006.1 Close Others keeps one tab
  Given tabs "a.txt", "b.txt", "c.txt" are open with no unsaved changes
  When I right-click "b.txt" and choose Close Others
  Then only "b.txt" is open

Scenario: TAB-006.2 Close Other Tabs from the menu keeps the active tab
  Given tabs "a.txt", "b.txt", "c.txt" are open and "c.txt" is active
  When I choose File › Close Other Tabs
  Then only "c.txt" is open

Scenario: TAB-006.3 Close All Tabs
  Given 5 tabs without unsaved changes are open
  When I choose File › Close All Tabs
  Then no tabs are open and the Welcome screen is shown

Scenario: TAB-006.4 Each tab with unsaved changes is asked about
  Given tabs "a.txt", "b.txt", "c.txt" are open and "b.txt" has unsaved changes
  When I choose File › Close All Tabs
  Then "a.txt" closes and Quarry asks "Save changes to b.txt?"

Scenario: TAB-006.5 Cancel stops the rest
  Given tabs "a.txt", "b.txt", "c.txt" are open and "b.txt" has unsaved changes
  When I choose File › Close All Tabs and answer Cancel for "b.txt"
  Then "b.txt" and "c.txt" stay open
  And "a.txt", closed before the question, stays closed

Scenario: TAB-006.6 Unavailable with no tabs
  Given no tabs are open
  When I open the File menu
  Then Close Tab, Close Other Tabs and Close All Tabs are disabled
```

## TAB-007: Act on a tab from its right-click menu

- Status: draft
- Commands: `file.showInQuarryExplorer`, `file.showInWindowsExplorer`
- Files:
  - `src/components/TitleBar.tsx` — the `ctx-menu` in `Tab`: which items show for which document, closes on any mouse press or key outside
  - `src/lib/actions.ts` — `showInExplorerPanel` (opens the file's folder when it is outside the open one, emits `explorer.reveal`), `showInWindowsExplorer`, `isInside`, `closeDocument`, `closeOthers`
  - `src/lib/commands.ts` — `file.showInQuarryExplorer`, `file.showInWindowsExplorer` (enabled when the active document has a path)
  - `src/lib/split.ts` — `openToSide`
  - `src/lib/diff.ts` — `openCompare`, `selectForCompare`, `compareWithSelected`, `compareCandidate`
  - `src/lib/git.ts` — `repoOf`, `fileStatus`, `compareWithHead`, `showHistory`
  - `src/lib/panels.ts` — `showPanel`
  - `src/lib/bus.ts` — `explorer.reveal`
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/editing.md`

**As a** person looking at a tab
**I want** the actions for that document on its right-click menu
**So that** I can close it, compare it or find its file without making it active first

```gherkin
Scenario: TAB-007.1 Menu for a saved text file
  Given "C:\work\a.txt" is open, has no unsaved changes and is not in a git repository
  When I right-click its tab
  Then the menu offers Close (Ctrl+W), Close Others, Open to the Side, Select for Compare, Compare with Clipboard, Copy Path, Show in Quarry Explorer and Show in Windows Explorer

Scenario: TAB-007.2 Menu for an untitled document
  Given "Untitled-1" is open
  When I right-click its tab
  Then the menu offers Close, Close Others, Open to the Side and Compare with Clipboard
  And it has no Copy Path, Show in Quarry Explorer or Show in Windows Explorer

Scenario: TAB-007.3 Items that depend on the document
  Given "a.txt" is a tracked file in a git repository and has unsaved changes
  When I right-click its tab
  Then the menu also offers Compare with Saved, Compare with Last Commit and Show File History

Scenario: TAB-007.4 Tabs that are not text documents
  Given a large-file tab "big.log" is open
  When I right-click its tab
  Then the menu offers Close, Close Others, Copy Path, Show in Quarry Explorer and Show in Windows Explorer only

Scenario: TAB-007.5 Copy Path
  Given "C:\work\a.txt" is open
  When I choose Copy Path from its tab menu
  Then the clipboard holds "C:\work\a.txt" and a notice says "Path copied"

Scenario: TAB-007.6 Show in Quarry Explorer for a file outside the open folder
  Given the folder "C:\work\project" is open and "C:\other\b.txt" is open in a tab
  When I choose Show in Quarry Explorer from the "b.txt" tab menu
  Then "C:\other" opens in the Explorer panel with "b.txt" selected and focused
  And a notice says "Opened C:\other in the Explorer"

Scenario: TAB-007.7 The File menu versions need a saved file
  Given "Untitled-1" is the active tab
  When I open the File menu
  Then Show in Quarry Explorer and Show in Windows Explorer are disabled

Scenario: TAB-007.8 Dismissing the menu
  Given a tab's right-click menu is open
  When I click elsewhere or press a key outside the menu
  Then the menu closes and no tab is closed or changed
```

## TAB-008: Preview tabs while browsing the Explorer

- Status: draft
- Commands: none
- Files:
  - `src/lib/actions.ts` — `openPath` with `preview` (closes the previous clean preview, also when the clicked file is already open), `openFiles` keeps requested previews
  - `src/lib/tabLimit.ts` — the store subscription that turns an edited preview into a kept tab
  - `src/lib/store.ts` — `Doc.preview`
  - `src/components/TitleBar.tsx` — `.tab.preview`, preview tooltip, double-click keeps the tab
  - `src/components/panels/ExplorerPanel.tsx` — single click opens with `preview: true` and `editor.keepFocusOnNextOpen()`; double-click clears `preview`
  - `src/components/panels/ScriptsPanel.tsx` — opening a script clears `preview`
  - `src/editor/manager.ts` — `keepFocusOnNextOpen`, `takeKeepFocus`
  - `src/styles/app.css` — `.tab.preview .tab-title` (italic)
- Tests: none
- Docs: `docs/editing.md`

**As a** person clicking through files in the Explorer
**I want** each click to reuse one preview tab
**So that** browsing does not pile up tabs I never meant to keep

```gherkin
Scenario: TAB-008.1 A single click opens a preview tab
  Given the Explorer shows "a.txt" and no tabs are open
  When I single-click "a.txt"
  Then "a.txt" opens in a tab whose name is in italics
  And keyboard focus stays in the Explorer tree

Scenario: TAB-008.2 The next click replaces the preview
  Given "a.txt" is open as a preview tab
  When I single-click "b.txt" in the Explorer
  Then "b.txt" is open as the preview tab and "a.txt" is closed

Scenario: TAB-008.3 Editing keeps the tab
  Given "a.txt" is open as a preview tab
  When I type in it and then single-click "b.txt" in the Explorer
  Then "a.txt" stays open, no longer in italics
  And "b.txt" opens in a second tab as the preview

Scenario: TAB-008.4 Double-clicking the tab keeps it
  Given "a.txt" is open as a preview tab
  When I double-click its tab and then single-click "b.txt" in the Explorer
  Then both "a.txt" and "b.txt" are open

Scenario: TAB-008.5 Double-clicking the file keeps it and moves to the editor
  Given the Explorer shows "a.txt"
  When I double-click "a.txt"
  Then "a.txt" is open as an ordinary tab and the editor has keyboard focus

Scenario: TAB-008.6 Clicking a file that is already open
  Given "a.txt" is open as an ordinary tab and "b.txt" is the preview tab
  When I single-click "a.txt" in the Explorer
  Then the "a.txt" tab becomes active and stays an ordinary tab
  And the "b.txt" preview tab is closed

Scenario: TAB-008.7 The tooltip explains the preview
  Given "a.txt" is open as a preview tab
  When I hover its tab
  Then the tooltip says the next file clicked in the Explorer replaces this tab, and that a double-click or an edit keeps it
```

## TAB-009: Limit how many tabs are open

- Status: draft
- Commands: none
- Files:
  - `src/lib/tabLimit.ts` — `planRoom` (pure), `makeRoom` (the two dialogs, list of up to 8 names), `markUsed` / `lastUsed` (least recently shown), `inUse` (running terminal, busy Claude)
  - `src/lib/actions.ts` — `openPath` (`noLimit`), `openFiles` (one question for a batch, `keep`), `sanitizeSettings` (1–1000)
  - `src/lib/commands.ts` — `file.new` calls `makeRoom`
  - `src/lib/types.ts` — `Settings.maxOpenTabs` (default 50)
  - `src/components/panels/SettingsPanel.tsx` — "Maximum open tabs" row
  - `src/lib/dialogs.ts` — `choose`
- Tests: `src/__tests__/tabLimit.test.ts`
- Docs: `docs/editing.md`, `docs/settings.md`

**As a** person who opens many files over a day
**I want** a cap on open tabs that closes the ones I have not used for longest, after asking
**So that** the tab strip stays manageable without ever costing me unsaved work

```gherkin
Scenario: TAB-009.1 Room left: nothing is asked
  Given Maximum open tabs is 50 and 49 tabs are open
  When I open "new.txt"
  Then it opens with no question and 50 tabs are open

Scenario: TAB-009.2 At the limit: Quarry offers to close the least recently used tab
  Given Maximum open tabs is 3
  And "a.txt", "b.txt", "c.txt" are open without unsaved changes, last shown in that order
  When I open "d.txt"
  Then Quarry asks "Close 1 tab to stay within your limit?", listing "a.txt"
  And "Close It and Open" closes "a.txt" and opens "d.txt"

Scenario: TAB-009.3 Cancel opens nothing
  Given Quarry asked to close a tab to stay within the limit
  When I choose Cancel
  Then no tab is closed and the file is not opened

Scenario: TAB-009.4 Tabs with unsaved changes or something running are never closed
  Given Maximum open tabs is 3
  And "a.txt" has unsaved changes, a terminal tab has a program running, and "c.txt" is clean and was used most recently
  When I open "d.txt"
  Then the question lists "c.txt" as the tab to close

Scenario: TAB-009.5 Nothing can be closed
  Given Maximum open tabs is 2 and both open tabs have unsaved changes
  When I open "d.txt"
  Then Quarry says "You have 2 tabs open, your limit" with only an OK button
  And "d.txt" is not opened

Scenario: TAB-009.6 A batch gets one question
  Given Maximum open tabs is 5 and 4 clean tabs are open
  When I choose Open All Files on a folder with 3 files in the Explorer
  Then Quarry asks once, "Close 2 tabs to stay within your limit?", naming 3 files to open
  And accepting closes the 2 least recently used tabs and opens the 3 files

Scenario: TAB-009.7 Only part of a batch fits
  Given Maximum open tabs is 3 and 3 tabs are open, 2 of them with unsaved changes
  When I ask to open 4 files at once
  Then the question says only 1 of the 4 files fits within the limit and the first 1 will open

Scenario: TAB-009.8 Showing a file that is already open never asks
  Given the tab limit is reached and "a.txt" is one of the open tabs
  When I open "a.txt" again
  Then its tab becomes active with no question

Scenario: TAB-009.9 A replaced preview tab makes its own room
  Given Maximum open tabs is 3 and 3 tabs are open, one of them a clean preview tab
  When I single-click another file in the Explorer
  Then it replaces the preview tab with no question

Scenario: TAB-009.10 The setting's bounds
  Given Settings is open
  When I enter 0 or 5000 for Maximum open tabs
  Then the value is kept within 1 to 1000
```
