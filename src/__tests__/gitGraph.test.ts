import { describe, expect, it } from "vitest";
import { actionConfirm, actionDone, commitMatches, layoutGraph, newGraphState, refLabels, type GraphAction } from "../lib/gitGraph";

const c = (sha: string, ...parents: string[]) => ({ sha, parents });

describe("commit graph layout", () => {
  it("keeps a straight history in one lane", () => {
    const rows = layoutGraph([c("c", "b"), c("b", "a"), c("a")]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(rows[0]).toEqual({ col: 0, into: [], through: [], out: [0], cut: [], from: [], width: 1 });
    expect(rows[1]).toEqual({ col: 0, into: [0], through: [], out: [0], cut: [], from: [], width: 1 });
    expect(rows[2]).toEqual({ col: 0, into: [0], through: [], out: [], cut: [], from: [], width: 1 });
  });

  it("draws a branch and its merge in a second lane, then frees it", () => {
    // m merges f into main: m(b, f), f(a), b(a), a, then an older commit reuses lane 0 only.
    const rows = layoutGraph([c("m", "b", "f"), c("f", "a"), c("b", "a"), c("a", "z"), c("z")]);
    expect(rows[0]).toMatchObject({ col: 0, out: [0, 1], width: 2 });
    expect(rows[1]).toMatchObject({ col: 1, into: [1], through: [0], out: [1] });
    // main's own line stays in lane 0 although the branch already waits for `a` in lane 1.
    expect(rows[2]).toMatchObject({ col: 0, into: [0], through: [1], out: [0] });
    // Both lines end at a; it takes the lowest lane and the other is freed.
    expect(rows[3]).toMatchObject({ col: 0, into: [0, 1], through: [], out: [0] });
    expect(rows[4]).toMatchObject({ col: 0, width: 1 });
  });

  it("keeps the trunk in lane 0 when a side branch forks from an older commit", () => {
    // tip(m) ; side(old) is newer than m ; m(old)
    const rows = layoutGraph([c("tip", "m"), c("side", "old"), c("m", "old"), c("old")]);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 0]);
    expect(rows[2].out).toEqual([0]);
    expect(rows[3].into).toEqual([0, 1]);
  });

  it("gives two branch tips their own lanes and joins them at the fork", () => {
    const rows = layoutGraph([c("x", "base"), c("y", "base"), c("base")]);
    expect(rows[0]).toMatchObject({ col: 0, out: [0] });
    expect(rows[1]).toMatchObject({ col: 1, through: [0], out: [0] });
    expect(rows[2]).toMatchObject({ col: 0, into: [0], out: [], width: 1 });
  });

  it("reuses a freed lane instead of growing wider", () => {
    // Two short-lived branches one after the other never need a third lane.
    const rows = layoutGraph([c("m2", "m1", "f2"), c("f2", "m1"), c("m1", "a", "f1"), c("f1", "a"), c("a")]);
    expect(Math.max(...rows.map((r) => r.width))).toBe(2);
  });

  it("continues across pages with the carried lanes", () => {
    const all = [c("m", "b", "f"), c("f", "a"), c("b", "a"), c("a")];
    const whole = layoutGraph(all);
    const state = newGraphState();
    const paged = [...layoutGraph(all.slice(0, 2), state), ...layoutGraph(all.slice(2), state)];
    expect(paged).toEqual(whole);
  });

  it("cuts a line that runs too long and brings it back in at its commit", () => {
    // A merge whose side branch forked from `old`, six trunk commits further down.
    const trunk = ["t1", "t2", "t3", "t4", "t5", "t6"];
    const commits = [c("m", "t1", "side"), c("side", "old"), ...trunk.map((t, i) => c(t, trunk[i + 1] ?? "old")), c("old")];
    const rows = layoutGraph(commits, newGraphState(), 3);
    // side's line to `old` starts at row 1 and is cut three rows later, freeing lane 1.
    expect(rows[1]).toMatchObject({ col: 1, out: [1] });
    expect(rows[3]).toMatchObject({ through: [1], cut: [] });
    expect(rows[4]).toMatchObject({ col: 0, through: [], cut: [1], width: 2 });
    expect(rows[5]).toMatchObject({ col: 0, width: 1, cut: [] });
    // `old` shows where the cut line came from (row 1), and nothing is left waiting.
    expect(rows[8]).toMatchObject({ col: 0, into: [0], from: [1], width: 1 });
    // The same history without cutting keeps lane 1 all the way down.
    expect(layoutGraph(commits, newGraphState(), 1000).every((r, i) => i === 0 || i === 8 || r.width === 2)).toBe(true);
  });

  it("never cuts lane 0 and gives the same result when paged", () => {
    const chain = Array.from({ length: 30 }, (_, i) => c(`n${i}`, `n${i + 1}`));
    const commits = [c("tip", "far"), c("other", "n0", "x"), c("x", "far"), ...chain, c("n30", "far"), c("far")];
    const whole = layoutGraph(commits, newGraphState(), 5);
    // The first branch's line (lane 0) is still there at the end although it ran 34 rows.
    expect(whole[whole.length - 1].into).toContain(0);
    expect(whole.some((r) => r.cut.includes(0))).toBe(false);
    const state = newGraphState();
    expect([...layoutGraph(commits.slice(0, 7), state, 5), ...layoutGraph(commits.slice(7), state, 5)]).toEqual(whole);
  });
});

describe("ref labels", () => {
  it("marks the checked-out branch, orders branches before remotes and tags, and drops origin/HEAD", () => {
    const labels = refLabels(["HEAD", "refs/heads/main", "refs/remotes/origin/main", "refs/remotes/origin/HEAD", "refs/tags/v1", "refs/heads/other"]);
    expect(labels.map((l) => `${l.kind}:${l.name}`)).toEqual(["head:main", "branch:other", "remote:origin/main", "tag:v1"]);
  });
  it("labels a detached HEAD on its own", () => {
    expect(refLabels(["HEAD", "refs/tags/v2"]).map((l) => `${l.kind}:${l.name}`)).toEqual(["head:HEAD", "tag:v2"]);
    expect(refLabels([])).toEqual([]);
  });
});

describe("graph search", () => {
  const commit = { sha: "abc123def", summary: "Fix the Parser", author: "Ada", email: "ada@example.com", refs: ["refs/heads/feature/x"] };
  it("matches message, author, email, id prefix and ref names, ignoring case", () => {
    for (const q of ["", "parser", "ADA", "example.com", "abc12", "feature/x"]) expect(commitMatches(commit, q)).toBe(true);
    expect(commitMatches(commit, "c123")).toBe(false);
    expect(commitMatches(commit, "nothing")).toBe(false);
  });
});

describe("commit actions from the graph", () => {
  const commit = { short: "18bc71d", summary: "Add tokenizer" };

  it("asks before every action that changes the branch or the files", () => {
    const asks: GraphAction[] = ["checkout", "cherry-pick", "revert", "reset-soft", "reset-mixed", "reset-hard"];
    for (const a of asks) expect(actionConfirm(a, commit, "main", 0), a).not.toBeNull();
    for (const a of ["branch", "branch-switch", "tag"] as GraphAction[]) expect(actionConfirm(a, commit, "main", 0), a).toBeNull();
  });

  it("names the branch and the commit, and warns what a hard reset loses", () => {
    expect(actionConfirm("revert", commit, "main", 0)?.text).toBe('Adds a new commit on "main" that undoes 18bc71d "Add tokenizer". History is kept; nothing is deleted.');
    expect(actionConfirm("cherry-pick", commit, null, 0)?.text).toContain("onto the current commit (not on a branch)");
    const hard = actionConfirm("reset-hard", commit, "main", 2)!;
    expect(hard).toMatchObject({ title: "Reset (hard) and discard changes?", ok: "Reset and Discard", kind: "danger" });
    expect(hard.text).toContain("and your 2 uncommitted changes to tracked files are lost");
    expect(actionConfirm("reset-hard", commit, "main", 0)!.text).not.toContain("uncommitted");
    expect(actionConfirm("reset-soft", commit, "main", 0)!.kind).toBe("primary");
  });

  it("says what was done", () => {
    expect(actionDone("branch-switch", "18bc71d", "hotfix")).toBe("On new branch hotfix");
    expect(actionDone("branch", "18bc71d", "keep-this")).toBe("Created branch keep-this");
    expect(actionDone("tag", "18bc71d", "v1.2.0")).toBe("Created tag v1.2.0");
    expect(actionDone("reset-mixed", "18bc71d")).toBe("Reset to 18bc71d");
  });
});

// A stash row is a commit with one parent (the commit it was made on) and no children, listed
// right above that commit: the layout needs nothing special for it.
describe("stash rows in the layout", () => {
  it("puts a stash on an older commit in its own lane, joined at its base, with main in the first lane", () => {
    const rows = layoutGraph([c("m3", "m2"), c("m2", "m1"), c("stash", "m1"), c("m1", "m0"), c("m0")]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 1, 0, 0]);
    // Its line curves straight into main's lane, which already leads to that commit.
    expect(rows[2]).toMatchObject({ col: 1, into: [], through: [0], out: [0], width: 2 });
    expect(rows[3]).toMatchObject({ col: 0, into: [0], width: 1 }); // the lane is free again
  });

  it("draws several stashes on one commit as separate rows joined to it", () => {
    const rows = layoutGraph([c("m2", "m1"), c("s2", "m1"), c("s1", "m1"), c("m1")]);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 1, 0]);
    expect(rows.slice(1, 3).map((r) => r.out)).toEqual([[0], [0]]);
  });

  it("a stash on the newest commit sits above it", () => {
    const rows = layoutGraph([c("stash", "tip"), c("tip", "old"), c("old")]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(rows[1].into).toEqual([0]);
  });

  it("find matches the stash label", () => {
    const row = { sha: "f".repeat(40), summary: "WIP parser", author: "Ada", email: "ada@example.com", refs: ["refs/stash"] };
    expect(commitMatches(row, "parser")).toBe(true);
    expect(commitMatches(row, "stash")).toBe(true);
    expect(commitMatches(row, "lexer")).toBe(false);
  });
});

// ----- Graph polish (GRAPH-015..018) -----
import { clampHitsHeight, clampLaneScroll, dateOrderAllowed, isUncommitted, revealLane, rowOffset, takePage, UNCOMMITTED, uncommittedLineEnd, withoutUncommitted, withUncommitted } from "../lib/gitGraph";

describe("the uncommitted-changes row in the layout (GRAPH-015)", () => {
  const un = (head?: string) => ({ sha: UNCOMMITTED, parents: head ? [head] : [] });

  it("is the first row, in lane 0, joined to the current commit below it", () => {
    const list = withUncommitted([c("tip", "old"), c("old")], un("tip"));
    expect(list.map((r) => r.sha)).toEqual([UNCOMMITTED, "tip", "old"]);
    const rows = layoutGraph(list);
    expect(rows[0]).toEqual({ col: 0, into: [], through: [], out: [0], cut: [], from: [], width: 1 });
    expect(rows[1]).toMatchObject({ col: 0, into: [0], out: [0] });
    expect(uncommittedLineEnd(list)).toBe(1);
    expect(rowOffset(list)).toBe(1);
    expect(rowOffset(withoutUncommitted(list))).toBe(0);
    expect(isUncommitted(list[0].sha)).toBe(true);
    // Adding it again replaces the row instead of stacking a second one.
    expect(withUncommitted(list, un("tip"))).toHaveLength(3);
  });

  it("runs down lane 0 past commits to pull, which sit in the second lane", () => {
    // origin/main is 2 commits ahead of the commit I am on (head).
    const list = withUncommitted([c("in2", "in1"), c("in1", "head"), c("head", "old"), c("old")], un("head"));
    const rows = layoutGraph(list);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 1, 0, 0]);
    expect(rows[1]).toMatchObject({ col: 1, through: [0] });
    // The incoming line joins lane 0, which already leads to the current commit.
    expect(rows[2]).toMatchObject({ col: 1, through: [0], out: [0] });
    expect(rows[3]).toMatchObject({ col: 0, into: [0] });
    expect(uncommittedLineEnd(list)).toBe(3);
  });

  it("is never cut, however far down the current commit is", () => {
    // 500 commits of another branch above the current commit.
    const other = Array.from({ length: 500 }, (_, i) => c(`o${i}`, `o${i + 1}`));
    const list = withUncommitted([...other, c("o500"), c("head", "old"), c("old")], un("head"));
    const rows = layoutGraph(list);
    expect(rows[0].col).toBe(0);
    for (let i = 1; i <= 501; i++) {
      expect(rows[i].through).toContain(0);
      expect(rows[i].cut).toEqual([]);
      expect(rows[i].col).toBe(1);
    }
    expect(rows[502]).toMatchObject({ col: 0, into: [0], from: [] });
    expect(uncommittedLineEnd(list)).toBe(502);
  });

  it("has no line before the first commit, and reports a current commit that is not loaded", () => {
    const empty = withUncommitted([], un());
    expect(layoutGraph(empty)).toEqual([{ col: 0, into: [], through: [], out: [], cut: [], from: [], width: 1 }]);
    expect(uncommittedLineEnd(empty)).toBe(0);
    expect(uncommittedLineEnd(withUncommitted([c("a", "b")], un("far")))).toBe(-1);
    expect(uncommittedLineEnd([c("a", "b")])).toBe(0);
  });

  it("lays out the same page by page as in one go", () => {
    const side = Array.from({ length: 90 }, (_, i) => c(`s${i}`, i === 89 ? "base" : `s${i + 1}`));
    const main = Array.from({ length: 60 }, (_, i) => c(`m${i}`, i === 59 ? "base" : `m${i + 1}`));
    const list = withUncommitted([...side.slice(0, 30), ...main, ...side.slice(30), c("base")], un("m0"));
    const whole = layoutGraph(list);
    const state = newGraphState();
    const paged = [...layoutGraph(list.slice(0, 50), state), ...layoutGraph(list.slice(50, 120), state), ...layoutGraph(list.slice(120), state)];
    expect(paged).toEqual(whole);
    // The side branch started first, but lane 0 is the uncommitted row's and then main's.
    expect(whole[31]).toMatchObject({ col: 0, into: [0] });
  });
});

describe("lanes beyond the 16 shown (GRAPH-017)", () => {
  it("gives every lane its own number: 40 open branches need 40 lanes", () => {
    // 40 branch tips, each on its own older commit.
    const tips = Array.from({ length: 40 }, (_, i) => c(`t${i}`, `p${i}`));
    const rows = layoutGraph([...tips, ...Array.from({ length: 40 }, (_, i) => c(`p${i}`))]);
    expect(rows.slice(0, 40).map((r) => r.col)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(rows[39].width).toBe(40);
    // Each line ends in its own lane too.
    expect(rows.slice(40).map((r) => r.col)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(rows[40]).toMatchObject({ col: 0, into: [0], width: 40 });
  });

  it("revealLane scrolls just far enough to show a lane", () => {
    // 16 of 44 lanes are visible, starting at lane 0.
    expect(revealLane(0, 5, 16, 44)).toBe(0); // already in view
    expect(revealLane(0, 29, 16, 44)).toBe(14); // lanes 14..29: its dot is the last one shown
    expect(revealLane(14, 0, 16, 44)).toBe(0);
    expect(revealLane(14, 20, 16, 44)).toBe(14);
    expect(revealLane(9.5, 9, 16, 44)).toBe(9); // a half-hidden lane is brought in whole
    expect(revealLane(0, 43, 16, 44)).toBe(28);
    expect(revealLane(0, 60, 16, 44)).toBe(28); // never past the last lane
    expect(revealLane(3, 2, 16, 12)).toBe(0); // a graph that fits does not scroll
  });

  it("clampLaneScroll keeps a scroll inside the graph's width", () => {
    expect(clampLaneScroll(9, 16, 44)).toBe(9);
    expect(clampLaneScroll(40, 16, 44)).toBe(28);
    expect(clampLaneScroll(-3, 16, 44)).toBe(0);
    expect(clampLaneScroll(9, 16, 12)).toBe(0);
  });
});

describe("the first-page probe and date order (GRAPH-018)", () => {
  const n = (count: number): { sha: string; stash?: boolean }[] => Array.from({ length: count }, (_, i) => ({ sha: `${i}` }));

  it("takePage keeps `size` commits and says whether one more came", () => {
    expect(takePage(n(301), 300)).toMatchObject({ more: true, rows: { length: 300 } });
    expect(takePage(n(300), 300)).toMatchObject({ more: false, rows: { length: 300 } });
    expect(takePage(n(12), 300)).toMatchObject({ more: false, rows: { length: 12 } });
    expect(takePage([], 300)).toEqual({ more: false, rows: [] });
  });

  it("takePage does not count stash rows", () => {
    const page = [{ sha: "s", stash: true }, ...n(3), { sha: "s2", stash: true }, { sha: "x" }];
    expect(takePage(page, 4)).toEqual({ rows: page, more: false });
    // The stash row above the commit that is left out stays on the page; the next page brings its commit.
    expect(takePage(page, 3)).toEqual({ rows: page.slice(0, 5), more: true });
  });

  it("date order is allowed for 300 commits or fewer, all loaded", () => {
    expect(dateOrderAllowed(40, false)).toBe(true);
    expect(dateOrderAllowed(300, false)).toBe(true);
    expect(dateOrderAllowed(300, true)).toBe(false); // "300+": 301 or more
    expect(dateOrderAllowed(301, false)).toBe(false);
    expect(dateOrderAllowed(0, false)).toBe(true);
  });

  it("the layout takes commits in date order: branches interleave, main keeps lane 0", () => {
    // merge(13:00) of main(12:00) and feature(11:00), both on base(10:00): newest first.
    const rows = layoutGraph([c("merge", "main12", "feat11"), c("main12", "base10"), c("feat11", "base10"), c("base10")]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 1, 0]);
    expect(rows[1]).toMatchObject({ into: [0], through: [1], out: [0] });
    // The feature commit's line joins main's lane, which already leads to their common parent.
    expect(rows[2]).toMatchObject({ into: [1], through: [0], out: [0] });
    expect(rows[3]).toMatchObject({ into: [0], width: 1 });
  });
});

describe("the height of the Search All History results (GRAPH-016)", () => {
  it("follows the drag between its limits", () => {
    // 60 results (content 1,470 px); results + commit list share 700 px, of which the list keeps 156.
    expect(clampHitsHeight(370, 1470, 544)).toBe(370);
    expect(clampHitsHeight(20, 1470, 544)).toBe(80); // heading and one result stay
    expect(clampHitsHeight(900, 1470, 544)).toBe(544); // the commit list keeps 6 rows
  });

  it("is never taller than its content, which wins over the minimum", () => {
    expect(clampHitsHeight(400, 78, 544)).toBe(78); // 2 results
    expect(clampHitsHeight(10, 78, 544)).toBe(78);
    expect(clampHitsHeight(400, 200, 544)).toBe(200);
  });

  it("keeps the minimum in a window too small for both", () => {
    expect(clampHitsHeight(300, 1470, 40)).toBe(80);
  });
});
