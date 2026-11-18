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
  - `src/components/panels/SettingsPanel.tsx` — `SettingsPanel` (focus and scroll-to-top on open, filter box, Escape clears the filter), `SECTIONS`, `rowMatches`, `Section`, `Group`, `Row` (`keywords`, `info` are searched too), `ActionRow`
  - `src/components/MatchText.tsx` — `MatchText`, `splitMatches` (the matched text is highlighted)
  - `src/components/Sidebar.tsx` — Settings width set to `SETTINGS_SHARE` of the window on every open (at least 200 px)
  - `src/lib/panels.ts` — `SETTINGS_SHARE` = 0.35, `showPanel`, `isPanelShown`, `panelWidth`
  - `src/lib/commands.ts` — `view.settings`
  - `src/components/MenuBar.tsx` — Tools › Settings and View › Panels › Settings
  - `src/components/SidebarRail.tsx` — the gear button below the other panel icons
  - `src/styles/app.css` — `.settings-body`, `.settings-top`, `.settings-filter`, `.match-hl`, `.settings-empty`
- Tests: `src/__tests__/ui.test.ts`, `src/__tests__/settingsPanel.test.tsx`
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
  And the sections are Appearance, Editor, Files & tabs, Find, Languages, Terminal, Git, Scripts & macros, Keyboard shortcuts and App, in that order

Scenario: SET-001.2 Settings always opens at 35% of the window width
  Given the window is 2000 px wide and I dragged the Settings panel to 300 px before closing it
  When I open Settings again
  Then the panel is 700 px wide
  And I can still drag it to another width, which lasts until it is closed

Scenario: SET-001.3 Filter by label, hint, other words, or section and group name
  Given the Settings panel is open
  When I type "wrap" in the filter box
  Then only the "Word wrap" row is shown, with "wrap" highlighted
  When I type "ALT+Z" instead
  Then the "Word wrap" row is shown, because its hint matches, ignoring case
  When I type "indent" instead
  Then "Tab size", "Insert spaces" and "Pretty-print indent" are shown, because "indent" is one of their search words
  When I type "json" instead
  Then every row of the Languages section's JSON group is shown
  And a section or group with no row left is hidden

Scenario: SET-001.4 Nothing matches
  When I type "zzzz" in the filter box
  Then no rows are shown and the panel says No settings match “zzzz”

Scenario: SET-001.5 Clear the filter
  Given the filter box contains "font"
  When I press Escape in the filter box, or click the "Clear filter" button
  Then the filter is empty and every row is shown again

Scenario: SET-001.6 Other ways in
  Given the Settings panel is closed
  When I choose Tools › Settings, View › Panels › Settings, or click the gear at the bottom of the side rail
  Then the Settings panel opens
```

## SET-002: Changes apply at once and are saved automatically

- Status: verified
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

- Status: verified
- Commands: none
- Files:
  - `src/lib/actions.ts` — `loadSettings` (merge over `DEFAULT_SETTINGS`, `.bak` copy and warning toast when unreadable), `sanitizeSettings` (numbers clamped, enums and `BOOLEAN_SETTINGS` checked, empty `fontFamily` replaced), `clampInt`
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

Scenario: SET-003.7 Switches that are not true or false, and an empty font, fall back to the default
  Given settings.json contains "wordWrap": "yes", "restoreSession": null, "mica": "off" and "fontFamily": ""
  When Quarry starts
  Then word wrap is off, session restore and Mica are on, and the editor font is the default font list
```

## SET-004: Use previous setting and Restore default on each row

- Status: verified
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
  - `src/components/panels/SettingsPanel.tsx` — section App: `resetAll` (confirmation, `DEFAULT_SETTINGS`, `loadMacros("switch")`, `restartServers` when a code-intelligence setting changes, toast) on the "Reset all to defaults" row, "Open settings folder" row (`appData.path`, `revealItemInDir`, falls back to a toast with the path)
  - `src/lib/actions.ts` — `askDialog`, `persistSettings`
  - `src/lib/macros.ts` — `loadMacros`
  - `src/lib/lsp.ts` — `restartServers`
  - `src-tauri/src/lib.rs` — `app_data_path`
- Tests: none
- Docs: `docs/settings.md`

**As a** Quarry user whose configuration has drifted
**I want** to put every setting back to its default, and to get at the files Quarry keeps
**So that** I can start clean or back up my configuration

```gherkin
Scenario: SET-005.1 Reset all asks first
  When I click "Reset all…" on the "Reset all to defaults" row of the App section
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
  When I click "Open" on the "Open settings folder" row
  Then Windows File Explorer opens showing %APPDATA%\com.quarry.app

Scenario: SET-005.5 Reset all reconnects the language servers
  Given code intelligence is on with the Rust language server turned off in Settings
  When I confirm "Reset all"
  Then the language servers are restarted and open Rust files get code intelligence again
  And when no code-intelligence setting changed, running language servers are left alone
```

## SET-006: Theme, window material and menu bar position

- Status: verified
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

- Status: verified
- Commands: `view.zoomIn`, `view.zoomInPlus`, `view.zoomOut`, `view.zoomReset`
- Files:
  - `src/components/panels/SettingsPanel.tsx` — Appearance › Editor font: "Font size" row, "Font family" row with `FontFamilyField` (`FONT_CHOICES`, only installed fonts listed, "Custom…"), `fontListFor`, `firstFontFamily`, `fontMissing`, `fontInstalled` (width measurement, since WebView2 reports every font as available)
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

- Status: verified
- Commands: `view.toggleWrap`, `view.toggleWhitespace`, `view.setTabSize`
- Files:
  - `src/components/panels/SettingsPanel.tsx` — Editor section: groups Typing (`tabSize`, `insertSpaces`, `autoCloseBrackets`) and Display (`wordWrap`, `lineNumbers`, `highlightActiveLine`, `bracketMatching`, `renderWhitespace`); `defaultEol` in Files & tabs
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

- Status: verified
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

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — "Files & tabs" section (`restoreSession`, `maxOpenTabs`, group Large files: `largeFileThresholdMb`, `bigHighlight`)
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
  - `src/components/panels/SettingsPanel.tsx` — `FolderRow` (shows the folder in use with its middle shortened and the full path in the tooltip, a click turns it into a text box, default path typed back in stores empty, "Browse…", hint suffix "· default folder"), `splitPath`, `changeFolder`
  - `src/lib/scripting.ts` — `scriptsDir` (resolves and reports an unusable folder)
  - `src/lib/macros.ts` — `resolveFolder` (creates a missing folder; one that can't be created resets the setting to empty with a warning), `loadMacros("switch")` (unsaved-macros guard; Cancel puts back the folder loaded before)
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
  And when the panel is too narrow for the whole path, its middle is cut short with "…" and its last folder stays visible
  And pointing at the field shows the whole path
  And the row's hint ends with "default folder"

Scenario: SET-011.2 Choose a folder with Browse
  When I click "Browse…" on the "Scripts folder" row and pick D:\my-scripts
  Then the field shows D:\my-scripts
  And the Scripts panel lists the .js files of D:\my-scripts

Scenario: SET-011.3 Typing the default path keeps the setting empty
  Given the Macros folder is D:\macros
  When I click the "Macros folder" field, type the default macros folder path, with or without a trailing backslash and in any letter case, and press Enter
  Then the setting is stored as empty
  And "Restore default" on that row is disabled

Scenario: SET-011.4 Changing the macros folder reloads the macros
  Given the Macros panel lists the macros of the default folder
  When I set "Macros folder" to D:\team-macros
  Then the Macros panel lists the .macro.json files of D:\team-macros

Scenario: SET-011.5 A folder that can't be used falls back to the default
  Given Z: is not a drive on this PC
  When I set "Scripts folder" to Z:\scripts
  Then the setting goes back to empty and the field shows the default scripts folder
  And a warning says 'Scripts folder "Z:\scripts" is not usable (…). The setting was reset to the default folder.'

Scenario: SET-011.6 Cancelling a macros folder change keeps the previous folder
  Given the Macros folder is D:\macros and the Macros panel has 1 unsaved macro
  When I set "Macros folder" to D:\team-macros and answer Cancel to "Switch macros folder?"
  Then the Macros folder is D:\macros again, not the default
  And a notice says "Macros folder change cancelled."

Scenario: SET-011.7 Type a folder
  When I click the "Scripts folder" field
  Then it becomes a text box holding the whole path, with the cursor in it
  When I type D:\my-scripts and press Enter, or leave the box
  Then the setting is D:\my-scripts and the field shows it shortened again
  When I click the field again and press Escape instead
  Then the folder is unchanged
```

## SET-012: Find and replace history size

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — section Find: "Find & replace history" row (Unlimited / Limit, number field, default limit 500), "Clear find & replace history" row (`clearSearchHistory`)
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
  When I click "Clear…" on the "Clear find & replace history" row
  Then a dialog asks "Clear find & replace history?" with a "Clear" button
  When I confirm
  Then the find bar and Find in Files offer no remembered entries
  And a toast says "Find & replace history cleared"
  And cancelling the dialog instead keeps every entry
```

## SET-013: Confirmation and update-check switches

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — rows "Confirm script & macro runs" (`confirmRuns`, section Scripts & macros) and "Check for updates on start" (`autoUpdateCheck`, section App)
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
  - `src/components/panels/SettingsPanel.tsx` — `CodeIntelGroup` in Languages (master switch, one compact line per server from `SERVERS`: status dot, Installed / Not installed, "Install…", per-server switch; opening the line shows the path and the own command box; "Restart language servers" row, re-detect on window focus)
  - `src/lib/lsp.ts` — `restartServers`
  - `src/lib/lspServers.ts` — `SERVERS`, `splitCommand`
  - `src/lib/lspInstall.ts` — `installServer`
  - `src-tauri/src/lsp.rs` — `lsp_which`
  - `src/lib/actions.ts` — `sanitizeSettings` (`lspEnabled`, `lspDisabled`, `lspCommands`)
- Tests: `src/__tests__/settingsPanel.test.tsx`
- Docs: `docs/settings.md`, `docs/code-intelligence.md`

**As a** developer
**I want** to turn language servers on or off and choose which installation each one uses
**So that** I get suggestions and problems only for the languages I care about, from the tools I trust

```gherkin
Scenario: SET-014.1 Each server shows whether it is installed
  Given "Code intelligence" is on
  When I open Settings › Languages
  Then every supported language server has a one-line row with a status dot reading "Installed", "Not installed" or "Looking…"
  And pointing at an installed server's name shows its path
  And a server that is not installed has an "Install…" button
  When I click a server's name
  Then the row opens and shows the path of the program found ("Not found on PATH" when there is none) and the command box
  When I click the name again
  Then the row closes

Scenario: SET-014.2 The master switch hides the server rows
  When I turn "Code intelligence" off
  Then the server rows and the "Restart language servers" row disappear
  And every running language server is stopped

Scenario: SET-014.3 Turn one server off
  When I turn off the switch on one server's row
  Then that language gets no suggestions, hover or problems
  And the other servers are restarted and keep working

Scenario: SET-014.4 Use my own command
  When I open a server's row, type a full path with arguments into its command box and leave the box
  Then the servers restart and that server is started with my command
  And its row shows whether that program was found
  When I empty the box again and leave it
  Then the default command is used

Scenario: SET-014.5 Restart language servers
  When I click "Restart" on the "Restart language servers" row
  Then the button is disabled until every server has been restarted

Scenario: SET-014.6 The filter covers servers
  When I type a server's language name in the filter box
  Then that server's row is shown
```

## SET-016: JSON pretty-print indent

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — Languages › JSON, "Pretty-print indent" (`jsonIndent`, 1–8)
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

- Status: verified
- Commands: none
- Files:
  - `src/components/Select.tsx` — `Select` (combobox button, portalled listbox, `onKey` (Escape on an open list calls `preventDefault`), type-ahead with a 700 ms window, closes on outside mouse-down / resize / outside scroll / blur), `placeFlyout` (flips up, clamps to the window, max height 320), `typeAheadIndex`, option groups and hints
  - `src/styles/app.css` — `.select-btn`, `.select-flyout`, `.select-option`, `.select-group`
  - `src/components/Sidebar.tsx` — the floating panel's Escape handler skips a key a control already used (`defaultPrevented`)
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
  And a floating panel holding the dropdown (Settings, for example) stays open; a second Escape closes the panel

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

Scenario: SET-017.9 An option that cannot be chosen
  Given a dropdown one of whose options is disabled with a reason (Squash on the bottom row of the Edit History list, HISTORY-008.10)
  When I open the list
  Then that option is greyed out and its tooltip gives the reason
  And clicking it, Enter on it or typing its first letter does not choose it
```

## SET-018: Help "i" icons

- Status: verified
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

## SET-019: Git settings

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — section "Git": "Allow merging with uncommitted changes" (switch) and "Compare with Branch shows" (The two tips / Changes since split), each hint and "i" text following the current value
  - `src/lib/types.ts` — `gitMergeWithChanges` (default off), `gitCompareBranch` (default `"tips"`)
  - `src/lib/actions.ts` — `sanitizeSettings` (`gitMergeWithChanges` in `BOOLEAN_SETTINGS`; `gitCompareBranch` anything but `"split"` → `"tips"`)
- Tests: `src/__tests__/gitMerge.test.ts`, `src/__tests__/graphCompare.test.tsx`
- Docs: `docs/settings.md`, `docs/git.md`

**As a** developer
**I want** to choose how strict a merge is about my uncommitted work, and what Compare with Branch compares
**So that** git in Quarry works the way I am used to

```gherkin
Scenario: SET-019.1 The defaults are the careful ones
  Given a fresh settings file
  When I open Settings › Git
  Then "Allow merging with uncommitted changes" is off
  And "Compare with Branch shows" is "The two tips"

Scenario: SET-019.2 The hint says what the current choice does
  When I turn "Allow merging with uncommitted changes" on
  Then its hint says a merge may start while tracked files have changes
  And its "i" says git refuses a merge that would change those files, and that Abort may not bring them back exactly after a conflict
  When I turn it off again
  Then its hint says a merge only starts when every tracked file is committed, and its "i" says Abort can then always bring everything back
  When I choose "Changes since split"
  Then its hint says only what the picked branch changed since it split off is shown, and its "i" adds "As a pull request shows it."

Scenario: SET-019.3 What they change
  When I change either setting
  Then the next merge or Compare with Branch… follows it, as MERGE-008.12 and COMMITCMP-005.14 describe, with no restart

Scenario: SET-019.4 A bad value in the file
  Given settings.json has "gitCompareBranch": "sideways"
  When Quarry starts
  Then "Compare with Branch shows" is "The two tips"
```

## SET-020: Change keyboard shortcuts

- Status: draft
- Commands: `view.shortcuts`
- Files:
  - `src/components/ShortcutsView.tsx` — the Keyboard Shortcuts tab: `listedRows` (search, Changed only), sort (`sortKeyRows`), Change / Remove / Restore default buttons, double-click to change, the recording box, Restore all, the count line
  - `src/lib/shortcutsTab.ts` — `openShortcuts` (one tab, reused; takes the search text), `takePendingQuery`
  - `src/lib/keybindings.ts` — pure rules: `strokeProblem`, `checkKeys`, `withKeys`, `restoreDefault`, `captureStep`, `keyRowMatches`, `sortKeyRows`, `sanitizeKeybindings`, `vacatedKeys`
  - `src/lib/commands.ts` — `setKeyOverrides` (rebuilds the key index, sets each command's `keys`), `keyRows`, `isVacatedKey`, `setKeyCapture` / `getKeyCapture`, the store subscription at the end of `registerAllCommands`, `view.shortcuts`
  - `src/App.tsx` — mounts the tab's view; `onKey`: key presses go to the recording handler first; a vacated built-in key is swallowed inside an editor
  - `src/components/TitleBar.tsx` — the tab's keyboard icon
  - `src/components/panels/SettingsPanel.tsx` — `ShortcutsRow`, section "Keyboard shortcuts": how many are changed, "Edit shortcuts…", "Restore all", and the commands the Settings filter finds ("Show matches")
  - `src/components/MenuBar.tsx` — Tools › Keyboard Shortcuts…, Help › Change Keyboard Shortcuts…; `MENU_MNEMONICS` (letters a shortcut may not take)
  - `src/lib/store.ts`, `src/lib/types.ts` — doc kind `"shortcuts"` (not kept in the session); `Settings.keybindings` (command id → keys, "" = none; default `{}`)
  - `src/lib/actions.ts` — `sanitizeSettings` (`sanitizeKeybindings`)
  - `src/styles/app.css` — `.shortcuts-view`, `.shortcut-row`, `.shortcut-capture`
- Tests: `src/__tests__/keybindings.test.ts`, `src/__tests__/shortcutsView.test.tsx`, `src/__tests__/settingsPanel.test.tsx`
- Docs: `docs/keyboard-shortcuts.md`, `docs/settings.md`

**As a** developer coming from another editor
**I want** to give any command the keys I am used to
**So that** I do not have to relearn my shortcuts

```gherkin
Scenario: SET-020.1 The Keyboard Shortcuts tab lists every command
  When I choose Tools › Keyboard Shortcuts…
  Then a "Keyboard Shortcuts" tab opens with the cursor in its search box
  And every command of the palette is listed under its category with its keys, or "None"
  And the line at the bottom says how many commands there are and how many shortcuts are changed
  When I choose Tools › Keyboard Shortcuts… again
  Then the same tab is shown; there is never a second one
  And the tab is not reopened when Quarry restarts

Scenario: SET-020.2 Search, sort and Changed only
  When I type "duplicate" in the tab's search box
  Then "Duplicate Line Down" is listed with Ctrl+Shift+D, and "duplicate" is highlighted
  When I type "ctrl+shift+d" instead
  Then the same command is listed
  When I choose "By name" or "By keys" in the sort list
  Then the commands are listed by title, or by keys with the commands without keys last, each with its category
  When I click "Changed only"
  Then only the commands whose keys I changed are listed, and "No shortcuts changed" when there are none
  When I press Escape in the search box
  Then the search is emptied

Scenario: SET-020.3 Record new keys
  Given "Edit: Duplicate Line Down" has Ctrl+Shift+D
  When I click its Change button, or double-click its row, and press Ctrl+Alt+J
  Then the box shows "Ctrl+Alt+J" and no command runs
  When I press Enter
  Then the command's keys are Ctrl+Alt+J in the list, the Edit menu and the palette
  And pressing Ctrl+Alt+J in a document duplicates the line
  And pressing Ctrl+Shift+D in a document does nothing

Scenario: SET-020.4 A two-key shortcut
  When I click Change, press Ctrl+K, then J, then Enter
  Then the command's keys are "Ctrl+K J"

Scenario: SET-020.5 Cancel and start over
  Given I clicked Change and pressed Ctrl+Alt+J
  When I press Backspace
  Then the box is empty again and waits for keys
  When I press Escape, click outside the row, or switch to another tab
  Then recording ends and the shortcut is unchanged

Scenario: SET-020.6 Keys another command has
  Given Ctrl+S is the shortcut of Save
  When I click Change on another command and press Ctrl+S
  Then the row says Ctrl+S is the shortcut of Save and that assigning it takes it away from that command
  When I click "Assign"
  Then the other command has Ctrl+S and Save has no shortcut

Scenario: SET-020.7 Keys that are refused
  When I record K, Shift+K or Enter on its own
  Then the row says "A shortcut needs Ctrl or Alt, or a function key." and "Assign" is disabled
  When I record Ctrl+C, Ctrl+X, Ctrl+V or F10
  Then the row says what the key is kept for and "Assign" is disabled
  When I record Alt+F
  Then the row says "Alt+F opens the File menu."
  When I record Ctrl+K on its own while Ctrl+K M exists
  Then the row says Ctrl+K starts two-key shortcuts
  When I record Ctrl+S followed by X while Ctrl+S is the shortcut of Save
  Then the row says a two-key shortcut cannot start with it

Scenario: SET-020.8 Remove a shortcut
  When I click Remove on "Edit: Toggle Line Comment"
  Then it shows "None"
  And pressing Ctrl+/ in a document does nothing
  And Edit › Toggle Line Comment still works

Scenario: SET-020.9 Restore one and restore all
  Given I gave Save's Ctrl+S to another command
  When I click Restore default on Save
  Then Save has Ctrl+S again and the other command loses it
  When I click "Restore all"
  Then a dialog asks "Restore all keyboard shortcuts?"
  When I confirm
  Then every command has its built-in keys

Scenario: SET-020.10 Saved and applied at start
  Given I changed a shortcut
  When I restart Quarry
  Then the changed shortcut works and is shown in the menus
  And settings.json has it under "keybindings"

Scenario: SET-020.11 A bad value in the file
  Given settings.json has "keybindings": "x", or an entry whose value is a number
  When Quarry starts
  Then the bad value is ignored and the built-in keys apply

Scenario: SET-020.12 From Settings
  When I open Settings › Keyboard shortcuts
  Then its row says "No shortcuts changed" or how many are, with "Edit shortcuts…" (and "Restore all" when some are changed)
  When I click "Edit shortcuts…"
  Then the Keyboard Shortcuts tab opens
  When I type "duplicate line" in the Settings filter
  Then the row says how many commands match "duplicate line"
  When I click "Show matches"
  Then the Keyboard Shortcuts tab opens with "duplicate line" in its search box
```

## SET-021: Find your way around Settings

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `SECTIONS`, `Section` (heading that collapses it, one card), `Group`, `Row` (`modified` mark), `ActionRow`, the jump bar and contents column (`nav`, `jump`, `onScroll`), collapsed sections in localStorage (`quarry.settingsCollapsed`), "Modified" (`modifiedKeys`, `sameValue`), the empty message
  - `src/styles/app.css` — `.settings-top`, `.settings-chips`, `.settings-toc` (container query `settings` ≥ 700 px), `.section-head`, `.settings-card`, `.settings-group`, `.field-row.modified`
- Tests: `src/__tests__/settingsPanel.test.tsx`
- Docs: `docs/settings.md`

**As a** Quarry user looking for one setting among many
**I want** clearly separated sections I can jump to, fold away, or narrow to what I changed
**So that** I find a setting without scrolling through all of them

```gherkin
Scenario: SET-021.1 Sections are cards with groups
  When I open Settings
  Then each section has a heading and one card holding its rows, separated by lines
  And longer sections are split into named groups, such as Editor › Typing and Editor › Display
  And a row with longer help has an "i" next to its name that shows it

Scenario: SET-021.2 Jump to a section
  Given the Settings panel is narrower than 700 px
  Then a row of section buttons stays at the top under the filter box, marking the section being read
  When I click "Git"
  Then the panel scrolls so the Git section is at the top, and "Git" is marked
  Given the panel is 700 px or wider
  Then the section buttons are a contents column on the left instead
  And while the filter or Modified hides a section, its button is hidden too

Scenario: SET-021.3 Collapse a section
  When I click the "Editor" heading
  Then the Editor card folds away and the heading shows a closed arrow
  And it stays folded the next time Settings opens
  When I type in the filter box, or turn on Modified
  Then the matching rows of folded sections are shown
  When I click "Editor" in the jump bar, or the heading again
  Then the section opens

Scenario: SET-021.4 Changed settings are marked
  Given "Tab size" is 2 and every other setting has its default
  Then the "Tab size" row has an accent bar on its left edge and no other row has one
  And "Modified (1)" is shown next to the filter box
  When I click "Modified"
  Then only the "Tab size" row is shown
  And with every setting at its default the panel says "Every setting has its default value"
  When I click "Modified" again
  Then every row is shown
```
