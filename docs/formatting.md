# Formatting

**Format Document** (**Shift+Alt+F**, or **Code › Format Document**) reformats the current file. Which formatter runs depends on the document's language, shown in the status bar.

Formatting works out of the box for every language below except Rust. Nothing extra needs installing.

| Language | Formatter |
| --- | --- |
| JSON | Quarry's own formatter (see [JSON › Format and minify](json.md#format-and-minify)) |
| JavaScript, JSX, TypeScript, TSX, CSS, SCSS, Less, HTML, Vue, Angular, Markdown, YAML, GraphQL, XML, SVG | [Prettier](https://prettier.io/), built in |
| Go, Python, C, C++, C#, Java, Shell, SQL (and its MySQL, MariaDB, PostgreSQL, SQL Server, SQLite and PL/SQL variants) | Your installed formatter if you have one, otherwise a built-in one (below) |
| Rust | `rustfmt`, which you install (it comes with Rust) |

When it's done, the message says which formatter ran, for example "Formatted (Python, built-in ruff)" or "Formatted (Python, ruff)". Formatting is one undo step. If the language is wrong (for example an untitled file), set it with **Code › Language** or **Ctrl+K M** first.

## Web languages (Prettier)

Prettier is bundled and loaded the first time you format. It uses:

- **Tab size** and **Insert spaces** from Settings;
- a line width of 100;
- for XML and SVG, [`@prettier/plugin-xml`](https://github.com/prettier/plugin-xml), formatting without regard to whitespace and putting closing brackets on their own line.

With a non-empty selection in JavaScript, JSX, TypeScript, TSX, GraphQL or Vue, only the selection is formatted (Prettier widens it to whole statements or elements). Prettier cannot format part of a CSS, SCSS, Less, HTML, Angular, Markdown, YAML or XML file, so there the selection is ignored and the whole document is formatted.

## Other languages: installed or built in

For these languages, Quarry first looks for the standard command-line formatter on your `PATH`. If it's installed, Quarry uses it, so the result matches what you, your editor and your CI already produce, including your project's configuration files. If it isn't installed, Quarry uses the built-in formatter instead.

| Language | Installed tool (preferred) | Built-in fallback |
| --- | --- | --- |
| Go | `gofmt` | [gofmt](https://pkg.go.dev/cmd/gofmt), compiled to WebAssembly: identical output |
| Python | `ruff format` | [Ruff](https://docs.astral.sh/ruff/formatter/)'s formatter, compiled to WebAssembly (Black-compatible style) |
| C, C++ | `clang-format` | [clang-format](https://clang.llvm.org/docs/ClangFormat.html), compiled to WebAssembly, LLVM style |
| C# | `dotnet csharpier` | clang-format, Microsoft style |
| Java | `google-java-format` | [prettier-plugin-java](https://github.com/jhipster/prettier-java) |
| Shell | `shfmt` | [shfmt](https://github.com/mvdan/sh), compiled to WebAssembly |
| SQL | `sqlfluff fix` | [sql-formatter](https://github.com/sql-formatter-org/sql-formatter), using the dialect of the document's language |
| MySQL, MariaDB SQL, PostgreSQL, MS SQL, SQLite, PLSQL | – | sql-formatter with that dialect |
| Rust | `rustfmt` | none |

**Built-in formatters**

- They run inside Quarry, offline, and are loaded the first time you format a file of that language. Until then they cost no memory or start-up time.
- They use **Tab size** and **Insert spaces** from Settings and a line width of 100. Exceptions: gofmt always uses tabs, as Go requires, and Ruff uses its usual 88.
- They don't read project configuration files such as `.clang-format`, `pyproject.toml` or `.editorconfig`. If your project has those, install the tool so Quarry uses it instead.
- For C#, clang-format gives clean, consistent layout but is less C#-aware than CSharpier. Install CSharpier if you need its exact style.
- SQL keywords keep their case.

**Installed tools**

Quarry runs these without a console window, sends the document on standard input, and replaces the document with their output:

| Tool | Command run | Install |
| --- | --- | --- |
| rustfmt | `rustfmt --edition 2021 --emit stdout` | `rustup component add rustfmt` |
| gofmt | `gofmt` | Install [Go](https://go.dev/dl/) |
| Ruff | `ruff format -` | `pip install ruff` |
| clang-format | `clang-format` | Install [LLVM](https://releases.llvm.org/) |
| CSharpier | `dotnet csharpier --` | `dotnet tool install -g csharpier` |
| google-java-format | `google-java-format -` | [google-java-format](https://github.com/google/google-java-format) |
| shfmt | `shfmt -` | [shfmt](https://github.com/mvdan/sh) |
| SQLFluff | `sqlfluff fix -` | `pip install sqlfluff` |

- The tool runs in the document's folder, so it finds project configuration files as it would on the command line (`rustfmt.toml`, `.clang-format`, `pyproject.toml`, `.sqlfluff`, …).
- If the tool reports an error, for example a syntax error in the file, the document is left unchanged and the tool's message is shown. Quarry doesn't fall back to the built-in formatter in that case, because it would most likely hit the same error.
- For Rust without rustfmt installed, a message says how to install it.

## Syntax errors

A formatter can't format code it can't parse. If the file has a syntax error, the document is left unchanged and the message shows where the error is, for example `2:12: expected ')', found '{'`. For JSON, the cursor is also moved to the error.
