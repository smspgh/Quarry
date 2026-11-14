import { Sparkles, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { runCommand } from "../lib/commands";
import { elapsed } from "../lib/gitAi";
import { useGitAssist } from "../lib/gitAssist";
import { useStore } from "../lib/store";

/**
 * Status bar: the Claude git request that is running ("Claude: drafting a commit message… 12s")
 * with a stop button, wherever the user is meanwhile (specs/git-claude.md, GITAI-005).
 */
export function GitAssistStatusItem() {
  const assist = useGitAssist((s) => s.assist);
  const on = useStore((s) => s.settings.claudeEnabled);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!assist) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [assist?.id]);
  if (!assist || !on) return null;
  return (
    <span className="status-item git-assist" title="A Claude git request is running. Nothing changes until you accept its result.">
      <Sparkles size={12} /> Claude: {assist.label}… {elapsed(Date.now() - assist.startedAt)}
      <button className="status-inline-btn" title="Stop Claude Request" aria-label="Stop Claude Request" onClick={() => void runCommand("git.stopClaude")}>
        <Square size={11} />
      </button>
    </span>
  );
}
