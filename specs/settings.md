---
area: Settings
prefix: SET
---

# Settings

The Settings panel, every setting it holds and what changing it does, the per-row Use previous / Restore default buttons, how settings are stored and repaired on load, and the two small controls the panels rely on (the themed `Select` dropdown and the `InfoTip` help icon). User documentation: `docs/settings.md`.

## SET-001: Open the Settings panel and filter it

- Status: draft
- Commands: `view.settings`
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `SettingsPanel` (focus and scroll-to-top on open, filter box, Escape clears the filter), `rowMatches`, `Section`, `Row`
  - `src/components/Sidebar.tsx` — Settings width set to `SETTINGS_SHARE` of the window on every open (at least 200 px)
  - `src/lib/panels.ts` — `SETTINGS_SHARE` = 0.35, `showPanel`, `isPanelShown`, `panelWidth`
  - `src/lib/commands.ts` — `view.settings`
  - `src/components/MenuBar.tsx` — Tools › Settings and View › Panels › Settings
  - `src/styles/app.css` — `.settings-body`, `.settings-filter`, `.settings-empty` (visible only when no row or button is left)
- Tests: `src/__tests__/ui.test.ts`
- Docs: `docs/settings.md`, `docs/keyboard-shortcuts.md`

**As a** Quarry user
**I want** to open Settings quickly and find a setting by typing part of its name
**So that** I can change how the editor behaves without reading a long list

```gherkin
Scenario: SET-001.1 Open with the shortcut
  Given the Settings panel is closed
  When I press Ctrl+,
  Then the Settings panel opens scrolled to the top
  And keyboard focus is in the "Filter settings" box
  And the sections are Appearance, Editor, Tabs and panels, Files, Folders, Search, Code intelligence, Claude Code, JSON and Data, in that order

Scenario: SET-001.2 Settings always opens at 35% of the window width
  Given the window is 2000 px wide and I dragged the Settings panel to 300 px before closing it
  When I open Settings again
  Then the panel is 700 px wide
  And I can still drag it to another width, which lasts until it is closed

Scenario: SET-001.3 Filter by label, hint or section name
  Given the Settings panel is open
  When I type "wrap" in the filter box
  Then only the "Word wrap" row is shown
  When I type "ALT+Z" instead
  Then the "Word wrap" row is shown, because its hint matches, ignoring case
  When I type "json" instead
  Then every row of the JSON section is shown

Scenario: SET-001.4 Nothing matches
  When I type "zzzz" in the filter box
  Then no rows are shown and the panel says No settings match “zzzz”

Scenario: SET-001.5 Clear the filter
  Given the filter box contains "font"
  When I press Escape in the filter box, or click the "Clear filter" button
  Then the filter is empty and every row is shown again
```

## SET-002: Changes apply at once and are saved automatically

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `change` (store update, `editor.applySettings`, `persistSettings`, `applyHistoryLimit` for the history limit)
  - `src/lib/store.ts` — `settings`, `updateSettings`
  - `src/lib/actions.ts` — `persistSettings` (writes `settings.json` 300 ms after the last change), `SETTINGS_FILE`
  - `src/editor/manager.ts` — `applySettings` (both panes and every stored document state)
  - `src/editor/cmSetup.ts` — `settingsReconfigure`
  - `src/lib/ipc.ts` — `appData.write`
  - `src-tauri/src/lib.rs` — `app_write`, `app_data_dir` (`%APPDATA%\com.quarry.app`), `safe_name`
- Tests: none
- Docs: `docs/settings.md`

**As a** Quarry user
**I want** a setting to take effect the moment I change it, with no Save button
**So that** I can see the result immediately and never lose a change

```gherkin
Scenario: SET-002.1 A change is visible immediately in every open document
  Given two text tabs are open and "Line numbers" is on
  When I turn "Line numbers" off in Settings
  Then the line-number gutter disappears in the visible tab at once
  And it is also gone in the other tab when I switch to it

Scenario: SET-002.2 A change survives a restart
  Given "Tab size" is 4
  When I set "Tab size" to 2 and restart Quarry a second later
  Then "Tab size" is 2
  And %APPDATA%\com.quarry.app\settings.json contains "tabSize": 2

Scenario: SET-002.3 Several quick changes are written once
  When I press Ctrl+= five times within a second
  Then the font size is 5 larger
  And the settings file is written once, about 300 ms after the last press

Scenario: SET-002.4 A split editor follows too
  Given the editor is split
  When I turn "Word wrap" on
  Then long lines wrap in both panes
```

## SET-003: Settings are loaded, completed and repaired at start

- Status: draft
- Commands: none
- Files:
  - `src/lib/actions.ts` — `loadSettings` (merge over `DEFAULT_SETTINGS`, `.bak` copy and warning toast when unreadable), `sanitizeSettings`, `clampInt`
  - `src/lib/types.ts` — `Settings`, `DEFAULT_SETTINGS`
  - `src/App.tsx` — boot order (`loadSettings` before commands and session restore)
  - `src-tauri/src/lib.rs` — `app_read`
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/settings.md`

**As a** Quarry user upgrading or hand-editing my settings file
**I want** Quarry to start with sensible values whatever the file contains
**So that** a new version, a typo or a damaged file never leaves the editor unusable

```gherkin
Scenario: SET-003.1 First start uses the defaults
  Given there is no settings.json
  When Quarry starts
  Then the theme is System, the font size is 14, the tab size is 4 with spaces, the menu bar is in the title bar and the large-file threshold is 32 MB
  And no warning is shown

Scenario: SET-003.2 A file from an older version keeps its values and gains new settings
  Given settings.json contains only "fontSize": 18 and "theme": "dark"
  When Quarry starts
  Then the font size is 18 and the theme is Dark
  And every other setting has its default, for example "Maximum open tabs" is 50

Scenario Outline: SET-003.3 Out-of-range numbers are clamped
  Given settings.json contains "<key>": <stored>
  When Quarry starts
  Then the setting is <used>

  Examples:
    | key                  | stored | used |
    | fontSize             | 400    | 40   |
    | fontSize             | 2      | 8    |
    | tabSize              | 0      | 1    |
    | jsonIndent           | 99     | 8    |
    | largeFileThresholdMb | 100000 | 4096 |
    | maxOpenTabs          | 0      | 1    |

Scenario: SET-003.4 Junk values fall back to the default
  Given settings.json contains "theme": "purple", "menuPosition": "left", "defaultEol": "CR" and "fontSize": "big"
  When Quarry starts
  Then the theme is System, the menu bar is in the title bar, default line endings are CRLF and the font size is 14

Scenario: SET-003.5 Line breaks in a folder setting are removed
  Given settings.json has a scriptsDir value with a line break inside and spaces around it
  When Quarry starts
  Then the Scripts folder is that path with the line break and the outer spaces removed

Scenario: SET-003.6 An unreadable file is kept as a backup
  Given settings.json is not valid JSON
  When Quarry starts
  Then every setting has its default
  And the old content is saved as settings.json.bak in the same folder
  And a warning toast says "Settings file was unreadable; using defaults. The old file was kept as settings.json.bak."
```

## SET-004: Use previous setting and Restore default on each row

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `Row` (`hasPrev`, `dirty`, the two buttons, `apply` for rows with side effects), `describeValue`
  - `src/lib/store.ts` — `prevSettings`, `updateSettings` (records the old value of every key that changes), `loadPrevSettings`, localStorage key `quarry.prevSettings`
  - `src/lib/types.ts` — `DEFAULT_SETTINGS`
  - `src/styles/app.css` — `.field-actions`, `.field-reset` (a disabled button is invisible until the row is hovered or focused)
- Tests: `src/__tests__/ui.test.ts`
- Docs: `docs/settings.md`

**As a** Quarry user trying out options
**I want** to flip a setting back to what it was, or to its default, with one click
**So that** I can compare two choices and undo experiments without remembering the old value

```gherkin
Scenario: SET-004.1 Use previous setting
  Given "Font size" was 14 and I changed it to 18
  When I point at the "Font size" row
  Then its first button has the tooltip "Use previous setting (14)"
  When I click it
  Then "Font size" is 14 and the editor text is smaller at once

Scenario: SET-004.2 Clicking again swaps back
  Given "Font size" was 14, then 18, and I clicked "Use previous setting"
  When I click the same button again
  Then "Font size" is 18
  And its tooltip now reads "Use previous setting (14)"

Scenario: SET-004.3 Restore default
  Given "Tab size" is 8
  When I click the second button on the "Tab size" row, whose tooltip is "Restore default (4)"
  Then "Tab size" is 4
  And "Use previous setting" now offers 8

Scenario: SET-004.4 Buttons with nothing to do
  Given "Word wrap" has never been changed
  When I point at the "Word wrap" row
  Then the first button is disabled with the tooltip "No previous setting yet"
  And the second is disabled with the tooltip "Already the default"
  And neither button is visible while the row is neither hovered nor focused

Scenario: SET-004.5 Previous values are remembered between sessions
  Given I changed "Theme" from Light to Dark and restarted Quarry
  When I open Settings
  Then the "Theme" row offers "Use previous setting (light)"

Scenario: SET-004.6 Values changed outside the panel count too
  Given the font size is 14
  When I press Ctrl+= twice
  Then the "Font size" row offers "Use previous setting (15)"

Scenario: SET-004.7 Tooltip wording
  When I read the tooltips of the two buttons
  Then a switch value is shown as "On" or "Off", an empty text as "empty", and a text longer than 48 characters is cut with "…"

Scenario: SET-004.8 Rows with side effects run them
  Given the Scripts folder is D:\scripts
  When I click "Restore default" on the "Scripts folder" row
  Then the setting is empty and the field shows the default folder under the app data folder
  And the Scripts panel lists that folder
```

## SET-005: Reset everything and open the settings folder

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `resetAll` (confirmation, `DEFAULT_SETTINGS`, `loadMacros("switch")`, toast), "Open settings folder" button (`appData.path`, `revealItemInDir`, falls back to a toast with the path)
  - `src/lib/actions.ts` — `askDialog`, `persistSettings`
  - `src/lib/macros.ts` — `loadMacros`
  - `src-tauri/src/lib.rs` — `app_data_path`
- Tests: none
- Docs: `docs/settings.md`

**As a** Quarry user whose configuration has drifted
**I want** to put every setting back to its default, and to get at the files Quarry keeps
**So that** I can start clean or back up my configuration

```gherkin
Scenario: SET-005.1 Reset all asks first
  When I click "Reset all to defaults" in the Data section
  Then a dialog asks "Reset all settings?" with a "Reset all" button
  And nothing has changed yet

Scenario: SET-005.2 Confirming resets every setting
  Given the theme is Dark, the font size is 20 and the Macros folder is D:\macros
  When I confirm "Reset all"
  Then the theme is System, the font size is 14 and the Macros folder is the default one
  And the open documents show the default font size at once
  And a toast says "Settings reset to defaults"
  And the "Font size" row offers "Use previous setting (20)"

Scenario: SET-005.3 Cancelling changes nothing
  Given the font size is 20
  When I cancel the "Reset all settings?" dialog
  Then the font size is still 20

Scenario: SET-005.4 Open settings folder
  When I click "Open settings folder"
  Then Windows File Explorer opens showing %APPDATA%\com.quarry.app
```

## SET-006: Theme, window material and menu bar position

- Status: draft
- Commands: `view.toggleTheme`
- Files:
  - `src/components/panels/SettingsPanel.tsx` — Appearance rows "Theme", "Menu bar", "Mica material"
  - `src/App.tsx` — `useTheme` (`data-theme` on the root element, follows the Windows colour scheme while System, native window theme, `data-mica`)
  - `src/lib/commands.ts` — `view.toggleTheme` (switches between Light and Dark from whatever is shown)
  - `src/styles/tokens.css` — light and `[data-theme="dark"]` variables
  - `src/components/TitleBar.tsx` — layout per `menuPosition`
  - `src/components/MenuBar.tsx` — menu bar, shown by Alt / F10 when hidden
- Tests: none
- Docs: `docs/settings.md`, `docs/editing.md`

**As a** Quarry user
**I want** to choose light or dark colours, the window background and where the menus sit
**So that** the application fits my desktop and my habits

```gherkin
Scenario: SET-006.1 Pick a theme
  Given the theme is System and Windows uses light colours
  When I choose "Dark" on the "Theme" row
  Then the whole window, including the title bar, switches to dark colours at once

Scenario: SET-006.2 System follows Windows live
  Given the theme is System
  When I switch Windows from light to dark app mode
  Then Quarry switches to dark colours without a restart

Scenario: SET-006.3 Toggle Light/Dark Theme leaves System mode
  Given the theme is System and Quarry currently shows dark colours
  When I run View › Toggle Light/Dark Theme
  Then Quarry shows light colours and the "Theme" row shows Light
  And the choice is saved

Scenario: SET-006.4 Mica material
  Given "Mica material" is on
  When I turn it off
  Then the window background becomes opaque

Scenario Outline: SET-006.5 Menu bar position
  When I choose "<choice>" on the "Menu bar" row
  Then <result>

  Examples:
    | choice    | result                                                                |
    | Title bar | the menus sit in the title bar next to the Quarry mark                |
    | Top       | the menus get their own row below the title bar                       |
    | Hidden    | no menus are shown until I press Alt or F10                           |
```

## SET-007: Editor font size and font family

- Status: draft
- Commands: `view.zoomIn`, `view.zoomInPlus`, `view.zoomOut`, `view.zoomReset`
- Files:
  - `src/components/panels/SettingsPanel.tsx` — "Font size" row, `FontFamilyField` (`FONT_CHOICES`, only installed fonts listed, "Custom…"), `fontListFor`, `firstFontFamily`, `fontMissing`, `fontInstalled` (width measurement, since WebView2 reports every font as available)
  - `src/lib/commands.ts` — `view.zoomIn` (max 40), `view.zoomInPlus` (hidden alias on Ctrl+Plus), `view.zoomOut` (min 8), `view.zoomReset` (14)
  - `src/editor/cmSetup.ts` — `fontTheme` via `settingsReconfigure`
  - `src/components/Select.tsx` — the font list
- Tests: `src/__tests__/ui.test.ts`
- Docs: `docs/settings.md`, `docs/keyboard-shortcuts.md`

**As a** Quarry user
**I want** to choose the editor's font and size
**So that** code is comfortable to read on my screen

```gherkin
Scenario: SET-007.1 Set the font size
  When I type 18 in "Font size" and press Enter
  Then the editor text is drawn at 18 px

Scenario: SET-007.2 Zoom shortcuts change the same setting
  Given the font size is 14
  When I press Ctrl+=
  Then the font size is 15 and the "Font size" field shows 15
  When I press Ctrl+-
  Then the font size is 14
  Given the font size is 22
  When I press Ctrl+0
  Then the font size is 14

Scenario: SET-007.3 Zoom stops at the limits
  Given the font size is 40
  When I press Ctrl+=
  Then the font size stays 40
  Given the font size is 8
  When I press Ctrl+-
  Then the font size stays 8

Scenario: SET-007.4 Pick an installed font
  Given Consolas is installed and Iosevka is not
  When I open the "Editor font family" list
  Then it offers "Default (Cascadia Code)", "Consolas" and "Custom…", and does not offer "Iosevka"
  When I pick "Consolas"
  Then the editor uses Consolas
  And the stored value is "Consolas", monospace

Scenario: SET-007.5 Custom font list
  When I pick "Custom…"
  Then a text box appears under the list holding the current font list
  When I type "My Font", Consolas, monospace and press Enter
  Then the editor uses the first of those fonts that is installed

Scenario: SET-007.6 Warning for a font that is not installed
  When I enter the custom list "No Such Font", monospace
  Then the row's hint reads: Font "No Such Font" not found; falling back to the next family

Scenario: SET-007.7 A hand-written value opens in Custom
  Given the stored font family is not the default and not one of the listed fonts
  When I open Settings
  Then the list shows "Custom…" and the text box shows the stored value
```

## SET-008: Editor behaviour settings

- Status: draft
- Commands: `view.toggleWrap`, `view.toggleWhitespace`, `view.setTabSize`
- Files:
  - `src/components/panels/SettingsPanel.tsx` — Editor section rows (`tabSize`, `insertSpaces`, `wordWrap`, `lineNumbers`, `highlightActiveLine`, `bracketMatching`, `autoCloseBrackets`, `renderWhitespace`, `defaultEol`)
  - `src/editor/cmSetup.ts` — `settingsReconfigure` (compartments for line numbers, wrap, whitespace, indent, active line, brackets, close brackets)
  - `src/editor/manager.ts` — `applySettings`
  - `src/lib/commands.ts` — `view.toggleWrap` (Alt+Z), `view.toggleWhitespace`, `view.setTabSize` (1–16, or opens the status-bar picker when run without a size)
  - `src/components/StatusBar.tsx` — tab-size picker that runs `view.setTabSize`
- Tests: none
- Docs: `docs/settings.md`, `docs/keyboard-shortcuts.md`

**As a** developer
**I want** to set indentation, wrapping, gutters and bracket helpers once for all documents
**So that** every file I open behaves the way I type

```gherkin
Scenario: SET-008.1 Tab size and Insert spaces
  Given "Tab size" is 4 and "Insert spaces" is on
  When I press Tab at the start of a line
  Then 4 spaces are inserted
  When I set "Tab size" to 2 and turn "Insert spaces" off, then press Tab at the start of a line
  Then one tab character is inserted and it is drawn 2 columns wide

Scenario: SET-008.2 Word wrap from Settings or Alt+Z
  Given "Word wrap" is off
  When I press Alt+Z in the editor
  Then long lines wrap and the "Word wrap" switch in Settings is on
  And the change is saved

Scenario: SET-008.3 Render whitespace
  When I run "Toggle Render Whitespace"
  Then spaces, tabs and trailing whitespace are drawn in the editor
  And the "Render whitespace" switch is on

Scenario Outline: SET-008.4 Display and typing switches
  When I turn "<setting>" off
  Then <effect>

  Examples:
    | setting                        | effect                                                         |
    | Line numbers                   | the line-number gutter is hidden                               |
    | Highlight active line          | the line with the cursor is no longer tinted                   |
    | Bracket matching               | the bracket matching the one at the cursor is not highlighted  |
    | Auto-close brackets and quotes | typing ( inserts only (                                        |

Scenario: SET-008.5 Default line endings apply to new files only
  Given "Default line endings" is CRLF and a tab with LF endings is open
  When I choose "LF" and create a new file
  Then the new file uses LF
  And the already open tab keeps its own line endings

Scenario: SET-008.6 Change the tab size from the status bar
  When I pick 8 in the status bar's tab-size picker
  Then "Tab size" in Settings is 8

Scenario: SET-008.7 The tab-size command without a size opens the picker
  When I run "Change Tab Size…" from the command palette
  Then the status bar's tab-size picker opens and the tab size is unchanged until I pick a value
```

## SET-009: Number fields, switches and segmented choices

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `NumberField` (commit on blur / Enter, clamp, `invalid` state), `Switch` (`role="switch"`), `Segmented` (`role="radiogroup"`, arrow keys, roving tab stop), `TextField` (commit on blur / Enter, re-syncs from the store), `LabelCtx` (`aria-labelledby`)
  - `src/styles/app.css` — `.field-row`, `.switch`, `.segmented`, `.input.number.invalid`
- Tests: none
- Docs: `docs/settings.md`

**As a** Quarry user, with or without a mouse
**I want** the controls in Settings to accept free typing, reject impossible values and work from the keyboard
**So that** I cannot put the editor into a broken state by mistyping

```gherkin
Scenario: SET-009.1 A number is applied on Enter or when I leave the field
  Given "Font size" shows 14
  When I clear the field and type 1 and then 6
  Then the font size is still 14 while I type
  When I press Enter
  Then the font size is 16

Scenario: SET-009.2 An out-of-range number is clamped and flagged
  When I type 99 in "Tab size" and press Enter
  Then the field shows 16 and the tab size is 16
  And the field is marked invalid with the tooltip "Clamped to 1–16"

Scenario: SET-009.3 A decimal is rounded
  When I type 2.6 in "Pretty-print indent" and leave the field
  Then the field shows 3 and is marked as clamped

Scenario: SET-009.4 An empty field puts the old value back
  Given "Maximum open tabs" is 50
  When I clear the field and leave it
  Then the field shows 50 and nothing changes

Scenario Outline: SET-009.5 Ranges
  When I enter a value in "<setting>"
  Then it is kept within <min> to <max>

  Examples:
    | setting                   | min | max     |
    | Font size                 | 8   | 40      |
    | Tab size                  | 1   | 16      |
    | Maximum open tabs         | 1   | 1000    |
    | Large-file threshold (MB) | 1   | 4096    |
    | Pretty-print indent       | 1   | 8       |
    | Find & replace history    | 1   | 1000000 |

Scenario: SET-009.6 Segmented choices with the arrow keys
  Given focus is on "System" in the "Theme" row
  When I press ArrowRight
  Then "Light" is chosen, applied and focused
  When I press ArrowLeft twice
  Then "Dark" is chosen, because the choice wraps around
  And only the chosen option of the row is a Tab stop

Scenario: SET-009.7 Switches are announced by their row label
  When a screen reader reaches the switch on the "Word wrap" row
  Then it is announced as the switch "Word wrap" with its on or off state
```

## SET-010: Tab limit, large-file and session settings

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — "Tabs and panels" and "Files" sections (`maxOpenTabs`, `largeFileThresholdMb`, `bigHighlight`, `restoreSession`)
  - `src/lib/tabLimit.ts` — `makeRoom` / `planRoom` read `maxOpenTabs`
  - `src/lib/actions.ts` — `openPath` (threshold decides large-file mode), `restoreSession`, `needsSavePromptOnExit`
  - `src/lib/bigHighlight.ts` — colours used when `bigHighlight` is on
  - `src/lib/types.ts` — defaults 50, 32, on, on
- Tests: `src/__tests__/tabLimit.test.ts`, `src/__tests__/paths.test.ts`
- Docs: `docs/settings.md`, `docs/large-files.md`

**As a** Quarry user who opens many and very large files
**I want** to set how many tabs stay open, when a file counts as large, and whether my session comes back
**So that** Quarry stays fast and starts the way I left it

```gherkin
Scenario: SET-010.1 Maximum open tabs
  Given "Maximum open tabs" is 3 and three unmodified tabs are open
  When I open a fourth file
  Then Quarry asks before closing the least recently used unmodified tab

Scenario: SET-010.2 Large-file threshold
  Given "Large-file threshold (MB)" is 32
  When I open a 40 MB file
  Then it opens in large-file mode
  Given I set the threshold to 64
  When I open the same 40 MB file in a new tab
  Then it opens as an ordinary text tab

Scenario: SET-010.3 Colours in large-file mode
  Given a 2 GB JSON file is open in large-file mode with colours
  When I turn "Colours in large-file mode" off
  Then its lines are drawn in the plain text colour

Scenario: SET-010.4 Restore session on start
  Given "Restore session on start" is off and a folder and two files are open
  When I restart Quarry
  Then no folder and no tabs are reopened
```

## SET-011: Scripts and macros folders

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `FolderRow` (shows the folder in use, default path typed back in stores empty, "Browse…", hint suffix "· default folder"), `changeFolder`
  - `src/lib/scripting.ts` — `scriptsDir` (resolves and reports an unusable folder)
  - `src/lib/macros.ts` — `loadMacros("switch")` (unsaved-macros guard, may undo the change)
  - `src/lib/ipc.ts` — `appData.path`
  - `src/lib/actions.ts` — `sanitizeSettings` (folder values)
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/settings.md`, `docs/scripting.md`, `docs/macros.md`

**As a** Quarry user who keeps scripts and macros in my own folders
**I want** to point Quarry at those folders
**So that** I can keep them in a repository or a synced drive

```gherkin
Scenario: SET-011.1 The field shows the folder in use
  Given the Scripts folder setting is empty
  When I open Settings
  Then the "Scripts folder" field shows the scripts folder inside %APPDATA%\com.quarry.app
  And the row's hint ends with "default folder"

Scenario: SET-011.2 Choose a folder with Browse
  When I click "Browse…" on the "Scripts folder" row and pick D:\my-scripts
  Then the field shows D:\my-scripts
  And the Scripts panel lists the .js files of D:\my-scripts

Scenario: SET-011.3 Typing the default path keeps the setting empty
  Given the Macros folder is D:\macros
  When I type the default macros folder path, with or without a trailing backslash and in any letter case, and press Enter
  Then the setting is stored as empty
  And "Restore default" on that row is disabled

Scenario: SET-011.4 Changing the macros folder reloads the macros
  Given the Macros panel lists the macros of the default folder
  When I set "Macros folder" to D:\team-macros
  Then the Macros panel lists the .macro.json files of D:\team-macros
```

## SET-012: Find and replace history size

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — "Find & replace history" row (Unlimited / Limit, number field, default limit 500), `clearSearchHistory`
  - `src/lib/searchHistory.ts` — `applyHistoryLimit`, `clearHistory`
  - `src/lib/types.ts` — `searchHistoryLimit` (0 = unlimited)
- Tests: none
- Docs: `docs/settings.md`, `docs/find-and-replace.md`

**As a** Quarry user who searches a lot
**I want** to cap or wipe the remembered find and replace entries
**So that** the history stays useful and private

```gherkin
Scenario: SET-012.1 Unlimited by default
  Given a fresh installation
  When I open Settings
  Then "Find & replace history" shows "Unlimited" and no number field

Scenario: SET-012.2 Switch to a limit
  When I choose "Limit"
  Then a number field appears showing 500
  When I enter 20
  Then only the 20 newest find entries and the 20 newest replace entries are kept, at once

Scenario: SET-012.3 Back to unlimited
  Given the limit is 20
  When I choose "Unlimited"
  Then the number field disappears and entries are no longer dropped

Scenario: SET-012.4 Clear the history
  When I click "Clear find & replace history"
  Then a dialog asks "Clear find & replace history?" with a "Clear" button
  When I confirm
  Then the find bar and Find in Files offer no remembered entries
  And a toast says "Find & replace history cleared"
  And cancelling the dialog instead keeps every entry
```

## SET-013: Confirmation and update-check switches

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — rows "Confirm script & macro runs" (`confirmRuns`) and "Check for updates on start" (`autoUpdateCheck`)
  - `src/lib/commands.ts` — `confirmRun` reads `confirmRuns`
  - `src/App.tsx` — start-up update check gated by `autoUpdateCheck`
  - `src/lib/types.ts` — both default to on
- Tests: none
- Docs: `docs/settings.md`

**As a** Quarry user
**I want** to decide whether Quarry asks before running scripts and macros and whether it looks for updates by itself
**So that** it interrupts me only as much as I want

```gherkin
Scenario: SET-013.1 Confirm script and macro runs
  Given "Confirm script & macro runs" is on
  When I start a macro from the menu
  Then Quarry asks before it runs
  Given I turn the switch off
  When I start the same macro from the menu
  Then it runs without a question

Scenario: SET-013.2 Check for updates on start
  Given "Check for updates on start" is off
  When Quarry starts and a newer release exists
  Then no update dialog appears
  And Help › Check for Updates… still finds the release
```

## SET-014: Code intelligence settings

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `CodeIntelSection` (master switch, one row per server from `SERVERS`, installed / not installed line, own command box, "Install…", per-server switch, "Restart language servers", re-detect on window focus)
  - `src/lib/lsp.ts` — `restartServers`
  - `src/lib/lspServers.ts` — `SERVERS`, `splitCommand`
  - `src/lib/lspInstall.ts` — `installServer`
  - `src-tauri/src/lsp.rs` — `lsp_which`
  - `src/lib/actions.ts` — `sanitizeSettings` (`lspEnabled`, `lspDisabled`, `lspCommands`)
- Tests: none
- Docs: `docs/settings.md`, `docs/code-intelligence.md`

**As a** developer
**I want** to turn language servers on or off and choose which installation each one uses
**So that** I get suggestions and problems only for the languages I care about, from the tools I trust

```gherkin
Scenario: SET-014.1 Each server shows whether it is installed
  Given "Code intelligence" is on
  When I open Settings
  Then every supported language server has a row reading either "Installed" with its path or "Not installed"
  And a server that is not installed has an "Install…" button

Scenario: SET-014.2 The master switch hides the server rows
  When I turn "Code intelligence" off
  Then the server rows and "Restart language servers" disappear
  And every running language server is stopped

Scenario: SET-014.3 Turn one server off
  When I turn off the switch on one server's row
  Then that language gets no suggestions, hover or problems
  And the other servers are restarted and keep working

Scenario: SET-014.4 Use my own command
  When I type a full path with arguments into a server's command box and leave the box
  Then the servers restart and that server is started with my command
  And its row shows whether that program was found
  When I empty the box again and leave it
  Then the default command is used

Scenario: SET-014.5 Restart language servers
  When I click "Restart language servers"
  Then the button is disabled until every server has been restarted

Scenario: SET-014.6 The filter covers servers
  When I type a server's language name in the filter box
  Then that server's row is shown
```

## SET-015: Claude Code settings

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `ClaudeSection` (`setEnabled` closes Claude tabs after asking, location row with detection hint and "Browse…", `CLAUDE_MODELS`, permissions segmented control)
  - `src/lib/claude.ts` — `detectClaude`
  - `src/lib/actions.ts` — `closeDocument`, `askDialog`, `sanitizeSettings` (`claudeEnabled`, `claudePath`, `claudeModel`, `claudePermissionMode`)
  - `src/components/Select.tsx` — the model list
- Tests: none
- Docs: `docs/settings.md`, `docs/claude-code.md`

**As a** developer who does, or does not, use Claude Code
**I want** to switch the integration on or off and set its executable, model and permission mode
**So that** Quarry shows only what I use and Claude works the way I expect

```gherkin
Scenario: SET-015.1 Turning Claude Code off hides its settings
  Given no Claude Code tabs are open
  When I turn the "Claude Code" switch off
  Then the rows "Claude Code location", "Model" and "Permissions" disappear
  And the Explorer's right-click menu no longer offers "Work with Claude Code Here"

Scenario: SET-015.2 Turning it off with Claude tabs open asks first
  Given 2 Claude Code tabs are open
  When I turn the "Claude Code" switch off
  Then a dialog asks "Turn off Claude Code?" and says the 2 Claude Code tabs close
  When I click "Turn off"
  Then both tabs are closed and the switch is off

Scenario: SET-015.3 Cancelling keeps it on
  Given 1 Claude Code tab is open
  When I turn the switch off and cancel the dialog
  Then the tab stays open and the switch stays on

Scenario: SET-015.4 The location row reports what was found
  Given Claude Code is installed and "Claude Code location" is empty
  When I open Settings
  Then the row's hint first reads "Looking for Claude Code…" and then shows the version and the path found

Scenario: SET-015.5 Claude Code is not found
  Given "Claude Code location" points at a file that does not exist
  When I open Settings
  Then the row's hint ends with "Install it from claude.com/claude-code, or browse to claude.exe"

Scenario: SET-015.6 A pasted path loses its quotes
  When I paste "C:\Tools\claude.exe" including the quotes into "Claude Code location" and press Enter
  Then the stored value is C:\Tools\claude.exe without quotes

Scenario: SET-015.7 Model
  When I open the "Model" list
  Then it offers Default, Opus, Sonnet and Haiku
  And a model name already stored that is not one of those is offered as a fifth entry

Scenario: SET-015.8 Permissions
  Given "Permissions" is "Auto-accept edits"
  When I choose "Ask first"
  Then the hint reads "Claude asks before every edit and command"
```

## SET-016: JSON pretty-print indent

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — JSON section, "Pretty-print indent" (`jsonIndent`, 1–8)
  - `src/lib/types.ts` — default 2
  - `src/lib/format.ts` — JSON formatting reads the setting
- Tests: none
- Docs: `docs/settings.md`

**As a** developer formatting JSON
**I want** to choose the indent width used by Format
**So that** formatted files match my project's style

```gherkin
Scenario: SET-016.1 Format uses the chosen indent
  Given "Pretty-print indent" is 4 and a tab holds {"a":{"b":1}}
  When I run "JSON: Format / Pretty-print"
  Then "a" is indented by 4 spaces and "b" by 8

Scenario: SET-016.2 The default is 2
  Given a fresh installation
  When I open Settings
  Then "Pretty-print indent" shows 2
```

## SET-017: Themed dropdown lists

- Status: draft
- Commands: none
- Files:
  - `src/components/Select.tsx` — `Select` (combobox button, portalled listbox, `onKey`, type-ahead with a 700 ms window, closes on outside mouse-down / resize / outside scroll / blur), `placeFlyout` (flips up, clamps to the window, max height 320), `typeAheadIndex`, option groups and hints
  - `src/styles/app.css` — `.select-btn`, `.select-flyout`, `.select-option`, `.select-group`
- Tests: `src/__tests__/ui.test.ts`
- Docs: none

**As a** Quarry user
**I want** dropdown lists that follow the application theme and work fully from the keyboard
**So that** choosing a value looks and behaves the same everywhere, in light and dark

```gherkin
Scenario: SET-017.1 Open, move and choose with the keyboard
  Given focus is on a closed dropdown whose value is the second of five options
  When I press ArrowDown
  Then the list opens with the second option highlighted and ticked
  When I press ArrowDown and then Enter
  Then the third option is chosen, the list closes and focus is back on the dropdown

Scenario: SET-017.2 Other keys in an open list
  Given the list is open
  When I press End
  Then the last option is highlighted
  When I press Home
  Then the first option is highlighted
  And PageDown and PageUp move the highlight by 8 options
  And Space chooses the highlighted option like Enter

Scenario: SET-017.3 Escape closes without changing the value
  Given the list is open and I moved the highlight to another option
  When I press Escape
  Then the list closes and the value is unchanged

Scenario: SET-017.4 Tab closes the list and moves on
  Given the list is open
  When I press Tab
  Then the list closes, the value is unchanged and focus moves to the next control

Scenario: SET-017.5 Type-ahead
  Given a closed dropdown with the options "Cascadia Code", "Consolas" and "Courier New", showing "Cascadia Code"
  When I type "c"
  Then the value becomes "Consolas" without the list opening
  When I type "cou" quickly while the list is open
  Then "Courier New" is highlighted and the value changes only when I press Enter

Scenario: SET-017.6 Mouse
  When I click the dropdown and then click an option
  Then that option is chosen and the list closes
  When I open the list again and press the mouse outside it
  Then the list closes and the value is unchanged

Scenario: SET-017.7 The list stays inside the window
  Given a dropdown near the bottom edge of the window
  When I open it
  Then the list opens above the dropdown
  And it is never wider than the window allows, never narrower than the dropdown or 120 px, and scrolls when taller than 320 px

Scenario: SET-017.8 The list follows the theme
  Given the dark theme
  When I open any dropdown
  Then its list is drawn with the dark theme's colours
```

## SET-018: Help "i" icons

- Status: draft
- Commands: none
- Files:
  - `src/components/InfoTip.tsx` — `InfoTip` (hover shows, click pins, Escape / outside click / second click dismisses, positioned below or above the icon and kept 8 px inside the window)
  - `src/components/panels/SearchPanel.tsx` — the one current use ("Search tips")
  - `src/styles/app.css` — `.info-tip`, `.tip-btn`
- Tests: none
- Docs: none

**As a** Quarry user unsure what an option does
**I want** a small "i" next to it that explains it
**So that** I can get help in place, by mouse or keyboard, without opening the documentation

```gherkin
Scenario: SET-018.1 Hover shows the help text
  When I point at an "i" icon
  Then its help text appears next to it
  When I move the pointer away from the icon and the text
  Then the help text disappears

Scenario: SET-018.2 Click keeps it open
  When I click an "i" icon and move the pointer away
  Then the help text stays open

Scenario: SET-018.3 Dismiss a pinned tip
  Given a help text pinned by a click
  When I click the "i" again, click anywhere else, or press Escape
  Then the help text closes
  And Escape closes only the help text, not the panel behind it

Scenario: SET-018.4 Keyboard
  Given focus is on an "i" icon
  When I press Enter or Space
  Then the help text opens and stays open

Scenario: SET-018.5 The text stays inside the window
  Given an "i" icon near the bottom-right corner of the window
  When its help text opens
  Then the text is shown above the icon and entirely inside the window
```
