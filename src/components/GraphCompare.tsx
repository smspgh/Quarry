import { ArrowLeftRight, FolderGit2, GitCommitHorizontal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { openPath } from "../lib/actions";
import { openCompareFile } from "../lib/git";
import { git, type GitCommitFile, type GitCompare, type GitGraphCommit } from "../lib/gitApi";
import { arrange, compareFileKind, compareHeading, compareSummary, countsLine, noDifferences, untrackedNote, WORKTREE, type CompareNames } from "../lib/gitCompare";
import { refLabels } from "../lib/gitGraph";
import { gitErrorText, KIND_LABEL, KIND_LETTER } from "../lib/gitStatus";

const ROW = 24;
/** Rows drawn above and below the ones on screen. */
const OVERSCAN = 6;

interface Props {
  root: string;
  /** The commit selected first, and the second side: a commit id or WORKTREE. */
  first: string;
  second: string;
  /** Branch names to show beside the ids (Compare with Branch…). */
  names?: CompareNames;
  /** The second side is a picked branch: it goes on the left unless it is ahead (`orderSides`). */
  picked?: boolean;
  /** git's answer for this pair when the caller already has it. */
  initial?: GitCompare | null;
  height: number;
  /** Changes whenever the repository's status is read again: a working-tree comparison reloads. */
  tick?: unknown;
  /** Is this commit among the graph's loaded rows? (Else its side offers Show in Graph.) */
  loaded: (sha: string) => boolean;
  seeking?: boolean;
  onShowInGraph: (sha: string) => void;
  onClose: () => void;
}

/**
 * The comparison pane of the commit graph (in place of the details pane while two sides are
 * set): what differs between two commits, or between a commit and the working tree. Read-only:
 * nothing here acts on the repository; a file opens in a Compare tab.
 */
export function GraphCompare({ root, first, second, names, picked = false, initial, height, tick, loaded, seeking, onShowInGraph, onClose }: Props) {
  const worktree = second === WORKTREE;
  const pair = `${root}|${first}|${second}`;
  const [res, setRes] = useState<GitCompare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const listRef = useRef<HTMLDivElement>(null);
  /** The pair the pane holds (or is loading): the same pair read again keeps its list on screen. */
  const shown = useRef("");

  useEffect(() => {
    let live = true;
    const fresh = shown.current !== pair;
    if (fresh) {
      shown.current = pair;
      setError(null);
      setSwapped(false);
      setScrollTop(0);
      if (listRef.current) listRef.current.scrollTop = 0;
      const ready = initial && initial.left.sha === first && initial.right?.sha === second ? initial : null;
      setRes(ready);
      if (ready) return;
    }
    // A late answer for a pair that was changed meanwhile is dropped (`live`).
    const read = () =>
      git.diffFiles(root, first, worktree ? undefined : second).then(
        (d) => {
          if (!live) return;
          setRes(d);
          setError(null);
        },
        (e) => {
          if (!live) return;
          setRes(null);
          setError(gitErrorText(String(e)));
        },
      );
    // The working tree changing (a save, a commit): wait for the burst to end, then read again.
    const timer = fresh ? (void read(), 0) : window.setTimeout(read, 250);
    return () => {
      live = false;
      if (timer) window.clearTimeout(timer);
    };
    // `initial` only matters when the pair changes.
  }, [pair, worktree ? tick : null]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => el.clientHeight > 0 && setViewH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const arranged = res ? arrange(res, picked, swapped) : null;
  const view = arranged?.view ?? null;
  const sideNames = arranged?.flipped ? { left: names?.second, right: names?.first } : { left: names?.first, right: names?.second };
  const files = view?.files ?? [];
  const from = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const to = Math.min(files.length, Math.ceil((scrollTop + viewH) / ROW) + OVERSCAN);
  // Before git answers the title has the ids as selected; after, the sides in their final order.
  const short = (sha: string) => sha.slice(0, 7);
  const title = view ? compareHeading(view.left.short, view.right ? view.right.short : null, sideNames) : compareHeading(short(first), worktree ? null : short(second));
  const counts = view ? countsLine(view.left.short, view.right ? view.right.short : null, view.ahead, view.behind, view.head) : "";
  const same = !!view?.right && view.right.sha === view.left.sha;
  const summary = view ? compareSummary(files.length, view.insertions, view.deletions) : "";
  const note = view ? untrackedNote(view.untracked) : "";

  const side = (c: GitGraphCommit) => (
    <div className="graph-compare-side">
      <GitCommitHorizontal size={13} className="muted" />
      <span className="mono graph-compare-id" title={c.sha}>{c.short}</span>
      {refLabels(c.refs).map((l) => <span key={l.full} className={`graph-ref ${l.kind}`}>{l.name}</span>)}
      <span className="truncate graph-compare-msg" title={c.summary}>{c.summary}</span>
      {!loaded(c.sha) && <button className="btn small" disabled={seeking} title="Load the graph back to this commit and show it there" onClick={() => onShowInGraph(c.sha)}>{seeking ? "Loading…" : "Show in Graph"}</button>}
    </div>
  );

  return (
    <div className="graph-detail graph-compare selectable" style={{ height }} role="region" aria-label="Comparison">
      <div className="graph-detail-info">
        <div className="row">
          <ArrowLeftRight size={14} className="muted" />
          <span className="graph-compare-title">{title}</span>
          {view?.right && !same && <button className="btn small" title="Exchange the left and the right side" onClick={() => setSwapped(!swapped)}>Swap Sides</button>}
          <span className="grow" />
          <button className="icon-btn xs" title="Close the comparison" onClick={onClose}><X size={14} /></button>
        </div>
        {view && side(view.left)}
        {view && (view.right ? !same && side(view.right) : (
          <div className="graph-compare-side">
            <FolderGit2 size={13} className="muted" />
            <span className="graph-compare-id">Working tree</span>
            <span className="truncate graph-compare-msg">Your tracked files as they are on disk, staged or not</span>
          </div>
        ))}
        {counts && <div className="graph-compare-counts">{counts}.</div>}
      </div>
      <div className="graph-detail-files graph-compare-files">
        <div className="graph-files-head">
          {error ? <span className="graph-compare-error">Could not compare: {error}</span> : !view ? "Loading…" : files.length === 0 ? noDifferences(view, sideNames) : summary}
          {note && <div>{note}</div>}
        </div>
        <div ref={listRef} className="graph-compare-list" role="list" aria-label="Files that differ" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          <div className="graph-compare-rows" style={{ height: files.length * ROW }}>
            {view && files.slice(from, to).map((f, k) => <CompareFile key={f.rel} file={f} top={(from + k) * ROW} left={view.left} right={view.right} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function CompareFile({ file, top, left, right }: { file: GitCommitFile; top: number; left: GitGraphCommit; right: GitGraphCommit | null }) {
  const kind = compareFileKind(file.status);
  const slash = file.rel.lastIndexOf("/");
  const open = () => void openCompareFile(left, right, file);
  const move = (e: React.KeyboardEvent, to: Element | null) => {
    e.preventDefault();
    (to as HTMLElement | null)?.focus();
  };
  return (
    <div
      className="scm-row graph-file graph-compare-file"
      role="listitem"
      style={{ top }}
      tabIndex={0}
      title={`${file.rel}\n${KIND_LABEL[kind]}${file.origRel ? ` (from ${file.origRel})` : ""}\nClick to compare the two versions, double-click to open the file as it is now`}
      onClick={open}
      onDoubleClick={() => file.status !== "D" && void openPath(file.path)}
      onKeyDown={(e) => {
        if (e.key === "Enter") open();
        else if (e.key === "ArrowDown") move(e, e.currentTarget.nextElementSibling);
        else if (e.key === "ArrowUp") move(e, e.currentTarget.previousElementSibling);
      }}
    >
      <span className={`scm-name git-${kind}`}>{file.rel.slice(slash + 1)}</span>
      {slash > 0 && <span className="scm-dir">{file.rel.slice(0, slash).replace(/\//g, "\\")}</span>}
      <span className="grow" />
      <span className={`scm-letter git-${kind}`} aria-label={KIND_LABEL[kind]}>{KIND_LETTER[kind]}</span>
    </div>
  );
}
