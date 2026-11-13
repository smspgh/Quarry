# Keyboard shortcuts

Every command is also in the command palette (**Ctrl+Shift+P** or **F1**), which shows its shortcut, and nearly all are in the menus.

Letter and digit shortcuts follow the physical key position, so they work on any keyboard layout. **Ctrl+K M** is a chord: press Ctrl+K, release, then press M.

The **Id** column is the command id used in [macro files](macros.md#file-format).

## File and tabs

| Keys | Command | Id |
| --- | --- | --- |
| Ctrl+N | New File | `file.new` |
| Ctrl+O | Open File | `file.open` |
| Ctrl+Shift+O | Open Folder | `file.openFolder` |
| Ctrl+P | Quick Open File | `file.quickOpen` |
| Ctrl+S | Save | `file.save` |
| Ctrl+Shift+S | Save As | `file.saveAs` |
| Ctrl+Alt+S | Save All | `file.saveAll` |
| Ctrl+W, Ctrl+F4 | Close Tab | `file.close` (Ctrl+F4: `file.closeF4`) |
| – | Close Other Tabs / Close All Tabs | `file.closeOthers` / `file.closeAll` |
| Ctrl+Shift+T | Reopen Closed Tab | `file.reopenClosedTab` |
| – | Copy Path of Active File / Open to the Side | `file.copyPath` / `file.openToSide` |
| – | Revert File | `file.revert` |
| Ctrl+Tab, Ctrl+Page Down | Next Tab | `file.nextTab` (Ctrl+Page Down: `file.nextTabPg`) |
| Ctrl+Shift+Tab, Ctrl+Page Up | Previous Tab | `file.prevTab` (Ctrl+Page Up: `file.prevTabPg`) |
| Alt+F4 | Exit | `app.exit` |

## Edit

| Keys | Command | Id |
| --- | --- | --- |
| Ctrl+Z | Undo | `edit.undo` |
| Ctrl+Y, Ctrl+Shift+Z | Redo | `edit.redo` |
| Ctrl+X / Ctrl+C / Ctrl+V | Cut / Copy / Paste (with nothing selected, Cut and Copy take the whole line) | `edit.cut` / `edit.copy` / `edit.paste` |
| Ctrl+A | Select All | `edit.selectAll` |
| Ctrl+Shift+D | Duplicate Line Down | `edit.duplicateLine` |
| – | Duplicate Line Up | `edit.duplicateLineUp` |
| Ctrl+Shift+K | Delete Line | `edit.deleteLine` |
| Alt+↑ / Alt+↓ | Move Line Up / Down | `edit.moveLineUp` / `edit.moveLineDown` |
| Tab / Shift+Tab | Indent / Outdent | `edit.indent` / `edit.outdent` |
| – | Uppercase / Lowercase / Title Case | `edit.upper` / `edit.lower` / `code.titleCase` |
| – | Wrap Selections in Quotes | `edit.quoteSelections` |
| – | Sort Lines Ascending / Descending | `code.sortAsc` / `code.sortDesc` |
| – | Reverse Lines | `code.reverseLines` |
| – | Remove Duplicate Lines | `code.dedupe` |
| – | Delete Blank Lines / Delete Empty Lines | `code.removeBlank` / `code.removeEmpty` |
| – | Trim Trailing Whitespace | `code.trimTrailing` |
| – | Join Lines | `code.joinLines` |
| – | Number Lines | `edit.numberLines` |

## Selection and multi-cursor

| Keys | Command | Id |
| --- | --- | --- |
| Ctrl+D | Add Selection to Next Find Match | `edit.selectNextOccurrence` |
| Ctrl+Shift+L | Select All Occurrences | `edit.selectAllOccurrences` |
| Alt+Enter | Select All Find Matches | `edit.selectAllMatches` |
| Ctrl+Alt+↑ / Ctrl+Alt+↓ | Add Cursor Above / Below | `selection.addCursorAbove` / `selection.addCursorBelow` |
| Alt+Shift+C | Toggle Column (Block) Selection Mode | `selection.toggleColumnMode` |
| Alt+Shift+I | Split Block Selection into Cursors | `selection.blockToCursors` |
| Alt+drag | Rectangular selection | – |
| Esc | Back to a single cursor | – |

## Code

| Keys | Command | Id |
| --- | --- | --- |
| Shift+Alt+F | Format Document | `code.format` |
| Ctrl+/ | Toggle Line Comment | `edit.toggleComment` |
| Shift+Alt+A | Toggle Block Comment | `code.toggleBlockComment` |
| Ctrl+Shift+[ / Ctrl+Shift+] | Fold / Unfold Region | `code.fold` / `code.unfold` |
| – | Fold All / Unfold All | `code.foldAll` / `code.unfoldAll` |
| Ctrl+Shift+\\ | Go to Matching Bracket | `code.gotoBracket` |
| Ctrl+K M | Change Language Mode | `code.setLanguage` |
| – | Auto-detect Language | `code.detectLanguage` |
| – | Indentation: Convert to Spaces / Tabs | `code.indentToSpaces` / `code.indentToTabs` |

## Find

| Keys | Command | Id |
| --- | --- | --- |
| Ctrl+F | Find | `find.open` |
| Ctrl+H | Replace | `find.replace` |
| F3 / Shift+F3 | Find Next / Previous | `find.next` / `find.prev` |
| Alt+L | Toggle Find in Selection | `find.toggleInSelection` |
| Ctrl+Shift+F | Find in Files | `find.inFiles` |
| Ctrl+Shift+H | Replace in Files | `find.replaceInFiles` |
| – | Undo Replace in Files | `find.undoReplaceInFiles` |
| F4 / Shift+F4 | Next / Previous Search Result | `find.nextResult` / `find.prevResult` |
| Ctrl+G | Go to Line | `goto.line` |

Inside the find bar: **Enter / Shift+Enter** next / previous, **Alt+C / Alt+W / Alt+R / Alt+P** toggle case / whole word / regex / preserve case, **Ctrl+Enter** insert a line break, **Ctrl+Alt+Enter** replace all.

## View

| Keys | Command | Id |
| --- | --- | --- |
| Ctrl+Shift+P, F1 | Command Palette | `view.commandPalette` |
| Ctrl+B | Collapse / Restore Side Panels | `view.toggleSidebar` |
| Ctrl+J | Toggle Bottom Panel | `view.togglePanel` |
| Ctrl+\ | Split Editor / Close Split Editor | `view.splitEditor` |
| Ctrl+1 / Ctrl+2 | Focus Left / Right Editor Pane | `view.focusLeftPane` / `view.focusRightPane` |
| Ctrl+Shift+E | Show Explorer | `view.explorer` |
| Ctrl+Shift+J | Show JSON Tools | `view.json` |
| – | Show Macros / Show Scripts | `view.macros` / `view.scripts` |
| Ctrl+, | Settings | `view.settings` |
| Alt+Z | Toggle Word Wrap | `view.toggleWrap` |
| – | Toggle Render Whitespace | `view.toggleWhitespace` |
| – | Toggle Light/Dark Theme | `view.toggleTheme` |
| Ctrl+M | Toggle Tab Key Moves Focus | `view.toggleTabFocus` |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom In / Out / Reset | `view.zoomIn` / `view.zoomOut` / `view.zoomReset` |
| Alt, F10 | Open the menu bar | – |

## JSON

| Keys | Command | Id |
| --- | --- | --- |
| Ctrl+Alt+F | Format / Pretty-print | `json.format` |
| Ctrl+Alt+M | Minify | `json.minify` |
| Ctrl+Alt+V | Validate | `json.validate` |
| Ctrl+Alt+P | Copy Path at Cursor (dot) | `json.copyPath` |
| – | Copy JSONPath / JSON Pointer / Bracket Path at Cursor | `json.copyJsonPath` / `json.copyPointer` / `json.copyBracket` |
| Ctrl+Alt+C | Copy Value at Cursor | `json.copyValue` |
| – | Convert to CSV / Convert CSV to JSON | `json.toCsv` / `json.fromCsv` |
| – | Copy Top-level Keys | `json.copyKeys` |

In the JSON tree: **Ctrl+C** copies the value, **Ctrl+Shift+C** copies the path.

## Macros and scripts

| Keys | Command | Id |
| --- | --- | --- |
| Ctrl+Shift+R | Start / Stop Recording | `macro.toggleRecord` |
| Ctrl+Shift+M | Play Last Macro | `macro.playLast` |
| – | Play Last Until End of File | `macro.playToEnd` |
| – | Pause / Resume Playback | `macro.pause` |
| Shift+Esc | Stop Playback | `macro.stop` |
| Ctrl+Shift+Enter | Run Current Script | `script.runActive` |
| – | Show Scripts / New Script | `script.panel` / `script.new` |
| – | Script API Reference (Help menu) | `help.scriptApi` |

## Code intelligence

These need the file's [language server](code-intelligence.md).

| Keys | Command | Id |
| --- | --- | --- |
| Ctrl+Space | Show Suggestions | `code.triggerSuggest` |
| Ctrl+Shift+Space | Show Parameter Hints | `code.signatureHelp` |
| F12 | Go to Definition | `code.gotoDefinition` |
| Ctrl+F12 | Go to Implementation | `code.gotoImplementation` |
| – | Go to Type Definition | `code.gotoTypeDefinition` |
| Shift+F12 | Find All References | `code.findReferences` |
| F2 | Rename Symbol | `code.renameSymbol` |
| F8 / Shift+F8 | Next / Previous Problem | `code.nextProblem` / `code.prevProblem` |
| – | Format Document with Language Server | `code.formatWithServer` |
| – | Restart Language Servers | `code.restartLanguageServers` |
| – | Problems (bottom panel) | `view.problems` |

## Compare

| Keys | Command | Id |
| --- | --- | --- |
| – | Compare Two Files… | `compare.files` |
| – | Compare Active File With… | `compare.activeWith` |
| – | Compare with Saved | `compare.withSaved` |
| – | Compare with Clipboard | `compare.withClipboard` |
| – | Select Active File for Compare / Compare Active File with Selected | `compare.selectForCompare` / `compare.withSelected` |
| F7 / Shift+F7 | Next / Previous Change | `compare.nextChange` / `compare.prevChange` |
| – | Swap Sides | `compare.swap` |
| – | Toggle Inline / Side by Side | `compare.toggleInline` |
| Ctrl+S | Save the edited side | `file.save` |

## Git

| Keys | Command | Id |
| --- | --- | --- |
| Ctrl+Shift+G | Show Source Control | `git.showPanel` |
| Alt+F5 / Shift+Alt+F5 | Next / Previous Change (since the last commit) | `git.nextChange` / `git.prevChange` |
| – | Show Change at Cursor / Revert Change at Cursor | `git.peekChange` / `git.revertChange` |
| – | Compare with Last Commit (HEAD) | `git.compareWithHead` |
| – | Show File History | `git.fileHistory` |
| – | Show Commit Graph | `git.graph` |
| Alt+F6 / Shift+Alt+F6 | Next / Previous Conflict | `git.nextConflict` / `git.prevConflict` |
| – | Accept Current / Incoming / Both (conflict at cursor) | `git.acceptCurrent` / `git.acceptIncoming` / `git.acceptBoth` |
| – | Accept All Current / Incoming in This File | `git.acceptAllCurrent` / `git.acceptAllIncoming` |
| – | Show / Hide Line Blame | `git.toggleBlame` |
| – | Stage / Unstage Current File | `git.stageFile` / `git.unstageFile` |
| – | Switch Branch… | `git.switchBranch` |
| – | Fetch / Pull / Push | `git.fetch` / `git.pull` / `git.push` |
| – | Add Remote… | `git.addRemote` |
| – | Refresh Git Status | `git.refresh` |

## Claude Code

| Keys | Command | Id |
| --- | --- | --- |
| – | Work with Claude Code Here | `claude.openHere` |
| – | Work with Claude Code in Folder… | `claude.openFolder` |
| – | Open Claude Code Terminal Here | `claude.openTerminal` |
| Ctrl+Alt+L | Add Selection to Claude Code | `claude.addSelection` |
| – | Mention This File to Claude Code | `claude.addFile` |
| – | New Conversation | `claude.newSession` |
| – | Stop | `claude.stop` |

In a Claude tab's message box: **Enter** sends, **Shift+Enter** adds a line, **Esc** stops Claude, and **Ctrl+V** pastes text or a screenshot. In a Claude CLI tab every key goes to Claude Code except **Ctrl+Tab**, **Ctrl+Shift+Tab**, **Ctrl+Shift+P** and **Ctrl+F4** (close the tab). **Ctrl+C** there copies only when text is selected. See [Claude Code](claude-code.md).

## Large-file tabs

| Keys | Action |
| --- | --- |
| Enter, F2, double-click | Edit the selected line |
| Ctrl+Enter | Insert a line below |
| Delete | Delete the selected lines |
| Ctrl+C | Copy the selected lines |
| Ctrl+F, then Enter | Find |
| F3 / Shift+F3 | Next / previous hit |
| Ctrl+G | Go to line |
| Ctrl+Z / Ctrl+Y | Undo / redo |

## Editor keys from CodeMirror

| Keys | Action |
| --- | --- |
| Ctrl+Enter | Insert a blank line below |
| Alt+L | Select line |
| Ctrl+I | Select the enclosing syntax node |
| Ctrl+[ / Ctrl+] | Outdent / indent |
| Ctrl+Alt+\\ | Re-indent the selection |
| Shift+Alt+↑ / Shift+Alt+↓ | Copy line up / down |
| Alt+← / Alt+→ | Move by syntax node |
| Ctrl+U / Alt+U | Undo / redo the last selection change |
| Ctrl+Alt+[ / Ctrl+Alt+] | Fold all / unfold all |
| Ctrl+Space | Show completions |
| Ctrl+Backspace / Ctrl+Delete | Delete word |
| Esc, then Tab | Move focus out of the editor |
