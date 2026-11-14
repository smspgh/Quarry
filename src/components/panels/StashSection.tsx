import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { relativeTime } from "../../editor/git";
import { openPath } from "../../lib/actions";
import { openStashFile, stashAction, stashChanges, useGit } from "../../lib/git";
import { git, type GitCommitFile, type GitStash, type GitStatus } from "../../lib/gitApi";
import { STASH_CONFLICT, stashBlocked, stashCounts, stashTitle, stashWhere } from "../../lib/gitStash";
import { commitFileKind, KIND_LABEL, KIND_LETTER } from "../../lib/gitStatus";
import { fs } from "../../lib/ipc";

/** The last Show Stashes request this section acted on (it outlives the panel being closed). */
let revealed = 0;

/** The repository the open Stash Changes form was opened for (null: no form). */
let formRoot: string | null = null;

/** The Stash Changes form: an optional message and whether untracked files go along. */
function StashForm({ repo, busy }: { repo: GitStatus; busy: boolean }) {
  const [message, setMessage] = useState("");
  // Ticked every time the form opens: untracked files are listed under Changes like the rest.
  const [untracked, setUntracked] = useState(true);
  const n = stashCounts(repo.files);
  const blocked = stashBlocked(repo, "stash");
  const withUntracked = untracked && n.untracked > 0;
  const onlyUntracked = !blocked && n.tracked === 0 && n.untracked > 0 && !untracked;
  const can = !busy && !blocked && n.tracked + (withUntracked ? n.untracked : 0) > 0;
  const submit = () => {
    if (can) void stashChanges(repo.root, message, withUntracked);
  };
  const cancel = () => useGit.setState({ stashForm: false });
  // The form belongs to the repository it was opened for: shown for another one (the section is
  // drawn again for the new repository while `stashForm` is still set) it closes itself.
  useEffect(() => {
    if (formRoot !== null && formRoot !== repo.root) cancel();
    else formRoot = repo.root;
    return () => {
      if (!useGit.getState().stashForm) formRoot = null;
    };
  }, [repo.root]);
  return (
    <div
      className="scm-form scm-stash-form"
      role="form"
      aria-label="Stash changes"
      // Escape closes the form from the checkbox and the buttons too, not only from the message box.
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }}
    >
      <input
        autoFocus
        className="input"
        placeholder="Stash message (optional)"
        aria-label="Stash message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          e.stopPropagation();
          submit();
        }}
      />
      {n.untracked > 0 && (
        <label className="check" title="Also stash the new files git does not track yet. Ignored files are never stashed.">
          <input type="checkbox" checked={untracked} onChange={(e) => setUntracked(e.target.checked)} />
          Include untracked files ({n.untracked})
        </label>
      )}
      {onlyUntracked && <div className="scm-hint">Only untracked files have changed: tick the box to stash them.</div>}
      <div className="row">
        <button className="btn btn-primary small" disabled={!can} title={blocked ?? undefined} onClick={submit}>
          Stash
        </button>
        <button className="btn small" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The repository's stashes, newest first, between the change sections and Commits. A row opens to
 * the files the stash holds; Apply / Pop / Drop are on the row. There is always a section once the
 * repository has a commit, so Stash Changes can be found.
 */
export function StashesSection({ repo }: { repo: GitStatus }) {
  const list = useGit((s) => s.stashes[repo.root.toLowerCase()]);
  const form = useGit((s) => s.stashForm);
  const busy = useGit((s) => s.busy);
  const pending = useGit((s) => s.stashPending);
  const reveal = useGit((s) => s.stashReveal);
  const [open, setOpen] = useState(true);
  /** Expanded stashes: their files once loaded (null while loading). */
  const [files, setFiles] = useState<Record<string, GitCommitFile[] | null>>({});
  const first = useRef<HTMLDivElement>(null);

  // Show Stashes: open the list and put the focus on its first row.
  useEffect(() => {
    if (reveal <= revealed) return;
    revealed = reveal;
    setOpen(true);
    const t = window.setTimeout(() => first.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [reveal]);

  if (!repo.head) return null;

  const stashes: GitStash[] = list ?? [];
  const blockedNew = stashBlocked(repo, "stash");
  const blockedBack = stashBlocked(repo, "apply");
  const toggle = (s: GitStash) => {
    if (s.sha in files) {
      setFiles((f) => {
        const n = { ...f };
        delete n[s.sha];
        return n;
      });
      return;
    }
    setFiles((f) => ({ ...f, [s.sha]: null }));
    void git.stashFiles(repo.root, s.sha).then(
      (l) => setFiles((f) => (s.sha in f ? { ...f, [s.sha]: l } : f)),
      () => setFiles((f) => (s.sha in f ? { ...f, [s.sha]: [] } : f)),
    );
  };

  return (
    <div className="scm-section" role="group" aria-label="Stashes">
      <div className="scm-section-head" onClick={() => setOpen(!open)}>
        <span className={`tree-chevron ${open ? "open" : ""}`}>
          <ChevronRight size={14} />
        </span>
        <span>Stashes</span>
        {stashes.length > 0 && <span className="scm-count">{stashes.length}</span>}
        <span className="grow" />
        <span className="scm-actions always" onClick={(e) => e.stopPropagation()}>
          <button className="btn small scm-stash-new" disabled={!!busy || !!blockedNew} title={blockedNew ?? "Put your uncommitted changes aside, to bring back later"} onClick={() => useGit.setState({ stashForm: true })}>
            Stash Changes…
          </button>
        </span>
      </div>
      {form && <StashForm repo={repo} busy={!!busy} />}
      {open && (
        <>
          {stashes.length === 0 && <div className="panel-note">{list ? "No stashes. Stash Changes puts your uncommitted work aside to bring back later." : "Loading…"}</div>}
          <div role="list">
            {stashes.map((s, i) => {
              const t = stashTitle(s.subject);
              const held = files[s.sha];
              const isOpen = s.sha in files;
              const conflicted = pending?.sha === s.sha;
              const act = (what: "apply" | "pop" | "drop") => void stashAction(repo.root, s, what);
              return (
                <div key={s.sha} role="listitem">
                  <div
                    ref={i === 0 ? first : undefined}
                    className="scm-commit scm-commit-row scm-stash"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    title={`${t.title}\nMade ${t.branch ? `on ${t.branch}` : "on no branch"}, ${new Date(s.time * 1000).toLocaleString()}\nOn commit ${s.base.slice(0, 7)}${s.untracked ? "\nHolds untracked files too" : ""}${conflicted ? `\nApplied with conflicts: resolve the files under Merge Changes` : ""}\n\nClick to see the files it holds`}
                    onClick={() => toggle(s)}
                    onKeyDown={(ev) => {
                      if (ev.target !== ev.currentTarget) return;
                      if (ev.key === "Enter") toggle(s);
                      if (ev.key === "Delete") act("drop");
                    }}
                  >
                    <span className={`tree-chevron ${isOpen ? "open" : ""}`}>
                      <ChevronRight size={14} />
                    </span>
                    <div className="scm-commit-text">
                      <div className="scm-commit-line">
                        <span className="truncate grow">{t.title}</span>
                        <span className="scm-actions" onClick={(e) => e.stopPropagation()}>
                          <button className="btn small scm-side" disabled={!!busy || !!blockedBack} title={blockedBack ?? "Bring this stash's changes back into your files and keep the stash"} onClick={() => act("apply")}>
                            Apply
                          </button>
                          <button className="btn small scm-side" disabled={!!busy || !!blockedBack} title={blockedBack ?? "Bring this stash's changes back into your files and remove it from the list"} onClick={() => act("pop")}>
                            Pop
                          </button>
                          <button className="btn small scm-side scm-stash-drop" disabled={!!busy} title="Delete this stash (asks first)" onClick={() => act("drop")}>
                            Drop
                          </button>
                        </span>
                      </div>
                      <div className="scm-commit-meta">
                        {stashWhere(t.branch, relativeTime(s.time))}
                        {conflicted && <span className="scm-stash-mark"> · {STASH_CONFLICT.rowMark}</span>}
                      </div>
                    </div>
                  </div>
                  {isOpen && held === null && <div className="panel-note scm-commit-files">Loading…</div>}
                  {isOpen && held && held.length === 0 && <div className="panel-note scm-commit-files">This stash holds no file changes.</div>}
                  {isOpen &&
                    held &&
                    held.map((f) => {
                      const kind = commitFileKind(f.status);
                      const slash = f.rel.lastIndexOf("/");
                      return (
                        <div
                          key={f.rel}
                          className="scm-row scm-commit-file"
                          tabIndex={0}
                          title={`${f.rel}\n${KIND_LABEL[kind]}${f.origRel ? ` (from ${f.origRel})` : ""} in this stash\nClick to see what the stash changed, double-click to open the file as it is now`}
                          onClick={() => void openStashFile(s, f)}
                          onDoubleClick={() => f.status !== "D" && void fs.exists(f.path).then((there) => void (there && openPath(f.path)), () => {})}
                          onKeyDown={(ev) => ev.key === "Enter" && void openStashFile(s, f)}
                        >
                          <span className={`scm-name git-${kind}`}>{f.rel.slice(slash + 1)}</span>
                          {slash > 0 && <span className="scm-dir">{f.rel.slice(0, slash).replace(/\//g, "\\")}</span>}
                          <span className="grow" />
                          <span className={`scm-letter git-${kind}`} aria-label={KIND_LABEL[kind]}>
                            {KIND_LETTER[kind]}
                          </span>
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
