# Terminal

A terminal tab runs a shell inside Quarry, in the folder you are working in: PowerShell, Command Prompt, Git Bash, or any shell you name. It is a real Windows console (ConPTY), so full-screen programs, colours and prompts work as in Windows Terminal.

## Opening a terminal

| From | How |
| --- | --- |
| Anywhere | **Ctrl+`**, **Tools › New Terminal**, or **New Terminal** in the command palette |
| Explorer | Right-click a folder, or blank space for the open folder, and choose **Open in Terminal** |
| Another shell, once | **Tools › New Terminal With**, then the shell |

The terminal starts in the folder of the active terminal tab if there is one; otherwise in the open folder, then the active file's folder, then your home folder. The tab is named after the shell and the folder ("PowerShell 7 · proj"). You can open as many as the [tab limit](settings.md#tabs-and-panels) allows.

## Choosing the shell

**Settings › Terminal › Shell** lists the shells Quarry found:

| Shell | Found when |
| --- | --- |
| PowerShell 7 | `pwsh.exe` is on your PATH or in `Program Files\PowerShell\7` |
| Windows PowerShell | Always (part of Windows) |
| Command Prompt | Always |
| Git Bash | Git for Windows is installed |

**Automatic** (the default) uses the first of these that is installed. **Custom…** runs a command line you type, such as `"C:\msys64\usr\bin\bash.exe" --login -i` or `wsl.exe`; put a path with spaces in quotes. A change applies to the next terminal you open; open terminals keep their shell.

## Keys

Every key goes to the shell, so Ctrl+R, Ctrl+L, Ctrl+W, Esc and the rest behave as in a terminal. Quarry keeps only:

- **Ctrl+Tab** / **Ctrl+Shift+Tab**: switch tabs
- **Ctrl+Shift+P**: command palette
- **Ctrl+F4**: close the tab
- **Ctrl+`** (or the keys you gave New Terminal): another terminal in the same folder

Copy and paste work as in Windows Terminal: **Ctrl+C** copies when text is selected and otherwise interrupts the program, **Ctrl+Shift+C** copies, and **Ctrl+V** / **Ctrl+Shift+V** paste.

## Closing

- Typing `exit` closes the tab.
- If the shell ends with an error code, the tab stays so you can read what happened; press **Enter** to start the shell again.
- Closing the tab while the shell is running asks first, then ends the shell and everything it started.
- Terminal tabs are not reopened when Quarry restarts.

The terminal follows Quarry's theme and the editor font and size.
