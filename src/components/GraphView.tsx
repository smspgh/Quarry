import { ArrowDown, ArrowUp, CloudDownload, Copy, GitBranch, GitCommitHorizontal, History, Loader2, RefreshCw, RotateCcw, Search, Tag, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { editor } from "../editor/manager";
import { relativeTime } from "../editor/git";
import { askDialog, openPath } from "../lib/actions";
import { checkoutRef, commitAction, openCommitFile, remote, useGit } from "../lib/git";
import { git, type GitCommitAction, type GitCommitDetail, type GitCommitFile, type GitGraphCommit } from "../lib/gitApi";
import { commitMatches, layoutGraph, refLabels, type GraphRow, type Lanes, type RefLabel } from "../lib/gitGraph";
import { commitFileKind, KIND_LABEL, KIND_LETTER } from "../lib/gitStatus";
import { useStore, type Doc } from "../lib/store";

const PAGE = 300;
const ROW = 26;
const LANE = 14;
/** Lanes drawn before the graph column stops growing (wider graphs are clipped, not the text). */
const MAX_LANES = 14;
const LANE_COLORS = 8;

const x = (lane: number) => lane * LANE + LANE / 2;

/** The lines and the dot of one row. */
function RowGraph({ row, head, width }: { row: GraphRow; head: boolean; width: number }) {
  const mid = ROW / 2;
  const cx = x(row.col);
  const cls = (lane: number) => `gl gl-${lane % LANE_COLORS}`;
  return (
    <svg className="graph-lanes" width={width} height={ROW} aria-hidden>
      {row.through.map((i) => <line key={`t${i}`} className={cls(i)} x1={x(i)} y1={0} x2={x(i)} y2={ROW} />)}
      {row.into.map((i) => (i === row.col
        ? <line key={`i${i}`} className={cls(i)} x1={cx} y1={0} x2={cx} y2={mid} />
        : <path key={`i${i}`} className={cls(i)} d={`M ${x(i)} 0 Q ${x(i)} ${mid} ${cx} ${mid}`} />))}
      {row.out.map((j) => (j === row.col
        ? <line key={`o${j}`} className={cls(j)} x1={cx} y1={mid} x2={cx} y2={ROW} />
        : <path key={`o${j}`} className={cls(j)} d={`M ${cx} ${mid} Q ${x(j)} ${mid} ${x(j)} ${ROW}`} />))}
      <circle className={`gn gl-${row.col % LANE_COLORS} ${head ? "head" : ""}`} cx={cx} cy={mid} r={head ? 4.5 : 3.5} />
    </svg>
  );
}

function RefBadge({ label }: { label: RefLabel }) {
  const Icon = label.kind === "tag" ? Tag : label.kind === "remote" ? CloudDownload : GitBranch;
  const what = label.kind === "head" ? (label.name === "HEAD" ? "You are here (detached: not on a branch)" : `${label.name}: the branch you are on`) : label.kind === "branch" ? `Local branch ${label.name}` : label.kind === "remote" ? `Remote branch ${label.name}` : `Tag ${label.name}`;
  return (
    <span className={`graph-ref ${label.kind}`} title={what}>
      <Icon size={10} /> {label.name}
    </span>
  );
}

interface Menu {
  x: number;
  y: number;
  commit: GitGraphCommit;
}

/** Asking for a branch / tag name before an action runs. */
interface Naming {
  action: "branch" | "branch-switch" | "tag";
  commit: GitGraphCommit;
}

/**
 * Commit graph tab: every commit of the branch (or of all branches) as a lane graph with its
 * refs, a details pane for the selected commit, and the actions on a commit in its right-click menu.
 */
export function GraphView({ doc, visible }: { doc: Doc; visible: boolean }) {
  const root = doc.graph!.root;
  const repo = useGit((s) => s.repos[root.toLowerCase()]);
  const busy = useGit((s) => s.busy);
  const toast = useStore((s) => s.toast);
  const [all, setAll] = useState(false);
  const [commits, setCommits] = useState<GitGraphCommit[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [newName, setNewName] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [detailH, setDetailH] = useState(260);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Guards against a slow page arriving after a reload. */
  const generation = useRef(0);

  useEffect(() => editor.registerFocus(doc.id, () => listRef.current?.focus()), [doc.id]);

  const load = useCallback(async (reset: boolean) => {
    const gen = reset ? ++generation.current : generation.current;
    setLoading(true);
    setError(null);
    try {
      const skip = reset ? 0 : commitsRef.current.length;
      const page = await git.graph(root, allRef.current, skip, PAGE);
      if (gen !== generation.current) return;
      setCommits((cur) => (reset ? page : [...cur, ...page.filter((p) => !cur.some((c) => c.sha === p.sha))]));
      setMore(page.length === PAGE);
    } catch (e) {
      if (gen === generation.current) setError(String(e));
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, [root]);
  const commitsRef = useRef(commits);
  commitsRef.current = commits;
  const allRef = useRef(all);
  allRef.current = all;

  // (Re)load when the tab is shown and whenever the repository moves: commit, pull, push, checkout, fetch.
  const stamp = repo ? `${repo.head}|${repo.branch}|${repo.ahead}|${repo.behind}|${repo.upstream}|${repo.operation}` : "";
  useEffect(() => {
    if (visible) void load(true);
  }, [visible, all, stamp, load]);

  // Layout is cheap (a pass over the loaded commits), so it is simply redone when a page arrives.
  const rows = useMemo(() => {
    const lanes: Lanes = [];
    return layoutGraph(commits, lanes);
  }, [commits]);
  const lanesWide = useMemo(() => Math.min(MAX_LANES, rows.reduce((m, r) => Math.max(m, r.width), 1)), [rows]);
  const graphW = lanesWide * LANE + 6;
  const matches = useMemo(() => (query.trim() ? commits.map((c) => commitMatches(c, query)) : null), [commits, query]);
  const matchCount = matches ? matches.filter(Boolean).length : 0;

  // Only the rows on screen are in the DOM.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !visible) return;
    const measure = () => setViewH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible]);
  const first = Math.max(0, Math.floor(scrollTop / ROW) - 8);
  const last = Math.min(commits.length, Math.ceil((scrollTop + viewH) / ROW) + 8);
  useEffect(() => {
    if (more && !loading && last >= commits.length - 40) void load(false);
  }, [last, more, loading, commits.length, load]);

  // Details of the selected commit.
  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    let live = true;
    git.commitDetail(root, selected).then((d) => live && setDetail(d), () => {});
    return () => { live = false; };
  }, [root, selected]);

  const index = selected ? commits.findIndex((c) => c.sha === selected) : -1;
  const reveal = (i: number) => {
    const el = listRef.current;
    if (!el) return;
    if (i * ROW < el.scrollTop) el.scrollTop = i * ROW;
    else if ((i + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (i + 1) * ROW - el.clientHeight;
  };
  const select = (i: number) => {
    const c = commits[Math.max(0, Math.min(commits.length - 1, i))];
    if (!c) return;
    setSelected(c.sha);
    reveal(commits.indexOf(c));
  };
  const goTo = (sha: string) => {
    const i = commits.findIndex((c) => c.sha === sha);
    if (i >= 0) select(i);
    else toast("That commit is further back: scroll down to load it" + (all ? "." : ", or switch to All branches."), "info", 4000);
  };
  const nextMatch = (dir: 1 | -1) => {
    if (!matches) return;
    const n = commits.length;
    for (let k = 1; k <= n; k++) {
      const i = (((index < 0 ? (dir === 1 ? -1 : 0) : index) + dir * k) % n + n) % n;
      if (matches[i]) {
        select(i);
        return;
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const page = Math.max(1, Math.floor(viewH / ROW) - 1);
    if (e.key === "ArrowDown") select(index + 1);
    else if (e.key === "ArrowUp") select(index <= 0 ? 0 : index - 1);
    else if (e.key === "PageDown") select(index + page);
    else if (e.key === "PageUp") select(Math.max(0, index - page));
    else if (e.key === "Home") select(0);
    else if (e.key === "End") select(commits.length - 1);
    else if (e.key === "f" && e.ctrlKey) searchRef.current?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const copy = (text: string, what: string) => void writeText(text).then(() => toast(`Copied ${what}`, "success", 1500), () => {});
  const branch = repo?.branch ?? null;

  /** Run an action from the menu, after asking when it changes the branch or the files. */
  const act = async (action: GitCommitAction, c: GitGraphCommit, name?: string) => {
    const on = branch ? `"${branch}"` : "the current commit (not on a branch)";
    const what = `${c.short} "${c.summary}"`;
    const dirty = repo?.files.length ?? 0;
    let ok = true;
    if (action === "cherry-pick") ok = await askDialog("Cherry-pick this commit?", `Copies the changes of ${what} onto ${on} as a new commit. If they conflict, the pick stops and Source Control shows the files to resolve.`, "Cherry-pick", "primary");
    else if (action === "revert") ok = await askDialog("Revert this commit?", `Adds a new commit on ${on} that undoes ${what}. History is kept; nothing is deleted.`, "Revert", "primary");
    else if (action === "reset-soft") ok = await askDialog("Reset (soft)?", `Moves ${on} back to ${what}. The commits after it leave the branch, but all their changes stay staged, ready to commit again. Your files are not touched.`, "Reset (Soft)", "primary");
    else if (action === "reset-mixed") ok = await askDialog("Reset (mixed)?", `Moves ${on} back to ${what}. The commits after it leave the branch; their changes stay in your files, unstaged.`, "Reset (Mixed)", "primary");
    else if (action === "reset-hard") ok = await askDialog("Reset (hard) and discard changes?", `Moves ${on} back to ${what} and makes every tracked file match it. The commits after it leave the branch${dirty ? `, and your ${dirty} uncommitted change${dirty === 1 ? "" : "s"} to tracked files ${dirty === 1 ? "is" : "are"} lost` : ""}. This can't be undone from Quarry.`, "Reset and Discard");
    else if (action === "checkout") ok = await askDialog("Check out this commit?", `Your files become ${what}, and you are no longer on a branch ("detached"). Commits made here belong to no branch until you create one. Switch back with the branch button.`, "Check Out", "primary");
    if (!ok) return;
    if (await commitAction(root, action, c.sha, name)) {
      const done: Record<GitCommitAction, string> = { checkout: `Checked out ${c.short}`, branch: `Created branch ${name}`, "branch-switch": `On new branch ${name}`, tag: `Created tag ${name}`, "cherry-pick": `Cherry-picked ${c.short}`, revert: `Reverted ${c.short}`, "reset-soft": `Reset to ${c.short}`, "reset-mixed": `Reset to ${c.short}`, "reset-hard": `Reset to ${c.short}` };
      toast(done[action], "success", 3000);
      // Branches and tags do not change the status the reload effect watches.
      if (action === "branch" || action === "tag") void load(true);
    }
  };
  const commitNaming = () => {
    const n = newName.trim();
    const cur = naming;
    setNaming(null);
    setNewName("");
    if (cur && n) void act(cur.action, cur.commit, n);
  };

  // The menu closes on any click outside it, Escape, or losing the window.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = detailH;
    const move = (ev: MouseEvent) => setDetailH(Math.max(120, Math.min(window.innerHeight * 0.7, startH - (ev.clientY - startY))));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const sel = index >= 0 ? commits[index] : null;
  const item = (label: string, Icon: typeof Copy, run: () => void, title?: string, danger = false) => (
    <button className={`palette-item ${danger ? "danger" : ""}`} role="menuitem" title={title} onClick={() => { setMenu(null); run(); }}>
      <Icon size={13} /><span className="title">{label}</span>
    </button>
  );

  return (
    <div className="graph-view" hidden={!visible}>
      <div className="graph-toolbar">
        <History size={15} className="muted" />
        <span className="graph-title truncate" title={root}>{root.split(/[\\/]/).pop()}</span>
        <div className="segmented" role="group" aria-label="Which commits to show">
          <button className={all ? "" : "on"} aria-pressed={!all} title={`${branch ?? "The current commit"} and the branch it tracks on the remote: your commits to push and the ones to pull`} onClick={() => setAll(false)}>Current branch</button>
          <button className={all ? "on" : ""} aria-pressed={all} title="Every branch and tag, local and remote" onClick={() => setAll(true)}>All branches</button>
        </div>
        <span className="graph-search">
          <Search size={13} className="muted" />
          <input
            ref={searchRef}
            className="input"
            placeholder="Find: message, author, id, branch"
            aria-label="Find in the commits loaded so far"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") nextMatch(e.shiftKey ? -1 : 1);
              if (e.key === "Escape") {
                setQuery("");
                listRef.current?.focus();
              }
              e.stopPropagation();
            }}
          />
          {matches && <span className="muted graph-count" title="Among the commits loaded so far; scroll down to load older ones">{matchCount} of {commits.length}{more ? "+" : ""}</span>}
          {matches && <button className="icon-btn xs" title="Previous match (Shift+Enter)" disabled={!matchCount} onClick={() => nextMatch(-1)}><ArrowUp size={13} /></button>}
          {matches && <button className="icon-btn xs" title="Next match (Enter)" disabled={!matchCount} onClick={() => nextMatch(1)}><ArrowDown size={13} /></button>}
        </span>
        <span className="grow" />
        {(busy || loading) && <span className="muted row graph-busy"><Loader2 size={13} className="spin" /> {busy ?? "Loading…"}</span>}
        <span className="muted graph-count">{commits.length}{more ? "+" : ""} commits</span>
        <button className="icon-btn" title="Fetch from all remotes" disabled={!!busy} onClick={() => void remote(root, "fetch").then(() => load(true))}><CloudDownload size={15} /></button>
        <button className="icon-btn" title="Reload the graph" onClick={() => void load(true)}><RefreshCw size={15} /></button>
      </div>

      {naming && (
        <div className="graph-naming">
          <span>{naming.action === "tag" ? "New tag" : "New branch"} at <span className="mono">{naming.commit.short}</span>:</span>
          <input
            autoFocus
            className="input"
            spellCheck={false}
            placeholder={naming.action === "tag" ? "v1.0.0" : "branch-name"}
            aria-label={naming.action === "tag" ? "Tag name" : "Branch name"}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitNaming();
              if (e.key === "Escape") setNaming(null);
              e.stopPropagation();
            }}
          />
          <button className="btn btn-primary small" disabled={!newName.trim()} onClick={commitNaming}>{naming.action === "branch-switch" ? "Create and Switch" : "Create"}</button>
          <button className="icon-btn xs" title="Cancel" onClick={() => setNaming(null)}><X size={14} /></button>
        </div>
      )}

      <div className="graph-head" style={{ paddingLeft: graphW + 8 }}>
        <span className="graph-c-msg">Commit</span>
        <span className="graph-c-author">Author</span>
        <span className="graph-c-date">Date</span>
        <span className="graph-c-sha">Id</span>
      </div>
      <div
        ref={listRef}
        className="graph-list"
        role="listbox"
        aria-label="Commits"
        tabIndex={0}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
      >
        {error && <div className="panel-note">Could not read the history: {error}</div>}
        {!error && commits.length === 0 && <div className="panel-note">{loading ? "Loading…" : "No commits yet."}</div>}
        <div style={{ height: commits.length * ROW, position: "relative" }}>
          {commits.slice(first, last).map((c, k) => {
            const i = first + k;
            const row = rows[i];
            const labels = refLabels(c.refs);
            const isHead = c.refs.includes("HEAD");
            const dim = matches ? !matches[i] : false;
            return (
              <div
                key={c.sha}
                role="option"
                aria-selected={c.sha === selected}
                className={`graph-row ${c.sha === selected ? "selected" : ""} ${dim ? "dim" : ""} ${isHead ? "head" : ""}`}
                style={{ top: i * ROW, height: ROW }}
                onClick={() => { setSelected(c.sha); listRef.current?.focus(); }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelected(c.sha);
                  setMenu({ x: e.clientX, y: e.clientY, commit: c });
                }}
              >
                <span className="graph-lane-cell" style={{ width: graphW }}>{row && <RowGraph row={row} head={isHead} width={graphW} />}</span>
                <span className="graph-c-msg">
                  {labels.map((l) => <RefBadge key={l.full} label={l} />)}
                  <span className="truncate" title={c.summary}>{c.summary}</span>
                </span>
                <span className="graph-c-author truncate" title={`${c.author} <${c.email}>`}>{c.author}</span>
                <span className="graph-c-date truncate" title={new Date(c.time * 1000).toLocaleString()}>{relativeTime(c.time)}</span>
                <span className="graph-c-sha mono" title={c.sha}>{c.short}</span>
              </div>
            );
          })}
        </div>
      </div>

      {sel && (
        <>
          <div className="graph-resizer" onMouseDown={startResize} />
          <div className="graph-detail selectable" style={{ height: detailH }}>
            <div className="graph-detail-info">
              <div className="row">
                <GitCommitHorizontal size={14} className="muted" />
                <span className="mono graph-full-sha">{sel.sha}</span>
                <button className="icon-btn xs" title="Copy the commit id" onClick={() => copy(sel.sha, "the commit id")}><Copy size={12} /></button>
                <span className="grow" />
                <button className="icon-btn xs" title="Close details" onClick={() => setSelected(null)}><X size={14} /></button>
              </div>
              <pre className="graph-message">{detail?.message ?? sel.summary}</pre>
              <dl className="graph-meta">
                <dt>Author</dt><dd>{sel.author} &lt;{sel.email}&gt; · {new Date(sel.time * 1000).toLocaleString()}</dd>
                {detail && (detail.committer !== detail.author || detail.commitTime !== detail.time) && (
                  <><dt>Committed</dt><dd>{detail.committer} &lt;{detail.committerEmail}&gt; · {new Date(detail.commitTime * 1000).toLocaleString()}</dd></>
                )}
                <dt>{sel.parents.length > 1 ? "Parents" : "Parent"}</dt>
                <dd>
                  {sel.parents.length === 0 && "none (the first commit)"}
                  {sel.parents.map((p) => <button key={p} className="link-btn mono" title="Go to this commit" onClick={() => goTo(p)}>{p.slice(0, 7)}</button>)}
                </dd>
                {refLabels(sel.refs).length > 0 && (<><dt>Refs</dt><dd className="graph-refs">{refLabels(sel.refs).map((l) => <RefBadge key={l.full} label={l} />)}</dd></>)}
              </dl>
            </div>
            <div className="graph-detail-files">
              <div className="graph-files-head">{detail ? (detail.stat || "No file changes") : "Loading…"}{sel.parents.length > 1 && " (against the first parent)"}</div>
              {detail?.files.map((f) => <DetailFile key={f.rel} file={f} commit={sel} />)}
            </div>
          </div>
        </>
      )}

      {menu && createPortal(
        <GraphMenu menu={menu}>
          {item("Copy Commit Id", Copy, () => copy(menu.commit.sha, "the commit id"))}
          {item("Copy Message", Copy, () => copy(menu.commit.summary, "the message"))}
          <div className="menu-sep" />
          {refLabels(menu.commit.refs).filter((l) => l.kind === "branch" || l.kind === "remote").map((l) => (
            <button key={l.full} className="palette-item" role="menuitem" disabled={!!busy} onClick={() => { setMenu(null); void checkoutRef(root, l.name); }}>
              <GitBranch size={13} /><span className="title">Switch to {l.name}</span>
            </button>
          ))}
          {item("Create Branch Here…", GitBranch, () => { setNewName(""); setNaming({ action: "branch-switch", commit: menu.commit }); }, "A new branch starting at this commit, and switch to it")}
          {item("Create Tag Here…", Tag, () => { setNewName(""); setNaming({ action: "tag", commit: menu.commit }); })}
          {item("Check Out This Commit…", GitCommitHorizontal, () => void act("checkout", menu.commit), "Look at the files as they were (detached: not on a branch)")}
          <div className="menu-sep" />
          {item(`Cherry-pick onto ${branch ?? "Here"}…`, GitCommitHorizontal, () => void act("cherry-pick", menu.commit), "Copy this commit's changes onto the current branch as a new commit")}
          {item("Revert This Commit…", Undo2, () => void act("revert", menu.commit), "Add a commit that undoes this one")}
          <div className="menu-sep" />
          {item(`Reset ${branch ?? "HEAD"} to Here (Soft)…`, RotateCcw, () => void act("reset-soft", menu.commit), "Keep later changes staged")}
          {item(`Reset ${branch ?? "HEAD"} to Here (Mixed)…`, RotateCcw, () => void act("reset-mixed", menu.commit), "Keep later changes in the files, unstaged")}
          {item(`Reset ${branch ?? "HEAD"} to Here (Hard)…`, RotateCcw, () => void act("reset-hard", menu.commit), "Discard later commits and uncommitted changes", true)}
        </GraphMenu>,
        document.body,
      )}
    </div>
  );
}

function DetailFile({ file, commit }: { file: GitCommitFile; commit: GitGraphCommit }) {
  const kind = commitFileKind(file.status);
  const slash = file.rel.lastIndexOf("/");
  const open = () => void openCommitFile({ sha: commit.sha, short: commit.short, author: commit.author, email: commit.email, time: commit.time, summary: commit.summary, rel: file.rel, root: "" }, file);
  return (
    <div
      className="scm-row graph-file"
      tabIndex={0}
      title={`${file.rel}\n${KIND_LABEL[kind]}${file.origRel ? ` (from ${file.origRel})` : ""}\nClick to see what this commit changed, double-click to open the file as it is now`}
      onClick={open}
      onDoubleClick={() => file.status !== "D" && void openPath(file.path)}
      onKeyDown={(e) => e.key === "Enter" && open()}
    >
      <span className={`scm-name git-${kind}`}>{file.rel.slice(slash + 1)}</span>
      {slash > 0 && <span className="scm-dir">{file.rel.slice(0, slash).replace(/\//g, "\\")}</span>}
      <span className="grow" />
      <span className={`scm-letter git-${kind}`} aria-label={KIND_LABEL[kind]}>{KIND_LETTER[kind]}</span>
    </div>
  );
}

/** The right-click menu, kept inside the window. */
function GraphMenu({ menu, children }: { menu: Menu; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)) });
  }, [menu.x, menu.y]);
  return (
    <div ref={ref} className="palette ctx-menu graph-menu" role="menu" style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="graph-menu-head truncate"><span className="mono">{menu.commit.short}</span> {menu.commit.summary}</div>
      {children}
    </div>
  );
}
