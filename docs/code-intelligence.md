# Code intelligence

Quarry uses [language servers](https://microsoft.github.io/language-server-protocol/), the same ones VS Code and other editors use, to understand your code. When a file's language server is installed, its tab gets suggestions while you type, documentation on hover, Go to Definition, Find All References, Rename and live problems. Nothing has to be configured: Quarry starts the right server when you open a file and stops it when you quit.

- [Languages](#languages)
- [What you get](#what-you-get)
- [Problems](#problems)
- [Installing a language server](#installing-a-language-server)
- [Projects](#projects)
- [Settings](#settings)
- [Limits](#limits)

## Languages

| Language | Server | Install command |
| --- | --- | --- |
| TypeScript, JavaScript (`.ts .tsx .js .jsx .mjs .cjs`) | TypeScript 7's built-in server (`tsc --lsp`), or [typescript-language-server](https://github.com/typescript-language-server/typescript-language-server) for TypeScript 5 / 6 | `npm install -g typescript-language-server` (with `typescript` too when none is installed) |
| Python (`.py .pyi`) | [Pyright](https://github.com/microsoft/pyright) | `npm install -g pyright` |
| Rust (`.rs`) | [rust-analyzer](https://rust-analyzer.github.io/) | `rustup component add rust-analyzer` |
| Go (`.go`) | [gopls](https://pkg.go.dev/golang.org/x/tools/gopls) | `go install golang.org/x/tools/gopls@latest` |
| C, C++ (`.c .h .cpp .hpp …`) | [clangd](https://clangd.llvm.org/) | `winget install --id LLVM.LLVM -e` |
| C# (`.cs`) | [csharp-ls](https://github.com/razzmatazz/csharp-language-server) | `dotnet tool install --global csharp-ls` |
| CSS, SCSS, Less | vscode-css-language-server | `npm install -g vscode-langservers-extracted` |
| HTML | vscode-html-language-server | `npm install -g vscode-langservers-extracted` |

For TypeScript, a project's own `node_modules\typescript` is used before the global one.

JSON keeps Quarry's own [JSON tools](json.md). Files in [large-file mode](large-files.md) don't use language servers.

## What you get

| Keys | Action |
| --- | --- |
| *typing* | Suggestions from the server; **Ctrl+Space** asks for them |
| *hover* | The symbol's type and documentation |
| **Ctrl+Shift+Space** | Parameter hints for the call you're typing (they also appear by themselves after `(` and `,`) |
| **F12** | Go to Definition, in another tab if it's in another file |
| **Ctrl+F12** | Go to Implementation |
| **Shift+F12** | Find All References, listed in a panel under the editor that takes the keyboard: ↑ / ↓ and Enter go to a reference, Esc or × closes it |
| **F2** | Rename Symbol across the project's open files: type the new name and press Enter (Esc cancels). Each changed tab undoes its part with Ctrl+Z |
| **F8** / **Shift+F8** | Next / previous problem |

All of these are also in the **Code** category of the command palette, along with **Go to Type Definition**, **Format Document with Language Server** and **Restart Language Servers**. Quarry's own **Format Document** (Shift+Alt+F) is unchanged.

The status bar shows the server for the file in front (for example **TypeScript**), and what it's doing while it indexes (**rust-analyzer: Indexing 40%**). Hover over it to see the project folder the server works in.

## Problems

Errors and warnings from the server are underlined in the editor and marked in the gutter. Hover over an underline to read the message.

- **Status bar.** The ✖ and ⚠ counts are for the file in front. Click them to open the **Problems** list.
- **Problems list.** **View › Problems** (or the Problems tab of the bottom panel, **Ctrl+J**) lists the problems in every open file, errors first. Click one to go to it.

## Installing a language server

If the server for a file isn't installed, the status bar shows **Install … support**. Clicking it runs the install command in a terminal tab, so you can see what happens. When it finishes, the servers restart and your open files connect.

For TypeScript the offer depends on what you have. With TypeScript 5 or 6 installed (in the project or globally) and no typescript-language-server, it installs only typescript-language-server (`npm install -g typescript-language-server`) and leaves your TypeScript as it is. With no TypeScript at all, it installs both (`npm install -g typescript-language-server typescript`); whichever version npm installs, one of the two then serves.

Install commands need the matching tool chain: Node.js for the npm ones, rustup for rust-analyzer, Go for gopls, the .NET SDK for csharp-ls. **Settings › Languages › Code intelligence** lists every server, says whether it's installed (click its name to see where), and has an **Install…** button for each missing one.

## Projects

Each server runs once per project. The project folder is the nearest folder above the file that has one of the server's marker files: `tsconfig.json` / `package.json` for TypeScript, `pyproject.toml` for Python, `Cargo.toml` for Rust, `go.mod` for Go, `compile_commands.json` for clangd, `*.sln` / `*.csproj` for C#, or `.git`.

- **Open folder.** When the file is inside the open folder, the search stops there, and with no marker found the open folder is the project.
- **Never too wide.** A drive root or your home folder is never used as a project, so a server doesn't try to index the whole disk.

## Settings

**Settings › Languages › Code intelligence**:

- **Code intelligence**: everything on or off.
- **Each server**: one line with a status dot (green installed, amber missing, hollow switched off), an **Install…** button when it's missing, and a switch to turn it off. Click the server's name to see where it's installed and to type your own command line (for example `"C:\LLVM\bin\clangd.exe" --background-index`). Empty means the default.
- **Restart language servers**: after installing or updating one outside Quarry.

## Limits

- **Rename** changes only the files that are open in tabs; uses in files that aren't open stay as they are. Open the files first (or use Replace in Files) to rename everywhere.
- **Hover links.** Documentation from servers is shown with scripts and styles removed, and its links open in your browser.
- **Pull diagnostics.** Servers that only report problems when asked (TypeScript 7) are asked after each pause in typing, for every open file of the project.
