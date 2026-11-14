import { describe, expect, it } from "vitest";
import type { GitCommitFile, GitCompare, GitGraphCommit } from "../lib/gitApi";
import { arrange, compareClick, compareFileKind, compareHeading, compareSummary, countsLine, noDifferences, orderSides, sideLabel, swapCompare, swapFile, untrackedNote, WORKTREE } from "../lib/gitCompare";

// Compare commits, pure parts (specs/git-compare-commits.md).
const ROOT = "C:\\work\\proj";
const commit = (short: string, refs: string[] = []): GitGraphCommit => ({ sha: short.padEnd(40, "0"), short, parents: [], author: "Ada", email: "ada@example.com", time: 0, refs, summary: `Commit ${short}` });
const file = (status: string, rel: string, origRel: string | null = null): GitCommitFile => ({ path: `${ROOT}\\${rel.replace(/\//g, "\\")}`, rel, status, origRel });
const A = commit("a1b2c3d");
const B = commit("18bc71d");
const result = (extra: Partial<GitCompare> = {}): GitCompare => ({ left: A, right: B, head: null, files: [], insertions: 0, deletions: 0, ahead: 0, behind: 0, untracked: 0, ...extra });

describe("compareClick (COMMITCMP-001)", () => {
  it("with nothing selected a Ctrl+click is a plain click", () => {
    expect(compareClick({ first: null, second: null }, "x")).toEqual({ first: "x", second: null });
  });
  it("a second commit is added, a third replaces the second and keeps the first", () => {
    expect(compareClick({ first: "a", second: null }, "b")).toEqual({ first: "a", second: "b" });
    expect(compareClick({ first: "a", second: "b" }, "c")).toEqual({ first: "a", second: "c" });
  });
  it("Ctrl+click on a selected commit takes it out and leaves the other alone", () => {
    expect(compareClick({ first: "a", second: "b" }, "b")).toEqual({ first: "a", second: null });
    expect(compareClick({ first: "a", second: "b" }, "a")).toEqual({ first: "b", second: null });
    expect(compareClick({ first: "a", second: null }, "a")).toEqual({ first: null, second: null });
  });
  it("a commit replaces the working tree as the second side; the first commit taken out leaves nothing", () => {
    expect(compareClick({ first: "a", second: WORKTREE }, "b")).toEqual({ first: "a", second: "b" });
    expect(compareClick({ first: "a", second: WORKTREE }, "a")).toEqual({ first: null, second: null });
  });
});

describe("orderSides / arrange (COMMITCMP-002, COMMITCMP-005)", () => {
  it("the ancestor goes on the left whatever the click order", () => {
    expect(orderSides(3, 0)).toBe(false); // the first is the ancestor: stays left
    expect(orderSides(0, 3)).toBe(true); // the second is the ancestor: they change places
    expect(orderSides(0, 0)).toBe(false);
  });
  it("neither an ancestor: the first selected stays left, but a picked branch goes left", () => {
    expect(orderSides(4, 2)).toBe(false);
    expect(orderSides(4, 2, true)).toBe(true);
    // A picked branch that is ahead of the other commit stays on the right.
    expect(orderSides(3, 0, true)).toBe(false);
    expect(orderSides(0, 4, true)).toBe(true);
  });
  it("arrange orders the sides, and Swap Sides flips them once more", () => {
    // Selected the newer commit first: git answered with it on the left, 3 commits "behind".
    const c = result({ left: B, right: A, behind: 3, files: [file("D", "new.ts")], insertions: 9, deletions: 25 });
    const shown = arrange(c, false, false);
    expect(shown.flipped).toBe(true);
    expect([shown.view.left.short, shown.view.right?.short, shown.view.ahead, shown.view.behind]).toEqual(["a1b2c3d", "18bc71d", 3, 0]);
    expect(shown.view.files[0].status).toBe("A");
    expect([shown.view.insertions, shown.view.deletions]).toEqual([25, 9]);
    const swapped = arrange(c, false, true);
    expect(swapped.flipped).toBe(false);
    expect(swapped.view).toBe(c);
    // The working tree is always on the right.
    const wt = result({ right: null, ahead: 0, behind: 2 });
    expect(arrange(wt, false, true)).toEqual({ view: wt, flipped: false });
  });
});

describe("swapFile / swapCompare (COMMITCMP-002.5)", () => {
  it("added and deleted change places, modified stays", () => {
    expect(swapFile(file("A", "new.ts")).status).toBe("D");
    expect(swapFile(file("D", "old.ts")).status).toBe("A");
    expect(swapFile(file("M", "store.ts"))).toEqual(file("M", "store.ts"));
  });
  it("a rename reads the other way: the old name, renamed from the new one", () => {
    expect(swapFile(file("R", "src/lib/helpers.ts", "src/util.ts"))).toEqual({ path: `${ROOT}\\src\\util.ts`, rel: "src/util.ts", status: "R", origRel: "src/lib/helpers.ts" });
  });
  it("the whole comparison: sides, counts and insertions / deletions are exchanged", () => {
    const c = result({ files: [file("A", "new.ts"), file("R", "helpers.ts", "util.ts")], insertions: 25, deletions: 9, ahead: 3, behind: 1 });
    const s = swapCompare(c);
    expect([s.left, s.right]).toEqual([B, A]);
    expect(s.files.map((f) => [f.status, f.rel, f.origRel])).toEqual([["D", "new.ts", null], ["R", "util.ts", "helpers.ts"]]);
    expect([s.insertions, s.deletions, s.ahead, s.behind]).toEqual([9, 25, 1, 3]);
    expect(swapCompare(s)).toEqual(c);
  });
});

describe("wording", () => {
  it("heading: the two short ids, branch names beside them, or the working tree", () => {
    expect(compareHeading("a1b2c3d", "18bc71d")).toBe("a1b2c3d ↔ 18bc71d");
    expect(compareHeading("a1b2c3d", "18bc71d", { left: "main", right: "feature" })).toBe("a1b2c3d main ↔ 18bc71d feature");
    expect(compareHeading("a1b2c3d", null)).toBe("a1b2c3d ↔ Working tree");
  });
  it("counts line: ahead, the other way round, and diverged", () => {
    expect(countsLine("a1b2c3d", "18bc71d", 3, 0)).toBe("18bc71d is 3 commits ahead of a1b2c3d");
    expect(countsLine("a1b2c3d", "18bc71d", 1, 0)).toBe("18bc71d is 1 commit ahead of a1b2c3d");
    expect(countsLine("18bc71d", "a1b2c3d", 0, 3)).toBe("18bc71d is 3 commits ahead of a1b2c3d");
    expect(countsLine("a1b2c3d", "18bc71d", 4, 2)).toBe("18bc71d has 4 commits that a1b2c3d does not; a1b2c3d has 2 that 18bc71d does not");
    expect(countsLine("a1b2c3d", "a1b2c3d", 0, 0)).toBe("");
  });
  it("counts line for the working tree speaks of the commit the files are on", () => {
    expect(countsLine("a1b2c3d", null, 0, 0, "a1b2c3d")).toBe("a1b2c3d is the commit you are on");
    expect(countsLine("a1b2c3d", null, 2, 0, "e4f5a6b")).toBe("Your files are on e4f5a6b, 2 commits ahead of a1b2c3d");
    expect(countsLine("a1b2c3d", null, 0, 1, "e4f5a6b")).toBe("Your files are on e4f5a6b, 1 commit behind a1b2c3d");
    expect(countsLine("a1b2c3d", null, 4, 2, "e4f5a6b")).toBe("Your files are on e4f5a6b, which has 4 commits that a1b2c3d does not; a1b2c3d has 2 that e4f5a6b does not");
    expect(countsLine("a1b2c3d", null, 0, 0, null)).toBe("");
  });
  it("summary reads like git's, leaving out what is zero", () => {
    expect(compareSummary(4, 25, 9)).toBe("4 files changed, 25 insertions(+), 9 deletions(-)");
    expect(compareSummary(12400, 1, 0)).toBe("12400 files changed, 1 insertion(+)");
    expect(compareSummary(1, 0, 1)).toBe("1 file changed, 1 deletion(-)");
    expect(compareSummary(1, 0, 0)).toBe("1 file changed");
    expect(compareSummary(0, 0, 0)).toBe("");
  });
  it("no differences: identical files, the working tree, and the commit you are on", () => {
    expect(noDifferences(result())).toBe("No differences: the files of a1b2c3d and 18bc71d are identical.");
    expect(noDifferences(result({ right: null }))).toBe("No differences: your files match a1b2c3d.");
    const head = commit("a1b2c3d", ["HEAD", "refs/heads/main"]);
    expect(noDifferences(result({ left: head, right: head }), { left: "main", right: "main" })).toBe("No differences: main is the commit you are on.");
    expect(noDifferences(result({ left: A, right: A }), { right: "main" })).toBe("No differences: both sides are the commit a1b2c3d.");
  });
  it("untracked note, side labels and row kinds", () => {
    expect(untrackedNote(3)).toBe("3 untracked files are not compared.");
    expect(untrackedNote(1)).toBe("1 untracked file is not compared.");
    expect(untrackedNote(0)).toBe("");
    expect(sideLabel("src/lib/helpers.ts", "18bc71d")).toBe("helpers.ts @ 18bc71d");
    expect(sideLabel("store.ts", "a1b2c3d")).toBe("store.ts @ a1b2c3d");
    expect(["A", "M", "D", "R", "U"].map(compareFileKind)).toEqual(["added", "modified", "deleted", "renamed", "conflict"]);
  });
});
