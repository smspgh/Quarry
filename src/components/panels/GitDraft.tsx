import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { draftState } from "../../lib/gitAi";
import type { GitStatus } from "../../lib/gitApi";
import { cancelAssist, clearDraftNote, draftCommitMessage, draftRepo, takeDraft, useGitAssist } from "../../lib/gitAssist";
import { useStore } from "../../lib/store";

/**
 * The commit box's side of "Draft Commit Message with Claude" (specs/git-claude.md, GITAI-003 to
 * 005): the Draft button, what the message box shows while Claude is drafting, taking the draft
 * when it arrives (also when the panel was closed meanwhile), and the "Large change" line. The
 * request itself is lib/gitAssist.ts; with Claude Code switched off `on` is false and nothing shows.
 */
export function useDraft(repo: GitStatus | null, message: string, setMessage: (m: string) => void, amend: boolean) {
  const on = useStore((s) => s.settings.claudeEnabled);
  const a = useGitAssist();
  const root = repo?.root ?? null;
  const same = (r: string | null | undefined) => !!root && !!r && r.toLowerCase() === root.toLowerCase();
  const drafting = on && a.assist?.kind === "draft" && same(a.assist.root);
  const box = useRef<HTMLTextAreaElement>(null);
  // What the box holds and whether Amend is ticked, for a draft started by the command.
  const now = useRef({ message, amend });
  now.current = { message, amend };

  // The draft arrived (or was waiting while the panel was closed): it becomes the message, ready to edit.
  useEffect(() => {
    if (!root || !a.draft) return;
    const text = takeDraft(root);
    if (text === null) return;
    setMessage(text);
    setTimeout(() => box.current?.focus(), 0);
  }, [a.draft, root]);

  // "Draft Commit Message with Claude" from the palette or the Git menu.
  useEffect(() => {
    if (!a.draftAsked || !root) return;
    useGitAssist.setState({ draftAsked: false });
    void draftCommitMessage(root, now.current);
  }, [a.draftAsked, root]);

  // Another repository's draft is "another request" here, like a summary or a conflict.
  const state = repo ? draftState(draftRepo(repo), amend, drafting ? "draft" : a.assist ? "summary" : null) : null;
  const tooltip = state?.tooltip ?? "";
  const disabled = !state || (!drafting && !!state.disabled);

  const button =
    on && repo ? (
      <button
        className={`btn small scm-draft ${drafting ? "busy" : ""}`}
        disabled={disabled}
        title={tooltip}
        aria-label={drafting ? "Stop drafting" : "Draft a commit message with Claude"}
        onClick={() => {
          if (drafting) cancelAssist();
          else void draftCommitMessage(repo.root, now.current);
        }}
      >
        {drafting ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}
        Draft
      </button>
    ) : null;

  const noteText = on && a.draftNote && same(a.draftNote.root) ? a.draftNote.text : "";
  const note = noteText ? <div className="scm-hint scm-draft-note">{noteText}</div> : null;

  return {
    on,
    /** Claude is drafting for this repository: the box is read-only and shows the working line. */
    drafting,
    box,
    button,
    note,
    /** The user changed the message: an emptied box drops the "Large change" line. */
    edited: (text: string) => {
      if (!text.trim() && root) clearDraftNote(root);
    },
    /** A commit was made with the message. */
    committed: () => {
      if (root) clearDraftNote(root);
    },
    /** Escape in the message box stops a running draft. True when it did. */
    escape: () => (drafting ? cancelAssist() : false),
  };
}

export const DRAFTING_PLACEHOLDER = "Claude is drafting a message…";
