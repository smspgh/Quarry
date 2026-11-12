import { ExternalLink, Globe, Lock, Pencil, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { chooseGithub, createOnGithub, githubSignIn, loadGithub, loadIdentity, loadRemoteInfo, saveIdentity, saveRemote, useGit } from "../../lib/git";
import type { GitRemote, GitStatus } from "../../lib/gitApi";
import { displayUrl, remoteWebUrl, repoNameFor } from "../../lib/gitStatus";
import { Select } from "../Select";

const openUrl = (url: string) => void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url)).catch(() => {});

/** "github.com/ada/demo" for https://github.com/ada/demo.git. */
const shortUrl = (url: string) => displayUrl(url).replace(/^https?:\/\//i, "").replace(/\.git$/i, "");

/** Escape in a form's field cancels it (when it can be cancelled). */
const escTo = (cancel?: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === "Escape" && cancel) {
    e.stopPropagation();
    cancel();
  }
};

function IdentityForm({ root, name, email, local, onCancel }: { root: string; name: string; email: string; local: boolean; onCancel?: () => void }) {
  const busy = useGit((s) => s.busy);
  const [n, setN] = useState(name);
  const [e, setE] = useState(email);
  const [only, setOnly] = useState(local);
  const ready = !busy && !!n.trim() && !!e.trim();
  const save = async () => {
    if (ready && (await saveIdentity(root, n, e, !only))) onCancel?.();
  };
  const keys = (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void save();
    } else escTo(onCancel)(ev);
  };
  return (
    <div className="scm-form" role="group" aria-label="Commit identity">
      <div className="row">
        <span className="grow">{onCancel ? "Commit as:" : "Git needs a name and an email to commit with. Both are saved in every commit; on GitHub the email links commits to your account."}</span>
        {onCancel && (
          <button className="icon-btn xs" title="Cancel" onClick={onCancel}>
            <X size={14} />
          </button>
        )}
      </div>
      <input className="input" aria-label="Your name" placeholder="Your name" value={n} autoFocus={!!onCancel} onChange={(ev) => setN(ev.target.value)} onKeyDown={keys} />
      <input className="input" aria-label="Your email" placeholder="you@example.com" type="email" spellCheck={false} value={e} onChange={(ev) => setE(ev.target.value)} onKeyDown={keys} />
      <div className="row">
        <label className="check grow" title="Off: used by every repository on this computer (git config --global)">
          <input type="checkbox" checked={only} onChange={(ev) => setOnly(ev.target.checked)} />
          Only this repository
        </label>
        <button className="btn btn-primary small" disabled={!ready} onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  );
}

/**
 * Add a remote (`change` unset) or point an existing one somewhere else: a new repository created
 * on GitHub, or a URL typed in.
 */
function RemoteForm({ repo, change, onCancel }: { repo: GitStatus; change?: GitRemote; onCancel?: () => void }) {
  const busy = useGit((s) => s.busy);
  const asked = useGit((s) => s.addingRemote);
  const taken = (n: string) => repo.remotes.some((r) => r.name === n.trim());
  const startHow = useGit((s) => (change && s.editRemote?.name === change.name ? s.editRemote.how : null));
  const [how, setHow] = useState<"github" | "url">(startHow ?? (change ? "url" : "github"));
  const [remoteName, setRemoteName] = useState(() => change?.name ?? (taken("origin") ? "" : "origin"));
  const [repoName, setRepoName] = useState(() => repoNameFor(repo.root));
  const [isPrivate, setPrivate] = useState(true);
  const [url, setUrl] = useState(change?.url ?? "");
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (asked || change) first.current?.focus();
  }, [asked, how]);

  const nameOk = !!remoteName.trim() && (!!change || !taken(remoteName));
  const ready = !busy && nameOk && (how === "github" ? !!repoName.trim() : !!url.trim() && url.trim() !== change?.url);
  const canPush = !!repo.head;
  const go = async (push: boolean) => {
    if (!ready) return;
    const opts = { replace: !!change, push: push && canPush };
    const ok = how === "github" ? await createOnGithub(repo.root, repoName, isPrivate, remoteName, opts) : await saveRemote(repo.root, remoteName, url, opts);
    if (ok) onCancel?.();
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void go(true);
    } else escTo(onCancel)(e);
  };
  const verb = how === "github" ? "Create" : change ? "Save" : "Add";
  const intro = change
    ? `Point ${change.name} at another repository. The current one is left as it is; your branch is pushed to the new one.`
    : repo.remotes.length
      ? "Add another remote."
      : "No remote yet. Create a repository on GitHub for this one, or use the URL of an existing, empty one.";

  return (
    <div className="scm-form" role="group" aria-label={change ? `Change remote ${change.name}` : "Add remote"}>
      <div className="row">
        <span className="grow">{intro}</span>
        {onCancel && (
          <button className="icon-btn xs" title="Cancel" onClick={onCancel}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="scm-choice" role="radiogroup" aria-label="Where the repository comes from">
        <label className="check">
          <input type="radio" name={`how-${change?.name ?? "add"}`} checked={how === "github"} onChange={() => setHow("github")} />
          Create a new repository on GitHub
        </label>
        <label className="check">
          <input type="radio" name={`how-${change?.name ?? "add"}`} checked={how === "url"} onChange={() => setHow("url")} />
          {change ? "Use another repository's URL" : "Use an existing repository's URL"}
        </label>
      </div>
      {how === "github" ? (
        <>
          <div className="row">
            {!change && <RemoteNameInput value={remoteName} taken={taken(remoteName)} onChange={setRemoteName} onKeyDown={keys} />}
            <input ref={first} className="input grow" aria-label="Repository name" title="Name of the new repository on GitHub" placeholder="Repository name" spellCheck={false} value={repoName} onChange={(e) => setRepoName(e.target.value)} onKeyDown={keys} />
          </div>
          <label className="check" title="Only you (and people you invite) can see a private repository">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
            Private
          </label>
          <GithubTarget />
        </>
      ) : (
        <div className="row">
          {!change && <RemoteNameInput value={remoteName} taken={taken(remoteName)} onChange={setRemoteName} onKeyDown={keys} />}
          <input ref={first} className="input mono grow" aria-label="Remote URL" placeholder="https://github.com/you/repo.git" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={keys} />
        </div>
      )}
      <div className="row">
        <button
          className="btn btn-primary small grow"
          disabled={!ready}
          title={canPush ? `${verb}, then push this branch there and track it` : "Nothing is pushed until there is a commit"}
          onClick={() => void go(true)}
        >
          {canPush ? `${verb} and Push` : verb}
        </button>
        {canPush && (
          <button className="btn small" disabled={!ready} onClick={() => void go(false)}>
            {verb}
          </button>
        )}
      </div>
    </div>
  );
}

/** Where Create on GitHub puts the repository: the chosen account, or a note that it asks to sign in. */
function GithubTarget() {
  const github = useGit((s) => s.github);
  const text = github?.chosen
    ? `Created on the GitHub account ${github.chosen} (shown under Your identity).`
    : "Created on your GitHub account; Git Credential Manager asks you to sign in first.";
  return <div className="scm-hint">{text}</div>;
}

/**
 * The GitHub account (Git Credential Manager's sign-in) new repositories go to: pick one of
 * several, or sign in to another in GCM's own window.
 */
function GithubRow({ root }: { root: string }) {
  const github = useGit((s) => s.github);
  const busy = useGit((s) => s.busy);
  if (!github) return null;
  const { accounts, chosen } = github;
  return (
    <div className="scm-kv" title="New repositories you create on GitHub go to this account. GitHub links your commits to it when the email in Commits as is one of the account's emails.">
      <span className="scm-k">GitHub</span>
      {accounts.length > 1 ? (
        <span className="grow scm-select">
          <Select size="sm" value={chosen ?? ""} options={accounts.map((a) => ({ value: a, label: a }))} onChange={chooseGithub} title="GitHub account" />
        </span>
      ) : (
        <span className={`truncate grow ${chosen ? "" : "muted"}`}>{chosen ?? "not signed in"}</span>
      )}
      {accounts.length === 0 ? (
        <button className="btn small" disabled={!!busy} onClick={() => void githubSignIn(root)}>
          Sign in
        </button>
      ) : (
        <button className="icon-btn xs" title="Sign in to another GitHub account" disabled={!!busy} onClick={() => void githubSignIn(root)}>
          <UserPlus size={13} />
        </button>
      )}
    </div>
  );
}

/** Private / Public for a GitHub remote, once GitHub has said (nothing for other hosts or unknown). */
function Visibility({ root, url }: { root: string; url: string }) {
  const info = useGit((s) => s.remoteInfo[url]);
  const account = useGit((s) => s.github?.chosen);
  const github = /github\.com[:/]/i.test(url);
  useEffect(() => {
    if (github) void loadRemoteInfo(root, url);
  }, [root, url, github, account]);
  if (!info) return null;
  return info.private ? (
    <span className="scm-badge" title={`${info.fullName} is private: only you and people you invite can see it`}>
      <Lock size={11} /> Private
    </span>
  ) : (
    <span className="scm-badge public" title={`${info.fullName} is public: anyone can see it`}>
      <Globe size={11} /> Public
    </span>
  );
}

function RemoteNameInput({ value, taken, onChange, onKeyDown }: { value: string; taken: boolean; onChange: (v: string) => void; onKeyDown: (e: React.KeyboardEvent) => void }) {
  return (
    <input
      className={`input scm-remote-name ${value.trim() && taken ? "invalid" : ""}`}
      aria-label="Remote name"
      title={taken ? "There is already a remote with this name" : "Remote name"}
      placeholder="Name"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

/**
 * Who commits are made as, and the repository's remotes (with Change and Open), under the commit
 * box. Forms open by themselves when something is missing: no name / email, or no remote.
 */
export function RepoSettings({ repo }: { repo: GitStatus }) {
  const identity = useGit((s) => s.identity);
  const adding = useGit((s) => s.addingRemote);
  const [editId, setEditId] = useState(false);
  const editRemote = useGit((s) => s.editRemote?.name ?? null);
  const setEditRemote = (name: string | null) => useGit.setState({ editRemote: name ? { name, how: "url" } : null });
  useEffect(() => {
    void loadIdentity(repo.root);
    void loadGithub(repo.root);
    setEditId(false);
    setEditRemote(null);
  }, [repo.root]);
  const id = identity?.root === repo.root ? identity : null;
  const missing = !!id && (!id.name || !id.email);
  const showForm = repo.remotes.length === 0 || adding;
  // The GitHub account matters when a repository may be created there or a remote is on GitHub.
  const onGithub = showForm || repo.remotes.some((r) => /github\.com[:/]/i.test(r.url));
  const where = (scope: string | null) => (scope === "local" ? "this repository" : scope === "global" ? "all your repositories" : (scope ?? "git"));

  return (
    <div className="panel-section scm-repo">
      <div className="scm-group">Your identity</div>
      {id &&
        (missing || editId ? (
          <IdentityForm root={repo.root} name={id.name ?? ""} email={id.email ?? ""} local={id.nameScope === "local"} onCancel={missing ? undefined : () => setEditId(false)} />
        ) : (
          <div className="scm-kv">
            <span className="scm-k">Commits as</span>
            <span className="truncate grow" title={`Commits are made as ${id.name} <${id.email}>\nSet for ${where(id.nameScope)}`}>
              {id.name} <span className="muted">&lt;{id.email}&gt;</span>
            </span>
            <button className="icon-btn xs" title="Change name / email" onClick={() => setEditId(true)}>
              <Pencil size={13} />
            </button>
          </div>
        ))}
      {onGithub && <GithubRow root={repo.root} />}
      <div className="scm-group">{repo.remotes.length > 1 ? "Remotes" : "Remote"}</div>
      {repo.remotes.map((r) => {
        if (editRemote === r.name) return <RemoteForm key={r.name} repo={repo} change={r} onCancel={() => setEditRemote(null)} />;
        const web = remoteWebUrl(r.url);
        return (
          <div className="scm-kv" key={r.name}>
            <span className="scm-k truncate" title={`Remote ${r.name}${repo.upstream?.startsWith(r.name + "/") ? ` (this branch tracks ${repo.upstream})` : ""}`}>
              {r.name}
            </span>
            <span className="truncate grow mono" title={displayUrl(r.url)}>
              {shortUrl(r.url)}
            </span>
            <Visibility root={repo.root} url={r.url} />
            {web && (
              <button className="icon-btn xs" title={`Open ${web}`} onClick={() => openUrl(web)}>
                <ExternalLink size={13} />
              </button>
            )}
            <button className="icon-btn xs" title="Change: another URL, or a new repository on GitHub" onClick={() => setEditRemote(r.name)}>
              <Pencil size={13} />
            </button>
          </div>
        );
      })}
      {showForm && <RemoteForm key={`add:${repo.root}`} repo={repo} onCancel={repo.remotes.length ? () => useGit.setState({ addingRemote: false }) : undefined} />}
    </div>
  );
}
