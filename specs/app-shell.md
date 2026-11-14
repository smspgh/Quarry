---
area: Application Shell
prefix: UI
---

# Application Shell

The window and its chrome (title bar, menu bar, panel rail and side panels, bottom panel, status bar), the command system behind every menu item, shortcut and palette entry, and the cross-cutting rules: dialogs, notifications, themes, keyboard focus, window state, single instance and files handed over by Windows. User documentation: `docs/editing.md` (Window layout; Command palette, Quick Open and Go to Line; Appearance and accessibility), `docs/keyboard-shortcuts.md`, `docs/settings.md`.

## UI-001: Custom title bar and window buttons

- Status: draft
- Commands: `app.exit`
- Files:
  - `src/components/TitleBar.tsx` — `TitleBar` (window title, drag regions, `onDouble`), `WindowControls` (Minimize / Maximize / Restore / Close)
  - `src/components/BrandIcon.tsx` — the Quarry mark shown at the left of the title bar
  - `src/lib/commands.ts` — `app.exit` (Alt+F4) closes the window
  - `src/styles/app.css` — `.titlebar`, `.tabbar`, `.win-controls`, `.win-btn`
  - `src-tauri/tauri.conf.json` — window without native decorations, default size 1280 x 820, minimum 720 x 400
- Tests: none
- Docs: `docs/editing.md`

**As a** Windows user
**I want** Quarry's own title bar to behave like a normal window title bar
**So that** I can move, minimise, maximise and close the window the way I do in any other application

```gherkin
Scenario: UI-001.1 Window buttons
  Given the Quarry window is not maximized
  When I click the "Maximize" button at the right of the title bar
  Then the window is maximized
  And the button's tooltip becomes "Restore"
  When I click "Minimize"
  Then the window is minimized to the taskbar

Scenario: UI-001.2 Double-click an empty part of the title bar
  Given the Quarry window is not maximized
  When I double-click an empty part of the title bar
  Then the window is maximized
  When I double-click a tab, a menu name, the Quarry mark or a window button
  Then the window is not maximized or restored by that double-click

Scenario: UI-001.3 Drag the window
  When I drag an empty part of the title bar or of the tab row
  Then the window moves

Scenario: UI-001.4 The window title names the active document
  Given the tab "notes.txt" is active and has unsaved changes
  Then the window title (taskbar, Alt+Tab) is "● notes.txt — Quarry"
  When I save the document
  Then the window title is "notes.txt — Quarry"
  When I close every tab
  Then the window title is "Quarry"

Scenario: UI-001.5 Close and Exit
  When I click the "Close" button, press Alt+F4 or choose File › Exit
  Then Quarry asks the window to close
  And the usual unsaved-changes check runs before the window goes away
```

## UI-002: Menu bar position

- Status: draft
- Commands: none
- Files:
  - `src/components/TitleBar.tsx` — `TitleBar`: `inlineMenu` layout (`.tabbar` row + `.titlebar` with `MenuBar inline`) versus tabs in the title bar
  - `src/App.tsx` — renders `MenuBar` (top) or `MenuBar overlay` (hidden) under the title bar from `settings.menuPosition`
  - `src/components/MenuBar.tsx` — `inline` and `overlay` variants; the overlay renders nothing until a menu is open
  - `src/lib/types.ts` — `Settings.menuPosition` ("top" | "titlebar" | "hidden"), default "titlebar"
  - `src/lib/actions.ts` — `sanitizeSettings` falls back to the default for an unknown value
  - `src/styles/app.css` — `.menubar.inline`, `.menubar.overlay-bar`, `.titlebar.under-tabs`
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/settings.md`, `docs/editing.md`

**As a** user who cares how much vertical space the chrome takes
**I want** to choose where the menus sit: in the title bar, on their own row, or hidden
**So that** the window layout suits my screen and habits

```gherkin
Scenario: UI-002.1 Default: menus in the title bar, tabs in their own row
  Given Settings › Appearance › Menu bar is "Title bar"
  When 2 documents are open
  Then a tab row with the 2 tabs and the window buttons is shown at the top
  And below it the title bar shows the Quarry mark and the menus File, Edit, Code, Selection, Find, View, Git, JSON, Scripts, Macros, Tools, Help

Scenario: UI-002.2 Title bar position with no document open
  Given Menu bar is "Title bar"
  When the last document is closed
  Then there is no tab row
  And the window buttons are at the right of the title bar that holds the menus

Scenario: UI-002.3 Top: menus on their own row
  When I set Menu bar to "Top"
  Then the title bar shows the Quarry mark, the tabs and the window buttons
  And the menus are on their own row below the title bar

Scenario: UI-002.4 Hidden: menus appear on Alt or F10
  Given Menu bar is "Hidden"
  Then no menu names are visible
  And the tabs share the title bar with the Quarry mark and the window buttons
  When I press and release Alt
  Then the menu bar appears below the title bar with the File menu open
  When I press Escape
  Then the menu bar disappears again

Scenario: UI-002.5 A corrupt setting falls back to the default
  Given the settings file contains a menu position that is not "top", "titlebar" or "hidden"
  When Quarry starts
  Then the menus are in the title bar
```

## UI-003: Menus list commands and reflect their state

- Status: draft
- Commands: `help.scriptApi`
- Files:
  - `src/components/MenuBar.tsx` — `MENUS` model (items reference command ids), `resolve` (label, shortcut, disabled state, dynamic title), `TEXT_CATEGORY`, `MenuList` (a submenu is moved up to stay inside the window: pure `submenuShift`), `languageMenu`, `recentFilesMenu`, `recentFoldersMenu`
  - `src/lib/commands.ts` — `getCommand`, `isEnabled`, `prettyKeys`, `Command.enabled` / `dynamicTitle`, `applyDefaultEnabled`, `showScriptApi` (`help.scriptApi`)
  - `src/lib/fuzzy.ts` — `bareTitle` strips the "JSON: " / "Macro: " / "Script: " / "Large File: " prefix from menu labels
  - `src/styles/app.css` — `.menubar`, `.menu-flyout`, `.menu-item`, `.menu-keys`, `.menu-sep`
- Tests: `src/__tests__/ui.test.ts`
- Docs: `docs/editing.md`, `docs/development.md`

**As a** user who finds features through the menus
**I want** every menu item to run the same command as its shortcut and palette entry, with its shortcut shown and unavailable items greyed out
**So that** I can discover what Quarry does and never trigger something that does not apply

```gherkin
Scenario: UI-003.1 Open a menu and run an item
  Given a text document is open
  When I click "View" in the menu bar
  And I click "Toggle Word Wrap"
  Then the menu closes
  And word wrap is toggled exactly as with Alt+Z
  And keyboard focus is back in the editor

Scenario: UI-003.2 Items show their shortcut
  When I open the File menu
  Then the item "Save" shows "Ctrl+S"
  And the item "Open Folder…" shows "Ctrl+Shift+O"

Scenario: UI-003.3 Hovering switches menus and opens submenus
  Given the File menu is open
  When I move the mouse over "Edit" in the menu bar
  Then the Edit menu opens and the File menu closes
  When I move the mouse over "Line"
  Then its submenu opens with "Duplicate Line Down", "Duplicate Line Up", "Delete Line", "Move Line Up" and "Move Line Down"

Scenario: UI-003.4 Items that do not apply are greyed out
  Given no document is open
  When I open the Edit menu
  Then "Undo", "Redo", "Select All", "Indent" and "Outdent" are disabled
  And the submenus "Line", "Lines" and "Transform" are disabled because all of their items are
  And clicking a disabled item does nothing

Scenario: UI-003.5 Labels follow the current state
  Given the editor is split
  When I open the View menu
  Then the split item reads "Close Split Editor"
  When the editor is not split
  Then the same item reads "Split Editor"

Scenario: UI-003.6 Click outside closes the menu
  Given the Find menu is open
  When I click in the editor
  Then the menu closes without running anything

Scenario: UI-003.7 Help menu
  When I open the Help menu
  Then it lists "All Commands and Shortcuts", "Script API Reference", "Check for Updates…" and "About Quarry"
  When I choose "All Commands and Shortcuts"
  Then the command palette opens
  When I choose "Script API Reference"
  Then an untitled tab "Script API Reference.js" opens with no unsaved-changes mark
  And choosing it again shows that same tab instead of opening a second one

Scenario: UI-003.8 Git menu: Stage Part of a File
  When I open the Git menu
  Then "Stage Part of a File" comes directly after "Stage Current File" and "Unstage Current File"
  And its submenu lists the six partial-staging commands (STAGE-008.1), with "Ctrl+K S", "Ctrl+K U", "Ctrl+K L" and "Ctrl+K N" beside the four that have a shortcut
  And the submenu is greyed out unless the active tab is a comparison opened from Source Control in which one of them applies

Scenario: UI-003.9 A submenu stays inside the window
  Given the Git menu is open in a window 816 px high
  When I move the mouse over "Branches and Tags", which is near the bottom of the menu
  Then its submenu opens beside it, moved up as far as needed for its last entry "Push Tag…" to be inside the window
  And a submenu that fits below its entry opens level with it, as before
```

## UI-004: Menu bar keyboard access

- Status: draft
- Commands: none
- Files:
  - `src/components/MenuBar.tsx` — `MenuBar` (lone Alt / F10 / Alt+letter listener, ignored while `store.dialog` is set, Left / Right between menus, Escape, `openWithKeyboard`, `altHeld` → `show-mnemonics`), `MENU_MNEMONICS`, `menuForMnemonic`, `mnemonicKey` (letter from `KeyboardEvent.code`), `splitMnemonic` / `MenuLabel`, `MenuList.onKeyDown` (Up / Down / Home / End, Right / Enter / Space into a submenu, Left out of it, Tab kept inside), `nextMenuIndex`, `ITEM_SELECTOR` (disabled items are skipped)
  - `src/styles/app.css` — `.menubar.show-mnemonics .mnemonic` (underline)
  - `src/editor/manager.ts` — `editor.focus()` when the menu closes
- Tests: `src/__tests__/ui.test.ts`
- Docs: `docs/keyboard-shortcuts.md`, `docs/editing.md`

**As a** keyboard user
**I want** to open and walk the menus with Alt, F10, Alt+letter and the arrow keys
**So that** I can reach every menu command without the mouse

```gherkin
Scenario: UI-004.1 Alt or F10 opens the first menu
  Given no menu is open
  When I press and release Alt without any other key
  Then the File menu opens with its first enabled item focused
  When I press and release Alt again
  Then the menu closes
  And F10 opens and closes the menu in the same way

Scenario: UI-004.2 Alt used as a modifier does not open the menu
  When I press Alt+Z
  Then word wrap is toggled
  And no menu opens

Scenario: UI-004.3 Left and Right move between menus, wrapping
  Given the File menu is open
  When I press Right
  Then the Edit menu is open with its first enabled item focused
  When I press Left twice
  Then the Help menu is open

Scenario: UI-004.4 Up, Down, Home and End move through enabled items
  Given a menu is open with the last enabled item focused
  When I press Down
  Then the first enabled item is focused
  And disabled items and separators are never focused
  When I press End
  Then the last enabled item is focused

Scenario: UI-004.5 Submenus from the keyboard
  Given the Edit menu is open and "Line" is focused
  When I press Right
  Then the Line submenu opens with its first enabled item focused
  When I press Left
  Then the submenu closes and "Line" is focused again
  And Enter or Space on "Line" also opens the submenu

Scenario: UI-004.6 Enter runs the focused item
  Given the View menu is open and "Zoom In" is focused
  When I press Enter
  Then the editor font size grows by 1
  And the menu closes and focus returns to the editor

Scenario: UI-004.7 Escape closes the whole menu
  Given a submenu is open
  When I press Escape
  Then every menu is closed
  And keyboard focus is in the active tab
  And Tab pressed while a menu is open does not move focus out of the menu

Scenario: UI-004.8 Alt and F10 do nothing while a dialog is open
  Given a dialog asks whether to save "notes.txt"
  When I press and release Alt, press F10, or press Alt+F
  Then no menu opens
  And the dialog keeps the keyboard focus

Scenario: UI-004.9 Alt+letter opens that menu
  Given no menu is open and the menu bar is in the title bar or on its own row
  When I press Alt+V
  Then the View menu opens with its first enabled item focused
  When I press Alt+E
  Then the Edit menu is open instead

Scenario Outline: UI-004.10 Each menu has its own letter
  When I press Alt+<letter>
  Then the <menu> menu opens

  Examples:
    | letter | menu      |
    | F      | File      |
    | E      | Edit      |
    | O      | Code      |
    | S      | Selection |
    | N      | Find      |
    | V      | View      |
    | G      | Git       |
    | J      | JSON      |
    | I      | Scripts   |
    | M      | Macros    |
    | T      | Tools     |
    | H      | Help      |

Scenario: UI-004.11 The letters are underlined while Alt is held
  Given no menu is open
  When I hold Alt
  Then the "F" of File, the "o" of Code and the "i" of Scripts are underlined
  When I release Alt
  Then the File menu opens and the letters stay underlined while it is open
  And the letters are not underlined when a menu is opened with the mouse

Scenario: UI-004.12 Mnemonics leave other Alt shortcuts alone
  Given the editor has focus
  When I press Alt+L
  Then the line is selected and no menu opens
  Given the find bar has focus
  When I press Alt+C
  Then Match Case is toggled and no menu opens
  Given a Claude CLI terminal tab has focus
  When I press Alt+F
  Then the key goes to the terminal and no menu opens

Scenario: UI-004.13 Hidden menu bar
  Given Settings › Appearance › Menu bar is Hidden
  When I press Alt+G
  Then the menu bar appears with the Git menu open
```

## UI-005: Command palette

- Status: draft
- Commands: `view.commandPalette`, `view.commandPaletteF1`
- Files:
  - `src/components/CommandPalette.tsx` — `CommandPalette` (mode `commands`), `loadRecentCommands` / `pushRecentCommand` (localStorage `quarry.recentCommands`, 20 entries), `Highlight`, `paletteTop`, `onKey`; the `language`, `encoding` and `branch` modes reuse the same list
  - `src/lib/fuzzy.ts` — `fuzzy`, `fuzzyCommand` (title match ranks above category-only match), `bareTitle`, `shiftIndices`
  - `src/lib/commands.ts` — `allCommands` (leaves out hidden and disabled commands), `runCommand`, `prettyKeys`; `view.commandPalette` (Ctrl+Shift+P) and `view.commandPaletteF1` (F1)
  - `src/lib/store.ts` — `palette: PaletteMode`
  - `src/styles/app.css` — `.overlay`, `.palette`, `.palette-item`, `.palette-empty`
- Tests: `src/__tests__/text.test.ts`, `src/__tests__/branchPicker.test.tsx`
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** user who does not remember where a feature is
**I want** a searchable list of every command with its shortcut
**So that** I can run anything by typing a few letters of its name

```gherkin
Scenario: UI-005.1 Open the palette and run a command
  When I press Ctrl+Shift+P or F1
  Then the palette opens just below the title bar and menu bar with the placeholder "Type a command…"
  When I type "zoom in" and press Enter
  Then the palette closes
  And the editor font size grows by 1
  And keyboard focus is back in the active tab

Scenario: UI-005.2 Fuzzy matching against category and title
  When I type "json" in the palette
  Then commands in the JSON category are listed as "JSON: <title>" with the matched letters in bold
  And a command whose own title contains the letters ranks above one that only matches through its category
  And each row shows the command's shortcut when it has one

Scenario: UI-005.3 Recently used commands come first
  Given I ran "Toggle Word Wrap" and then "Zoom In" from the palette
  When I open the palette with an empty box
  Then "Zoom In" and "Toggle Word Wrap" are the first two rows under "recently used"
  And the remaining commands follow under "all commands", sorted by category and then title
  And at most 20 recently used commands are remembered, across restarts

Scenario: UI-005.4 Unavailable commands are left out
  Given no document is open
  When I open the palette and type "save"
  Then "Save" and "Save As…" are not listed
  And duplicate shortcut entries such as the F1 variant of "Command Palette" are never listed

Scenario: UI-005.5 Keyboard navigation
  Given the palette lists 30 commands
  When I press Down or Tab
  Then the next row is highlighted, wrapping from the last row to the first
  When I press Up or Shift+Tab
  Then the previous row is highlighted, wrapping from the first row to the last
  And Page Down and Page Up move the highlight by 10 rows without wrapping
  And the text box keeps keyboard focus the whole time

Scenario: UI-005.6 Cancel
  Given the palette is open
  When I press Escape or click outside the palette
  Then the palette closes without running anything
  And keyboard focus is back in the active tab

Scenario: UI-005.7 Nothing matches
  When I type "qqqq" in the palette
  Then the list shows "No matches"
  And Enter does nothing

Scenario: UI-005.8 The pointer highlights a row only when it moves
  Given the pointer rests where the palette, or a list opened from a menu (a branch list, Set Upstream…), is about to appear
  When the list opens under the pointer
  Then the first row is highlighted, not the row under the pointer, so Enter picks the first row
  When I move the pointer over another row
  Then that row is highlighted
```

## UI-006: Quick Open a file by name

- Status: draft
- Commands: `file.quickOpen`
- Files:
  - `src/components/CommandPalette.tsx` — mode `files`: pool of open and recent files, folder file list (`fs.walk`, `fileListCache`), 50 / 100 result caps, `pick` builds the absolute path
  - `src/lib/fuzzy.ts` — `fuzzyPath` (prefers a match inside the file name)
  - `src/lib/commands.ts` — `file.quickOpen` (Ctrl+P)
  - `src/lib/store.ts` — `fileListCache`, `recentFiles`
  - `src-tauri/src/lib.rs` — `fs_walk` lists the folder's files
- Tests: `src/__tests__/text.test.ts`
- Docs: `docs/editing.md`

**As a** developer working in a folder
**I want** to open a file by typing part of its name
**So that** I do not have to browse the tree for it

```gherkin
Scenario: UI-006.1 Search the open folder
  Given the folder "C:\work\app" is open and contains "src/components/CommandPalette.tsx" and "src/components/BottomPanel.tsx"
  When I press Ctrl+P and type "cmpal"
  Then "CommandPalette.tsx" is listed above "BottomPanel.tsx"
  And each row shows the file name with its relative path underneath
  When I press Enter
  Then "C:\work\app\src\components\CommandPalette.tsx" opens in a tab

Scenario: UI-006.2 Empty box lists open and recent files
  Given 2 files are open and 5 other files are in the recent list
  When I press Ctrl+P
  Then the 2 open files are listed first, followed by the 5 recent files
  And at most 50 files are listed

Scenario: UI-006.3 No folder open
  Given no folder is open
  When I press Ctrl+P
  Then the placeholder is "Search open and recent files…"
  And typing filters only the open and recent files

Scenario: UI-006.4 Folder still being listed
  Given a folder was just opened and its file list is not ready
  When I press Ctrl+P and type "main"
  Then the list shows "Indexing folder…" until the file list arrives
  And the results then appear, limited to the best 100 matches

Scenario: UI-006.5 The file list belongs to the folder it was built for
  Given Quick Open is listing folder A
  When folder B is opened before the listing finishes
  Then the list built for folder A is not used for folder B
```

## UI-007: Go to Line from the palette

- Status: draft
- Commands: `goto.line`
- Files:
  - `src/components/CommandPalette.tsx` — mode `goto`: `parseGoto`, live preview effect, `gotoOrigin` restore in `cancel`, `gotoHint`, out-of-range toast in `pick`
  - `src/lib/commands.ts` — `goto.line` (Ctrl+G); enabled only for text and large-file tabs (`applyDefaultEnabled`)
  - `src/editor/manager.ts` — `editor.goTo(line, col)`
  - `src/lib/bus.ts` — `big.goto` event for large-file tabs, `palette.cancel`
  - `src/components/StatusBar.tsx` — the "Ln, Col" item runs `goto.line`
- Tests: none
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** user reading a stack trace or a log
**I want** to jump to a line (and column) by number
**So that** I get to the reported position immediately

```gherkin
Scenario: UI-007.1 Jump to a line
  Given a text document with 120 lines and the cursor on line 3
  When I press Ctrl+G
  Then the box shows the placeholder "Go to line[:column]  (1–120)"
  And the hint reads "Current: line 3 of 120. Type a line number and press Enter."
  When I type "40" and press Enter
  Then the cursor is at line 40, column 1, and the line is scrolled into view

Scenario: UI-007.2 Line and column
  When I type "40:7" or "40,7" and press Enter
  Then the cursor is at line 40, column 7

Scenario: UI-007.3 Live preview and Escape
  Given a text document with the cursor on line 3
  When I press Ctrl+G and type "80"
  Then the editor already shows line 80 centred, before I press Enter
  When I press Escape
  Then the cursor and scroll position are back where they were on line 3

Scenario: UI-007.4 Line out of range
  Given a text document with 120 lines
  When I press Ctrl+G and type "999"
  Then the box is marked invalid and the hint reads "Line 999 is out of range (1–120). Enter jumps to the nearest line."
  When I press Enter
  Then the cursor is on line 120
  And a notification says "Line 999 is out of range; jumped to line 120."

Scenario: UI-007.5 Not a number
  When I press Ctrl+G and type "abc"
  Then the hint reads "Type a line number, optionally followed by :column."
  When I press Enter
  Then the palette closes and the cursor has not moved

Scenario: UI-007.6 Large-file tabs
  Given a large-file tab is active
  When I press Ctrl+G, type "2000000" and press Enter
  Then the large-file view goes to line 2,000,000
  And there is no live preview while typing

Scenario: UI-007.7 No file tab
  Given no document is open
  When I press Ctrl+G
  Then the palette does not open
  And a notification says "Go to Line… is not available here"
```

## UI-008: One command registry behind menus, shortcuts and the palette

- Status: draft
- Commands: none
- Files:
  - `src/lib/commands.ts` — `Command`, `register`, `runCommand`, `allCommands`, `getCommand`, `isEnabled`, `applyDefaultEnabled` (`hasDoc` / `hasFileDoc` / `hasText` / `hasJson`), `registerAllCommands`, `toastOnce`
  - `src/lib/macros.ts` — `recordCommand` is called for every command run, so the macro recorder sees it
  - `src/App.tsx` — boot order: `loadSettings`, then `registerAllCommands`, before the UI renders
  - `src/main.tsx` — dev builds expose `runCommand` on `window.__shi`
- Tests: none
- Docs: `docs/development.md`

**As a** user who mixes menus, shortcuts, the palette and macros
**I want** every action to be one command that behaves the same wherever I start it
**So that** nothing works from the menu but not from the keyboard, and macros can replay what I did

```gherkin
Scenario: UI-008.1 The same action from three places
  Given a text document is open with word wrap off
  When I run "Toggle Word Wrap" from the View menu, from the palette, or with Alt+Z
  Then word wrap turns on in each case
  And while a macro is being recorded each of the three is recorded as the same step

Scenario: UI-008.2 A command that does not apply is a no-op everywhere
  Given no document is open
  Then "Save" is greyed out in the File menu
  And "Save" is not listed in the palette
  When I press Ctrl+S
  Then nothing is saved
  And a notification says "Save is not available here"

Scenario: UI-008.3 Default availability by kind of tab
  When a large-file tab is active
  Then Find, Replace, Go to Line, Save, Save As, Undo and Redo are available
  And Code, Selection and JSON commands, line commands such as Duplicate Line Down, Toggle Word Wrap and Toggle Render Whitespace are not
  When a text tab whose language is not JSON is active
  Then the JSON menu's document commands are not available
  When no document is open
  Then Close Tab, Close Other Tabs, Close All Tabs, Save All, Next Tab and Previous Tab are not available

Scenario: UI-008.4 Commands that are always available
  When no document is open
  Then Command Palette, Quick Open File, Open File, Open Folder, the panel commands, Toggle Bottom Panel, Zoom In, Zoom Out, Reset Zoom and Toggle Light/Dark Theme can still be run
```

## UI-009: Global keyboard shortcuts

- Status: draft
- Commands: `ui.escape`
- Files:
  - `src/App.tsx` — capture-phase `onKey` handler (field, terminal, tab strip, Explorer tree and history-menu exceptions), `matchesRegistered` (which keys are swallowed)
  - `src/lib/commands.ts` — `handleKeyEvent`, `resolveStroke`, `normalizeKeys`, `eventToKeys` (physical key for letters and digits), `getCommandsForKeys`, `Command.when`, chord state (`CHORD_TIMEOUT_MS` 1500, `chordPrefixes`), `ui.escape`
  - `src/lib/bus.ts` — `palette.cancel` emitted by `ui.escape`
- Tests: `src/__tests__/shell.test.ts`
- Docs: `docs/keyboard-shortcuts.md`

**As a** keyboard-driven user
**I want** shortcuts to work wherever the focus is, without stealing ordinary typing from text boxes or from a terminal
**So that** I can drive the editor from the keyboard without surprises

```gherkin
Scenario: UI-009.1 Shortcuts work from a text box
  Given keyboard focus is in the Find in Files search box
  When I press Ctrl+Shift+P
  Then the command palette opens
  When I press Ctrl+J
  Then the bottom panel is toggled

Scenario: UI-009.2 Typing and clipboard keys stay in the text box
  Given keyboard focus is in a text box outside the editor
  When I type letters, press Tab, Delete or Enter
  Then the text box receives the keys and no command runs
  When I press Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+Z or Ctrl+Y
  Then the text box selects, copies, cuts, pastes, undoes or redoes its own text
  And the document is not changed
  When I press Alt+Down or Alt+Up
  Then the text box handles the key and no line is moved in the document

Scenario: UI-009.3 Shortcuts follow the physical key
  Given a keyboard layout where the key at the QWERTY "P" position types another character
  When I press Ctrl+Shift and the key at the "P" position
  Then the command palette opens

Scenario: UI-009.4 Two-key chords
  Given a text document is active
  When I press Ctrl+K
  Then a notification says "Ctrl+K pressed, waiting for second key…"
  When I press M within 1.5 seconds
  Then the language picker opens
  And the letter "m" is not typed into the document

Scenario: UI-009.5 A chord that does not exist
  When I press Ctrl+K and then X
  Then a notification says "Ctrl+K X is not a shortcut"
  And "x" is not typed into the document
  When I press Ctrl+K and wait more than 1.5 seconds before pressing M
  Then "m" is typed as ordinary text

Scenario: UI-009.6 A terminal tab keeps its keys
  Given keyboard focus is in a Claude CLI terminal tab
  When I press Ctrl+R, Ctrl+L, Ctrl+W, Ctrl+J or Escape
  Then the key goes to the program in the terminal and no Quarry command runs
  When I press Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+Shift+P or Ctrl+F4
  Then Quarry switches tab, opens the palette or closes the tab

Scenario: UI-009.7 Escape closes the topmost overlay only
  Given the find bar is open and the command palette is open over it
  When I press Escape
  Then the palette closes and the find bar stays open
  When I press Escape again
  Then the find bar closes and focus returns to the editor

Scenario: UI-009.8 A shortcut for an unavailable command is swallowed
  Given a large-file tab is active
  When I press Ctrl+/
  Then nothing changes in the file
  And a notification says "Toggle Line Comment is not available here"

Scenario: UI-009.9 Browser context menu is suppressed
  When I right-click an empty part of the status bar, the rail or a panel header
  Then no browser context menu appears
  When I right-click inside a text box or the editor
  Then the context menu for that text is available
```

## UI-010: Modal dialogs

- Status: draft
- Commands: none
- Files:
  - `src/lib/dialogs.ts` — `choose`, `inform`, `dismissDialog`, the `queue` / `current` pair (one dialog at a time, later ones wait), `Choice.default` / `cancel`
  - `src/components/Toasts.tsx` — `Dialog` component (Enter / Escape / Tab handling, autofocus of the default button), `dialogDefaultAction`, `dialogCancelAction`
  - `src/App.tsx` — `onKey` returns early while `store.dialog` is set, so no shortcut runs behind a dialog
  - `src/lib/store.ts` — `dialog`, `DialogAction`
  - `src/styles/app.css` — `.overlay`, `.dialog`, `.btn-primary`, `.btn-danger`
- Tests: `src/__tests__/shell.test.ts`
- Docs: none

**As a** user being asked to confirm something
**I want** one clear dialog at a time that I can answer from the keyboard
**So that** I never lose a question behind another one or trigger a command by accident while it is open

```gherkin
Scenario: UI-010.1 Answer with the mouse
  Given a dialog "Save changes to notes.txt before closing?" is shown
  When I click one of its buttons
  Then the dialog closes and that choice is carried out
  And keyboard focus returns to the active tab

Scenario: UI-010.2 Enter runs the default button
  Given a dialog is shown and I have not moved focus
  Then its default button has keyboard focus
  When I press Enter
  Then the default choice is carried out
  And when no button is marked as default, the first button that is not a destructive one is the default

Scenario: UI-010.3 Escape cancels
  Given a dialog with a "Cancel" button is shown
  When I press Escape
  Then the dialog closes as if I had clicked "Cancel"
  Given a dialog with only an "OK" button is shown
  When I press Escape
  Then the dialog closes

Scenario: UI-010.4 Tab stays inside the dialog
  Given a dialog with 3 buttons is shown with the last one focused
  When I press Tab
  Then the first button is focused
  When I press Shift+Tab
  Then the last button is focused
  And pressing Enter runs the focused button rather than the default one

Scenario: UI-010.5 A second dialog waits its turn
  Given a dialog A is on screen
  When something else asks a question B
  Then dialog A stays on screen unchanged
  When I answer A
  Then dialog B is shown
  And both questions receive their own answer

Scenario: UI-010.6 No shortcut runs behind a dialog
  Given a dialog is shown
  When I press Ctrl+S, Ctrl+W, Ctrl+Shift+P or Ctrl+N
  Then nothing is saved, closed or opened
  And the dialog is still shown
```

## UI-011: Notifications

- Status: draft
- Commands: none
- Files:
  - `src/components/Toasts.tsx` — `Toasts` (icon per kind, dismiss button, Escape on a focused notification)
  - `src/lib/store.ts` — `toast` (keeps the last 5, default 3.5 s, errors 8 s, explicit timeout), `dismissToast`
  - `src/lib/commands.ts` — `toastOnce` (does not stack an identical message)
  - `src/styles/app.css` — `.toasts`, `.toast`
- Tests: none
- Docs: none

**As a** user
**I want** short notifications that tell me what just happened and then get out of the way
**So that** I get feedback without having to dismiss a dialog

```gherkin
Scenario: UI-011.1 An information notification goes away by itself
  When an action reports "Path copied"
  Then a notification with that text appears
  And it disappears by itself after its timeout, 3.5 seconds unless the action sets another

Scenario: UI-011.2 Errors stay longer
  When an action fails with an error notification
  Then the notification is announced as an alert
  And it stays for 8 seconds unless the action sets another timeout

Scenario: UI-011.3 Dismiss by hand
  Given a notification is shown
  When I click its "Dismiss (Esc)" button
  Then it disappears immediately
  When I Tab to a notification's dismiss button and press Escape
  Then it disappears and keyboard focus returns to the active tab

Scenario: UI-011.4 At most 5 at a time
  Given 5 notifications are on screen
  When a 6th is raised
  Then the oldest one is removed and 5 are shown
```

## UI-012: Panel rail

- Status: draft
- Commands: `view.explorer`, `view.json`, `view.macros`, `view.scripts`, `view.settings`
- Files:
  - `src/components/SidebarRail.tsx` — `SidebarRail`, `PANEL_TITLES`, `ICONS`, order `TOP` + Settings at the bottom, pin dot
  - `src/lib/panels.ts` — `togglePanel`, `showPanel`, `focusPanel`, `isPanelShown`, `floatingPanel`
  - `src/lib/commands.ts` — `view.explorer` (Ctrl+Shift+E), `view.json` (Ctrl+Shift+J), `view.macros`, `view.scripts`, `view.settings` (Ctrl+,) all call `togglePanel`
  - `src/components/MenuBar.tsx` — View › Panels submenu, Tools › Settings
  - `src/lib/store.ts` — `SidebarPanel`, `PANELS`, `sidebarVisible`, `sidebarPanel`
  - `src/styles/tokens.css` — `--panel-search`, `--panel-explorer`, `--panel-git`, `--panel-json`, `--panel-scripts`, `--panel-macros`, `--panel-settings` (light and dark)
  - `src/styles/app.css` — `.sidebar-rail`, `.rail-btn`, `.rail-pin-dot`
- Tests: `src/__tests__/panels.test.ts`
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** user
**I want** an always-visible strip of icons that opens each side panel
**So that** Search, Explorer, Source Control, JSON Tools, Scripts, Macros and Settings are one click away

```gherkin
Scenario: UI-012.1 The rail is always there
  When Quarry is running
  Then the left edge of the window shows the icons Search, Explorer, Source Control, JSON Tools, Scripts and Macros from the top, and Settings at the bottom
  And each icon has its own colour and a tooltip such as "Explorer Panel"
  And the rail stays visible when every panel is closed

Scenario: UI-012.2 Open and close a panel from its icon
  Given no panel is open
  When I click the Explorer icon
  Then the Explorer panel opens to the right of the rail and its icon is shown as open
  When I click the Explorer icon again
  Then the Explorer panel closes

Scenario: UI-012.3 Only one unpinned panel at a time
  Given the Explorer panel is open and not pinned
  When I click the JSON Tools icon
  Then the JSON Tools panel is shown in its place
  And the Explorer panel is closed

Scenario: UI-012.4 The icon of a pinned panel moves focus into it
  Given the Explorer panel is pinned and shown
  When I click the Explorer icon or press Ctrl+Shift+E
  Then the Explorer panel stays open
  And keyboard focus moves into it
  And its rail icon carries a small pin dot

Scenario: UI-012.5 Shortcuts and menu items
  When I press Ctrl+Shift+E
  Then the Explorer panel opens
  When I press Ctrl+,
  Then the Settings panel opens
  And View › Panels lists Explorer, Search, JSON Tools, Macros, Scripts and Settings

Scenario: UI-012.6 A panel keeps its contents while closed
  Given I typed a filter in a panel and then closed the panel
  When I open the panel again
  Then the filter and the panel's scroll position are as I left them
```

## UI-013: Floating and pinned side panels

- Status: draft
- Commands: none
- Files:
  - `src/lib/panels.ts` — `isPinned`, `isAutoDocked`, `isDocked`, `floatingPanel`, `isPanelShown`, `setPinned`, `closePanel`
  - `src/components/Sidebar.tsx` — `PanelFrame` (pin button, close button, pin badge, dock order, Escape on a floating panel), `Sidebar` (mousedown outside closes the floating panel)
  - `src/lib/store.ts` — `pinnedPanels`, `searchDocked`, `sidebarVisible`, `sidebarPanel`
  - `src/lib/actions.ts` — `buildSession` / `restoreSessionTabs` keep `pinnedPanels`; the session folder is reopened with `openFolder(..., { show: false })` so it does not show the Explorer
  - `src/styles/app.css` — `.panel-dock`, `.sidebar.floating`, `.sidebar.docked`, `.panel-pin-badge`, `.sidebar-pin`, `.sidebar-close`
- Tests: `src/__tests__/panels.test.ts`
- Docs: `docs/editing.md`

**As a** user who sometimes glances at a panel and sometimes works beside one
**I want** panels to close by themselves when I go back to the document unless I pin them
**So that** the editor gets its space back without my managing panels by hand

```gherkin
Scenario: UI-013.1 A floating panel closes when I click back into the document
  Given the JSON Tools panel is open and not pinned
  When I click in the editor, on a tab, on the title bar or on the status bar
  Then the JSON Tools panel closes

Scenario: UI-013.2 Escape closes a floating panel
  Given the Macros panel is open and not pinned, with keyboard focus inside it
  When I press Escape and no control in the panel uses the key
  Then the panel closes
  And keyboard focus returns to the active tab

Scenario: UI-013.3 A panel pushes the editor, it does not cover it
  Given a document is open
  When I open a panel, pinned or not
  Then the editor becomes narrower by the width of the panel
  And no part of the document is hidden behind the panel

Scenario: UI-013.4 Pin a panel
  Given the Explorer panel is open and not pinned
  When I click its "Pin Explorer panel (keep it open beside the editor)" button
  Then the panel shows a pin badge in its corner
  When I click in the editor
  Then the Explorer panel stays open
  And pressing Escape inside it does not close it

Scenario: UI-013.5 Pinned panels dock side by side in pin order
  Given I pinned Explorer first and Source Control second
  Then Explorer is docked next to the rail and Source Control to its right
  When I open the unpinned JSON Tools panel
  Then it appears to the right of both pinned panels
  And clicking inside a pinned panel closes JSON Tools

Scenario: UI-013.6 Unpin keeps the panel in view
  Given the Explorer panel is pinned
  When I click its "Unpin Explorer panel (it closes when you click the editor)" button
  Then the panel is still shown, now floating
  When I click in the editor
  Then it closes

Scenario: UI-013.7 The close button of a pinned panel unpins it
  Given the Explorer panel is pinned
  When I click its "Close Explorer panel (unpins it)" button
  Then the panel closes and is no longer pinned

Scenario: UI-013.8 Search docks while it has results
  Given Find in Files has results and the Search panel is not pinned
  When I click a result and the file opens in the editor
  Then the Search panel stays open beside the editor, without a pin badge
  When I close the Search panel or clear the results
  Then it behaves as a floating panel again

Scenario: UI-013.9 Pins survive a restart
  Given Explorer and Source Control are pinned
  When I restart Quarry
  Then both panels are docked again in the same order
  And a panel that was open but not pinned is not reopened by the restart itself

Scenario: UI-013.10 Restoring the open folder does not open the Explorer
  Given a folder was open in the Explorer, and the Explorer is not pinned
  When I restart Quarry with session restore on
  Then the folder is open again in the Explorer
  But no side panel is shown until I open one
```

## UI-014: Collapse and restore the side panels

- Status: draft
- Commands: `view.toggleSidebar`
- Files:
  - `src/lib/panels.ts` — `toggleAllPanels`, `collapsePanels`, `anyPanelShown`
  - `src/components/TitleBar.tsx` — `Brand` button (labels "Collapse side panels" / "Show pinned panels" / "Quarry"; deliberately inert with nothing pinned or open, where Ctrl+B reopens the last panel)
  - `src/lib/commands.ts` — `view.toggleSidebar` (Ctrl+B, "Collapse / Restore Side Panels")
  - `src/App.tsx` — store subscription: asking for a panel clears `pinnedHidden`; a change of `pinnedHidden` alone does not save the session
  - `src/lib/store.ts` — `pinnedHidden` (starts false; not in the session)
- Tests: `src/__tests__/panels.test.ts`
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** user who wants the whole window for the document for a moment
**I want** one click or key to hide every side panel and bring the pinned ones back
**So that** I can focus without losing my panel layout

```gherkin
Scenario: UI-014.1 Collapse everything
  Given Explorer is pinned and the unpinned JSON Tools panel is open
  When I press Ctrl+B or click the Quarry mark in the title bar
  Then no side panel is shown
  And Explorer is still pinned

Scenario: UI-014.2 Bring the pinned panels back
  Given Explorer is pinned and the panels are collapsed
  Then the Quarry mark's tooltip is "Show pinned panels"
  When I press Ctrl+B or click the Quarry mark
  Then the Explorer panel is docked again
  And the JSON Tools panel that was floating before is not reopened

Scenario: UI-014.3 Asking for a panel also brings the pinned ones back
  Given Explorer is pinned and the panels are collapsed
  When I click the Search icon in the rail
  Then the Search panel opens
  And the pinned Explorer panel is shown again

Scenario: UI-014.4 Nothing pinned and nothing open
  Given no panel is pinned and none is open
  When I press Ctrl+B
  Then the panel that was open last is shown again, floating
  When no panel is pinned and none is open and I click the Quarry mark
  Then nothing happens and its tooltip is "Quarry"

Scenario: UI-014.5 Collapsing is not kept across a restart
  Given Explorer and Source Control are pinned and the panels are collapsed
  When I close and restart Quarry
  Then Explorer and Source Control are docked and shown again
```

## UI-015: Side panel widths

- Status: draft
- Commands: none
- Files:
  - `src/components/Sidebar.tsx` — `PanelFrame.startResize` (drag handle, clamp to minimum and 60% of the window), Settings width reset in `useLayoutEffect`
  - `src/lib/panels.ts` — `panelWidth`, `minPanelWidth` (Search 280, others 200), `DEFAULT_PANEL_WIDTH` 300, `SETTINGS_SHARE` 0.35
  - `src/lib/store.ts` — `panelWidths`, `sidebarWidth`
  - `src/lib/actions.ts` — `buildSession` saves `panelWidths` without Settings; `restoreSessionTabs` drops unknown panels and widths under 200
  - `src/styles/app.css` — `.sidebar-resizer`
- Tests: none
- Docs: `docs/editing.md`, `docs/settings.md`

**As a** user
**I want** to drag each panel to the width that suits its content and have it remembered
**So that** a wide Search panel does not force a wide Explorer

```gherkin
Scenario: UI-015.1 Each panel has its own width
  Given the Explorer and Search panels are both 300 px wide
  When I drag the right edge of the Explorer panel 100 px to the right
  Then the Explorer panel is 400 px wide
  And the Search panel is still 300 px wide when I open it

Scenario: UI-015.2 Minimum and maximum width
  When I drag the Explorer panel's edge as far left as possible
  Then the panel is 200 px wide
  When I drag the Search panel's edge as far left as possible
  Then the panel is 280 px wide
  When I drag a panel's edge as far right as possible
  Then the panel is no wider than 60% of the window

Scenario: UI-015.3 Widths survive a restart
  Given I resized the Explorer panel to 420 px
  When I restart Quarry and open the Explorer panel
  Then it is 420 px wide

Scenario: UI-015.4 Settings always opens at 35% of the window
  Given the window is 1600 px wide
  When I open the Settings panel
  Then it is 560 px wide
  When I drag it to 700 px, close it and open it again
  Then it is 560 px wide again
```

## UI-016: Bottom panel

- Status: draft
- Commands: `view.togglePanel`, `view.problems`
- Files:
  - `src/components/BottomPanel.tsx` — `BottomPanel` (Console and Problems tabs, problem count, Clear console, close button, `startResize`, scroll to newest line)
  - `src/lib/commands.ts` — `view.togglePanel` (Ctrl+J), `view.problems` (shows the panel on the Problems tab)
  - `src/lib/store.ts` — `bottomVisible` (starts hidden), `bottomTab` (`console` | `problems`, starts on `console`), `bottomHeight` (220), `consoleLines`, `log` (keeps about the last 2000 lines), `clearConsole`
  - `src/lib/panels.ts` — `clampBottomHeight` (`BOTTOM_MIN_HEIGHT` 80, `BOTTOM_ROOM_ABOVE` 200, `BOTTOM_DEFAULT_HEIGHT` 220)
  - `src/lib/actions.ts` — `buildSession` saves `bottomHeight`; `restoreSessionTabs` clamps it to the window
  - `src/App.tsx` — the store subscription saves the session when `bottomHeight` changes
  - `src/components/LspStatus.tsx` — `ProblemsList`, `useProblemCount` shown inside the Problems tab
  - `src/lib/scripting.ts` — opens the panel on the Console tab when a script writes output
  - `src/styles/app.css` — `.bottom-panel`, `.bottom-tabs`, `.bottom-resizer`, `.console-line`
- Tests: `src/__tests__/panels.test.ts`
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** user running scripts or checking code problems
**I want** a panel under the editor for console output and the problem list that I can show, hide and resize
**So that** I can read output next to the document it is about

```gherkin
Scenario: UI-016.1 Toggle with Ctrl+J
  Given the bottom panel is hidden
  When I press Ctrl+J or choose View › Toggle Bottom Panel
  Then the bottom panel appears under the editor, on the Console tab, 220 px high unless I resized it before
  When I press Ctrl+J again or click its "Close panel (Ctrl+J)" button
  Then it is hidden

Scenario: UI-016.2 Empty console
  Given nothing has been written to the console
  When I show the bottom panel
  Then the Console tab reads "Script output and messages appear here."

Scenario: UI-016.3 Console output
  Given a script wrote 3 lines to the console
  Then the bottom panel is shown on the Console tab
  And each line starts with the time it was written
  And the view is scrolled to the newest line
  When I click "Clear console"
  Then the console is empty

Scenario: UI-016.4 Problems tab
  Given the language server reported 4 problems
  When I run the "Problems" command from the palette
  Then the bottom panel is shown on the Problems tab
  And the tab is labelled "Problems" with the count 4
  And the "Clear console" button is not shown on that tab

Scenario: UI-016.5 Resize
  When I drag the top edge of the bottom panel
  Then its height follows the mouse
  And it is never lower than 80 px and always leaves 200 px of the window above it

Scenario: UI-016.6 Side panels and the bottom panel are independent
  Given the bottom panel is shown
  When I press Ctrl+B
  Then the side panels collapse and the bottom panel stays

Scenario: UI-016.7 Only the height is kept across a restart
  Given I resized the bottom panel to 340 px and left it shown on the Problems tab
  When I close and restart Quarry
  Then the bottom panel is hidden
  When I press Ctrl+J
  Then it appears 340 px high on the Console tab

Scenario: UI-016.8 A saved height that no longer fits
  Given the bottom panel was 700 px high and Quarry now starts in a window 600 px high
  When I press Ctrl+J
  Then the bottom panel is 400 px high, leaving 200 px of the window above it
```

## UI-017: Status bar position and document facts

- Status: draft
- Commands: none
- Files:
  - `src/components/StatusBar.tsx` — `StatusBar`: "Ln, Col" item with selection / cursor counts, large-file size and indexing item, "Read-only", static encoding and line-ending items for large files
  - `src/components/GitAssistStatus.tsx` — `GitAssistStatusItem` (the running Claude git request and its stop button)
  - `src/lib/store.ts` — `cursor: CursorInfo` (`line`, `col`, `selections`, `selectedChars`)
  - `src/editor/manager.ts` — `publishCursor` feeds `cursor` from the focused pane
  - `src/lib/actions.ts` — `formatBytes`
  - `src/styles/app.css` — `.statusbar`, `.status-item`
- Tests: none
- Docs: `docs/editing.md`

**As a** user editing or reading a file
**I want** the status bar to show where I am and what kind of file this is
**So that** I can check position, selection size and file facts at a glance

```gherkin
Scenario: UI-017.1 Cursor position
  Given a text document with the cursor on line 12, column 5 and nothing selected
  Then the status bar shows "Ln 12, Col 5"
  When I click that item
  Then Go to Line opens

Scenario: UI-017.2 Selection size
  When I select 18 characters
  Then the status bar shows "Ln 12, Col 23 (18 selected)"
  When I have 3 selections totalling 30 characters
  Then the item ends with "(30 selected, 3 ranges)"
  When I have 4 cursors and nothing selected
  Then the item ends with "(4 cursors)"

Scenario: UI-017.3 Large-file tab
  When a 4 GB log is open as a large-file tab and still being indexed
  Then the status bar shows its size, the line count so far and "indexing" with a percentage
  And it shows "Ln, Col", the encoding and the line ending as plain text
  And the encoding and line-ending items cannot be clicked

Scenario: UI-017.4 Read-only file
  When the active file is read-only
  Then the status bar shows "Read-only"

Scenario: UI-017.5 No document
  When no document is open
  Then the status bar shows no cursor, encoding, line-ending or language items

Scenario: UI-017.6 A running Claude git request
  Given a Claude git helper is running (GITAI-005)
  When I look at the left part of the status bar, whatever tab is active
  Then an item reads "Claude: drafting a commit message… 12s", counting up, with a stop button
  And it is gone when the request ends or is stopped
```

## UI-018: Status bar pickers for indentation, encoding, line endings and language

- Status: draft
- Commands: `view.setTabSize`, `file.setEncoding`, `file.setEol`
- Files:
  - `src/components/StatusBar.tsx` — `Picker` (popup above the item, keyboard handling, current value ticked, `openOn` bus events), `placePopup`, the four pickers (line endings offer CR only while the document uses it) and the Column button in `StatusBar`
  - `src/lib/commands.ts` — `view.setTabSize` (1-16, else opens the picker), `file.setEncoding`, `file.setEol` (CRLF / LF / CR; no argument from the palette opens the picker)
  - `src/lib/bus.ts` — `status.tabSize`, `status.encoding`, `status.eol` events
  - `src/lib/types.ts` — `ENCODINGS`, `Settings.tabSize`, `Settings.insertSpaces`
  - `src/editor/manager.ts` — `editor.setLanguage`, `editor.applySettings`
  - `src/editor/cmSetup.ts` — `allLanguageNames` for the language picker
  - `src/styles/app.css` — `.status-popup`, `.status-item.clickable`
- Tests: `src/__tests__/shell.test.ts`
- Docs: `docs/editing.md`, `docs/settings.md`

**As a** user
**I want** to change indentation width, save encoding, line endings and language by clicking them in the status bar
**So that** I can fix a file's format without opening Settings

```gherkin
Scenario: UI-018.1 Change the tab size
  Given a text document is open and the status bar shows "Spaces: 4"
  When I click "Spaces: 4"
  Then a list opens above it with 2, 4 and 8, and 4 is ticked
  When I click 2
  Then the status bar shows "Spaces: 2"
  And the setting is saved and applies to every text tab
  And when indenting with tabs the item reads "Tab Size: 2" instead

Scenario: UI-018.2 Change the encoding used on save
  Given a text document saved as UTF-8
  When I click "UTF-8" in the status bar and choose "windows-1252"
  Then the status bar shows "windows-1252"
  And the tab is marked as having unsaved changes
  And a notification says "Will save as windows-1252"
  And the text shown in the editor is not reloaded
  When I choose the encoding the document already has
  Then nothing changes

Scenario: UI-018.3 A byte order mark is shown
  When I open a UTF-8 text file that starts with a byte order mark
  Then its encoding item reads "UTF-8 BOM"

Scenario: UI-018.4 Change line endings
  Given a text document with CRLF line endings
  When I click "CRLF" in the status bar and choose "LF"
  Then the status bar shows "LF"
  And the tab is marked as having unsaved changes

Scenario: UI-018.5 Change the language
  Given a text document shown as "Plain Text"
  When I click "Plain Text" in the status bar and choose "JSON"
  Then the document is highlighted as JSON
  And the status bar shows "JSON"

Scenario: UI-018.6 Keyboard and dismissal
  Given a status bar list is open
  When I press Down, Up, Home or End
  Then the highlight moves, wrapping at the ends
  When I press Enter
  Then the highlighted value is applied and keyboard focus returns to the editor
  When I press Escape or click outside the list
  Then the list closes without changing anything

Scenario: UI-018.7 The same pickers from the palette
  Given a text document is active
  When I run "Change Tab Size…", "Change File Encoding…" or "Change Line Endings…" from the palette
  Then the matching status bar list opens
  And without a text document "Change File Encoding…" and "Change Line Endings…" are not listed

Scenario: UI-018.8 Column mode button
  Given a text document is active
  When I click "Column" in the status bar
  Then column mode turns on and the button reads "COLUMN" in the accent colour

Scenario: UI-018.9 A CR-only file keeps CR in the line-ending picker
  Given a text file with CR-only (classic Mac) line endings is active
  When I click "CR" in the status bar
  Then the picker lists "CRLF", "LF" and "CR", with "CR" ticked
  And for a CRLF or LF document the picker lists only "CRLF" and "LF"
```

## UI-019: Light and dark themes

- Status: draft
- Commands: `view.toggleTheme`
- Files:
  - `src/App.tsx` — `useTheme` (sets `data-theme` and `data-mica` on the root element, follows the Windows colour scheme in System mode, sets the native window theme)
  - `src/styles/tokens.css` — colour variables: light set, `:root[data-theme="dark"]` set, `:root[data-mica="off"]` opaque backgrounds
  - `src/styles/app.css` — every component style reads the variables; `forced-colors` (High Contrast) and `prefers-reduced-motion` blocks
  - `src/lib/commands.ts` — `view.toggleTheme`
  - `src/lib/types.ts` — `Settings.theme` ("system" default), `Settings.mica` (on by default)
  - `src-tauri/tauri.conf.json` — transparent window with the `mica` / `tabbed` window effects
- Tests: none
- Docs: `docs/editing.md`, `docs/settings.md`

**As a** user who works at different times of day
**I want** Quarry to follow the Windows light or dark mode, or the theme I pick
**So that** the editor is comfortable to read and matches the rest of my desktop

```gherkin
Scenario: UI-019.1 System theme follows Windows
  Given Settings › Appearance › Theme is "System" and Windows is in light mode
  Then Quarry uses the light colours
  When I switch Windows to dark mode while Quarry is running
  Then Quarry switches to the dark colours without a restart

Scenario: UI-019.2 Fixed theme
  Given Theme is "Dark"
  When Windows switches between light and dark mode
  Then Quarry stays dark

Scenario: UI-019.3 Toggle Light/Dark Theme
  Given Theme is "System" and Quarry currently looks dark
  When I choose View › Toggle Light/Dark Theme
  Then Quarry looks light
  And the Theme setting is now "Light", no longer "System"
  And the choice is kept after a restart

Scenario: UI-019.4 Everything changes together
  When the theme changes
  Then the title bar, menus, panels, status bar, dialogs, notifications and the editor all use the new colours
  And each panel's rail icon keeps its own colour, in the variant for that theme

Scenario: UI-019.5 Mica on and off
  Given Settings › Appearance › Mica material is on
  Then the window background is the translucent Windows 11 material
  When I turn Mica material off
  Then the window background is opaque

Scenario: UI-019.6 Windows accessibility settings
  When a Windows High Contrast theme is active
  Then Quarry uses the system colours with visible borders and focus outlines
  When Windows "Animation effects" is off
  Then Quarry shows no animations
```

## UI-020: Zoom and editor view toggles

- Status: draft
- Commands: `view.zoomIn`, `view.zoomInPlus`, `view.zoomOut`, `view.zoomReset`, `view.toggleWrap`, `view.toggleWhitespace`
- Files:
  - `src/lib/commands.ts` — `view.zoomIn` (Ctrl+=), `view.zoomInPlus` (Ctrl+Plus, hidden duplicate), `view.zoomOut` (Ctrl+-), `view.zoomReset` (Ctrl+0, back to `DEFAULT_SETTINGS.fontSize`), `view.toggleWrap` (Alt+Z), `view.toggleWhitespace`; each updates the setting, applies it and saves it
  - `src/lib/actions.ts` — `persistSettings`
  - `src/editor/manager.ts` — `editor.applySettings`
  - `src/lib/types.ts` — `Settings.fontSize` (14), `Settings.wordWrap`, `Settings.renderWhitespace`
  - `src/components/MenuBar.tsx` — View menu entries
- Tests: none
- Docs: `docs/keyboard-shortcuts.md`, `docs/editing.md`

**As a** user
**I want** quick keys for the editor font size, word wrap and visible whitespace
**So that** I can adapt the view to the file in front of me without opening Settings

```gherkin
Scenario: UI-020.1 Zoom in and out
  Given the editor font size is 14
  When I press Ctrl+=
  Then the editor font size is 15
  When I press Ctrl+- twice
  Then the editor font size is 13
  And Settings shows the same font size

Scenario: UI-020.2 Zoom limits
  Given the editor font size is 40
  When I press Ctrl+=
  Then the editor font size is still 40
  Given the editor font size is 8
  When I press Ctrl+-
  Then the editor font size is still 8

Scenario: UI-020.3 Reset zoom
  Given the editor font size is 22
  When I press Ctrl+0
  Then the editor font size is 14, the default font size

Scenario: UI-020.4 Zoom is remembered
  Given I zoomed to font size 18
  When I restart Quarry
  Then the editor font size is 18

Scenario: UI-020.5 Toggle word wrap
  Given a text document is active with word wrap off
  When I press Alt+Z
  Then long lines wrap at the edge of the editor
  And the Word wrap setting is on for every text tab and after a restart

Scenario: UI-020.6 Toggle render whitespace
  Given a text document is active
  When I choose View › Toggle Render Whitespace
  Then spaces and tabs are drawn as visible marks
  When I choose it again
  Then they are no longer drawn

Scenario: UI-020.7 Wrap and whitespace need a text document
  Given no text document is active
  When I open the View menu
  Then View › Toggle Word Wrap and View › Toggle Render Whitespace are greyed out
  And View › Zoom In, Zoom Out and Reset Zoom are still available
```

## UI-021: Keyboard focus returns to the active tab

- Status: draft
- Commands: none
- Files:
  - `src/editor/manager.ts` — `editor.focus()` (active tab's registered target, else the text editor; does nothing for a non-text tab without a target), `registerFocus(docId, fn)`
  - `src/components/MenuBar.tsx` — calls `editor.focus()` when a menu closes or an item ran
  - `src/components/CommandPalette.tsx` — `close` calls `editor.focus()`
  - `src/components/Toasts.tsx` — `Dialog` effect cleanup and the notification Escape handler call `editor.focus()`
  - `src/components/StatusBar.tsx` — `Picker.pick` calls `editor.focus()`
  - `src/components/Sidebar.tsx` — Escape in a floating panel calls `editor.focus()`
  - `src/components/BigFileView.tsx` — registers the large-file view as focus target
  - `src/components/ClaudeView.tsx` — registers the message box
  - `src/components/TerminalView.tsx` — registers the terminal
  - `src/components/DiffView.tsx` — registers the changed side of the comparison
  - `src/components/GraphView.tsx` — registers the commit list
- Tests: none
- Docs: none

**As a** keyboard user
**I want** focus to go back to what I was working in whenever a menu, palette, dialog or picker closes
**So that** I can keep typing without clicking back into the tab

```gherkin
Scenario: UI-021.1 Back to the text editor
  Given a text document is active and the command palette is open
  When I press Escape
  Then the caret is blinking in the editor and typing inserts text

Scenario: UI-021.2 Back to a non-text tab
  Given a Claude Code tab is active and I open the View menu
  When I press Escape
  Then keyboard focus is in the Claude message box
  And the same rule returns focus to the terminal of a Claude CLI tab, the line view of a large-file tab, the changed side of a Compare tab and the commit list of a commit graph tab

Scenario: UI-021.3 After a dialog
  Given a large-file tab is active and a dialog is shown
  When I answer the dialog
  Then keyboard focus is in the large-file view

Scenario: UI-021.4 After a status bar pick
  Given a text document is active
  When I choose "LF" in the line-endings list
  Then keyboard focus is in the editor

Scenario: UI-021.5 Focus is not sent to a hidden text editor
  Given a non-text tab is active
  When an overlay closes
  Then the hidden text editor does not take keyboard focus
```

## UI-022: Tab key can leave the editor

- Status: draft
- Commands: `view.toggleTabFocus`
- Files:
  - `src/App.tsx` — `onKey`: `tabEscapeUntil` (Escape then Tab within 2 s), `tabMovesFocus` check, Escape in the editor clears Find in Files highlighting
  - `src/lib/commands.ts` — `view.toggleTabFocus` (Ctrl+M) flips `tabMovesFocus`, keeps CodeMirror's tab-focus mode in step, notification text
  - `src/components/StatusBar.tsx` — "Tab moves focus" button shown while the mode is on
  - `src/lib/store.ts` — `tabMovesFocus`
- Tests: none
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** keyboard-only user
**I want** a way to Tab out of the editor even though Tab normally indents
**So that** the editor is not a keyboard trap

```gherkin
Scenario: UI-022.1 Tab indents by default
  Given the caret is in the editor
  When I press Tab
  Then the line is indented and focus stays in the editor

Scenario: UI-022.2 Escape then Tab leaves the editor once
  Given the caret is in the editor and no find bar or palette is open
  When I press Escape and then Tab within 2 seconds
  Then keyboard focus moves to the next control after the editor
  And the document is not indented
  When I press Escape, then another key, then Tab
  Then Tab indents as usual

Scenario: UI-022.3 Ctrl+M makes Tab move focus until turned off
  When I press Ctrl+M
  Then a notification says "Tab moves focus. Press Ctrl+M again to indent with Tab."
  And the status bar shows "Tab moves focus"
  And Tab and Shift+Tab in the editor move focus to the next or previous control
  When I press Ctrl+M again or click "Tab moves focus" in the status bar
  Then a notification says "Tab indents again"
  And the status bar item disappears

Scenario: UI-022.4 The mode is not remembered
  Given Tab moves focus is on
  When I restart Quarry
  Then Tab indents again
```

## UI-023: Single instance and files handed over by Windows

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/lib.rs` — `run` (single-instance plugin registered first: forwards arguments as the `open-paths` event, un-minimises, shows and focuses the main window), `cli_paths` (ignores options and missing paths, resolves relative paths against the launching folder, repairs `C:"`), `startup_paths`
  - `src-tauri/windows/hooks.nsh` — installer hooks: "Open with" registration for common text types, "Open with Quarry" on files, "Open folder in Quarry" on folders and folder backgrounds, all per-user and removed on uninstall
  - `src-tauri/tauri.conf.json` — `bundle.windows.nsis.installerHooks`
  - `src/App.tsx` — `open-paths` listener opens each path; drag-and-drop listener opens dropped files
  - `src/lib/actions.ts` — `restoreSessionTabs` opens `startupPaths()` after the session; `openPath` opens a folder in the Explorer when the path is a directory
  - `src/lib/ipc.ts` — `sys.startupPaths`
- Tests: none
- Docs: `docs/editing.md`, `docs/development.md`

**As a** Windows user
**I want** files I open from File Explorer or the command line to arrive in the Quarry window I already have
**So that** I get one editor with all my tabs instead of several windows

```gherkin
Scenario: UI-023.1 Start with files on the command line
  Given Quarry is not running
  When I run quarry.exe with the paths "C:\logs\a.log" and "C:\logs\b.log"
  Then Quarry starts with both files open in tabs
  And the tabs of the previous session are not reopened, except untitled tabs with unsaved text

Scenario: UI-023.2 A second launch goes to the running window
  Given Quarry is running, minimised, with 3 tabs
  When I double-click "notes.txt" in File Explorer with Quarry as its application
  Then no second Quarry window or process stays open
  And the existing window is restored and brought to the front
  And "notes.txt" opens as a 4th tab

Scenario: UI-023.3 A folder argument opens in the Explorer panel
  When I choose "Open folder in Quarry" on a folder in File Explorer
  Then that folder becomes the open folder and the Explorer panel shows it
  And this also works for a drive root such as "C:\" and for the background of an open folder

Scenario: UI-023.4 Relative paths are taken from where the command was run
  Given Quarry is running
  When I run "quarry.exe readme.md" in a terminal whose current folder is "D:\proj"
  Then "D:\proj\readme.md" opens in the running window

Scenario: UI-023.5 Arguments that are not existing paths are ignored
  When Quarry is started with "--flag" and "C:\missing\nothing.txt"
  Then no tab is opened for either and no error is shown

Scenario: UI-023.6 Explorer integration installed without changing defaults
  Given Quarry was installed with the installer
  Then right-clicking any file offers "Open with Quarry"
  And Quarry is listed under "Open with" for common text types such as .txt, .log, .json, .csv and .md
  And the default application of every file type is unchanged
  When Quarry is uninstalled
  Then these entries are removed

Scenario: UI-023.7 Drop files on the window
  When I drop 2 files from File Explorer on the Quarry window, outside a Claude Code tab
  Then both files open in tabs
```

## UI-024: Window size and position are remembered

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/lib.rs` — `run` registers `tauri_plugin_window_state` with its default settings (plugin 2.5: every `StateFlags` flag, saved on close and on exit to `.window-state.json` in the app config folder; a saved position is applied only if it overlaps a connected monitor)
  - `src-tauri/capabilities/default.json` — `window-state:default` permission
  - `src-tauri/tauri.conf.json` — first-run window: 1280 x 820, centred, minimum 720 x 400
- Tests: none
- Docs: none

**As a** user with my own window arrangement
**I want** Quarry to reopen where and how I left it
**So that** I do not have to move and resize the window on every start

```gherkin
Scenario: UI-024.1 First start
  Given Quarry has never been run on this account
  When it starts
  Then the window is 1280 x 820 and centred on the screen

Scenario: UI-024.2 Size and position come back
  Given I moved the window to the second monitor and resized it
  When I close and restart Quarry
  Then the window opens at the same position and size

Scenario: UI-024.3 Maximized state comes back
  Given I closed Quarry while its window was maximized
  When I start it again
  Then the window is maximized

Scenario: UI-024.4 Minimum size
  When I drag the window smaller
  Then it cannot become smaller than 720 x 400

Scenario: UI-024.5 A monitor that is gone
  Given I closed Quarry with its window on a second monitor
  And that monitor is no longer connected
  When I start Quarry
  Then the window keeps its saved size but is placed on a connected screen
```

## UI-025: Notice after an unexpected exit

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/lib.rs` — `install_crash_log` (panic hook appends to `crash.log` in the app log folder), `take_crash_report` (moves the report aside so it is shown once)
  - `src/App.tsx` — boot sequence shows the warning notification after the session is restored
  - `src/lib/ipc.ts` — `appIpc.takeCrashReport`
- Tests: `src-tauri/src/lib.rs`
- Docs: `docs/development.md`

**As a** user whose editor crashed
**I want** to be told on the next start where the details were saved
**So that** I can report the problem with something useful attached

```gherkin
Scenario: UI-025.1 Told once after a crash
  Given Quarry's core crashed during the last run
  When I start Quarry again
  Then a warning notification says "Quarry closed unexpectedly last time. Details were saved to" followed by a file path
  And the notification stays for 15 seconds
  When I start Quarry once more without a crash in between
  Then the notification is not shown again

Scenario: UI-025.2 Normal exit
  Given Quarry was closed normally
  When I start it again
  Then no such notification is shown
```
