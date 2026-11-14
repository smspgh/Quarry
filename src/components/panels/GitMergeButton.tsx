import { GitMerge, GitPullRequestArrow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { runCommand } from "../../lib/commands";
import { useGit } from "../../lib/git";
import type { GitStatus } from "../../lib/gitApi";
import { startBlocked } from "../../lib/gitMerge";

/**
 * The Source Control panel's "Merge or Rebase" button, right after the branch button: a menu with
 * Merge Branch… and Rebase onto Branch… (the same commands as the Git menu and the palette).
 * Disabled, with the reason as its tooltip, while an operation is stopped or git is busy.
 */
export function MergeRebaseButton({ repo }: { repo: GitStatus }) {
  const busy = useGit((s) => s.busy);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const blocked = { merge: startBlocked(repo, "merge", busy), rebase: startBlocked(repo, "rebase", busy) };
  // Nothing in the menu could run: the button itself is disabled and says why.
  const off = blocked.merge && blocked.rebase ? blocked.merge : null;

  // The menu closes on a click outside it, Escape, or losing the window.
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", close);
    };
  }, [at]);

  const open = () => {
    const r = button.current?.getBoundingClientRect();
    setAt(at ? null : { left: Math.max(4, Math.min(r?.left ?? 0, window.innerWidth - 228)), top: (r?.bottom ?? 0) + 2 });
  };
  const entry = (id: "git.mergeBranch" | "git.rebaseBranch", label: string, why: string | null, hint: string, Icon: typeof GitMerge) => (
    <button
      className="palette-item"
      role="menuitem"
      disabled={!!why}
      title={why ?? hint}
      onClick={() => {
        setAt(null);
        void runCommand(id);
      }}
    >
      <Icon size={13} />
      <span className="title">{label}</span>
    </button>
  );
  const into = repo.branch ?? "the current commit";

  return (
    <>
      <button
        ref={button}
        className="btn small scm-merge-btn"
        aria-label="Merge or Rebase"
        aria-haspopup="menu"
        aria-expanded={!!at}
        title={off ?? "Merge or Rebase: bring another branch's commits into this one, or move this branch on top of another"}
        disabled={!!off}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={open}
      >
        <GitMerge size={13} />
      </button>
      {at &&
        createPortal(
          <div className="palette ctx-menu scm-merge-menu" role="menu" aria-label="Merge or Rebase" style={{ left: at.left, top: at.top }} onMouseDown={(e) => e.stopPropagation()}>
            {entry("git.mergeBranch", "Merge Branch…", blocked.merge, `Pick a branch to merge into ${into}`, GitMerge)}
            {entry("git.rebaseBranch", "Rebase onto Branch…", blocked.rebase, `Pick a branch to rebase ${repo.branch ?? "your branch"} onto`, GitPullRequestArrow)}
          </div>,
          document.body,
        )}
    </>
  );
}
