import { ArrowDown, ArrowUp, Check, ChevronRight, CloudDownload, CloudOff, FileDiff, FileText, GitBranch, History, Minus, Plus, RefreshCw, TriangleAlert, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { openPath } from "../../lib/actions";
import { checkRemote, isMissingRepo, commit, compareCommitWithCurrent, currentRepo, discard, moreHistory, openChange, openCommitChange, pickBranch, remote, rescanGit, stage, unstage, useGit } from "../../lib/git";
import { groupFiles, KIND_LABEL, KIND_LETTER, rowKind, type Group } from "../../lib/gitStatus";
import type { GitFile, GitRemoteOp, GitStatus } from "../../lib/gitApi";
import { relativeTime } from "../../editor/git";
import { useStore } from "../../lib/store";
import { Select } from "../Select";
import { RepoSettings } from "./GitRepoSettings";

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
      title={`${f.path}\n${KIND_LABEL[kind]}${f.origPath ? ` (from ${nameOf(f.origPath)})` : ""}${staged ? ", staged" : ""}\nClick to see the change, double-click to open the file`}
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
        {staged ? (
          <button className="icon-btn xs" title="Unstage" onClick={() => void unstage(repo.root, [f.path])}>
            <Minus size={14} />
          </button>
        ) : (
          <button className="icon-btn xs" title={group === "conflict" ? "Mark as resolved (stage)" : "Stage"} onClick={() => void stage(repo.root, [f.path])}>
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
            <button className="icon-btn xs" title="Stage all" onClick={() => void stage(repo.root, paths)}>
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

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Where the branch stands against its remote, after a background check of the remote (on opening
 * the panel and when Quarry gets focus, at most once a minute), with what to do about it.
 */
function SyncStatus({ repo }: { repo: GitStatus }) {
  const check = useGit((s) => s.remoteCheck[repo.root.toLowerCase()]);
  const busy = useGit((s) => s.busy);
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
  } else if (repo.ahead && repo.behind) {
    kind = "warn";
    text = `Diverged from ${up}: ${plural(repo.ahead, "commit")} to push, ${repo.behind} to pull. Pull first, then push.`;
    actions = (
      <>
        {act("Pull (Merge)", "pull-merge", "Pull and join both histories with a merge commit", true)}
        {act("Pull (Rebase)", "pull-rebase", "Pull, then replay your commits on top of the remote's (no merge commit)")}
      </>
    );
  } else if (repo.behind) {
    kind = "todo";
    text = `${plural(repo.behind, "commit")} to pull from ${up}.`;
    actions = act("Pull", "pull", `Bring ${up}'s new commits into ${repo.branch}`, true);
  } else if (repo.ahead) {
    kind = "todo";
    text = `${plural(repo.ahead, "commit")} to push to ${up}.`;
    actions = act("Push", "push", `Send your commits to ${up}`, true);
  } else text = `Up to date with ${up}.`;

  const when = check?.checking ? "Checking the remote…" : check?.at && !check.error ? `Checked ${relativeTime(Math.floor(check.at / 1000))}.` : "";
  const Icon = kind === "ok" ? Check : kind === "warn" ? TriangleAlert : RefreshCw;
  return (
    <div className={`scm-sync ${kind}`} role="status">
      <div className="row">
        <Icon size={13} className="scm-sync-icon" />
        <span className="grow">
          {text} {when && <span className="muted">{when}</span>}
        </span>
        {!check?.checking && (
          <button className="icon-btn xs" title="Check the remote now" disabled={!!busy} onClick={() => void checkRemote(repo.root, true)}>
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

const OPERATION: Record<string, string> = { merge: "Merging", rebase: "Rebasing", am: "Applying patches", "cherry-pick": "Cherry-picking", revert: "Reverting" };

/** Source Control panel: branch, commit box, changed files (staged / not), file history. */
export function GitPanel() {
  const g = useGit();
  const folder = useStore((s) => s.folder);
  const repo = currentRepo(g);
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const busy = g.busy;

  const doCommit = async () => {
    if (!repo || busy) return;
    if (await commit(repo.root, message, amend)) {
      setMessage("");
      setAmend(false);
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

  if (g.available === false) {
    return (
      <>
        {header}
        <div className="panel-note">Git was not found. Install Git for Windows (git-scm.com) and make sure <span className="kbd">git</span> is on PATH, then click Refresh.</div>
      </>
    );
  }
  if (!repo) {
    return (
      <>
        {header}
        <div className="panel-note">{folder ? "The open folder is not in a git repository." : "Open a folder (or a file) in a git repository to see its changes here."}</div>
        <HistorySection />
      </>
    );
  }

  const groups = groupFiles(repo.files);
  const repos = Object.entries(g.repos);
  const branchLabel = repo.branch ?? (repo.head ? `${repo.head} (detached)` : "no commits yet");
  const target = repo.branch ? ` on ${repo.branch}` : "";

  return (
    <>
      {header}
      <div className="panel-body">
        <div className="panel-section scm-top">
          {repos.length > 1 && <Select size="sm" value={g.current ?? ""} options={repos.map(([k, r]) => ({ value: k, label: nameOf(r.root), hint: r.root }))} onChange={(v) => useGit.setState({ current: v })} title="Repository" />}
          <div className="row scm-branch">
            <button className="btn small" title="Switch branch or create one" disabled={!!busy} onClick={() => void pickBranch()}>
              <GitBranch size={13} /> <span className="truncate">{branchLabel}</span>
            </button>
            {repo.operation && <span className="scm-op">{OPERATION[repo.operation] ?? repo.operation}</span>}
            {busy && <span className="muted scm-busy">{busy}</span>}
          </div>
          <SyncStatus repo={repo} />
          <textarea
            className="input scm-message"
            placeholder={`Message (Ctrl+Enter to commit${target})`}
            aria-label="Commit message"
            value={message}
            rows={3}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();
                void doCommit();
              }
            }}
          />
          <div className="row">
            <button className="btn btn-primary small grow" disabled={!!busy || (!message.trim() && !amend)} onClick={() => void doCommit()}>
              {amend ? "Amend Last Commit" : `Commit${groups.staged.length ? "" : " All"}`}
            </button>
            <label className="check" title="Replace the last commit with this one (the message box empty keeps its message)">
              <input type="checkbox" checked={amend} disabled={!repo.head} onChange={(e) => setAmend(e.target.checked)} />
              Amend
            </label>
          </div>
        </div>
        <RepoSettings repo={repo} />
        <Section title="Merge Changes" group="conflict" files={groups.conflict} repo={repo} />
        <Section title="Staged Changes" group="staged" files={groups.staged} repo={repo} />
        <Section title="Changes" group="changes" files={groups.changes} repo={repo} />
        {repo.files.length === 0 && <div className="panel-note">No changes.</div>}
        <HistorySection />
      </div>
    </>
  );
}
