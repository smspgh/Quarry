---
area: Code Intelligence
prefix: LSP
---

# Code Intelligence

Language servers (LSP) give text tabs suggestions, hover documentation, navigation, rename, parameter hints and live problems. Quarry starts one server per language and project folder, keeps every open tab's file in sync with it, and offers to install a missing server. User documentation: `docs/code-intelligence.md`.

## LSP-001: A language server starts for supported files

- Status: draft
- Commands: none
- Files:
  - `src/lib/lspServers.ts` — `SERVERS` (ids, extensions, commands, install lines), `serverFor`, `languageIdOf`, `pathToUri`, `uriToPath`, `uriKey`
  - `src/lib/lsp.ts` — `installLsp` (follows the tab list), `attachDoc`, `startServer` (one per server + root), `launch`, `launchOf`, `makeClient`, `transportFor`, `answerServerRequest`
  - `src-tauri/src/lsp.rs` — `lsp_start` (`.cmd` / `.bat` through `cmd.exe /d /c`, no window, `SESSION_ENV` removed), `which`, `lsp_send`, `read_message` / `frame`, `lsp:msg`
  - `src-tauri/src/writer.rs` — `ChannelWriter` (stdin written off the UI thread)
  - `src/App.tsx` — `installLsp()` at start-up
  - `src/editor/cmSetup.ts` — `compartments.lsp`, `compartments.completion`
  - `src/editor/manager.ts` — `reconfigureDoc`
- Tests: `src/__tests__/lsp.test.ts`, `src-tauri/src/lsp.rs`
- Docs: `docs/code-intelligence.md`

**As a** developer opening a source file
**I want** the right language server to start by itself
**So that** I get code intelligence without configuring anything

```gherkin
Scenario: LSP-001.1 Opening a supported file starts its server
  Given rust-analyzer is installed and code intelligence is on
  When I open "C:\work\app\src\main.rs"
  Then the status bar shows "rust-analyzer" with a spinner while it starts
  And then shows it as ready

Scenario: LSP-001.2 Supported languages
  When I open a file with one of these extensions
  Then the server used is: TypeScript / JavaScript for ts, tsx, mts, cts, js, jsx, mjs, cjs; Pyright for py, pyi; rust-analyzer for rs; gopls for go; clangd for c, h, cc, cpp, cxx, hpp, hh, hxx; csharp-ls for cs; the CSS server for css, scss, less; the HTML server for html, htm

Scenario: LSP-001.3 One server per language and project
  Given "a.ts" of project "C:\work\app" is open with its server running
  When I open "b.ts" of the same project
  Then no second server is started; both tabs use the same one
  When I open "c.ts" of another project "C:\work\lib"
  Then a separate TypeScript server is started for "C:\work\lib"

Scenario: LSP-001.4 Files without a server
  When I open a JSON file, a Markdown file, an untitled tab or a file in large-file mode
  Then no language server is started and the status bar shows no server item

Scenario: LSP-001.5 Saving an untitled tab as a source file
  Given an untitled tab
  When I save it as "C:\work\app\util.py"
  Then the tab is connected to the Python server

Scenario: LSP-001.6 Servers installed as .cmd shims are found
  Given pyright-langserver exists only as "%APPDATA%\npm\pyright-langserver.cmd" and that folder is not on Quarry's PATH
  When I open a .py file
  Then the server is found and started
```

## LSP-002: The project folder of a file

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/lsp.rs` — `find_root`, `lsp_find_root`
  - `src/lib/lspServers.ts` — `rootMarkers` of each server
  - `src/lib/lsp.ts` — `attachDoc` (passes the open folder as `fallback`), `answerServerRequest` (`workspace/workspaceFolders`)
- Tests: `src-tauri/src/lsp.rs`
- Docs: `docs/code-intelligence.md`

**As a** developer
**I want** each server to work in the project a file belongs to
**So that** imports resolve and the server never indexes my whole disk

```gherkin
Scenario: LSP-002.1 The nearest marker file wins
  Given "C:\work\app\package.json" exists
  When I open "C:\work\app\src\deep\a.ts"
  Then the TypeScript server's project is "C:\work\app"

Scenario: LSP-002.2 Markers by suffix
  Given "C:\work\app\App.csproj" exists
  When I open "C:\work\app\src\Program.cs"
  Then the C# server's project is "C:\work\app"

Scenario: LSP-002.3 The search stops at the open folder
  Given the open folder is "C:\work\app" and only "C:\work\pyproject.toml" exists above it
  When I open "C:\work\app\tools\x.py"
  Then the project is "C:\work\app", not "C:\work"

Scenario: LSP-002.4 No marker, inside the open folder
  Given the open folder is "C:\work\app" and it has no marker file
  When I open "C:\work\app\src\a.py"
  Then the project is the open folder "C:\work\app"

Scenario: LSP-002.5 No marker, outside the open folder
  Given no folder is open and no marker file exists above the file
  When I open "D:\scratch\x\a.py"
  Then the project is the file's own folder "D:\scratch\x"

Scenario: LSP-002.6 Never a drive root or the home folder
  Given a marker file exists in "C:\" and in my home folder
  When I open a file in a folder below them that has no nearer marker
  Then neither the drive root nor my home folder becomes the project

Scenario: LSP-002.7 Hovering shows the project
  Given a server is ready
  When I hover over its status bar item
  Then the tooltip names the server and "project <folder>"
```

## LSP-003: TypeScript server choice

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/lsp.rs` — `typescript_setup`, `lsp_typescript` (`tsserver.js` = TypeScript 5 / 6, `getExePath.js` = TypeScript 7; global package in `%APPDATA%\npm\node_modules\typescript`)
  - `src/lib/lsp.ts` — `launchOf` (TypeScript branch, `tsserver.fallbackPath`; a custom command from Settings bypasses the choice)
  - `src/lib/lspServers.ts` — the `typescript` entry (`tsc --lsp --stdio`, `npm install -g typescript`)
  - `src/components/panels/SettingsPanel.tsx` — `CodeIntelSection` detection asks `lsp_typescript` (root = the open folder, or empty for global only) for TypeScript without a custom command
- Tests: `src-tauri/src/lsp.rs`
- Docs: `docs/code-intelligence.md`

**As a** TypeScript developer
**I want** Quarry to use the language server that matches the TypeScript my project uses
**So that** it works with TypeScript 7 as well as with earlier versions

```gherkin
Scenario: LSP-003.1 The project's TypeScript 7
  Given the project has TypeScript 7 in node_modules with "node_modules\.bin\tsc.cmd"
  When I open a .ts file of the project
  Then the project's own tsc is started as the language server ("tsc --lsp --stdio")

Scenario: LSP-003.2 The project's TypeScript 5 or 6
  Given the project has TypeScript 5 in node_modules and typescript-language-server is installed
  When I open a .ts file of the project
  Then typescript-language-server is started and uses the project's TypeScript

Scenario: LSP-003.3 Global TypeScript 7
  Given the project has no TypeScript and TypeScript 7 is installed globally with npm
  When I open a .ts file
  Then the tsc from npm's global folder is started, not whichever tsc comes first on PATH

Scenario: LSP-003.4 Global TypeScript 5 or 6
  Given the project has no TypeScript, TypeScript 5 is installed globally and typescript-language-server is installed
  When I open a .ts file
  Then typescript-language-server is started with the global TypeScript as its fallback

Scenario: LSP-003.5 TypeScript 5 without typescript-language-server
  Given only TypeScript 5 is installed and typescript-language-server is not
  When I open a .ts file
  Then no server starts and the status bar offers "Install TypeScript support"

Scenario: LSP-003.6 Nothing installed
  Given neither the project nor npm's global folder has TypeScript
  When I open a .ts file
  Then the status bar offers "Install TypeScript support"

Scenario: LSP-003.7 My own command wins
  Given Settings has a command line for TypeScript / JavaScript
  When I open a .ts file
  Then that command is started and no version check is made

Scenario: LSP-003.8 Settings reports the same choice
  Given only TypeScript 5 is installed globally, with "tsc" on PATH, and typescript-language-server is not
  When I open Settings › Code intelligence
  Then the TypeScript / JavaScript row says "Not installed · needs Node.js" and has an "Install…" button
  Given instead TypeScript 7 or typescript-language-server would be started
  Then the row says "Installed · <path of the program that would be started>"
  And with no folder open only the global installation is looked at
```

## LSP-004: Server status in the status bar

- Status: draft
- Commands: none
- Files:
  - `src/components/LspStatus.tsx` — `LspStatusItem`, `SHORT` names
  - `src/components/StatusBar.tsx` — places `LspStatusItem` for the active document
  - `src/lib/lsp.ts` — `useLsp` (`servers`, `docServer`), `patchServer`, `$/progress` handler, `lsp:exit` listener
- Tests: none
- Docs: `docs/code-intelligence.md`

**As a** developer
**I want** the status bar to show the language server of the file in front and what it is doing
**So that** I know whether code intelligence is available yet

```gherkin
Scenario: LSP-004.1 Starting
  Given the server for the active file is starting
  When I look at the status bar
  Then it shows a spinner and the short name, such as "Pyright"
  And the tooltip reads "Starting the Python (Pyright) language server in <project folder>"

Scenario: LSP-004.2 Ready
  Given the server is ready
  When I look at the status bar
  Then it shows the short name, such as "TypeScript", and the file's error and warning counts

Scenario: LSP-004.3 Progress
  Given rust-analyzer reports "Indexing" at 40 percent
  When I look at the status bar
  Then it shows "rust-analyzer: Indexing 40%" with a spinner
  And the plain name returns when the work ends

Scenario: LSP-004.4 It follows the active tab
  Given a .ts tab and a .txt tab are open
  When I switch to the .txt tab
  Then the status bar shows no server item
  When I switch back to the .ts tab
  Then the TypeScript item is shown again

Scenario: LSP-004.5 Stopped or failed
  Given the server crashed or failed to initialise
  When I look at the status bar
  Then it shows "<name> stopped" with the server's last error lines in the tooltip
  When I click it
  Then the language servers are restarted

Scenario: LSP-004.6 A custom command that is not found
  Given Settings has a command for clangd that does not exist
  When I open a .cpp file
  Then the status bar shows "clangd command not found"
  When I click it
  Then Settings opens
```

## LSP-005: Offer to install a missing language server

- Status: draft
- Commands: none
- Files:
  - `src/lib/lspInstall.ts` — `installServer` (terminal tab, toasts, `restartServers` on success)
  - `src/components/LspStatus.tsx` — "Install … support" button (status `missing`, no custom command)
  - `src/components/panels/SettingsPanel.tsx` — `CodeIntelSection`: "Installed · path" / "Not installed · needs …", "Install…" button, re-detect on window focus (`lsp_which`; `lsp_typescript` for TypeScript)
  - `src/lib/lspServers.ts` — `install`, `needs`
  - `src/lib/lsp.ts` — `launch` (`missing` when the program is not installed / not found)
  - `src/lib/terminal.ts` — `openCommandTerminal`
  - `src-tauri/src/lsp.rs` — `lsp_which`, `which` (also looks in npm, cargo, go and dotnet tool folders)
- Tests: `src-tauri/src/lsp.rs`, `src/__tests__/lspInstall.test.ts`
- Docs: `docs/code-intelligence.md`

**As a** developer opening a language for the first time
**I want** Quarry to offer the install command for its server and run it where I can watch
**So that** I get code intelligence without looking up how

```gherkin
Scenario: LSP-005.1 The offer
  Given Pyright is not installed
  When I open a .py file
  Then the status bar shows "Install Pyright support"
  And its tooltip names the command "npm install -g pyright"
  And nothing is installed unless I click

Scenario: LSP-005.2 Installing
  When I click "Install Pyright support"
  Then a terminal tab "Install · Python (Pyright)" opens and runs "npm install -g pyright" in the open folder

Scenario: LSP-005.3 Success connects the open files
  Given the install is running
  When it finishes with exit code 0
  Then a message "Python (Pyright) support is installed" is shown
  And the language servers restart and the open .py tabs connect

Scenario: LSP-005.4 Failure says what is needed
  Given the install is running
  When it finishes with an error
  Then a message "Installing Python (Pyright) support failed (it needs Node.js). See the terminal tab for details." is shown
  And the terminal tab stays open with the output

Scenario: LSP-005.5 From Settings
  Given gopls is not installed
  When I open Settings › Code intelligence
  Then the Go row says "Not installed · needs Go" and has an "Install…" button that runs "go install golang.org/x/tools/gopls@latest" the same way
  And an installed server's row says "Installed · <path>" and has no Install button

Scenario: LSP-005.6 Installed outside Quarry
  Given I installed a server in another program while Settings › Code intelligence was open
  When I come back to the Quarry window
  Then the row is checked again and shows "Installed · <path>"

Scenario: LSP-005.7 No folder open
  Given no folder is open
  When I start an install
  Then the command runs in "C:\"
```

## LSP-006: Suggestions while typing

- Status: draft
- Commands: `code.triggerSuggest`
- Files:
  - `src/lib/lsp.ts` — `serverCompletion()` in `makeClient`, `completionFor` (typing-triggered suggestions only with a server), `attachDoc` / `detachDoc` / `orphanDocs` (reconfigure `compartments.completion`)
  - `src/editor/cmSetup.ts` — `compartments.completion` (default `activateOnTyping: false`), `completionKeymap`
  - `src/lib/commands.ts` — `code.triggerSuggest` (Ctrl+Space, any text tab)
  - `src/lib/lspServers.ts` — `sanitizeHTML` (documentation shown next to a suggestion), `initializationOptions`
- Tests: `src/__tests__/lsp.test.ts`
- Docs: `docs/code-intelligence.md`

**As a** developer writing code
**I want** the language server's suggestions as I type
**So that** I write correct names and members faster

```gherkin
Scenario: LSP-006.1 Suggestions appear while typing
  Given a .ts tab connected to a ready server
  When I type "console."
  Then a list of members from the server appears

Scenario: LSP-006.2 Ask for them
  Given a text tab has the focus
  When I press Ctrl+Space
  Then the suggestion list opens

Scenario: LSP-006.3 No pop-ups without a server
  Given a tab with no language server
  When I type
  Then no suggestion list opens by itself
  And Ctrl+Space still asks for suggestions

Scenario: LSP-006.4 Typing pop-ups stop when the server goes away
  Given a tab was connected and its server stopped
  When I type
  Then no suggestion list opens by itself until the server is running again

Scenario: LSP-006.5 Only with the editor focused
  Given the focus is in a side panel
  When I press Ctrl+Space
  Then no suggestion list opens in the editor
```

## LSP-007: Documentation on hover

- Status: draft
- Commands: none
- Files:
  - `src/lib/lsp.ts` — `hoverTooltips({ hoverTime: 350 })`, the document click handler in `installLsp` (links in `.cm-tooltip` / `.cm-lsp-documentation`)
  - `src/lib/lspServers.ts` — `sanitizeHTML`, `DROP_TAGS`
- Tests: `src/__tests__/lsp.test.ts`
- Docs: `docs/code-intelligence.md`

**As a** developer reading code
**I want** a symbol's type and documentation when I hover over it
**So that** I do not have to navigate away to understand it

```gherkin
Scenario: LSP-007.1 Hover
  Given a tab connected to a ready server
  When I rest the pointer on a symbol for about a third of a second
  Then a tooltip shows its type and documentation

Scenario: LSP-007.2 Documentation is treated as untrusted
  Given a dependency's documentation contains a script, a style block, a form, an iframe or an "onclick" attribute
  When it is shown in a hover or next to a suggestion
  Then those parts are removed and only formatting, classes, web links and web or embedded images remain

Scenario: LSP-007.3 Links open in the browser
  When I click an "https://" link in hover documentation
  Then it opens in my browser and Quarry's window does not navigate

Scenario: LSP-007.4 Other links do nothing
  When I click a link in hover documentation that is not http or https
  Then nothing is opened
```

## LSP-008: Parameter hints

- Status: draft
- Commands: `code.signatureHelp`
- Files:
  - `src/lib/lsp.ts` — `signatureHelp()` in `makeClient`, `lspCommands.signature` (`showSignatureHelp`)
  - `src/lib/commands.ts` — `code.signatureHelp` (Ctrl+Shift+Space, `lspReady`)
  - Library behaviour (@codemirror/lsp-client 6.3.0, `signatureHelp` / `signaturePlugin`): a request is made when typed text contains one of the server's `signatureHelpProvider.triggerCharacters` (or, while a hint shows, its `retriggerCharacters`); the tooltip is `.cm-lsp-signature-tooltip`
- Tests: none
- Docs: `docs/code-intelligence.md`

**As a** developer calling a function
**I want** to see its parameters while I type the arguments
**So that** I pass the right things in the right order

```gherkin
Scenario: LSP-008.1 Hints appear by themselves
  Given a tab connected to a ready server
  When I type "(" after a function name, or "," between arguments
  Then a hint shows the function's parameters, with the current parameter highlighted
  And the characters that open or update the hint are the ones the server declares (for TypeScript "(" and ",")

Scenario: LSP-008.2 Ask for them
  Given the cursor is inside a call's arguments
  When I press Ctrl+Shift+Space
  Then the parameter hint is shown

Scenario: LSP-008.3 Unavailable without a ready server
  Given the active tab has no ready language server
  When I open the command palette
  Then "Show Parameter Hints" is not offered and Ctrl+Shift+Space does nothing
```

## LSP-009: Go to definition, type definition and implementation

- Status: draft
- Commands: `code.gotoDefinition`, `code.gotoTypeDefinition`, `code.gotoImplementation`
- Files:
  - `src/lib/lsp.ts` — `lspCommands.definition` / `typeDefinition` / `implementation`, `onView`, `hasLsp`, `QuarryWorkspace.displayFile` (opens the target with `openPath`, waits for the tab)
  - `src/lib/commands.ts` — `lspCmd`, `lspReady`; keys F12 and Ctrl+F12 (editor focused)
  - `src/lib/actions.ts` — `openPath`
- Tests: none
- Docs: `docs/code-intelligence.md`

**As a** developer following code
**I want** to jump to where a symbol is defined
**So that** I can read it without searching

```gherkin
Scenario: LSP-009.1 Definition in the same file
  Given the cursor is on a call of "parse" defined further up in the file
  When I press F12
  Then the cursor moves to the definition of "parse"

Scenario: LSP-009.2 Definition in another file
  Given "parse" is defined in "src\parser.ts", which is not open
  When I press F12
  Then "src\parser.ts" opens in a tab with the cursor on the definition

Scenario: LSP-009.3 Implementation and type definition
  When I press Ctrl+F12 on an interface method
  Then the editor goes to its implementation
  When I run "Code: Go to Type Definition" on a variable
  Then the editor goes to the definition of its type

Scenario: LSP-009.4 The target opens in large-file mode
  Given the definition is in a file large enough to open in large-file mode
  When I press F12
  Then the file opens and a message says it opened in large-file mode, which has no code navigation, and to use Go to Line

Scenario: LSP-009.5 Unavailable without a ready server
  Given the active tab has no language server, or its server is still starting
  When I open the command palette
  Then "Go to Definition", "Go to Type Definition" and "Go to Implementation" are not offered and F12 does nothing

Scenario: LSP-009.6 Keys need the editor
  Given the focus is in the Explorer
  When I press F12
  Then nothing happens
```

## LSP-010: Find all references

- Status: draft
- Commands: `code.findReferences`
- Files:
  - `src/lib/lsp.ts` — `lspCommands.references` (`findReferences`), `QuarryWorkspace.requestFile` (files that are not open are read from disk, not opened)
  - `src/lib/commands.ts` — `code.findReferences` (Shift+F12)
  - `src/editor/cmSetup.ts` — theme rule that hides `.cm-panels` except LSP panels
  - `src/styles/app.css` — the same `:has(.cm-lsp-reference-panel, …)` rule
  - Library behaviour (@codemirror/lsp-client 6.3.0, `findReferences` / `createReferencePanel`): the panel takes the focus when it opens; rows are grouped under a file header (the path after the files' common prefix) and show "line: text" with the symbol in bold; ↑ / ↓ / Home / End / Page keys move, Enter or a click goes to the reference (`Workspace.displayFile` for another file); Escape inside the panel or its × closes it. Quarry does not install `findReferencesKeymap`, so Escape in the editor leaves the panel open
- Tests: none
- Docs: `docs/code-intelligence.md`

**As a** developer about to change a function
**I want** a list of every place that uses it
**So that** I know what my change affects

```gherkin
Scenario: LSP-010.1 List references
  Given the cursor is on a function used in 3 files
  When I press Shift+F12
  Then a panel under the editor lists the references grouped by file, each with its line number and line text
  And the panel has the keyboard focus, and Enter or a click on a row goes to that reference

Scenario: LSP-010.2 Files that are not open
  Given some references are in files that are not open in tabs
  When the list is shown
  Then those references are listed with their text, read from disk
  And no tab is opened for them until I pick one, which opens the file at that reference

Scenario: LSP-010.3 Close the panel
  Given the references panel is open and has the focus
  When I press Esc, or click its × button
  Then the panel closes and the editor has the focus

Scenario: LSP-010.4 Unavailable without a ready server
  Given the active tab has no ready language server
  When I press Shift+F12
  Then nothing happens and "Find All References" is not offered in the palette
```

## LSP-011: Rename a symbol

- Status: draft
- Commands: `code.renameSymbol`
- Files:
  - `src/lib/lsp.ts` — `lspCommands.rename` (`renameSymbol`), `QuarryWorkspace.updateFile` (edits only files open in tabs, through `editor.dispatchTo`), `openDoc` (background tabs are open on the server too)
  - `src/lib/commands.ts` — `code.renameSymbol` (F2)
  - `src/editor/manager.ts` — `dispatchTo` (an ordinary transaction on the view or the stored state, so it goes into that document's undo history)
  - Library behaviour (@codemirror/lsp-client 6.3.0, `renameSymbol` / `doRename`): F2 needs the cursor on a word and a server with `renameProvider`; it shows a "New name" box (`.cm-lsp-rename-panel`, the word preselected, a "rename" button); Enter confirms and Escape cancels. Only `WorkspaceEdit.changes` is applied (the client does not announce `documentChanges`), one `userEvent: "rename"` transaction per file, and only for files the workspace has open (`getFile`)
- Tests: none
- Docs: `docs/code-intelligence.md`

**As a** developer
**I want** to rename a symbol everywhere it is used in my open files
**So that** the code stays consistent

```gherkin
Scenario: LSP-011.1 Rename across open tabs
  Given "total" is used in "a.ts" and "b.ts", both open in tabs, and "a.ts" is in front
  When I press F2 on "total"
  Then a "New name" box opens under the editor with "total" selected
  When I type "sum" and press Enter
  Then every use in "a.ts" and in the background tab "b.ts" becomes "sum"
  And both tabs are marked as changed and nothing is saved

Scenario: LSP-011.2 Files that are not open are left alone
  Given "total" is also used in "c.ts", which is not open
  When I rename "total" to "sum"
  Then "c.ts" on disk is unchanged

Scenario: LSP-011.3 Undo
  Given a rename changed "a.ts" and the background tab "b.ts"
  When I press Ctrl+Z in "a.ts"
  Then the rename edits in "a.ts" are undone in one step
  And "b.ts" keeps its edits until I undo in that tab too

Scenario: LSP-011.4 Cancel
  Given the rename box is open
  When I press Esc
  Then nothing is renamed

Scenario: LSP-011.5 Unavailable without a ready server
  Given the active tab has no ready language server
  When I press F2
  Then no rename box opens
```

## LSP-012: Problems in the editor

- Status: draft
- Commands: `code.nextProblem`, `code.prevProblem`
- Files:
  - `src/lib/lsp.ts` — `applyDiagnostics`, `publishDiagnostics` handler, `QuarryWorkspace.pullSoon` / `pull` (pull diagnostics 400 ms after a change, for every open file; `workspace/diagnostic/refresh`), `orphanDocs`
  - `src/lib/lspServers.ts` — `offsetOf` (positions clamped to the line), `severityOf`
  - `src/editor/manager.ts` — `setLspDiagnostics` (sets them on a document's state, on screen or not)
  - `src/editor/cmSetup.ts` — `lintGutter()` (the gutter marks); @codemirror/lint draws the underlines and the hover tooltip with the message
  - `src/lib/commands.ts` — `code.nextProblem` (F8), `code.prevProblem` (Shift+F8), `problemsHere`
- Tests: `src/__tests__/lsp.test.ts`
- Docs: `docs/code-intelligence.md`

**As a** developer
**I want** errors and warnings marked in the code as I type
**So that** I fix mistakes before building

```gherkin
Scenario: LSP-012.1 Problems are underlined
  Given a .ts tab connected to a ready server
  When I type code with a type error
  Then the error is underlined and marked in the gutter
  And hovering over the underline shows the message

Scenario: LSP-012.2 Fixed problems go away
  Given an underlined error
  When I correct the code
  Then the underline and the gutter mark disappear

Scenario: LSP-012.3 Next and previous problem
  Given the file has problems on lines 4 and 20 and the cursor is on line 1
  When I press F8
  Then the cursor moves to the problem on line 4
  When I press F8 again
  Then it moves to line 20
  When I press Shift+F8
  Then it moves back to line 4

Scenario: LSP-012.4 No problems, no command
  Given the active file has no problems
  When I press F8
  Then nothing happens and "Next Problem" is not offered in the palette

Scenario: LSP-012.5 An edit in one file changes problems in another
  Given "a.ts" and "b.ts" are open and "b.ts" uses a function from "a.ts"
  When I change that function's parameters in "a.ts"
  Then "b.ts" shows the resulting error when I switch to it, without my editing it

Scenario: LSP-012.6 Problems are cleared with the server
  Given a file shows problems
  When its language server stops
  Then the underlines are removed
```

## LSP-013: The Problems list and counts

- Status: draft
- Commands: `view.problems`
- Files:
  - `src/components/LspStatus.tsx` — `ProblemsList`, `rank`, `useProblemCount`, the counts button of `LspStatusItem`
  - `src/components/BottomPanel.tsx` — Problems tab of the bottom panel
  - `src/lib/commands.ts` — `view.problems`
  - `src/lib/lsp.ts` — `useLsp.problems`, `Problem`
- Tests: none
- Docs: `docs/code-intelligence.md`

**As a** developer
**I want** one list of the problems in all my open files
**So that** I can work through them without visiting each tab

```gherkin
Scenario: LSP-013.1 Counts for the file in front
  Given the active file has 2 errors and 1 warning and its server is ready
  When I look at the status bar
  Then it shows the counts 2 and 1
  When I click them
  Then the bottom panel opens on the Problems tab

Scenario: LSP-013.2 The list
  Given "a.ts" has 1 warning and 2 errors and "b.ts" has 1 error
  When I run "View: Problems"
  Then the list shows a group per file with its number of problems
  And within a file errors come before warnings, then in document order
  And each row shows the first line of the message, its source and "Ln <line>, Col <column>"

Scenario: LSP-013.3 Go to a problem
  When I click a problem of the background tab "b.ts"
  Then "b.ts" comes to the front with the cursor at that problem and the editor focused

Scenario: LSP-013.4 Nothing to show
  Given open files are connected to servers and have no problems
  When I open the Problems list
  Then it says "No problems in the open files."

Scenario: LSP-013.5 No server at all
  Given no open file is connected to a language server
  When I open the Problems list
  Then it says "Problems from language servers appear here. Open a file in a supported language (Settings › Code intelligence)."

Scenario: LSP-013.6 Closing a tab removes its problems
  Given "b.ts" has problems in the list
  When I close "b.ts"
  Then its group disappears from the list
```

## LSP-014: Format with the language server

- Status: draft
- Commands: `code.formatWithServer`
- Files:
  - `src/lib/lsp.ts` — `lspCommands.format` (the library's `formatDocument`)
  - `src/lib/commands.ts` — `code.formatWithServer` (no key, `lspReady`)
  - `src/lib/lspServers.ts` — `provideFormatter` in the CSS and HTML servers' `initializationOptions`
  - Library behaviour (@codemirror/lsp-client 6.3.0, `formatDocument`): sends `textDocument/formatting` with the editor's indent unit, applies the reply as one `userEvent: "format"` transaction, drops it if I edited inside a changed range meanwhile, and shows "Formatting request failed: …" (`.cm-lsp-message`) when the server refuses
- Tests: none
- Docs: `docs/code-intelligence.md`

**As a** developer
**I want** to format a file with its language server's formatter
**So that** I get the formatting my tool chain defines

```gherkin
Scenario: LSP-014.1 Format with the server
  Given a tab connected to a ready server that can format
  When I run "Code: Format Document with Language Server"
  Then the document is reformatted by the server, using the editor's indentation settings
  And one Ctrl+Z undoes the whole reformat

Scenario: LSP-014.2 Format Document is unchanged
  Given a tab connected to a ready server
  When I press Shift+Alt+F
  Then Quarry's own Format Document runs, not the server's

Scenario: LSP-014.3 Unavailable without a ready server
  Given the active tab has no ready language server
  When I open the command palette
  Then "Format Document with Language Server" is not offered

Scenario: LSP-014.4 A server that can't format
  Given a tab connected to a ready server without a formatter
  When I run "Format Document with Language Server"
  Then a message "Formatting request failed: …" is shown above the editor and the text is unchanged
```

## LSP-015: Every open tab stays in sync with its server

- Status: draft
- Commands: none
- Files:
  - `src/lib/lsp.ts` — `QuarryWorkspace` (`files`, `syncFiles`, `openFile`, `openDoc`, `closeFile` no-op, `closeDoc`, `getFile`), `QuarryFile`, `docUris`, `docForUri`, `attachDoc` / `detachDoc`, the store subscription in `installLsp` (new, closed and renamed tabs)
  - `src/editor/manager.ts` — `stateOf`, `viewOf`, `docOf`, `reconfigureDoc`
  - `src/lib/lspServers.ts` — `uriKey` (URIs compared without case or encoding differences)
- Tests: `src/__tests__/lsp.test.ts`
- Docs: `docs/code-intelligence.md`

**As a** developer with many tabs open
**I want** the server to know the current text of every open file, not only the one on screen
**So that** problems, rename and navigation are right for unsaved edits in background tabs

```gherkin
Scenario: LSP-015.1 Unsaved text is what the server sees
  Given "a.ts" has unsaved edits
  When I ask for suggestions or problems in "b.ts", which imports "a.ts"
  Then the answers reflect the unsaved text of "a.ts"

Scenario: LSP-015.2 Background tabs are open on the server
  Given 3 .ts tabs were restored at start-up and only one has been shown
  When their server becomes ready
  Then all 3 files are open on the server and their problems are counted in the Problems list

Scenario: LSP-015.3 Switching tabs does not close the file
  Given "a.ts" is connected
  When I switch to another tab
  Then "a.ts" stays open on the server and keeps its problems

Scenario: LSP-015.4 Closing the tab closes the file
  When I close the "a.ts" tab
  Then the file is closed on the server and its problems are removed

Scenario: LSP-015.5 Save As to another name or language
  Given "a.ts" is connected
  When I save it as "a.py"
  Then it is closed on the TypeScript server and connected to the Python server

Scenario: LSP-015.6 Edits made while off screen
  Given a rename or Replace in Files changed a background tab
  When the server is next asked anything
  Then it first receives that tab's new text
```

## LSP-016: Settings for code intelligence

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `CodeIntelSection` (`apply` = change + `restartServers`, per-server switch, command box, detection with `lsp_which`, or `lsp_typescript` for TypeScript)
  - `src/lib/lsp.ts` — `attachDoc` (honours `lspEnabled`, `lspDisabled`), `launchOf` (`lspCommands` override), `restartServers`, `stopAllServers`
  - `src/lib/lspServers.ts` — `serverFor(path, disabled)`, `splitCommand`
  - `src/lib/actions.ts` — `mergeSettings` (`lspEnabled`, `lspDisabled`, `lspCommands`)
  - `src/lib/types.ts` — `lspEnabled` (default on), `lspDisabled`, `lspCommands`
- Tests: `src/__tests__/lsp.test.ts`
- Docs: `docs/code-intelligence.md`

**As a** developer
**I want** to switch code intelligence off, per language or altogether, and to choose which server program runs
**So that** it fits my machine and my tool chain

```gherkin
Scenario: LSP-016.1 Everything off
  Given language servers are running
  When I switch Settings › Code intelligence › "Code intelligence" off
  Then every language server process is stopped
  And the status bar shows no server item, underlines are removed and the Problems list is empty
  And the per-server rows and the restart button are hidden

Scenario: LSP-016.2 Back on
  Given code intelligence is off
  When I switch it on
  Then the open files are connected to their servers again

Scenario: LSP-016.3 One server off
  When I switch the Python (Pyright) row off
  Then .py tabs have no language server while other languages keep theirs
  When I switch it on again
  Then .py tabs are connected again

Scenario: LSP-016.4 My own command line
  When I enter "\"C:\LLVM\bin\clangd.exe\" --background-index" in the C / C++ row and leave the field
  Then the servers restart and C and C++ files use that program with that argument
  And the row shows whether that program was found

Scenario: LSP-016.5 Empty means the default
  Given a row has a custom command
  When I clear the field and leave it
  Then the default command, shown as the placeholder, is used again

Scenario: LSP-016.6 Any change restarts the servers
  When I change the main switch, a server's switch or a server's command
  Then all language servers are restarted and the open tabs reconnect
```

## LSP-017: Restart, crashes and quitting

- Status: draft
- Commands: `code.restartLanguageServers`
- Files:
  - `src/lib/lsp.ts` — `restartServers`, `stopAllServers` (`generation` invalidates launches in flight), `lsp:exit` listener, `orphanDocs`, `reattach`, `forget` in `launch` (a failed start is retried by the next file), request `timeout` 15 s
  - `src/lib/commands.ts` — `code.restartLanguageServers` (enabled while `lspEnabled`)
  - `src/components/panels/SettingsPanel.tsx` — "Restart language servers" button
  - `src/components/LspStatus.tsx` — "<name> stopped" button
  - `src-tauri/src/lsp.rs` — `lsp_stop`, `lsp_stop_all`, `kill` (`taskkill /T /F`), `lsp:exit` with exit code and stderr tail
  - `src/lib/actions.ts` — window close → `stopAllServers`
  - `src/lib/updater.ts` — stops servers before installing an update
- Tests: none
- Docs: `docs/code-intelligence.md`

**As a** developer whose language server got stuck or was updated
**I want** to restart the servers, and Quarry to clean up after them
**So that** code intelligence recovers and no server processes are left running

```gherkin
Scenario: LSP-017.1 Restart from the palette
  Given language servers are running
  When I run "Code: Restart Language Servers"
  Then every server is stopped and started again and the open tabs reconnect
  And a message "Language servers restarted" is shown

Scenario: LSP-017.2 Restart from Settings
  When I click "Restart language servers" in Settings › Code intelligence
  Then the servers restart and the button is disabled until that is done

Scenario: LSP-017.3 Not offered while off
  Given code intelligence is switched off
  When I open the command palette
  Then "Restart Language Servers" is not offered

Scenario: LSP-017.4 A server crashes
  Given a .go tab is connected to gopls
  When the gopls process exits by itself with code 2
  Then the status bar shows "gopls stopped" with "Exited with code 2" and its last error lines in the tooltip
  And the tab's underlines, problems and typing suggestions are removed
  And other languages' servers keep working

Scenario: LSP-017.5 A failed start is tried again
  Given the server for .rs files failed to start
  When I open another .rs file of the same project
  Then Quarry tries to start the server again
  And when it becomes ready, the earlier .rs tabs are connected too

Scenario: LSP-017.6 Quitting stops the servers
  Given 3 language servers are running
  When I quit Quarry
  Then all 3 server processes and their child processes are ended

Scenario: LSP-017.7 Restart during a start
  Given a server is still starting
  When I restart the language servers
  Then the start in flight is abandoned and does not leave a second process running
```
