# Quarry specs: user stories and acceptance criteria

This folder says what Quarry is expected to do, feature by feature, and which files do it. It is written for coding agents and reviewers: before changing a feature, read its stories; when behaviour changes, change the story in the same commit.

Nothing here ships in the application.

[FINDINGS.md](FINDINGS.md) lists possible bugs and doc/code mismatches noticed while the stories were written; it is not a spec and the index ignores it.

## How to look things up

| You have | Look in |
| --- | --- |
| A feature area | The table of areas below, then that area's `.md` file |
| A story id (`GIT-012`) or scenario id (`GIT-012.3`) | `index.json` → `stories["GIT-012"]` gives the spec file and line, commands, files, tests |
| A source file you are about to change | `index.json` → `files["src/lib/git.ts"]` lists every story that depends on it |
| A command id (`git.push`) | `index.json` → `commands["git.push"]` |
| A test file | `index.json` → `tests[...]` |

The quickest way is the lookup command, which takes any mix of source files, command ids and story ids:

```
pnpm specs --for src/lib/tabLimit.ts git.push UPD-002
```

It prints each story's id, title and `spec file:line` (and, for a story id, its files and tests); read that section of the spec file next.

`index.json` is generated from the `.md` files. Never edit it by hand:

- `pnpm specs` rebuilds it and prints problems.
- `pnpm specs:check` (also run by `pnpm test`, in `src/__tests__/specs.test.ts`) fails when a story is malformed, a listed file no longer exists, a source file or command has no story, or the index is stale.

## Areas

<!-- areas:start -->
| Prefix | Area | File | Stories |
| --- | --- | --- | --- |
| `BIG` | Large Files | [large-files.md](large-files.md) | 20 |
| `CLAUDE` | Claude Code Tabs | [claude-code.md](claude-code.md) | 20 |
| `CONFLICT` | Merge Conflicts and Stopped Operations | [git-conflicts.md](git-conflicts.md) | 13 |
| `DIFF` | Compare | [compare.md](compare.md) | 14 |
| `EDIT` | Text Editing | [editing.md](editing.md) | 23 |
| `EXPL` | Explorer and File Operations | [explorer.md](explorer.md) | 17 |
| `FILE` | Files and Sessions | [files.md](files.md) | 20 |
| `FIND` | Find and Replace in a Document | [find.md](find.md) | 9 |
| `FMT` | Formatting | [formatting.md](formatting.md) | 10 |
| `GIT` | Source Control | [git.md](git.md) | 27 |
| `GRAPH` | Commit Graph | [git-graph.md](git-graph.md) | 14 |
| `JSON` | JSON Tools | [json.md](json.md) | 14 |
| `LSP` | Code Intelligence | [code-intelligence.md](code-intelligence.md) | 17 |
| `MACRO` | Macros | [macros.md](macros.md) | 13 |
| `SCRIPT` | Scripts | [scripting.md](scripting.md) | 15 |
| `SEARCH` | Find in Files | [search.md](search.md) | 16 |
| `SET` | Settings | [settings.md](settings.md) | 18 |
| `SPLIT` | Split Editor | [split.md](split.md) | 7 |
| `TAB` | Tabs | [tabs.md](tabs.md) | 9 |
| `TERM` | Claude CLI Terminal Tabs | [terminal.md](terminal.md) | 9 |
| `UI` | Application Shell | [app-shell.md](app-shell.md) | 25 |
| `UPD` | Updates and About | [updates.md](updates.md) | 7 |
<!-- areas:end -->

## Story format

One file per area. The file starts with front matter, then one `##` section per story:

````markdown
---
area: Source Control
prefix: GIT
---

# Source Control

One or two sentences on what the area covers and where its user documentation is.

## GIT-012: Commit staged changes

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitPanel.tsx` — commit box, button label
  - `src/lib/git.ts` — `commit()` action, unsaved-tabs warning
  - `src/lib/gitStatus.ts` — `commitLabel`
  - `src-tauri/src/git.rs` — `git_commit`
- Tests: `src/__tests__/gitRemote.test.ts`
- Docs: `docs/git.md`

**As a** developer working in a git repository
**I want** to commit my staged changes from the Source Control panel
**So that** I can record my work without leaving the editor

```gherkin
Scenario: GIT-012.1 Commit what is staged
  Given a repository with 3 staged files and 2 unstaged changes
  And the message box contains "Fix tab order"
  When I click "Commit 3 Staged"
  Then a commit "Fix tab order" is created with the 3 staged files
  And the 2 unstaged changes remain in Changes

Scenario: GIT-012.2 Nothing to commit
  Given a repository with no changes
  When I open the Source Control panel
  Then the Commit button is disabled
```
````

Rules (the index script enforces the mechanical ones):

- **Ids are permanent.** `PREFIX-NNN`, three digits, numbered in file order when first written. Never renumber or reuse; a removed story's number stays retired. New stories take the next free number. Scenario ids are `<story id>.<n>`, in order.
- **Status.** `draft` = written from the code, describes what the application does today, not yet confirmed by the owner as what it *should* do. `verified` = confirmed. Only the owner sets `verified`. When code and a `verified` story disagree, the code is wrong; when code and a `draft` story disagree, ask.
- **Commands.** The command ids (`src/lib/commands.ts`, `gitCommands.ts`, …) that start this behaviour, or `none`.
- **Files.** Every file a change to this story would probably touch, one per line, with a short note naming the function, component or Tauri command that matters. Repository-relative, forward slashes. List shared files (`store.ts`, `commands.ts`, `types.ts`, `app.css`) only when real logic for the story lives in them.
- **Tests.** Test files that exercise the story (`src/__tests__/*.test.ts`, or the Rust file whose `#[cfg(test)]` module does), or `none`.
- **Docs.** The user documentation page, when there is one.
- **Story.** Exactly the three lines `**As a**`, `**I want**`, `**So that**`. The role is a real kind of user (a developer, someone reading a 4 GB log, …), never "the system".
- **Acceptance criteria.** One `gherkin` block per story. Each scenario is one observable behaviour in Given / When / Then (every scenario needs a `When` and a `Then`), in the user's terms: what they see and do, with concrete values ("3 staged files", `Ctrl+Shift+G`). Function names and implementation detail belong in the Files notes, not in scenarios. Cover the main path and the rules and guards that are easy to break (limits, confirmations, disabled states, what must *not* happen).

## Keeping it true

- A change to behaviour updates the story and its scenarios in the same commit; a new feature adds a story; a new source file or command must appear in some story (the check fails otherwise).
- When a file is renamed or split, fix the `Files` lists and run `pnpm specs`.
- A code review of a change starts from `index.json` → `files[...]` for each touched file: those are the scenarios the change must still satisfy.
