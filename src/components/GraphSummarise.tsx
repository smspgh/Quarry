import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { ancestorsOf, BUSY_ELSEWHERE, summariseEntries } from "../lib/gitAi";
import type { GitGraphCommit } from "../lib/gitApi";
import { summarise, summariseBranch, useGitAssist } from "../lib/gitAssist";
import { useStore } from "../lib/store";

/**
 * The last group of a commit's right-click menu in the graph (specs/git-claude.md, GITAI-009):
 * "Summarise <branch> with Claude…" on a commit that carries a local branch label, and "Summarise
 * from Here to <branch> with Claude" on a commit the checked-out one descends from. Nothing while
 * Claude Code is switched off, and nothing on a commit neither applies to.
 */
export function SummariseItems({ root, commits, commit, branch, close }: { root: string; commits: readonly GitGraphCommit[]; commit: GitGraphCommit; branch: string | null; close: () => void }) {
  const on = useStore((s) => s.settings.claudeEnabled);
  const busy = useGitAssist((s) => !!s.assist);
  const head = useMemo(() => commits.find((c) => c.refs.includes("HEAD"))?.sha ?? null, [commits]);
  const ancestors = useMemo(() => ancestorsOf(commits, head), [commits, head]);
  if (!on) return null;
  const entries = summariseEntries(commit, head ? { branch, ancestors } : null);
  if (!entries.length) return null;
  return (
    <>
      <div className="menu-sep" />
      {entries.map((e) => (
        <button
          key={e.label}
          className="palette-item"
          role="menuitem"
          disabled={busy}
          title={busy ? BUSY_ELSEWHERE : e.title}
          onClick={() => {
            close();
            if (e.branch) void summariseBranch(root, e.branch);
            else if (e.range) void summarise(root, { from: e.range.from, to: e.range.to, title: e.range.title, range: e.range.name });
          }}
        >
          <Sparkles size={13} />
          <span className="title">{e.label}</span>
        </button>
      ))}
    </>
  );
}
