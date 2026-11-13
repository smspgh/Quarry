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

export type RefKind = "head" | "branch" | "remote" | "tag";

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
  }
  if (head && !attached) out.unshift({ kind: "head", name: "HEAD", full: "HEAD" });
  const rank: Record<RefKind, number> = { head: 0, branch: 1, remote: 2, tag: 3 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** Does a commit match the graph's search box (message, author, email, id, ref names)? */
export function commitMatches(c: { sha: string; summary: string; author: string; email: string; refs: string[] }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return c.summary.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.sha.startsWith(q) || c.refs.some((r) => r.toLowerCase().includes(q));
}
