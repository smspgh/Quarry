import { ArrowDown, ArrowUp, Check, ChevronRight, CircleDot, CloudDownload, CloudOff, FileDiff, FileText, Folder, GitBranch, GitGraph, History, Minus, Plus, RefreshCw, TriangleAlert, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openPath } from "../../lib/actions";
import { abortOperation, continueOperation, resolveConflicts, takeSide, checkRemote, isMissingRepo, commit, compareCommitWithCurrent, currentRepo, discard, moreHistory, openChange, openCommitChange, openCommitFile, openGraph, pickBranch, remote, rescanGit, stage, unstage, useGit } from "../../lib/git";
import { commitFileKind, commitLabel, gitErrorText, groupFiles, KIND_LABEL, KIND_LETTER, operationWords, rowKind, syncLine, type Group } from "../../lib/gitStatus";
import { git, type GitCommitFile, type GitFile, type GitLogEntry, type GitRemoteOp, type GitStatus } from "../../lib/gitApi";
import { relativeTime } from "../../editor/git";
import { useStore } from "../../lib/store";
import { Select } from "../Select";
import { RepoSettings } from "./GitRepoSettings";
import { MergeRebaseButton } from "./GitMergeButton";
import { forcePush } from "../../lib/git";
import { isRewritten } from "../../lib/gitMerge";
import { StashesSection } from "./StashSection";
import { isStashConflict, STASH_CONFLICT, stashSideTitle } from "../../lib/gitStash";
import { DRAFTING_PLACEHOLDER, useDraft } from "./GitDraft";

const nameOf = (p: string) => p.slice(p.lastIndexOf("\\") + 1);

/** Folder of a file relative to the repository root ("" at the root). */
function relDir(path: string, root: string): string {
  const rel = path.slice(root.length).replace(/^\\/, "");
  const i = rel.lastIndexOf("\\");
  return i > 0 ? rel.slice(0, i) : "";
}

function FileRow({ f, repo, group }: { f: GitFile; repo: GitStatus; group: Group }) {
  const kind = rowKind(f, group);
  const dir = relDir(f.path, repo.root);
  const staged = group === "staged";
  return (
    <div
      className="scm-row"
      role="listitem"
      tabIndex={0}
      title={`${f.path}\n${KIND_LABEL[kind]}${f.origPath ? ` (from ${nameOf(f.origPath)})` : ""}${staged ? ", staged" : ""}\n${group === "conflict" ? "Click to open the file and resolve the conflict, then mark it resolved with +" : "Click to see the change, double-click to open the file"}`}
      onClick={() => void openChange(f, staged)}
      onDoubleClick={() => void openPath(f.path)}
      onKeyDown={(e) => {
        if (e.key === "Enter") void openChange(f, staged);
      }}
    >
      <span className={`scm-name git-${kind}`}>{nameOf(f.path)}</span>
      {dir && <span className="scm-dir">{dir}</span>}
      <span className="grow" />
      <span className="scm-actions" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {kind !== "deleted" && (
          <button className="icon-btn xs" title="Open file" onClick={() => void openPath(f.path)}>
            <FileText size={14} />
          </button>
        )}
        {group === "changes" && (
          <button className="icon-btn xs" title={f.untracked ? "Delete (to the Recycle Bin)" : "Discard changes"} onClick={() => void discard(repo.root, [f])}>
            <Undo2 size={14} />
          </button>
        )}
        {group === "conflict" && (
          <>
            <button className="btn small scm-side" title={repo.operation === "rebase" ? "Resolve by taking the version on the branch you are rebasing onto, for the whole file (deletes it if that side deleted it)" : !repo.operation ? stashSideTitle("ours") : "Resolve by taking your branch's version of the whole file (deletes it if your branch deleted it)"} onClick={() => void takeSide(repo.root, f, "ours")}>
              Current
            </button>
            <button className="btn small scm-side" title={repo.operation === "rebase" ? "Resolve by taking your own commit's version of the whole file (deletes it if your commit deleted it)" : !repo.operation ? stashSideTitle("theirs") : "Resolve by taking the incoming version of the whole file (deletes it if the incoming side deleted it)"} onClick={() => void takeSide(repo.root, f, "theirs")}>
              Incoming
            </button>
          </>
        )}
        {staged ? (
          <button className="icon-btn xs" title="Unstage" onClick={() => void unstage(repo.root, [f.path])}>
            <Minus size={14} />
          </button>
        ) : (
          <button className="icon-btn xs" title={group === "conflict" ? "Mark as resolved (stage)" : "Stage"} onClick={() => void (group === "conflict" ? resolveConflicts(repo.root, [f.path]) : stage(repo.root, [f.path]))}>
            <Plus size={14} />
          </button>
        )}
      </span>
      <span className={`scm-letter git-${kind}`} aria-label={KIND_LABEL[kind]}>
        {KIND_LETTER[kind]}
      </span>
    </div>
  );
}

function Section({ title, group, files, repo }: { title: string; group: Group; files: GitFile[]; repo: GitStatus }) {
  const [open, setOpen] = useState(true);
  if (!files.length) return null;
  const paths = files.map((f) => f.path);
  return (
    <div className="scm-section" role="group" aria-label={title}>
      <div className="scm-section-head" onClick={() => setOpen(!open)}>
        <span className={`tree-chevron ${open ? "open" : ""}`}>
          <ChevronRight size={14} />
        </span>
        <span>{title}</span>
        <span className="scm-count">{files.length}</span>
        <span className="grow" />
        <span className="scm-actions" onClick={(e) => e.stopPropagation()}>
          {group === "changes" && (
            <button className="icon-btn xs" title="Discard all changes" onClick={() => void discard(repo.root, files)}>
              <Undo2 size={14} />
            </button>
          )}
          {group === "staged" ? (
            <button className="icon-btn xs" title="Unstage all" onClick={() => void unstage(repo.root, paths)}>
              <Minus size={14} />
            </button>
          ) : (
            <button className="icon-btn xs" title={group === "conflict" ? "Mark all as resolved (stage)" : "Stage all"} onClick={() => void (group === "conflict" ? resolveConflicts(repo.root, paths) : stage(repo.root, paths))}>
              <Plus size={14} />
            </button>
          )}
        </span>
      </div>
      {open && (
        <div role="list">
          {files.map((f) => (
            <FileRow key={`${group}:${f.path}`} f={f} repo={repo} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

const COMMITS_PAGE = 30;

/**
 * The branch's commits, newest first. Commits the remote does not have yet are marked; a commit
 * opens to the files it changed, and a file there opens what the commit changed in it.
 */
function CommitsSection({ repo }: { repo: GitStatus }) {
  const [open, setOpen] = useState(true);
  const [entries, setEntries] = useState<GitLogEntry[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unpushed, setUnpushed] = useState<Set<string>>(new Set());
  /** Expanded commits: their files once loaded (null while loading). */
  const [files, setFiles] = useState<Record<string, GitCommitFile[] | null>>({});
  const tracked = !!repo.upstream && !repo.upstreamGone;

  // Reload when the branch moves: a commit, pull, push, checkout.
  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.all([git.log(repo.root, 0, COMMITS_PAGE).catch(() => [] as GitLogEntry[]), git.unpushed(repo.root).catch(() => [] as string[])]).then(([list, ahead]) => {
      if (!live) return;
      setEntries(list);
      setMore(list.length === COMMITS_PAGE);
      setUnpushed(new Set(ahead));
      setLoading(false);
    });
    return () => { live = false; };
  }, [repo.root, repo.head, repo.branch, repo.ahead, repo.behind, repo.upstream]);

  if (!repo.head) return null;

  const loadMore = async () => {
    setLoading(true);
    const next = await git.log(repo.root, entries.length, COMMITS_PAGE).catch(() => [] as GitLogEntry[]);
    setEntries((cur) => [...cur, ...next.filter((n) => !cur.some((c) => c.sha === n.sha))]);
    setMore(next.length === COMMITS_PAGE);
    setLoading(false);
  };
  const toggle = (e: GitLogEntry) => {
    if (e.sha in files) {
      setFiles((f) => {
        const n = { ...f };
        delete n[e.sha];
        return n;
      });
      return;
    }
    setFiles((f) => ({ ...f, [e.sha]: null }));
    void git.commitFiles(repo.root, e.sha).then(
      (list) => setFiles((f) => (e.sha in f ? { ...f, [e.sha]: list } : f)),
      () => setFiles((f) => (e.sha in f ? { ...f, [e.sha]: [] } : f)),
    );
  };

  return (
    <div className="scm-section" role="group" aria-label="Commits">
      <div className="scm-section-head" onClick={() => setOpen(!open)}>
        <span className={`tree-chevron ${open ? "open" : ""}`}>
          <ChevronRight size={14} />
        </span>
        <span>Commits</span>
        {/* git's ahead count, not the marked commits: those stop at 500. */}
        {tracked && repo.ahead > 0 && <span className="scm-count" title={`${repo.ahead} not on ${repo.upstream} yet`}>{repo.ahead} to push</span>}
        {repo.behind > 0 && <span className="scm-count" title={`${repo.behind} on ${repo.upstream} that you don't have yet: open the graph to see them`}>{repo.behind} to pull</span>}
        <span className="grow" />
        <span className="scm-actions always" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn xs" title="Open the commit graph in a tab: every branch, full details, and actions on commits" onClick={() => openGraph(repo.root)}>
            <GitGraph size={14} />
          </button>
        </span>
      </div>
      {open && (
        <>
          {entries.length === 0 && <div className="panel-note">{loading ? "Loading…" : "No commits yet."}</div>}
          <div role="list">
            {entries.map((e) => {
              const local = unpushed.has(e.sha);
              const list = files[e.sha];
              const isOpen = e.sha in files;
              return (
                <div key={e.sha} role="listitem">
                  <div
                    className={`scm-commit scm-commit-row ${local ? "local" : ""}`}
                    tabIndex={0}
                    aria-expanded={isOpen}
                    title={`${e.summary}\n${e.sha}\n${e.author} <${e.email}>\n${new Date(e.time * 1000).toLocaleString()}\n${tracked ? (local ? `Only on this computer: not pushed to ${repo.upstream} yet` : `On ${repo.upstream}`) : "This branch has no remote branch yet"}\n\nClick to see the files it changed`}
                    onClick={() => toggle(e)}
                    onKeyDown={(ev) => ev.key === "Enter" && toggle(e)}
                  >
                    <span className={`tree-chevron ${isOpen ? "open" : ""}`}>
                      <ChevronRight size={14} />
                    </span>
                    <div className="scm-commit-text">
                      <div className="scm-commit-line">
                        <span className="truncate grow">{e.summary}</span>
                        {tracked && (local ? <ArrowUp size={12} className="scm-commit-state local" aria-label="Not pushed yet" /> : <Check size={12} className="scm-commit-state" aria-label="On the remote" />)}
                      </div>
                      <div className="scm-commit-meta">
                        {e.author} · {relativeTime(e.time)} · <span className="mono">{e.short}</span>
                        {local && " · not pushed"}
                      </div>
                    </div>
                  </div>
                  {isOpen && list === null && <div className="panel-note scm-commit-files">Loading…</div>}
                  {isOpen && list && list.length === 0 && <div className="panel-note scm-commit-files">No file changes (a merge, or an empty commit).</div>}
                  {isOpen && list && list.map((f) => {
                    const kind = commitFileKind(f.status);
                    const slash = f.rel.lastIndexOf("/");
                    return (
                      <div
                        key={f.rel}
                        className="scm-row scm-commit-file"
                        tabIndex={0}
                        title={`${f.rel}\n${KIND_LABEL[kind]}${f.origRel ? ` (from ${f.origRel})` : ""} in ${e.short}\nClick to see what this commit changed, double-click to open the file`}
                        onClick={() => void openCommitFile(e, f)}
                        onDoubleClick={() => f.status !== "D" && void openPath(f.path)}
                        onKeyDown={(ev) => ev.key === "Enter" && void openCommitFile(e, f)}
                      >
                        <span className={`scm-name git-${kind}`}>{f.rel.slice(slash + 1)}</span>
                        {slash > 0 && <span className="scm-dir">{f.rel.slice(0, slash).replace(/\//g, "\\")}</span>}
                        <span className="grow" />
                        <span className={`scm-letter git-${kind}`} aria-label={KIND_LABEL[kind]}>{KIND_LETTER[kind]}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {more && (
            <button className="btn small scm-more" disabled={loading} onClick={() => void loadMore()}>
              {loading ? "Loading…" : "Show more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function HistorySection() {
  const h = useGit((s) => s.history);
  if (!h) return null;
  return (
    <div className="scm-section" role="group" aria-label="File history">
      <div className="scm-section-head">
        <History size={13} />
        <span className="truncate" title={h.path}>History: {nameOf(h.path)}</span>
        <span className="grow" />
        <button className="icon-btn xs" title="Close history" onClick={() => useGit.setState({ history: null })}>
          <X size={14} />
        </button>
      </div>
      {h.entries.length === 0 && <div className="panel-note">{h.loading ? "Loading…" : "No commits touch this file."}</div>}
      <div role="list">
        {h.entries.map((e, i) => (
          <div
            key={e.sha}
            className="scm-commit"
            role="listitem"
            tabIndex={0}
            title={`${e.sha}\n${e.author} <${e.email}>\n${new Date(e.time * 1000).toLocaleString()}\n${e.rel}\n\nClick to see what this commit changed`}
            onClick={() => void openCommitChange(h, i)}
            onKeyDown={(ev) => ev.key === "Enter" && void openCommitChange(h, i)}
          >
            <div className="scm-commit-line">
              <span className="truncate grow">{e.summary}</span>
              <button
                className="icon-btn xs scm-actions"
                title="Compare this version with the current file"
                onClick={(ev) => {
                  ev.stopPropagation();
                  void compareCommitWithCurrent(h, i);
                }}
              >
                <FileDiff size={13} />
              </button>
            </div>
            <div className="scm-commit-meta">
              {e.author} · {relativeTime(e.time)} · <span className="mono">{e.short}</span>
            </div>
          </div>
        ))}
      </div>
      {h.more && (
        <button className="btn small scm-more" disabled={h.loading} onClick={() => void moreHistory()}>
          {h.loading ? "Loading…" : "Show more"}
        </button>
      )}
    </div>
  );
}


/**
 * Where the branch stands against its remote, after a background check of the remote (on opening
 * the panel and when Quarry gets focus, at most once a minute), with what to do about it.
 */
function SyncStatus({ repo }: { repo: GitStatus }) {
  const check = useGit((s) => s.remoteCheck[repo.root.toLowerCase()]);
  const busy = useGit((s) => s.busy);
  const rewritten = useGit((s) => isRewritten(s.rewrotePushed[repo.root.toLowerCase()], repo));
  const hasRemote = repo.remotes.length > 0;
  useEffect(() => {
    if (!hasRemote) return;
    void checkRemote(repo.root);
    const onFocus = () => void checkRemote(repo.root);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [repo.root, hasRemote]);
  if (!hasRemote || !repo.branch) return null;

  const up = repo.upstream;
  // The remote this branch talks to: its upstream's, else origin (or the only one).
  const remoteName = repo.remotes.find((r) => up?.startsWith(r.name + "/"))?.name ?? repo.remotes.find((r) => r.name === "origin")?.name ?? repo.remotes[0].name;
  const remoteUrl = repo.remotes.find((r) => r.name === remoteName)?.url ?? "";
  const missing = isMissingRepo(check?.error);
  const change = (how: "github" | "url") => useGit.setState({ editRemote: { name: remoteName, how } });
  const act = (label: string, op: GitRemoteOp, title: string, primary = false) => (
    <button key={op} className={`btn small ${primary ? "btn-primary" : ""}`} title={title} disabled={!!busy || !!check?.checking} onClick={() => void remote(repo.root, op)}>
      {label}
    </button>
  );
  let kind = "ok";
  let text: string;
  let actions: React.ReactNode = null;
  if (missing) {
    // Pushing can't help: the repository itself is gone (or this account can't see it).
    kind = "warn";
    text = `The repository ${remoteName} points to isn't there: it was deleted or renamed, or your account can't see it.`;
    actions = (
      <>
        {/github\.com[:/]/i.test(remoteUrl) && (
          <button className="btn small btn-primary" disabled={!!busy} title={`Create a new repository on GitHub and point ${remoteName} at it`} onClick={() => change("github")}>
            Create It on GitHub
          </button>
        )}
        <button className="btn small" disabled={!!busy} title={`Point ${remoteName} at another repository`} onClick={() => change("url")}>
          Change URL
        </button>
      </>
    );
  } else if (!up) {
    kind = "todo";
    text = `${repo.branch} isn't on the remote yet.`;
    actions = act("Publish Branch", "push", "Push this branch to the remote and track it", true);
  } else if (repo.upstreamGone) {
    kind = "warn";
    text = `${up} no longer exists on the remote.`;
    actions = act("Push to Recreate It", "push", `Push ${repo.branch} to the remote again and track it`, true);
  } else {
    // Uncommitted work and commits to push / pull are separate things: say both.
    // After Quarry rewrote pushed commits (MERGE-009) a pull would bring the old ones back: the
    // line says so and its only action is Force Push, which asks on its own.
    const line = syncLine(repo.files.length, repo.ahead, repo.behind, up, rewritten ? repo.branch : null);
    kind = line.kind;
    text = line.text;
    if (rewritten) {
      actions = (
        <button className="btn small btn-danger" title={`Replace ${up} with your ${repo.branch} (asks first; refused if ${up} changed since it was last fetched)`} disabled={!!busy || !!check?.checking} onClick={() => void forcePush(repo.root)}>
          Force Push…
        </button>
      );
    } else if (repo.ahead && repo.behind) {
      actions = (
        <>
          {act("Pull (Merge)", "pull-merge", "Pull and join both histories with a merge commit", true)}
          {act("Pull (Rebase)", "pull-rebase", "Pull, then replay your commits on top of the remote's (no merge commit)")}
        </>
      );
    } else if (repo.behind) actions = act("Pull", "pull", `Bring ${up}'s new commits into ${repo.branch}`, true);
    else if (repo.ahead) actions = act("Push", "push", `Send your commits to ${up}`, true);
  }

  const when = check?.at && !check.error ? ` (checked ${relativeTime(Math.floor(check.at / 1000))})` : "";
  const Icon = kind === "ok" ? Check : kind === "warn" ? TriangleAlert : kind === "local" ? CircleDot : RefreshCw;
  return (
    <div className={`scm-sync ${kind}`} role="status">
      <div className="row">
        <Icon size={13} className="scm-sync-icon" />
        <span className="grow">
          {text} {check?.checking && <span className="muted">Checking the remote…</span>}
        </span>
        {!check?.checking && (
          <button className="icon-btn xs" title={`Check the remote now${when}`} disabled={!!busy} onClick={() => void checkRemote(repo.root, true)}>
            <RefreshCw size={13} />
          </button>
        )}
      </div>
      {check?.error && !missing && (
        <div className="row scm-sync-error">
          <CloudOff size={13} className="scm-sync-icon" />
          <span className="grow" title={check.error}>
            Couldn't check the remote ({check.error}), so this may be out of date. Fetch tries again and can ask you to sign in.
          </span>
          {act("Fetch", "fetch", "Fetch from all remotes")}
        </div>
      )}
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}


/** Source Control panel: branch, commit box, changed files (staged / not), file history. */
export function GitPanel() {
  const g = useGit();
  const folder = useStore((s) => s.folder);
  const repo = currentRepo(g);
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const busy = g.busy;

  // A stopped pick / merge / revert comes with the message git prepared: offer it once, in an empty box.
  const offered = useRef("");
  const offeredText = useRef("");
  const opKey = repo?.operation && repo.operationMessage ? `${repo.root}|${repo.operation}|${repo.operationMessage}` : "";
  useEffect(() => {
    if (!opKey) {
      // The operation ended: the next one gets its message offered again, even an identical one.
      offered.current = "";
      // Ended without a commit (Abort, or another repository is shown now): git's message goes with
      // it, unless it was edited. Left in the box it was offered for the next, unrelated commit.
      const was = offeredText.current;
      offeredText.current = "";
      if (was) setMessage((cur) => (cur === was ? "" : cur));
      return;
    }
    if (offered.current === opKey) return;
    offered.current = opKey;
    // (Not for a rebase or am: its commits / patches keep their own messages.)
    if (operationWords(repo!.operation!).continueLabel) return;
    const text = repo!.operationMessage!;
    setMessage((cur) => {
      if (cur.trim()) return cur;
      offeredText.current = text;
      return text;
    });
  }, [opKey]);

  // Edit History: Undo Last Commit hands the undone commit's message back, into an empty box only (HISTORY-002.3).
  const undone = g.undone;
  useEffect(() => {
    if (!undone || !repo || undone.root.toLowerCase() !== repo.root.toLowerCase()) return;
    useGit.setState({ undone: null });
    setMessage((cur) => (cur.trim() ? cur : undone.message));
  }, [undone, repo?.root]);

  const opWords = repo?.operation ? operationWords(repo.operation) : null;
  // A rebase or am is continued by the main button instead of committed.
  const rebasing = !!opWords?.continueLabel;
  // Claude git helpers: the Draft button and the box's state while a draft runs (GitDraft.tsx).
  const draft = useDraft(repo, message, setMessage, amend);
  const doCommit = async () => {
    if (!repo || busy || draft.drafting) return;
    if (rebasing) {
      await continueOperation(repo.root, repo.operation!, "continue");
      return;
    }
    if (await commit(repo.root, message, amend)) {
      setMessage("");
      setAmend(false);
      draft.committed();
    }
  };

  const header = (
    <div className="sidebar-header">
      Source Control
      <span className="grow" />
      {repo && (
        <>
          <button className="icon-btn" title="Fetch from all remotes" disabled={!!busy} onClick={() => void remote(repo.root, "fetch")}>
            <CloudDownload size={15} />
          </button>
          <button className="icon-btn" title={`Pull${repo.behind ? ` (${repo.behind} incoming)` : ""}`} disabled={!!busy} onClick={() => void remote(repo.root, "pull")}>
            <ArrowDown size={15} />
          </button>
          <button className="icon-btn" title={repo.remotes.length ? `Push${repo.ahead ? ` (${repo.ahead} outgoing)` : ""}${repo.upstream ? "" : " (publishes the branch)"}` : "Push (add a remote first)"} disabled={!!busy} onClick={() => void remote(repo.root, "push")}>
            <ArrowUp size={15} />
          </button>
        </>
      )}
      <button className="icon-btn" title="Refresh" onClick={rescanGit}>
        <RefreshCw size={15} />
      </button>
    </div>
  );
  // The folder the panel is about, on its own line under the buttons (the header cuts names off).
  const contextRoot = repo?.root ?? folder;
  const context = contextRoot && (
    <div className="scm-context" title={contextRoot}>
      <Folder size={13} />
      <span className="scm-context-name">{nameOf(contextRoot) || contextRoot}</span>
      <span className="scm-context-path">{contextRoot}</span>
    </div>
  );

  if (g.available === false) {
    return (
      <>
        {header}
        <div className="panel-note">Git was not found. Install Git for Windows (git-scm.com) and make sure <span className="kbd">git</span> is on PATH, then click Refresh (after installing it, restart Quarry first: a running program keeps its old PATH).</div>
      </>
    );
  }
  if (!repo) {
    const isFolder = (p: string) => !!folder && p.toLowerCase() === folder.toLowerCase();
    const failed = g.statusErrors.find((e) => isFolder(e.path)) ?? g.statusErrors[0];
    const others = Object.entries(g.repos);
    return (
      <>
        {header}
        {context}
        {others.length > 0 && (
          <div className="panel-section">
            <Select size="sm" value="" placeholder="Show a repository…" options={others.map(([k, r]) => ({ value: k, label: nameOf(r.root), hint: r.root }))} onChange={(v) => useGit.setState({ current: v })} title="Repository" />
          </div>
        )}
        {failed ? (
          <div className="panel-note scm-status-error">
            Git could not read {isFolder(failed.path) ? "the open folder" : failed.path}:{"\n"}
            {gitErrorText(failed.error)}
          </div>
        ) : (
          <div className="panel-note">{folder ? "The open folder is not in a git repository." : "Open a folder (or a file) in a git repository to see its changes here."}</div>
        )}
        <HistorySection />
      </>
    );
  }

  const groups = groupFiles(repo.files);
  const repos = Object.entries(g.repos);
  const branchLabel = repo.branch ?? (repo.head ? `${repo.head} (detached)` : "no commits yet");
  const target = repo.branch ? ` on ${repo.branch}` : "";
  const who = g.identity?.root === repo.root ? g.identity : null;

  return (
    <>
      {header}
      {context}
      <div className="panel-body">
        <div className="panel-section scm-top">
          {repos.length > 1 && <Select size="sm" value={g.current ?? ""} options={repos.map(([k, r]) => ({ value: k, label: nameOf(r.root), hint: r.root }))} onChange={(v) => useGit.setState({ current: v })} title="Repository" />}
          {/* Branch and where it stands share a row when the panel is wide enough. */}
          <div className="scm-status-row">
            <div className="row scm-branch">
              <button className="btn small" title="Switch branch or create one" disabled={!!busy} onClick={() => void pickBranch()}>
                <GitBranch size={13} /> <span className="truncate">{branchLabel}</span>
              </button>
              <MergeRebaseButton repo={repo} />
              {repo.operation && <span className="scm-op" title="Stopped part-way, usually on a conflict: resolve the files under Merge Changes and commit, or abort">{opWords!.badge}{repo.operationStep ? ` ${repo.operationStep[0]} of ${repo.operationStep[1]}` : ""}</span>}
              {repo.operation && repo.operation !== "merge" && (
                <button className="btn small" disabled={!!busy || groups.conflict.length > 0} title={groups.conflict.length ? "Resolve the conflicts first (or Abort)" : `Leave out the ${opWords!.item} ${opWords!.noun} stopped on and carry on`} onClick={() => void continueOperation(repo.root, repo.operation!, "skip")}>
                  Skip
                </button>
              )}
              {repo.operation && (
                <button className="btn small" disabled={!!busy} title={`Give up ${opWords!.noun} and go back to how things were before it`} onClick={() => void abortOperation(repo.root, repo.operation!)}>
                  Abort
                </button>
              )}
              {/* Stash: a stash that came back with conflicts has no operation, so no Abort / Skip; the two badges never show together. */}
              {isStashConflict(repo) && <span className="scm-op" title={STASH_CONFLICT.badgeTitle}>{STASH_CONFLICT.badge}</span>}
              {busy && <span className="muted scm-busy">{busy}</span>}
            </div>
            <SyncStatus repo={repo} />
          </div>
          <textarea
            className="input scm-message"
            placeholder={draft.drafting ? DRAFTING_PLACEHOLDER : rebasing ? opWords!.placeholder! : `Message (Ctrl+Enter to commit${target})`}
            disabled={rebasing}
            aria-label="Commit message"
            ref={draft.box}
            readOnly={draft.drafting}
            value={draft.drafting ? "" : message}
            rows={3}
            onChange={(e) => {
              if (draft.drafting) return;
              setMessage(e.target.value);
              draft.edited(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && draft.escape()) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              if (e.key === "Enter" && e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();
                void doCommit();
              }
            }}
          />
          <div className="row">
            <button
              className="btn btn-primary small grow"
              disabled={!!busy || draft.drafting || groups.conflict.length > 0 || (!rebasing && !message.trim() && !amend) || (!rebasing && !amend && repo.files.length === 0 && repo.operation !== "merge")}
              title={
                groups.conflict.length && !repo.operation
                  ? STASH_CONFLICT.commitTitle
                  : groups.conflict.length
                    ? "Open each file under Merge Changes, fix the conflict, save, and mark it resolved with +. Then commit to finish, or Abort to go back."
                    : busy
                      ? "Another git action is running."
                      : draft.drafting
                        ? "Claude is drafting a message."
                        : !rebasing && !amend && repo.files.length === 0 && repo.operation !== "merge"
                          ? "There is nothing to commit."
                          : !rebasing && !message.trim() && !amend
                            ? "Type a commit message first."
                            : undefined
              }
              onClick={() => void doCommit()}
            >
              {commitLabel(groups.staged.length, repo.files.length, amend, groups.conflict.length, repo.operation)}
            </button>
            {draft.button}
            <label className="check" title="Replace the last commit with this one (the message box empty keeps its message)">
              <input type="checkbox" checked={amend} disabled={!repo.head} onChange={(e) => setAmend(e.target.checked)} />
              Amend
            </label>
          </div>
          {draft.note}
          {who?.name && who.email && (
            <div className="scm-hint truncate" title={`Commits are made as ${who.name} <${who.email}>. Change it under Repository, below.`}>
              as {who.name} &lt;{who.email}&gt;
            </div>
          )}
        </div>
        <Section title="Merge Changes" group="conflict" files={groups.conflict} repo={repo} />
        <Section title="Staged Changes" group="staged" files={groups.staged} repo={repo} />
        <Section title="Changes" group="changes" files={groups.changes} repo={repo} />
        {repo.files.length === 0 && (
          <div className="panel-note">
            {repo.operation && !rebasing
              ? repo.operation === "merge"
                ? // Not a dead end: git still wants the merge commit ("All conflicts fixed but you are still merging").
                  "The merge changes none of your files: what it brings is already on the branch. Commit to record the merge, or Abort."
                : `Nothing is left to commit for ${opWords!.noun.replace(/^the /, "this ")}: its changes are already on the branch. Press Skip to move on, or Abort.`
              : "No uncommitted changes."}
          </div>
        )}
        <StashesSection repo={repo} />
        <CommitsSection repo={repo} />
        <HistorySection />
        <RepoSettings repo={repo} />
      </div>
    </>
  );
}
