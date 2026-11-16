/**
 * Commit graph layout (pure, unit-tested): which lane each commit sits in and which lines cross
 * its row. Commits arrive children-before-parents (git log --topo-order).
 *
 * Two things keep the graph narrow on histories with many branches:
 * - a lane is freed as soon as its line ends, and the lowest free lane is reused;
 * - a line that has run for `maxSpan` rows without reaching its commit is cut short: it ends in a
 *   down arrow, its lane is freed, and the commit it leads to (possibly thousands of rows further
 *   down) shows an up arrow where the line comes back in. Without this, every branch that forked
 *   from an old commit keeps a lane for the whole distance (150+ lanes on git.git).
 */
import { lostEditsSentence } from "./gitSafety";

export interface GraphInput {
  sha: string;
  parents: string[];
}

export interface GraphRow {
  /** The commit's lane. */
  col: number;
  /** Lanes whose line comes down from the row above and ends at this commit. */
  into: number[];
  /** Lanes that pass this row top to bottom (other branches). */
  through: number[];
  /** Lanes at the bottom edge this commit connects to: one per parent. */
  out: number[];
  /** Lanes whose line is cut short here (a down arrow): it continues at a commit further down. */
  cut: number[];
  /** Rows (indexes) of the commits whose cut lines lead here: this commit shows an up arrow. */
  from: number[];
  /** Number of lanes this row needs. */
  width: number;
}

interface Wait {
  /** The commit this lane's line leads to. */
  sha: string;
  /** Row of the commit the line started at, and the row it has run since. */
  child: number;
  since: number;
}

/** State carried from one page of commits to the next. */
export interface GraphState {
  lanes: (Wait | null)[];
  /** Commits that cut lines lead to: the rows of the commits those lines started at. */
  cut: Map<string, number[]>;
  /** Rows laid out so far. */
  row: number;
}

export const newGraphState = (): GraphState => ({ lanes: [], cut: new Map(), row: 0 });

/** Rows a line may run before it is cut. */
export const MAX_SPAN = 40;

function firstFree(lanes: (Wait | null)[]): number {
  const i = lanes.indexOf(null);
  if (i >= 0) return i;
  lanes.push(null);
  return lanes.length - 1;
}

/** Lay out `commits`, continuing from `state` (mutated; pass `newGraphState()` for the first page). */
export function layoutGraph(commits: GraphInput[], state: GraphState = newGraphState(), maxSpan = MAX_SPAN): GraphRow[] {
  const { lanes, cut } = state;
  const rows: GraphRow[] = [];
  const laneOf = (sha: string) => lanes.findIndex((w) => w?.sha === sha);
  for (const c of commits) {
    const r = state.row++;
    const into: number[] = [];
    lanes.forEach((w, i) => {
      if (w?.sha === c.sha) into.push(i);
    });
    // A commit nothing points at (a branch tip, or one only cut lines lead to) starts a lane.
    const col = into.length ? into[0] : firstFree(lanes);
    for (const i of into) lanes[i] = null;
    lanes[col] = null;
    const from = cut.get(c.sha) ?? [];
    cut.delete(c.sha);

    // Lines that have run long enough end here with an arrow. Lane 0 (the first branch shown,
    // normally the one you are on) is never cut.
    const through: number[] = [];
    const cutHere: number[] = [];
    lanes.forEach((w, i) => {
      if (!w) return;
      if (i > 0 && r - w.since >= maxSpan) {
        cutHere.push(i);
        const list = cut.get(w.sha);
        if (list) list.push(w.child);
        else cut.set(w.sha, [w.child]);
      } else through.push(i);
    });

    const out: number[] = [];
    c.parents.forEach((p, k) => {
      let j = laneOf(p);
      // A lane being cut on this row is not a target: the line to it would end at once.
      if (j >= 0 && cutHere.includes(j)) j = -1;
      if (k === 0 && lanes[col] === null && (j < 0 || j > col)) {
        // The first parent continues this commit's lane, so a branch's own line stays straight.
        // If a lane further right already waits for that parent, both run down and join at it.
        j = col;
        lanes[j] = { sha: p, child: r, since: r };
      } else if (j < 0) {
        // Another parent (a merge) opens a lane; never one that is being cut on this row.
        j = lanes.findIndex((w, i) => w === null && !cutHere.includes(i));
        if (j < 0) {
          lanes.push(null);
          j = lanes.length - 1;
        }
        lanes[j] = { sha: p, child: r, since: r };
      }
      if (!out.includes(j)) out.push(j);
    });
    for (const i of cutHere) if (lanes[i] && lanes[i]!.since !== r) lanes[i] = null;
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ col, into, through, out, cut: cutHere, from, width: Math.max(col, ...into, ...through, ...out, ...cutHere) + 1 });
  }
  return rows;
}

export type RefKind = "head" | "branch" | "remote" | "tag" | "stash";

export interface RefLabel {
  kind: RefKind;
  /** Short name: `main`, `origin/main`, `v1.0`. */
  name: string;
  full: string;
}

/**
 * Labels for a commit's refs (full names from git): local branches first (the checked-out one
 * marked "head"), then remote branches, then tags. `HEAD` alone (detached) is its own label; the
 * `origin/HEAD` pointer is dropped.
 */
export function refLabels(refs: string[]): RefLabel[] {
  const head = refs.includes("HEAD");
  const out: RefLabel[] = [];
  let attached = false;
  for (const full of refs) {
    if (full === "HEAD" || /^refs\/remotes\/[^/]+\/HEAD$/.test(full)) continue;
    if (full.startsWith("refs/heads/")) {
      // git lists the checked-out branch first, right after HEAD.
      const current = head && !attached && refs[refs.indexOf("HEAD") + 1] === full;
      if (current) attached = true;
      out.push({ kind: current ? "head" : "branch", name: full.slice(11), full });
    } else if (full.startsWith("refs/remotes/")) out.push({ kind: "remote", name: full.slice(13), full });
    else if (full.startsWith("refs/tags/")) out.push({ kind: "tag", name: full.slice(10), full });
    else if (full === "refs/stash") out.push({ kind: "stash", name: "stash", full }); // a stash row's label
  }
  if (head && !attached) out.unshift({ kind: "head", name: "HEAD", full: "HEAD" });
  const rank: Record<RefKind, number> = { head: 0, branch: 1, remote: 2, tag: 3, stash: 4 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** Does a commit match the graph's search box (message, author, email, id, ref names)? */
export function commitMatches(c: { sha: string; summary: string; author: string; email: string; refs: string[] }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return c.summary.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.sha.startsWith(q) || c.refs.some((r) => r.toLowerCase().includes(q));
}

/** An entry of a stash row's right-click menu (it never gets the commit actions). */
export interface StashMenuItem {
  id: "apply" | "pop" | "drop" | "copy";
  label: string;
  /** Why it cannot run now (shown as its tooltip), or null. */
  disabled: string | null;
  danger: boolean;
}

/**
 * The right-click menu of a stash row. `blocked`: why Apply / Pop cannot run (`stashBlocked`: a
 * stopped operation, files in conflict), or null; `busy`: another git action is running. Drop and
 * Copy are never blocked by an operation.
 */
export function stashMenu(blocked: string | null, busy: boolean): StashMenuItem[] {
  const wait = busy ? "Another git action is running" : null;
  return [
    { id: "apply", label: "Apply Stash", disabled: wait ?? blocked, danger: false },
    { id: "pop", label: "Pop Stash", disabled: wait ?? blocked, danger: false },
    { id: "drop", label: "Drop Stash…", disabled: wait, danger: true },
    { id: "copy", label: "Copy Message", disabled: null, danger: false },
  ];
}

/** The graph's commit actions (gitApi's `GitCommitAction`, repeated so this file stays free of imports). */
export type GraphAction = "checkout" | "branch" | "branch-switch" | "tag" | "cherry-pick" | "revert" | "reset-soft" | "reset-mixed" | "reset-hard";

/**
 * The question asked before a commit action from the graph's menu, or null when it runs at once
 * (creating a branch or tag). `branch` is the current branch (null when detached), `dirty` the
 * number of uncommitted changes.
 */
export function actionConfirm(action: GraphAction, c: { short: string; summary: string }, branch: string | null, dirty: number, unsaved: { rel: string; name: string }[] = []): { title: string; text: string; ok: string; kind: "primary" | "danger" } | null {
  const on = branch ? `"${branch}"` : "the current commit (not on a branch)";
  const what = `${c.short} "${c.summary}"`;
  switch (action) {
    case "cherry-pick":
      return { title: "Cherry-pick this commit?", text: `Copies the changes of ${what} onto ${on} as a new commit. If they conflict, the pick stops and Source Control shows the files to resolve.`, ok: "Cherry-pick", kind: "primary" };
    case "revert":
      return { title: "Revert this commit?", text: `Adds a new commit on ${on} that undoes ${what}. History is kept; nothing is deleted.`, ok: "Revert", kind: "primary" };
    case "reset-soft":
      return { title: "Reset (soft)?", text: `Moves ${on} back to ${what}. The commits after it leave the branch, but all their changes stay staged, ready to commit again. Your files are not touched.`, ok: "Reset (Soft)", kind: "primary" };
    case "reset-mixed":
      return { title: "Reset (mixed)?", text: `Moves ${on} back to ${what}. The commits after it leave the branch; their changes stay in your files, unstaged.`, ok: "Reset (Mixed)", kind: "primary" };
    case "reset-hard":
      return { title: "Reset (hard) and discard changes?", text: `Moves ${on} back to ${what} and makes every tracked file match it. The commits after it leave the branch${dirty ? `, and your ${dirty} uncommitted change${dirty === 1 ? "" : "s"} to tracked files ${dirty === 1 ? "is" : "are"} lost` : ""}.${unsaved.length ? ` ${lostEditsSentence("reset-hard", unsaved)}` : ""} This can't be undone from Quarry.`, ok: "Reset and Discard", kind: "danger" };
    case "checkout":
      return { title: "Check out this commit?", text: `Your files become ${what}, and you are no longer on a branch ("detached"). Commits made here belong to no branch until you create one. Switch back with the branch button.`, ok: "Check Out", kind: "primary" };
    default:
      return null;
  }
}

/** The notification after a commit action from the graph succeeded. */
export function actionDone(action: GraphAction, short: string, name?: string): string {
  const done: Record<GraphAction, string> = { checkout: `Checked out ${short}`, branch: `Created branch ${name}`, "branch-switch": `On new branch ${name}`, tag: `Created tag ${name}`, "cherry-pick": `Cherry-picked ${short}`, revert: `Reverted ${short}`, "reset-soft": `Reset to ${short}`, "reset-mixed": `Reset to ${short}`, "reset-hard": `Reset to ${short}` };
  return done[action];
}

// ---------- Graph polish (GRAPH-015..018): uncommitted row, results divider, lane scrolling, date order ----------

/** The "sha" of the uncommitted-changes row: never a commit id, so nothing git-side can be run on it. */
export const UNCOMMITTED = "uncommitted";
export const isUncommitted = (sha: string | null | undefined): boolean => sha === UNCOMMITTED;

/**
 * The graph's input with the uncommitted-changes row first: one extra "commit" (`row`, sha
 * `UNCOMMITTED`) whose only parent is the current commit (none before the first commit). Laid out
 * by `layoutGraph` like any other row, it takes lane 0 and keeps it down to the current commit
 * (lane 0 is never cut). Replaces a row that is already there.
 */
export function withUncommitted<T extends GraphInput>(commits: T[], row: T): T[] {
  return [row, ...withoutUncommitted(commits)];
}

export function withoutUncommitted<T extends { sha: string }>(commits: T[]): T[] {
  return isUncommitted(commits[0]?.sha) ? commits.slice(1) : commits;
}

/** Rows above the first commit: 1 with the uncommitted row, else 0 (row index = commit index + this). */
export const rowOffset = (rows: { sha: string }[]): number => (isUncommitted(rows[0]?.sha) ? 1 : 0);

/**
 * The row the uncommitted row's line ends at (the current commit); -1 when that commit is not
 * among the loaded rows (the line then runs to the end of the list); 0 when there is no such row
 * or it has no line (no commits yet). Rows 1..result carry the line in lane 0.
 */
export function uncommittedLineEnd(rows: GraphInput[]): number {
  if (!isUncommitted(rows[0]?.sha) || !rows[0].parents.length) return 0;
  const head = rows[0].parents[0];
  return rows.findIndex((r) => r.sha === head);
}

/**
 * The first page is asked for with one commit more than it shows, so "exactly `size` commits" can
 * be told from "more": keeps `size` commits (stash rows ride along and are not counted) and says
 * whether another one came.
 */
export function takePage<T extends { stash?: boolean }>(page: T[], size: number): { rows: T[]; more: boolean } {
  let n = 0;
  for (let i = 0; i < page.length; i++) {
    if (page[i].stash) continue;
    if (++n > size) return { rows: page.slice(0, i), more: true };
  }
  return { rows: page, more: false };
}

/** Date order is only offered for a history that fits one page (GRAPH-018). */
export const DATE_ORDER_MAX = 300;
export const DATE_ORDER_WHY = `Only for histories of ${DATE_ORDER_MAX} commits or fewer: in larger ones date order spreads the branches over many more lanes.`;
export const DATE_ORDER_OFF = `Date order is off: this history has more than ${DATE_ORDER_MAX} commits.`;

/** `count`: the commits loaded (no stash or uncommitted rows); `more`: commits remain unloaded. */
export function dateOrderAllowed(count: number, more: boolean): boolean {
  return !more && count <= DATE_ORDER_MAX;
}

/** Height the commit list always keeps beside the search results: 6 rows. */
export const LIST_MIN = 156;
export const HITS_MIN = 80;
/** The commit details pane never gets shorter than this (app.css `.graph-detail` min-height). */
export const DETAIL_MIN = 180;

/**
 * The height of the Search All History results for a dragged `wanted`: at least 80 px, the commit
 * list keeps its 156 px (`available` = what the results may take at most), and never taller than
 * the `content` (heading + rows), which wins over the minimum.
 */
export function clampHitsHeight(wanted: number, content: number, available: number): number {
  return Math.round(Math.min(content, Math.max(HITS_MIN, Math.min(wanted, available))));
}

/**
 * Sideways scroll of the lane column, in lanes: the new scroll that shows `lane`, moving just far
 * enough; unchanged when the lane is already in view. `visible` lanes of `total` are shown.
 */
export function revealLane(scroll: number, lane: number, visible: number, total: number): number {
  let next = scroll;
  if (lane < next) next = lane;
  else if (lane + 1 > next + visible) next = lane + 1 - visible;
  return clampLaneScroll(next, visible, total);
}

/** A lane scroll kept within the graph's width (the graph gets narrower on a reload). */
export function clampLaneScroll(scroll: number, visible: number, total: number): number {
  return Math.max(0, Math.min(Math.max(0, total - visible), scroll));
}
