import { FoldVertical, ListOrdered, Pencil, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { closeHistoryEdit, dropCommit, loadEditCommit, openHistoryEdit, rewordCommit, squashCommit, undoLastCommit, useGit } from "../lib/git";
import type { GitGraphCommit, GitHistoryCommit, GitStatus } from "../lib/gitApi";
import { editAllowed, graphEditContext, squashMessage, type EditAction } from "../lib/historyEdit";
import { HistoryEditList } from "./HistoryEditList";

/** The message strip of Reword Message… / Squash into Parent…: what it is about and what it started with. */
interface Strip {
  kind: "reword" | "squash";
  commit: GitHistoryCommit;
  parent: GitHistoryCommit | null;
  initial: string;
}

const ENTRIES: { action: EditAction; label: string; Icon: typeof Pencil; hint: string; danger?: boolean }[] = [
  { action: "undo", label: "Undo Last Commit…", Icon: Undo2, hint: "Take this commit back and keep its changes staged (asks first)" },
  { action: "reword", label: "Reword Message…", Icon: Pencil, hint: "Change this commit's message; it and the commits after it get new ids (asks first)" },
  { action: "squash", label: "Squash into Parent…", Icon: FoldVertical, hint: "Fold this commit into the one before it (asks first)" },
  { action: "drop", label: "Drop Commit…", Icon: Trash2, hint: "Remove this commit and its changes from the branch (asks first)", danger: true },
  { action: "list", label: "Edit History from Here…", Icon: ListOrdered, hint: "List the commits from this one to the tip to reorder, reword, squash or drop them; nothing changes until you run it" },
];

/**
 * Edit History in the graph tab (specs/git-history-edit.md): the commit menu's group (HISTORY-001),
 * the message strip for Reword / Squash (HISTORY-003, HISTORY-005) and the Edit History list that
 * takes the place of the rows (HISTORY-007). GraphView renders `menu(commit)` after its Reset
 * entries, `strip` and `list` above its rows, and hides the rows while `editing`.
 */
export function useGraphHistory(root: string, visible: boolean, repo: GitStatus | undefined, busy: string | null, commits: GitGraphCommit[], closeMenu: () => void) {
  const open = useGit((s) => s.historyEdit);
  const editing = open && open.root.toLowerCase() === root.toLowerCase() ? open : null;
  const [strip, setStrip] = useState<Strip | null>(null);

  // The list belongs to this tab: gone when the tab closes, and when an operation stops part-way
  // (the rows come back under the stopped-operation strip).
  useEffect(() => () => closeHistoryEdit(root), [root]);
  const stopped = !!repo?.operation;
  useEffect(() => {
    if (!stopped) return;
    closeHistoryEdit(root);
    setStrip(null);
  }, [stopped, root]);

  const start = async (action: EditAction, c: GitGraphCommit) => {
    setStrip(null);
    if (action === "undo") void undoLastCommit(root);
    else if (action === "drop") void dropCommit(root, c.sha);
    else if (action === "list") void openHistoryEdit(root, c.sha);
    else {
      const m = await loadEditCommit(root, c.sha, action);
      if (m) setStrip({ kind: action, commit: m.commit, parent: m.parent, initial: m.parent ? squashMessage(m.parent.message, m.commit.message) : m.commit.message });
    }
  };

  /** The group for a commit's right-click menu: disabled entries say why in their tooltip; Undo only on the tip. */
  const menu = (c: GitGraphCommit) => {
    const ctx = graphEditContext(commits, c.sha, repo, busy);
    const tip = c.refs.includes("HEAD");
    return (
      <>
        <div className="menu-sep" />
        {ENTRIES.filter((e) => e.action !== "undo" || tip).map((e) => {
          const off = editAllowed(e.action, c, ctx);
          return (
            <button key={e.action} className={`palette-item ${e.danger ? "danger" : ""}`} role="menuitem" disabled={!!off} title={off ?? e.hint} onClick={() => { closeMenu(); void start(e.action, c); }}>
              <e.Icon size={13} /><span className="title">{e.label}</span>
            </button>
          );
        })}
      </>
    );
  };

  return {
    editing: !!editing,
    menu,
    strip: strip && !editing ? (
      <MessageStrip
        key={`${strip.kind}:${strip.commit.sha}`}
        strip={strip}
        busy={!!busy}
        onClose={() => setStrip(null)}
        onSubmit={async (text) => {
          const ran = strip.kind === "reword" ? await rewordCommit(root, strip.commit.sha, text) : await squashCommit(root, strip.commit.sha, text);
          if (ran) setStrip(null);
        }}
      />
    ) : null,
    list: editing ? <HistoryEditList key={editing.seq} root={root} range={editing.range} visible={visible} /> : null,
  };
}

/** A multi-line message box above the graph's rows: Ctrl+Enter submits, Enter adds a line, Escape closes. */
function MessageStrip({ strip, busy, onSubmit, onClose }: { strip: Strip; busy: boolean; onSubmit: (text: string) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState(strip.initial);
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, []);
  const reword = strip.kind === "reword";
  // Reword: only a message that differs; Squash: any message.
  const ok = !!text.trim() && !busy && !sending && (!reword || text.trim() !== strip.initial.trim());
  const submit = async () => {
    if (!ok) return;
    setSending(true);
    await onSubmit(text);
    setSending(false);
  };
  return (
    <div className="graph-naming graph-message-strip" data-history-keys>
      <span>{reword ? <>New message for <span className="mono">{strip.commit.short}</span>:</> : <>Message for <span className="mono">{strip.parent?.short}</span> + <span className="mono">{strip.commit.short}</span>:</>}</span>
      <textarea
        ref={box}
        className="input"
        spellCheck={false}
        rows={Math.min(8, Math.max(3, text.split("\n").length))}
        aria-label={reword ? "New commit message" : "Message of the combined commit"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") onClose();
          e.stopPropagation();
        }}
      />
      <button className="btn btn-primary small" disabled={!ok} title={`${reword ? "Reword" : "Squash"} (Ctrl+Enter); asks first`} onClick={() => void submit()}>{reword ? "Reword" : "Squash"}</button>
      <button className="icon-btn xs" title="Cancel (Escape)" onClick={onClose}><X size={14} /></button>
    </div>
  );
}
