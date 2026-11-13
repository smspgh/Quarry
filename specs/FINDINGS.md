# Findings from writing the specs (2026-11-13)

Possible bugs, doc/code mismatches and open questions noticed while the stories were written from the code. **None of these was verified by running the application**; each is a reading of the code at the lines given (as of Quarry 0.1.7) and needs a check before it is acted on. Where a finding touches a story, the story records today's behaviour (`Status: draft`); if the behaviour is changed, update the story in the same commit and delete the entry here.

This file is not a spec: `scripts/specs-index.mjs` ignores it.

## Wording pass

About 190 scenarios had a `When` step added or converted mechanically to satisfy the format (mainly in `git-graph.md`, `git-conflicts.md`, `compare.md`, `claude-code.md`, `terminal.md`, `code-intelligence.md`, `large-files.md`). Some read as observations ("When I look at the toolbar") or states ("When Claude is working…"); they are correct but worth rewording as each story is reviewed.
