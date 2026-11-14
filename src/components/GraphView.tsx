import { Archive, ArchiveRestore, ArrowDown, ArrowUp, CircleDot, CloudDownload, Copy, Gauge, GitBranch, GitCommitHorizontal, GitMerge, History, Loader2, RefreshCw, RotateCcw, Search, Tag, TriangleAlert, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { editor } from "../editor/manager";
import { relativeTime } from "../editor/git";
import { askDialog, openPath } from "../lib/actions";
import { abortOperation, checkoutRef, commitAction, openCommitFile, remote, useGit } from "../lib/git";
import { isPanelShown, showPanel } from "../lib/panels";
import { git, type GitCommitAction, type GitCommitDetail, type GitCommitFile, type GitGraphCommit } from "../lib/gitApi";
import { actionConfirm, actionDone, commitMatches, layoutGraph, newGraphState, refLabels, type GraphRow, type RefLabel } from "../lib/gitGraph";
import { commitFileKind, KIND_LABEL, KIND_LETTER, operationWords } from "../lib/gitStatus";
import { useStore, type Doc } from "../lib/store";
// Merge / rebase entries of the commit menu and the ref-label menu (specs/git-merge-rebase.md).
import { openStashFile, stashAction, startMerge, startRebase } from "../lib/git";
import { startEntries, targetOf, type StartEntry, type StartTarget } from "../lib/gitMerge";
import { refMenu as refMenuOf } from "../lib/gitRefs";
// Stash rows (All branches): STASH-010.
import { stashMenu } from "../lib/gitGraph";
import { isStashConflict, stashBlocked, stashConflictStrip, stashTitle } from "../lib/gitStash";
import { fs } from "../lib/ipc";
// Compare commits (specs/git-compare-commits.md): Ctrl+click a second commit, the comparison pane.
import { ArrowLeftRight } from "lucide-react";
import { pickBranch } from "../lib/git";
import type { GitCompare } from "../lib/gitApi";
import { compareClick, WORKTREE, type CompareNames } from "../lib/gitCompare";
import { GraphCompare } from "./GraphCompare";
// Branch and tag housekeeping entries of the ref-label menu (specs/git-branches.md).
import { CloudUpload, Link2, Pencil, Trash2 } from "lucide-react";
import { runCommand } from "../lib/commands";
import { loadRefInfo } from "../lib/git";
import { REF_COMMANDS, type RefMenuEntry } from "../lib/gitRefs";
// Claude git helpers: the Summarise entries of the commit menu (specs/git-claude.md).
import { SummariseItems } from "./GraphSummarise";
// Graph polish (GRAPH-015..018): the uncommitted-changes row, results divider, lane scrolling, date order.
import { clampHitsHeight, clampLaneScroll, DATE_ORDER_OFF, DATE_ORDER_WHY, dateOrderAllowed, isUncommitted, LIST_MIN, revealLane, rowOffset, takePage, UNCOMMITTED, uncommittedLineEnd, withoutUncommitted, withUncommitted } from "../lib/gitGraph";
import { GraphLaneScroll } from "./GraphLaneScroll";
import { GraphUncommitted } from "./GraphUncommitted";

const PAGE = 300;
/** A page slower than this means git is walking the whole history for it. */
const SLOW_PAGE_MS = 400;
const MAX_PAGE = 4800;
const ROW = 26;
const LANE = 12;
/** Lanes the graph column shows at once; a wider graph scrolls sideways in it (GRAPH-017). */
const MAX_LANES = 16;
const LANE_COLORS = 8;

/** Every lane has its own place, however many there are. */
const x = (lane: number) => lane * LANE + LANE / 2;

/**
 * The lines and the dot of one row, drawn at the graph's full `width`. `uncommitted`: "row" = the
 * uncommitted-changes row itself (hollow dot, dashed line down); "line" = its dashed line passes
 * this row in lane 0, or ends at this commit (GRAPH-015).
 */
function RowGraph({ row, head, width, stash = false, uncommitted }: { row: GraphRow; head: boolean; width: number; stash?: boolean; uncommitted?: "row" | "line" }) {
  const mid = ROW / 2;
  const cx = x(row.col);
  const color = (lane: number) => `gl gl-${lane % LANE_COLORS}`;
  const cls = (lane: number) => `${color(lane)}${uncommitted === "line" && lane === 0 ? " dashed" : ""}`;
  return (
    <svg className="graph-lanes" width={width} height={ROW} aria-hidden>
      {row.through.map((i) => <line key={`t${i}`} className={cls(i)} x1={x(i)} y1={0} x2={x(i)} y2={ROW} />)}
      {row.into.map((i) => (i === row.col
        ? <line key={`i${i}`} className={cls(i)} x1={cx} y1={0} x2={cx} y2={mid} />
        : <path key={`i${i}`} className={cls(i)} d={`M ${x(i)} 0 Q ${x(i)} ${mid} ${cx} ${mid}`} />))}
      {row.cut.map((i) => (
        <g key={`c${i}`} className={color(i)}>
          <line x1={x(i)} y1={0} x2={x(i)} y2={mid - 3} />
          <path className="ga" d={`M ${x(i) - 3} ${mid - 4} L ${x(i)} ${mid + 1} L ${x(i) + 3} ${mid - 4}`} />
        </g>
      ))}
      {row.from.length > 0 && (
        <g className={color(row.col)}>
          <path className="ga" d={`M ${cx + 4} ${mid - 9} L ${cx + 7} ${mid - 13} L ${cx + 10} ${mid - 9}`} />
          <path d={`M ${cx + 7} ${mid - 12} Q ${cx + 7} ${mid} ${cx} ${mid}`} />
        </g>
      )}
      {row.out.map((j) => (j === row.col
        ? <line key={`o${j}`} className={`${color(j)}${uncommitted === "row" ? " dashed" : ""}`} x1={cx} y1={mid} x2={cx} y2={ROW} />
        : <path key={`o${j}`} className={color(j)} d={`M ${cx} ${mid} Q ${x(j)} ${mid} ${x(j)} ${ROW}`} />))}
      <circle className={`gn gl-${row.col % LANE_COLORS} ${head ? "head" : ""} ${stash ? "stash" : ""} ${uncommitted === "row" ? "uncommitted" : ""}`} cx={cx} cy={mid} r={head ? 4.5 : 3.5} />
    </svg>
  );
}

function RefBadge({ label, onContextMenu, open = false }: { label: RefLabel; onContextMenu?: (e: React.MouseEvent) => void; /** Its menu is open. */ open?: boolean }) {
  const Icon = label.kind === "stash" ? Archive : label.kind === "tag" ? Tag : label.kind === "remote" ? CloudDownload : GitBranch;
  const what = label.kind === "stash" ? "A stash: uncommitted work put aside, drawn on the commit it was made on" : label.kind === "head" ? (label.name === "HEAD" ? "You are here (detached: not on a branch)" : `${label.name}: the branch you are on`) : label.kind === "branch" ? `Local branch ${label.name}` : label.kind === "remote" ? `Remote branch ${label.name}` : `Tag ${label.name}`;
  return (
    <span className={`graph-ref ${label.kind} ${open ? "menu-open" : ""}`} title={what} onContextMenu={onContextMenu}>
      <Icon size={10} /> {label.name}
    </span>
  );
}

interface Menu {
  x: number;
  y: number;
  commit: GitGraphCommit;
}

/** The right-click menu of a branch / tag label (its entries come from `refMenu` in gitRefs.ts). */
interface RefMenu extends Menu {
  label: RefLabel;
}

/** Asking for a branch / tag name before an action runs. */
interface Naming {
  action: "branch" | "branch-switch" | "tag" | "rename";
  commit: GitGraphCommit;
  /** "rename": the branch being renamed (BRANCH-004). */
  branch?: string;
}

/** The uncommitted-changes row (GRAPH-015): laid out as one more commit on top of the current one, but never a commit. */
const uncommittedRow = (head: string | null): GitGraphCommit => ({ sha: UNCOMMITTED, short: "", parents: head ? [head] : [], author: "", email: "", time: 0, refs: [], summary: "Uncommitted changes", stash: false });

/**
 * Commit graph tab: every commit of the branch (or of all branches) as a lane graph with its
 * refs, a details pane for the selected commit, and the actions on a commit in its right-click menu.
 */
export function GraphView({ doc, visible }: { doc: Doc; visible: boolean }) {
  const root = doc.graph!.root;
  const repo = useGit((s) => s.repos[root.toLowerCase()]);
  const busy = useGit((s) => s.busy);
  const gitShown = useStore((s) => isPanelShown(s, "git"));
  const toast = useStore((s) => s.toast);
  const [all, setAll] = useState(false);
  /** Commits loaded so far and their rows; laid out page by page, carrying the lanes over. */
  const [data, setData] = useState<{ commits: GitGraphCommit[]; rows: GraphRow[]; wide: number }>({ commits: [], rows: [], wide: 1 });
  const { commits, rows } = data;
  const commitsRef = useRef(commits);
  commitsRef.current = commits;
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelectedOnly] = useState<string | null>(null);
  // Compare commits: `selected` is the first commit, `compare` the second side (a commit id, or
  // WORKTREE). Every plain selection (`setSelected`) ends the comparison.
  const [compare, setCompare] = useState<string | null>(null);
  const setSelected = (sha: string | null) => {
    setCompare(null);
    setSelectedOnly(sha);
  };
  /** A commit selected from a whole-history search that is not among the loaded pages (yet). */
  const [picked, setPicked] = useState<GitGraphCommit | null>(null);
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [query, setQuery] = useState("");
  /** Whole-history search results for `hits.query` (null: not searched). */
  const [hits, setHits] = useState<{ query: string; list: GitGraphCommit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  /** The results list shrinks to a few rows once a result is picked, so the graph keeps its room. */
  const [hitsOpen, setHitsOpen] = useState(true);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [refMenu, setRefMenu] = useState<RefMenu | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [newName, setNewName] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [detailH, setDetailH] = useState(260);
  /** How long git took for the last page, when that was slow (ms); and whether its index exists. */
  const [slowMs, setSlowMs] = useState(0);
  const [indexed, setIndexed] = useState<boolean | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [hideSpeedUp, setHideSpeedUp] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Guards against a slow page arriving after a reload. */
  const generation = useRef(0);
  const lanes = useRef(newGraphState());
  const indexOf = useRef(new Map<string, number>());
  const pageSize = useRef(PAGE);
  const inFlight = useRef(false);
  /** Stash rows among the loaded rows. */
  const stashRows = useRef(0);
  // ----- Graph polish (GRAPH-015..018): state -----
  /** The rows as last placed: `load` and the uncommitted-row sync build on it (the state lags a render behind). */
  const loaded = useRef(data);
  /** A first page has been placed since this tab opened. */
  const placed = useRef(false);
  /** There are uncommitted changes: they are the graph's first row (GRAPH-015). */
  const dirty = (repo?.files.length ?? 0) > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const hasHead = useRef(false);
  hasHead.current = !!repo?.head;
  /** Date order (GRAPH-018): the user's choice; `countedFor` = the scope (`all`) whose first page has arrived. */
  const [byDate, setByDate] = useState(false);
  const byDateRef = useRef(byDate);
  byDateRef.current = byDate;
  const [countedFor, setCountedFor] = useState<boolean | null>(null);
  /** The commit to bring back into view once the graph is loaded again in the other order. */
  const orderKeep = useRef<string | null>(null);
  /** Sideways scroll of the lane column, in lanes (GRAPH-017). */
  const [laneScroll, setLaneScroll] = useState(0);
  const wideRef = useRef(1);
  wideRef.current = data.wide;
  /** Height of the whole-history results once the divider under them was dragged (GRAPH-016). */
  const [hitsH, setHitsH] = useState<number | null>(null);
  const hitsRef = useRef<HTMLDivElement>(null);
  /** The current commit's full id (the uncommitted row's parent): among `list`, else asked from git. */
  const headOf = async (list: GitGraphCommit[]): Promise<string | null> => list.find((c) => c.refs.includes("HEAD"))?.sha ?? (hasHead.current ? ((await git.headSha(root).catch(() => null)) ?? null) : null);
  /** Lay `list` out from the top (the uncommitted row came or went: every lane may shift). */
  const place = (list: GitGraphCommit[]) => {
    lanes.current = newGraphState();
    indexOf.current = new Map(list.map((c, i) => [c.sha, i]));
    const laid = layoutGraph(list, lanes.current);
    const next = { commits: list, rows: laid, wide: laid.reduce((m, r) => Math.max(m, r.width), 1) };
    loaded.current = next;
    setData(next);
  };
  // ----- end -----

  useEffect(() => editor.registerFocus(doc.id, () => listRef.current?.focus()), [doc.id]);
  useEffect(() => {
    git.graphIndexed(root).then(setIndexed, () => setIndexed(null));
  }, [root]);

  /** Load the first page (`reset`) or the next one. Resolves false when there was nothing more. */
  const load = useCallback(async (reset: boolean): Promise<boolean> => {
    if (!reset && inFlight.current) return true;
    const gen = reset ? ++generation.current : generation.current;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const size = pageSize.current;
      // Stash rows (and the uncommitted row) are extra rows of a page: git's paging counts commits only.
      const skip = reset ? 0 : indexOf.current.size - stashRows.current - (indexOf.current.has(UNCOMMITTED) ? 1 : 0);
      const started = performance.now();
      // Graph polish: the first page asks for one commit more than it shows, which tells "exactly
      // 300 commits" from "more" (GRAPH-018.6); `order` is the Date order toggle.
      const date = byDateRef.current;
      const got = await git.graph(root, allRef.current, skip, reset ? size + 1 : size, date ? "date" : null);
      const took = performance.now() - started;
      if (gen !== generation.current) return true;
      const probe = reset ? takePage(got, size) : null;
      const page = probe ? probe.rows : got;
      // Date order is only for a history that fits one page: a larger one goes back to branch
      // order (turning the toggle off makes the reload effect run again).
      if (probe?.more && date) {
        byDateRef.current = false;
        setByDate(false);
        toast(DATE_ORDER_OFF, "info", 5000);
        return true;
      }
      // The uncommitted row's parent is the current commit, which need not be on this page.
      const head = reset && dirtyRef.current ? await headOf(page) : null;
      if (gen !== generation.current) return true;
      // Without git's commit-graph file every page costs a walk of the whole history: ask for
      // bigger pages then, so scrolling pays that cost less often.
      if (took > SLOW_PAGE_MS) {
        setSlowMs(Math.round(took));
        pageSize.current = Math.min(MAX_PAGE, size * 4);
      }
      if (reset) {
        lanes.current = newGraphState();
        indexOf.current = new Map();
        stashRows.current = 0;
      }
      const real = page.filter((c) => !indexOf.current.has(c.sha));
      // Uncommitted changes are the first row of the first page (GRAPH-015).
      const fresh = reset && dirtyRef.current ? withUncommitted(real, uncommittedRow(head)) : real;
      stashRows.current += fresh.filter((c) => c.stash).length;
      const full = probe ? probe.more : page.filter((c) => !c.stash).length === size;
      const base = indexOf.current.size;
      fresh.forEach((c, i) => indexOf.current.set(c.sha, base + i));
      const laid = layoutGraph(fresh, lanes.current);
      const wide = laid.reduce((m, r) => Math.max(m, r.width), 1);
      const cur = loaded.current;
      const next = reset ? { commits: fresh, rows: laid, wide } : { commits: [...cur.commits, ...fresh], rows: [...cur.rows, ...laid], wide: Math.max(cur.wide, wide) };
      loaded.current = next;
      setData(next);
      if (reset) {
        placed.current = true;
        setCountedFor(allRef.current);
        // Date order was switched: the selected commit has moved, bring it back into view (GRAPH-018.9).
        if (orderKeep.current) {
          revealWanted.current = orderKeep.current;
          orderKeep.current = null;
          setRevealTick((t) => t + 1);
        }
      }
      setMore(full);
      return full;
    } catch (e) {
      if (gen === generation.current) setError(String(e));
      return false;
    } finally {
      if (gen === generation.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, [root]);
  const allRef = useRef(all);
  allRef.current = all;

  // (Re)load when the tab is shown and whenever the repository moves: commit, pull, push, checkout, fetch.
  const stamp = repo ? `${repo.head}|${repo.branch}|${repo.ahead}|${repo.behind}|${repo.upstream}|${repo.operation}|${repo.stash ?? ""}|${repo.stashCount ?? 0}` : "";
  useEffect(() => {
    if (!visible) return;
    inFlight.current = false;
    void load(true);
  }, [visible, all, stamp, load, byDate]);

  // ----- Graph polish: the uncommitted row follows the working folder (GRAPH-015.7 / .8) -----
  // Its count is read from the status on every render; only its coming and going touches the
  // loaded rows (every lane may shift by one), and the history is not read again for it.
  useEffect(() => {
    if (!placed.current || (rowOffset(loaded.current.commits) === 1) === dirty) return;
    const gen = generation.current;
    void (async () => {
      const head = dirty ? await headOf(withoutUncommitted(loaded.current.commits)) : null;
      const now = loaded.current.commits;
      const want = dirtyRef.current;
      if (gen !== generation.current || want !== dirty || (rowOffset(now) === 1) === want) return;
      place(want ? withUncommitted(now, uncommittedRow(head)) : withoutUncommitted(now));
      // The rows moved by one: what was on screen stays where it was.
      const el = listRef.current;
      if (el && el.scrollTop > 0) el.scrollTop = Math.max(0, el.scrollTop + (want ? ROW : -ROW));
    })();
  }, [dirty]);
  // The row is gone (everything committed or discarded): so is its details pane.
  useEffect(() => {
    if (isUncommitted(selected) && !dirty) setSelected(null);
  }, [dirty, selected]);
  // Switching between Current branch and All branches starts the lane column at lane 1 again (GRAPH-017.9).
  useEffect(() => setLaneScroll(0), [all]);
  // Shift+wheel over the lane column scrolls the lanes sideways, never the list (GRAPH-017.3).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.shiftKey || wideRef.current <= MAX_LANES || !(e.target as Element).closest?.(".graph-lane-cell")) return;
      e.preventDefault();
      const d = e.deltaX || e.deltaY;
      setLaneScroll((cur) => clampLaneScroll(clampLaneScroll(cur, MAX_LANES, wideRef.current) + Math.sign(d) * Math.max(1, Math.abs(d) / 40), MAX_LANES, wideRef.current));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  /** Rows above the first commit (the uncommitted row), and the commits loaded without it. */
  const extra = rowOffset(commits);
  const total = commits.length - extra;
  /** Where the uncommitted row's dashed line ends (see `uncommittedLineEnd`). */
  const lineEnd = useMemo(() => uncommittedLineEnd(commits), [commits]);
  const orderOk = countedFor === all && dateOrderAllowed(total - stashRows.current, more);
  // ----- end -----

  const lanesWide = Math.min(MAX_LANES, data.wide);
  const graphW = lanesWide * LANE + 6;
  // Graph polish (GRAPH-017): the rows are drawn `fullW` wide and shifted by `lanePx` inside the `graphW` column.
  const fullW = data.wide * LANE + 6;
  const lanePx = clampLaneScroll(laneScroll, MAX_LANES, data.wide) * LANE;
  const matches = useMemo(() => (query.trim() ? commits.map((c) => !isUncommitted(c.sha) && commitMatches(c.stash ? { ...c, summary: stashTitle(c.summary).title } : c, query)) : null), [commits, query]);
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
    if (!selected || isUncommitted(selected)) return; // the uncommitted row is not a commit: its pane reads the status
    let live = true;
    // A stash: the files it holds (untracked ones included) instead of a commit's changes.
    const at = indexOf.current.get(selected);
    const held = at !== undefined && commitsRef.current[at]?.stash ? git.stashFiles(root, selected).catch(() => null) : null;
    Promise.all([git.commitDetail(root, selected), held]).then(([d, list]) => live && d && setDetail(list ? { ...d, files: list, stat: `${list.length} file${list.length === 1 ? "" : "s"} in this stash` } : d), () => {});
    return () => { live = false; };
  }, [root, selected]);

  const index = selected ? (indexOf.current.get(selected) ?? -1) : -1;
  // Graph polish (GRAPH-017.5): selecting a commit scrolls the lane column just far enough to show its dot.
  useEffect(() => {
    const col = index >= 0 ? rows[index]?.col : undefined;
    if (col !== undefined && data.wide > MAX_LANES) setLaneScroll((cur) => revealLane(clampLaneScroll(cur, MAX_LANES, data.wide), col, MAX_LANES, data.wide));
  }, [selected, index]);
  const reveal = (i: number) => {
    const el = listRef.current;
    if (!el) return;
    if (i * ROW < el.scrollTop) el.scrollTop = i * ROW;
    else if ((i + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (i + 1) * ROW - el.clientHeight;
  };
  const select = (i: number) => {
    const at = Math.max(0, Math.min(commits.length - 1, i));
    const c = commits[at];
    if (!c) return;
    setSelected(c.sha);
    reveal(at);
  };
  /** Load pages until `sha` is in the graph (it may be far back), then select it. */
  const [seeking, setSeeking] = useState(false);
  const revealWanted = useRef<string | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  useEffect(() => {
    const want = revealWanted.current;
    const i = want ? indexOf.current.get(want) : undefined;
    const el = listRef.current;
    if (i === undefined || !el) return;
    revealWanted.current = null;
    // Centre it: the commits around it are the context.
    el.scrollTop = Math.max(0, i * ROW - el.clientHeight / 2 + ROW);
  }, [revealTick, commits.length]);
  const goTo = async (sha: string, keep = false) => {
    let i = indexOf.current.get(sha) ?? -1;
    if (i < 0) {
      setSeeking(true);
      const gen = generation.current;
      // Bigger pages while seeking: the commit can be tens of thousands back.
      pageSize.current = MAX_PAGE;
      while (i < 0 && gen === generation.current && (await load(false))) i = indexOf.current.get(sha) ?? -1;
      i = indexOf.current.get(sha) ?? -1;
      setSeeking(false);
      if (gen !== generation.current) return;
    }
    if (i < 0) {
      toast(all ? "That commit is not in this history." : "That commit is not on this branch. Switch to All branches to see it.", "info", 5000);
      return;
    }
    if (!keep) setSelected(sha);
    // The list only becomes tall enough once the new pages are rendered (see the effect below).
    revealWanted.current = sha;
    setRevealTick((t) => t + 1);
  };
  /** Search every commit with git (not just the loaded pages). */
  const searchAll = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      setHits({ query: q, list: await git.graphSearch(root, all, q, 200) });
      setHitsOpen(true);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setSearching(false);
    }
  };
  const pickHit = (c: GitGraphCommit, el?: HTMLElement) => {
    // A dragged height is the user's choice: the list only shrinks while it has its default height (GRAPH-016.4).
    if (hitsH === null) setHitsOpen(false);
    // Keep the picked result in view once the list has shrunk.
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "nearest" }));
    setPicked(c);
    setSelected(c.sha);
    const i = indexOf.current.get(c.sha);
    if (i !== undefined) reveal(i);
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
    if (e.key === "Escape" && !compare) return;
    if (e.key === "Escape") setCompare(null); // back to the first commit alone (COMMITCMP-001.6)
    else if (e.key === "ArrowDown") select(index + 1);
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
    const ask = actionConfirm(action, c, branch, repo?.files.length ?? 0);
    if (ask && !(await askDialog(ask.title, ask.text, ask.ok, ask.kind))) return;
    if (await commitAction(root, action, c.sha, name)) {
      toast(actionDone(action, c.short, name), "success", 3000);
      // Branches and tags do not change the status the reload effect watches.
      if (action === "branch" || action === "tag") void load(true);
    }
  };
  /** Stash rows: the same guarded actions as the Stashes section. */
  const stashBlock = repo ? stashBlocked(repo, "apply") : null;
  const stashAct = (what: "apply" | "pop" | "drop", c: GitGraphCommit) => void stashAction(root, { sha: c.sha, subject: c.summary, time: c.time }, what);
  const commitNaming = () => {
    const n = newName.trim();
    const cur = naming;
    // Rename Branch… (BRANCH-004): an empty or unchanged name does nothing; the rest is the command's.
    if (cur?.action === "rename") {
      if (!n || n === cur.branch) return;
      setNaming(null);
      setNewName("");
      void runCommand("git.renameBranch", { name: cur.branch, to: n, root });
      return;
    }
    setNaming(null);
    setNewName("");
    if (cur && n) void act(cur.action, cur.commit, n);
  };

  // The menu closes on any click outside it, Escape, or losing the window.
  useEffect(() => {
    if (!menu && !refMenu) return;
    const close = () => {
      setMenu(null);
      setRefMenu(null);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", close);
    };
  }, [menu, refMenu]);

  // ----- Branch and tag housekeeping (specs/git-branches.md) -----
  // What the label menu needs besides the status: each branch's upstream, each remote's default branch.
  const refInfo = useGit((s) => s.refInfo[root.toLowerCase()]);
  const refsTick = useGit((s) => s.refsTick);
  const refCtx = { repo, busy, remotes: repo?.remotes.map((r) => r.name) ?? [], upstreams: refInfo?.upstreams, defaults: refInfo?.defaults };
  useEffect(() => {
    if (visible) void loadRefInfo(root);
  }, [visible, root, stamp, refsTick]);
  // A branch or tag action ran: refs do not change the status the reload effect watches.
  const seenTick = useRef(refsTick);
  useEffect(() => {
    if (seenTick.current === refsTick) return;
    seenTick.current = refsTick;
    if (visible) void load(true);
  }, [refsTick, visible, load]);
  /** An entry of the label menu that is not merge / rebase. Every action is a command, so its questions cannot be skipped. */
  const refAct = (e: RefMenuEntry, m: { name: string; kind: "branch" | "remote" | "tag" }, commit: GitGraphCommit) => {
    setRefMenu(null);
    if (e.id === "switch") void checkoutRef(root, m.name);
    else if (e.id === "copy") copy(m.name, m.kind === "tag" ? "the tag name" : "the branch name");
    else if (e.id === "rename") {
      setNewName(m.name);
      setNaming({ action: "rename", commit, branch: m.name });
    } else if (REF_COMMANDS[e.id]) void runCommand(REF_COMMANDS[e.id], { name: m.name, root });
  };
  const refIcon = (id: string) => (id === "switch" ? GitBranch : id === "copy" ? Copy : id === "rename" ? Pencil : id === "upstream" ? Link2 : id === "push" || id === "push-tag" ? CloudUpload : Trash2);

  // ----- Merge / rebase (specs/git-merge-rebase.md) -----
  /** Right-click on a ref label: its own menu; a label without one (detached HEAD) opens the commit's. */
  const onRefContext = (e: React.MouseEvent, c: GitGraphCommit, label: RefLabel) => {
    e.preventDefault();
    e.stopPropagation();
    noteMenuOther(c);
    setSelected(c.sha);
    const at = { x: e.clientX, y: e.clientY, commit: c };
    const has = !c.stash && !!refMenuOf(label, refCtx); // a stash row only ever gets its own menu
    setMenu(has ? null : at);
    setRefMenu(has ? { ...at, label } : null);
  };
  const start = (kind: StartEntry["kind"], target: StartTarget) => void (kind === "merge" ? startMerge : startRebase)(root, target);
  /** A merge / rebase entry: greyed out with the reason as its tooltip when it cannot start. */
  const startItem = (e: StartEntry, target: StartTarget) => (
    <button key={e.kind} className="palette-item" role="menuitem" disabled={!!e.disabled} title={e.disabled ?? e.hint} onClick={() => { setMenu(null); setRefMenu(null); start(e.kind, target); }}>
      <GitMerge size={13} /><span className="title">{e.label}</span>
    </button>
  );

  // ----- Compare commits (specs/git-compare-commits.md) -----
  /** What a comparison started by Compare with Branch… carries: names beside the ids, the branch ordering rule, git's answer. */
  const [cmp, setCmp] = useState<{ names: CompareNames; picked: boolean; initial: GitCompare | null }>({ names: {}, picked: false, initial: null });
  /** The commit that was selected when the commit menu opened: "Compare with <short id>". */
  const [menuOther, setMenuOther] = useState<GitGraphCommit | null>(null);
  const comparePair = (firstSha: string | null, second: string | null) => {
    setSelectedOnly(firstSha);
    setCompare(second);
    setCmp({ names: {}, picked: false, initial: null });
  };
  const rowOf = (sha: string) => {
    const i = indexOf.current.get(sha);
    return i !== undefined ? commits[i] : picked?.sha === sha ? picked : null;
  };
  /** Ctrl+click on a commit row. A stash cannot be compared (nor compared with): a plain click then. */
  const ctrlClick = (c: GitGraphCommit) => {
    if (c.stash || !selected || rowOf(selected)?.stash || isUncommitted(c.sha) || isUncommitted(selected)) return setSelected(c.sha); // nor can the uncommitted row (GRAPH-015.16)
    const next = compareClick({ first: selected, second: compare }, c.sha);
    comparePair(next.first, next.second);
  };
  /** Call before a right-click moves the selection to `c`. */
  const noteMenuOther = (c: GitGraphCommit) => {
    const other = selected && selected !== c.sha && !c.stash && !isUncommitted(selected) ? rowOf(selected) : null;
    setMenuOther(other && !other.stash ? other : null);
  };
  // A comparison asked for from outside (Compare with Branch…): its commits need not be loaded.
  const pending = useStore((s) => s.graphCompare);
  useEffect(() => {
    if (!pending || pending.root.toLowerCase() !== root.toLowerCase()) return;
    useStore.getState().set({ graphCompare: null });
    setSelectedOnly(pending.first);
    setCompare(pending.second);
    setCmp({ names: pending.names, picked: true, initial: pending.result });
  }, [pending, root]);
  // A reload (every return to this tab reloads the first page) keeps the comparison: a side that is
  // not among the loaded rows any more just has no highlighted row, and offers Show in Graph.

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
  // Graph polish (GRAPH-016): the divider under the whole-history results. The height is kept for
  // this tab; the limits are `clampHitsHeight`'s, measured when the drag starts.
  const startHitsResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = hitsRef.current;
    const listEl = listRef.current;
    if (!el || !listEl) return;
    const startY = e.clientY;
    const startH = el.offsetHeight;
    const content = el.scrollHeight;
    const available = startH + listEl.clientHeight - LIST_MIN;
    let moved = false;
    const move = (ev: MouseEvent) => {
      const h = clampHitsHeight(startH + ev.clientY - startY, content, available);
      // A drag that changes nothing (2 results cannot grow) is not remembered as a chosen height.
      if (h !== startH) moved = true;
      if (!moved) return;
      setHitsH(h);
      setHitsOpen(true);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const conflicts =repo?.files.filter((f) => f.conflicted).length ?? 0;
  /** Open Source Control and land on the first file that needs attention (a conflict, else a change). */
  const openSourceControl = () => {
    showPanel("git");
    requestAnimationFrame(() => {
      const panel = document.querySelector('.sidebar[data-panel="git"]');
      const row = panel?.querySelector<HTMLElement>('[aria-label="Merge Changes"] .scm-row') ?? panel?.querySelector<HTMLElement>(".scm-row");
      row?.focus();
      row?.scrollIntoView({ block: "nearest" });
    });
  };
  const sel = index >= 0 ? commits[index] : picked && picked.sha === selected ? picked : null;
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
        {/* Graph polish (GRAPH-018): date order, for a history that fits one page. */}
        <div className="segmented graph-order" title={orderOk ? undefined : countedFor === all ? DATE_ORDER_WHY : "Available once the commits are counted"}>
          <button
            className={byDate && orderOk ? "on" : ""}
            aria-pressed={byDate && orderOk}
            disabled={!orderOk}
            title={orderOk ? "List the commits newest first across branches (by the date in the Date column) instead of branch by branch" : countedFor === all ? DATE_ORDER_WHY : "Available once the commits are counted"}
            onClick={() => {
              orderKeep.current = selected;
              setByDate(!byDate);
            }}
          >
            Date order
          </button>
        </div>
        <span className="graph-search">
          <Search size={13} className="muted" />
          <input
            ref={searchRef}
            className="input"
            placeholder="Find: message, author, id, branch"
            aria-label="Find in the commits loaded so far"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHits(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (matchCount && !e.ctrlKey) nextMatch(e.shiftKey ? -1 : 1);
                else void searchAll();
              }
              if (e.key === "Escape") {
                setQuery("");
                setHits(null);
                listRef.current?.focus();
              }
              e.stopPropagation();
            }}
          />
          {matches && <span className="muted graph-count" title="Matches among the commits loaded so far">{matchCount} in {total} loaded</span>}
          {matches && <button className="icon-btn xs" title="Previous match (Shift+Enter)" disabled={!matchCount} onClick={() => nextMatch(-1)}><ArrowUp size={13} /></button>}
          {matches && <button className="icon-btn xs" title="Next match (Enter)" disabled={!matchCount} onClick={() => nextMatch(1)}><ArrowDown size={13} /></button>}
          {matches && more && (
            <button className="btn small" disabled={searching} title={`Only ${total} commits are loaded so far. Search every commit ${all ? "of every branch" : "of this branch"} with git (Ctrl+Enter; Enter when nothing loaded matches)`} onClick={() => void searchAll()}>
              {searching ? "Searching…" : "Search All History"}
            </button>
          )}
        </span>
        <span className="grow" />
        {(busy || loading || seeking) && <span className="muted row graph-busy"><Loader2 size={13} className="spin" /> {busy ?? (seeking ? "Loading back to that commit…" : "Loading…")}</span>}
        <span className="muted graph-count">{total}{more ? "+" : ""} commits</span>
        <button className="icon-btn" title="Fetch from all remotes" disabled={!!busy} onClick={() => void remote(root, "fetch").then(() => load(true))}><CloudDownload size={15} /></button>
        <button className="icon-btn" title="Reload the graph" onClick={() => void load(true)}><RefreshCw size={15} /></button>
      </div>

      {repo?.operation && (
        <div className="graph-strip warn" role="status">
          <TriangleAlert size={14} />
          <span className="grow">
            {stoppedNoun(repo.operation)} stopped part-way{conflicts ? `: ${conflicts} file${conflicts === 1 ? " has" : "s have"} conflicts` : ""}. Resolve them in Source Control and commit, or abort to go back to how things were.
          </span>
          {/* With the panel already open the button would do nothing visible: it is only offered when it is closed. */}
          {!gitShown && <button className="btn small" onClick={openSourceControl}>Open Source Control</button>}
          <button className="btn small" disabled={!!busy} onClick={() => void abortOperation(root, repo.operation!)}>Abort</button>
        </div>
      )}
      {repo && isStashConflict(repo) && (
        <div className="graph-strip warn" role="status">
          <TriangleAlert size={14} />
          <span className="grow">{stashConflictStrip(conflicts)}</span>
          {!gitShown && <button className="btn small" onClick={openSourceControl}>Open Source Control</button>}
        </div>
      )}
      {/* Uncommitted changes are the first row of the list, not a strip (GRAPH-015). */}
      {slowMs > 0 && indexed === false && !hideSpeedUp && (
        <div className="graph-strip" role="status">
          <Gauge size={14} className="muted" />
          <span className="grow">
            This is a large history: git needed {(slowMs / 1000).toFixed(1)} s for the last page. It can index the history once (a file inside .git, the same one <span className="mono">git gc</span> writes), after which pages load several times faster.
          </span>
          <button
            className="btn small btn-primary"
            disabled={indexing}
            onClick={async () => {
              setIndexing(true);
              try {
                await git.graphIndex(root);
                setIndexed(true);
                setSlowMs(0);
                pageSize.current = PAGE;
                toast("History indexed.", "success", 3000);
              } catch (e) {
                toast(String(e), "error");
              } finally {
                setIndexing(false);
              }
            }}
          >
            {indexing ? "Indexing…" : "Speed Up"}
          </button>
          <button className="icon-btn xs" title="Not now" onClick={() => setHideSpeedUp(true)}><X size={14} /></button>
        </div>
      )}
      {hits && (
        <div ref={hitsRef} className={`graph-hits ${hitsOpen ? "" : "compact"} ${hitsH !== null && hitsOpen ? "sized" : ""}`} style={hitsH !== null && hitsOpen ? { maxHeight: hitsH } : undefined} role="listbox" aria-label="Search results in the whole history">
          <div className="graph-hits-head">
            <span className="grow">{hits.list.length === 0 ? `No commit ${all ? "in any branch" : "on this branch"} matches "${hits.query}"${all ? "." : ". Try All branches."}` : `${hits.list.length}${hits.list.length === 200 ? "+" : ""} commit${hits.list.length === 1 ? "" : "s"} in the whole history match "${hits.query}" (message, author, branch / tag or id)`}</span>
            {hits.list.length > 3 && (
              <button className="btn small" title={hitsOpen ? "Shrink the results to a few rows" : "Show more of the results"} onClick={() => setHitsOpen(!hitsOpen)}>{hitsOpen ? "Show Fewer" : "Show More"}</button>
            )}
            <button className="icon-btn xs" title="Close the results" onClick={() => setHits(null)}><X size={14} /></button>
          </div>
          {hits.list.map((c) => (
            <div key={c.sha} role="option" aria-selected={c.sha === selected} className={`graph-hit ${c.sha === selected ? "selected" : ""}`} onClick={(e) => pickHit(c, e.currentTarget)} onDoubleClick={() => void goTo(c.sha)} title="Click for its details, double-click to go to it in the graph">
              <span className="mono graph-c-sha">{c.short}</span>
              <span className="truncate grow">{c.summary}</span>
              <span className="graph-c-author truncate">{c.author}</span>
              <span className="graph-c-date truncate">{relativeTime(c.time)}</span>
            </div>
          ))}
        </div>
      )}
      {/* Graph polish (GRAPH-016): drag the edge between the results and the graph; double-click for the default height. */}
      {hits && hits.list.length > 0 && <div className="graph-resizer graph-hits-resizer" title="Drag to resize the results; double-click for the default height" onMouseDown={startHitsResize} onDoubleClick={() => setHitsH(null)} />}
      {naming && (
        <div className="graph-naming">
          {naming.action === "rename" ? <span>Rename branch <span className="mono">{naming.branch}</span> to:</span> : <span>{naming.action === "tag" ? "New tag" : "New branch"} at <span className="mono">{naming.commit.short}</span>:</span>}
          <input
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
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
          <button className="btn btn-primary small" disabled={!newName.trim() || (naming.action === "rename" && newName.trim() === naming.branch)} onClick={commitNaming}>{naming.action === "rename" ? "Rename" : naming.action === "branch-switch" ? "Create and Switch" : "Create"}</button>
          <button className="icon-btn xs" title="Cancel" onClick={() => setNaming(null)}><X size={14} /></button>
        </div>
      )}

      <div className="graph-head" style={{ paddingLeft: graphW + 8 }}>
        <span className="graph-c-msg">Commit</span>
        <span className="graph-c-author">Author</span>
        <span className="graph-c-date">Date</span>
        <span className="graph-c-sha">Id</span>
        {/* Graph polish (GRAPH-017): a graph wider than 16 lanes scrolls sideways under the column heading. */}
        {data.wide > MAX_LANES && <GraphLaneScroll scroll={lanePx} width={graphW} total={fullW} onScroll={(px) => setLaneScroll(px / LANE)} />}
      </div>
      <div
        ref={listRef}
        className={`graph-list ${lanePx > 0 ? "lanes-left" : ""} ${lanePx < fullW - graphW ? "lanes-right" : ""}`}
        style={{ "--lane-scroll": `${lanePx}px` } as React.CSSProperties}
        role="listbox"
        aria-label="Commits"
        tabIndex={0}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
      >
        {error && <div className="panel-note">Could not read the history: {error}</div>}
        {!error && total === 0 && !extra && <div className="panel-note">{loading ? "Loading…" : "No commits yet."}</div>}
        <div style={{ height: commits.length * ROW, position: "relative" }}>
          {commits.slice(first, last).map((c, k) => {
            const i = first + k;
            const row = rows[i];
            const labels = refLabels(c.refs);
            const isHead = c.refs.includes("HEAD");
            const dim = matches ? !matches[i] : false;
            // Graph polish (GRAPH-015): the uncommitted row (not a commit: no menu, empty columns) and its dashed line in lane 0.
            const un = isUncommitted(c.sha);
            const unLine = un ? "row" : extra && lineEnd !== 0 && (lineEnd < 0 || i <= lineEnd) ? "line" : undefined;
            return (
              <div
                key={c.sha}
                role="option"
                aria-selected={c.sha === selected || c.sha === compare}
                className={`graph-row ${c.sha === selected ? "selected" : ""} ${dim ? "dim" : ""} ${isHead ? "head" : ""} ${c.stash ? "stash" : ""} ${c.sha === compare ? "selected compare" : ""} ${un ? "uncommitted" : ""}`}
                style={{ top: i * ROW, height: ROW }}
                onClick={(e) => { if (e.ctrlKey) ctrlClick(c); else setSelected(c.sha); listRef.current?.focus(); }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (un) return setSelected(c.sha); // selected, but nothing to offer: it is not a commit (GRAPH-015.9)
                  noteMenuOther(c);
                  setSelected(c.sha);
                  setMenu({ x: e.clientX, y: e.clientY, commit: c });
                }}
              >
                <span className="graph-lane-cell" style={{ width: graphW }}>{row && <RowGraph row={row} head={isHead} width={fullW} stash={c.stash} uncommitted={unLine} />}</span>
                <span className="graph-c-msg">
                  {labels.map((l) => <RefBadge key={l.full} label={l} open={refMenu?.label.full === l.full && refMenu.commit.sha === c.sha} onContextMenu={(e) => onRefContext(e, c, l)} />)}
                  {un && <CircleDot size={12} className="muted" />}
                  <span className="truncate" title={un ? "Work that is not committed yet, on the commit it sits on. Select it to see the changed files." : c.summary}>{un ? `Uncommitted changes (${repo?.files.length ?? 0})` : c.stash ? stashTitle(c.summary).title : c.summary}</span>
                </span>
                <span className="graph-c-author truncate" title={un ? undefined : `${c.author} <${c.email}>`}>{c.author}</span>
                <span className="graph-c-date truncate" title={un ? undefined : new Date(c.time * 1000).toLocaleString()}>{un ? "" : relativeTime(c.time)}</span>
                <span className="graph-c-sha mono" title={un ? undefined : c.sha}>{c.short}</span>
              </div>
            );
          })}
        </div>
        {/* Before the first commit the uncommitted row stands alone (GRAPH-015.14). */}
        {!error && total === 0 && extra > 0 && !loading && <div className="panel-note">No commits yet.</div>}
      </div>

      {/* Two sides set: the comparison pane takes the details pane's place (same resizer and height). */}
      {selected && compare && (
        <>
          <div className="graph-resizer" onMouseDown={startResize} />
          <GraphCompare
            root={root}
            first={selected}
            second={compare}
            names={cmp.names}
            picked={cmp.picked}
            initial={cmp.initial}
            height={detailH}
            tick={repo}
            loaded={(sha) => indexOf.current.has(sha)}
            seeking={seeking}
            onShowInGraph={(sha) => void goTo(sha, true)}
            onClose={() => setSelected(null)}
          />
        </>
      )}
      {/* Graph polish (GRAPH-015): the uncommitted row's pane lists the changed files instead of a commit's details. */}
      {isUncommitted(selected) && !compare && repo && dirty && (
        <>
          <div className="graph-resizer" onMouseDown={startResize} />
          <GraphUncommitted repo={repo} base={commits[0]?.parents[0] ?? null} height={detailH} gitShown={gitShown} onBase={(sha) => void goTo(sha)} onOpenSourceControl={openSourceControl} onClose={() => setSelected(null)} />
        </>
      )}
      {sel && !compare && !isUncommitted(sel.sha) && (
        <>
          <div className="graph-resizer" onMouseDown={startResize} />
          <div className="graph-detail selectable" style={{ height: detailH }}>
            <div className="graph-detail-info">
              <div className="row">
                <GitCommitHorizontal size={14} className="muted" />
                <span className="mono graph-full-sha">{sel.sha}</span>
                <button className="icon-btn xs" title="Copy the commit id" onClick={() => copy(sel.sha, "the commit id")}><Copy size={12} /></button>
                {index < 0 && <button className="btn small" disabled={seeking} title="Load the graph back to this commit and show it there" onClick={() => void goTo(sel.sha)}>{seeking ? "Loading…" : "Show in Graph"}</button>}
                <span className="grow" />
                <button className="icon-btn xs" title="Close details" onClick={() => setSelected(null)}><X size={14} /></button>
              </div>
              <pre className="graph-message">{sel.stash ? stashTitle(sel.summary).title : (detail?.message ?? sel.summary)}</pre>
              <dl className="graph-meta">
                <dt>{sel.stash ? "Stashed" : "Author"}</dt><dd>{sel.author} &lt;{sel.email}&gt; · {new Date(sel.time * 1000).toLocaleString()}</dd>
                {detail && !sel.stash && (detail.committer !== detail.author || detail.commitTime !== detail.time) && (
                  <><dt>Committed</dt><dd>{detail.committer} &lt;{detail.committerEmail}&gt; · {new Date(detail.commitTime * 1000).toLocaleString()}</dd></>
                )}
                {index >= 0 && rows[index]?.from.length > 0 && (
                  <>
                    <dt title="Commits further up whose line to this one is cut short (the arrows in the graph)">Continues</dt>
                    <dd>{rows[index].from.map((r) => commits[r] && <button key={r} className="link-btn mono" title={commits[r].summary} onClick={() => select(r)}>{commits[r].short}</button>)}</dd>
                  </>
                )}
                <dt title={sel.stash ? "The commit this stash was made on" : undefined}>{sel.parents.length > 1 ? "Parents" : "Parent"}</dt>
                <dd>
                  {sel.parents.length === 0 && "none (the first commit)"}
                  {sel.parents.map((p) => <button key={p} className="link-btn mono" title="Go to this commit" onClick={() => void goTo(p)}>{p.slice(0, 7)}</button>)}
                </dd>
                {refLabels(sel.refs).length > 0 && (<><dt>Refs</dt><dd className="graph-refs">{refLabels(sel.refs).map((l) => <RefBadge key={l.full} label={l} onContextMenu={(e) => onRefContext(e, sel, l)} />)}</dd></>)}
              </dl>
            </div>
            <div className="graph-detail-files">
              <div className="graph-files-head">{detail ? (detail.stat || "No file changes") : "Loading…"}{sel.parents.length > 1 && " (against the first parent)"}</div>
              {detail?.files.map((f) => <DetailFile key={f.rel} file={f} commit={sel} />)}
            </div>
          </div>
        </>
      )}

      {menu && menu.commit.stash && createPortal(
        <GraphMenu menu={menu}>
          {stashMenu(stashBlock, !!busy).map((m) => (
            <button
              key={m.id}
              className={`palette-item ${m.danger ? "danger" : ""}`}
              role="menuitem"
              disabled={!!m.disabled}
              title={m.disabled ?? undefined}
              onClick={() => {
                const c = menu.commit;
                setMenu(null);
                if (m.id === "copy") copy(stashTitle(c.summary).title, "the message");
                else stashAct(m.id, c);
              }}
            >
              {m.id === "copy" ? <Copy size={13} /> : m.id === "drop" ? <X size={13} /> : m.id === "pop" ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              <span className="title">{m.label}</span>
            </button>
          ))}
        </GraphMenu>,
        document.body,
      )}
      {menu && !menu.commit.stash && createPortal(
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
          {item("Create Branch Here (Don't Switch)…", GitBranch, () => { setNewName(""); setNaming({ action: "branch", commit: menu.commit }); }, "A new branch starting at this commit; you stay where you are")}
          {item("Create Tag Here…", Tag, () => { setNewName(""); setNaming({ action: "tag", commit: menu.commit }); })}
          {item("Check Out This Commit…", GitCommitHorizontal, () => void act("checkout", menu.commit), "Look at the files as they were (detached: not on a branch)")}
          {/* Compare commits: read-only, so never greyed out. */}
          <div className="menu-sep" />
          {menuOther && item(`Compare with ${menuOther.short}`, ArrowLeftRight, () => comparePair(menuOther.sha, menu.commit.sha), `The files that differ between ${menuOther.short} and this commit`)}
          {item("Compare with Working Tree", ArrowLeftRight, () => comparePair(menu.commit.sha, WORKTREE), "The files that differ between this commit and your files as they are now (tracked files, staged or not)")}
          {item("Compare with Branch…", ArrowLeftRight, () => void pickBranch("compare", { root, sha: menu.commit.sha }), "Pick a branch: the files that differ between its latest commit and this one")}
          <div className="menu-sep" />
          {item(`Cherry-pick onto ${branch ?? "Here"}…`, GitCommitHorizontal, () => void act("cherry-pick", menu.commit), "Copy this commit's changes onto the current branch as a new commit")}
          {item("Revert This Commit…", Undo2, () => void act("revert", menu.commit), "Add a commit that undoes this one")}
          {/* Merge / rebase: a commit with one other branch label stands for that branch. */}
          {startEntries(targetOf(menu.commit, branch), repo, busy, menu.commit.refs.includes("HEAD") ? "commit" : null).map((e) => startItem(e, targetOf(menu.commit, branch)))}
          <div className="menu-sep" />
          {item(`Reset ${branch ?? "HEAD"} to Here (Soft)…`, RotateCcw, () => void act("reset-soft", menu.commit), "Keep later changes staged")}
          {item(`Reset ${branch ?? "HEAD"} to Here (Mixed)…`, RotateCcw, () => void act("reset-mixed", menu.commit), "Keep later changes in the files, unstaged")}
          {item(`Reset ${branch ?? "HEAD"} to Here (Hard)…`, RotateCcw, () => void act("reset-hard", menu.commit), "Discard later commits and uncommitted changes", true)}
          {/* Claude git helpers: the Summarise entries, always the last group (specs/git-claude.md). */}
          <SummariseItems root={root} commits={commits} commit={menu.commit} branch={branch} close={() => setMenu(null)} />
        </GraphMenu>,
        document.body,
      )}
      {refMenu && (() => {
        // The ref-label menu: built by `refMenu()` so later entries (branch and tag housekeeping) land here.
        const m = refMenuOf(refMenu.label, refCtx);
        if (!m) return null;
        const target = { ref: m.full, label: m.name, named: true };
        return createPortal(
          <GraphMenu menu={refMenu} head={m.heading}>
            {m.entries.map((e) => (
              <span key={e.id} style={{ display: "contents" }}>
                {e.group && <div className="menu-sep" />}
                {(e.id === "merge" || e.id === "rebase") && startItem({ kind: e.id, label: e.label, disabled: e.disabled, hint: e.title ?? "" }, target)}
                {/* Housekeeping entries (specs/git-branches.md): Switch, rename, upstream, push, delete, copy. */}
                {e.id !== "merge" && e.id !== "rebase" && (() => {
                  const Icon = refIcon(e.id);
                  return (
                    <button className={`palette-item ${e.danger ? "danger" : ""}`} role="menuitem" disabled={!!e.disabled} title={e.disabled ?? e.title} onClick={() => refAct(e, m, refMenu.commit)}>
                      <Icon size={13} /><span className="title">{e.label}</span>
                    </button>
                  );
                })()}
              </span>
            ))}
          </GraphMenu>,
          document.body,
        );
      })()}
    </div>
  );
}

/** "The rebase", "The patch series": the strip's subject. */
function stoppedNoun(operation: string): string {
  const n = operationWords(operation).noun;
  return n[0].toUpperCase() + n.slice(1);
}

function DetailFile({ file, commit }: { file: GitCommitFile; commit: GitGraphCommit }) {
  const kind = commitFileKind(file.status);
  const slash = file.rel.lastIndexOf("/");
  const open = () => commit.stash ? void openStashFile({ sha: commit.sha, short: commit.short, base: commit.parents[0] ?? "" }, file) : void openCommitFile({ sha: commit.sha, short: commit.short, author: commit.author, email: commit.email, time: commit.time, summary: commit.summary, rel: file.rel, root: "" }, file);
  return (
    <div
      className="scm-row graph-file"
      tabIndex={0}
      title={`${file.rel}\n${KIND_LABEL[kind]}${file.origRel ? ` (from ${file.origRel})` : ""}\nClick to see what this commit changed, double-click to open the file as it is now`}
      onClick={open}
      onDoubleClick={() => file.status !== "D" && (commit.stash ? void fs.exists(file.path).then((there) => void (there && openPath(file.path)), () => {}) : void openPath(file.path))}
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
function GraphMenu({ menu, children, head }: { menu: Menu; children: React.ReactNode; head?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)) });
  }, [menu.x, menu.y]);
  return (
    <div ref={ref} className="palette ctx-menu graph-menu" role="menu" style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="graph-menu-head truncate">{head ?? <><span className="mono">{menu.commit.short}</span> {menu.commit.stash ? `Stash: ${stashTitle(menu.commit.summary).title}` : menu.commit.summary}</>}</div>
      {children}
    </div>
  );
}
