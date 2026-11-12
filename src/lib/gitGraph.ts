/**
 * Commit graph layout (pure, unit-tested): which lane each commit sits in and which lines cross
 * its row. Commits arrive children-before-parents (git log --date-order). A lane is freed as soon
 * as its line ends and the lowest free lane is reused, which keeps the graph narrow.
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
  /** Number of lanes this row needs. */
  width: number;
}

/** State carried from one page of commits to the next: the commit each lane is waiting for. */
export type Lanes = (string | null)[];

function firstFree(lanes: Lanes): number {
  const i = lanes.indexOf(null);
  if (i >= 0) return i;
  lanes.push(null);
  return lanes.length - 1;
}

/** Lay out `commits`, continuing from `lanes` (mutated; pass [] for the first page). */
export function layoutGraph(commits: GraphInput[], lanes: Lanes = []): GraphRow[] {
  const rows: GraphRow[] = [];
  for (const c of commits) {
    const into: number[] = [];
    lanes.forEach((sha, i) => {
      if (sha === c.sha) into.push(i);
    });
    // A commit nothing points at yet (a branch tip) starts a lane.
    const col = into.length ? into[0] : firstFree(lanes);
    for (const i of into) lanes[i] = null;
    lanes[col] = null;
    const through: number[] = [];
    lanes.forEach((sha, i) => {
      if (sha !== null) through.push(i);
    });
    const out: number[] = [];
    c.parents.forEach((p, k) => {
      let j = lanes.indexOf(p);
      if (k === 0 && lanes[col] === null && (j < 0 || j > col)) {
        // The first parent continues this commit's lane, so a branch's own line stays straight.
        // If a lane further right already waits for that parent, both run down and join at it.
        j = col;
        lanes[j] = p;
      } else if (j < 0) {
        // Another parent (a merge) opens a lane.
        j = firstFree(lanes);
        lanes[j] = p;
      }
      if (!out.includes(j)) out.push(j);
    });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ col, into, through, out, width: Math.max(col, ...into, ...through, ...out) + 1 });
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
