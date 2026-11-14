/**
 * Compare commits (pure; specs/git-compare-commits.md): the graph's two-commit selection, which
 * commit goes on which side, and the wording of the comparison pane. The pane is
 * components/GraphCompare.tsx; git's part is `diff_files` in src-tauri/src/git.rs.
 */
import type { GitCommitFile, GitCompare } from "./gitApi";
import { commitFileKind, type GitKind } from "./gitStatus";

/** The second side of a comparison when it is the working tree instead of a commit. */
export const WORKTREE = "worktree";

// ---- file rows of the graph's lists: click compares, double-click opens the file ----
// A Compare tab opened by the first click would cover the graph before the second click, so the
// double-click would never reach the row. The click's comparison therefore waits `ROW_CLICK_DELAY`
// ms; a double-click in that time cancels it and opens only the file. A comparison already on its
// way is waited for, so the file still ends up in front (GRAPH-015.6, COMMITCMP-003.9).

/** How long a file row's click waits for a second click before it opens the comparison. */
export const ROW_CLICK_DELAY = 300;
let rowClickDelay = ROW_CLICK_DELAY;
/** Component tests set 0: the click then compares at once. */
export const setRowClickDelay = (ms: number) => void (rowClickDelay = ms);

let rowTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRowOpen: Promise<unknown> = Promise.resolve();

/** A file row's click: runs `open` (the comparison) after `ROW_CLICK_DELAY`, unless a double-click comes first. */
export function fileRowClick(e: { detail: number }, open: () => unknown) {
  if (e.detail > 1) return;
  if (rowTimer) clearTimeout(rowTimer);
  rowTimer = null;
  if (rowClickDelay <= 0) {
    pendingRowOpen = Promise.resolve().then(open).catch(() => {});
    return;
  }
  let start = () => {};
  const started = new Promise<void>((r) => (start = r));
  pendingRowOpen = started.then(open).catch(() => {});
  rowTimer = setTimeout(() => {
    rowTimer = null;
    start();
  }, rowClickDelay);
}

/** A file row's double-click: cancels the first click's comparison if it has not started, else waits for it; then opens the file. */
export function fileRowDoubleClick(openFile: () => unknown): Promise<void> {
  if (rowTimer) {
    clearTimeout(rowTimer);
    rowTimer = null;
    pendingRowOpen = Promise.resolve();
  }
  return pendingRowOpen.then(() => void openFile());
}

/** What is selected in the graph: one commit, or two being compared (`second` may be WORKTREE). */
export interface CompareSel {
  first: string | null;
  second: string | null;
}

/** Branch names shown beside the ids of a comparison started from Compare with Branch…. */
export interface CompareNames {
  first?: string;
  second?: string;
}

/**
 * A Ctrl+click on the commit `sha`: with nothing selected it is a plain click; on another commit it
 * becomes the second one (replacing the previous second, or the working tree); on a selected
 * commit it takes that one out and leaves the other selected alone.
 */
export function compareClick(sel: CompareSel, sha: string): CompareSel {
  if (!sel.first) return { first: sha, second: null };
  if (sha === sel.first) return { first: sel.second && sel.second !== WORKTREE ? sel.second : null, second: null };
  if (sha === sel.second) return { first: sel.first, second: null };
  return { first: sel.first, second: sha };
}

/**
 * Whether the two commits change places, given git's counts for (first, second): `ahead` = commits
 * the second has that the first lacks, `behind` = the other way round. The ancestor goes on the
 * left whatever the click order; when neither is one, the first selected commit stays on the left,
 * except for a picked branch (`picked`: the second is the branch), which then goes on the left.
 */
export function orderSides(ahead: number, behind: number, picked = false): boolean {
  if (behind === 0) return false; // the first is an ancestor of the second (or the same commit)
  if (ahead === 0) return true;
  return picked;
}

/** A differing file read the other way round: A ↔ D, and a rename back to its old name. */
export function swapFile(f: GitCommitFile): GitCommitFile {
  if (f.status === "A") return { ...f, status: "D" };
  if (f.status === "D") return { ...f, status: "A" };
  if (!f.origRel) return f;
  const base = f.path.slice(0, f.path.length - f.rel.length);
  return { ...f, rel: f.origRel, origRel: f.rel, path: base + f.origRel.replace(/\//g, "\\") };
}

/** A comparison of two commits with its sides exchanged (the working tree is never swapped). */
export function swapCompare(c: GitCompare): GitCompare {
  if (!c.right) return c;
  return { ...c, left: c.right, right: c.left, files: c.files.map(swapFile), insertions: c.deletions, deletions: c.insertions, ahead: c.behind, behind: c.ahead };
}

/** The comparison as the pane shows it: ordered by `orderSides`, then flipped once more by Swap Sides. */
export function arrange(c: GitCompare, picked: boolean, swapped: boolean): { view: GitCompare; flipped: boolean } {
  const flipped = !!c.right && orderSides(c.ahead, c.behind, picked) !== swapped;
  return { view: flipped ? swapCompare(c) : c, flipped };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a1b2c3d ↔ 18bc71d", "a1b2c3d main ↔ 18bc71d feature", "a1b2c3d ↔ Working tree". */
export function compareHeading(left: string, right: string | null, names: { left?: string; right?: string } = {}): string {
  const side = (short: string, name?: string) => (name ? `${short} ${name}` : short);
  return `${side(left, names.left)} ↔ ${right === null ? "Working tree" : side(right, names.right)}`;
}

/**
 * How the two sides relate in history, so a diverged pair is not misread. `ahead`: commits the
 * right side has that the left lacks; `behind`: the other way round. For the working tree
 * (`right` null) the right side is the commit the files are on, `head`.
 */
export function countsLine(left: string, right: string | null, ahead: number, behind: number, head: string | null = null): string {
  if (right === null) {
    if (!head) return "";
    if (!ahead && !behind) return `${left} is the commit you are on`;
    if (!behind) return `Your files are on ${head}, ${plural(ahead, "commit")} ahead of ${left}`;
    if (!ahead) return `Your files are on ${head}, ${plural(behind, "commit")} behind ${left}`;
    return `Your files are on ${head}, which has ${plural(ahead, "commit")} that ${left} does not; ${left} has ${behind} that ${head} does not`;
  }
  if (!ahead && !behind) return "";
  if (!behind) return `${right} is ${plural(ahead, "commit")} ahead of ${left}`;
  if (!ahead) return `${left} is ${plural(behind, "commit")} ahead of ${right}`;
  return `${right} has ${plural(ahead, "commit")} that ${left} does not; ${left} has ${behind} that ${right} does not`;
}

/** git's summary line: "4 files changed, 25 insertions(+), 9 deletions(-)"; "" with no files. */
export function compareSummary(files: number, insertions: number, deletions: number): string {
  if (!files) return "";
  const parts = [`${plural(files, "file")} changed`];
  if (insertions) parts.push(`${plural(insertions, "insertion")}(+)`);
  if (deletions) parts.push(`${plural(deletions, "deletion")}(-)`);
  return parts.join(", ");
}

/** What the pane says instead of an empty list. `names`: the branch names beside the sides, if any. */
export function noDifferences(c: GitCompare, names: { left?: string; right?: string } = {}): string {
  if (!c.right) return `No differences: your files match ${c.left.short}.`;
  if (c.right.sha === c.left.sha) {
    const name = names.right ?? names.left ?? c.left.short;
    return c.left.refs.includes("HEAD") ? `No differences: ${name} is the commit you are on.` : `No differences: both sides are the commit ${c.left.short}.`;
  }
  return `No differences: the files of ${c.left.short} and ${c.right.short} are identical.`;
}

/** "3 untracked files are not compared."; "" with none. */
export function untrackedNote(n: number): string {
  return n ? `${plural(n, "untracked file")} ${n === 1 ? "is" : "are"} not compared.` : "";
}

/** A Compare tab side's label: `name @ shortid` (the caller passes the old path for the left of a rename). */
export function sideLabel(rel: string, short: string): string {
  return `${rel.slice(rel.lastIndexOf("/") + 1)} @ ${short}`;
}

/** Colour / letter of a row: git's letter, or a conflict ("U": unmerged in the working tree). */
export function compareFileKind(status: string): GitKind {
  return status === "U" ? "conflict" : commitFileKind(status);
}
