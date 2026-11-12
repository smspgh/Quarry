import { describe, expect, it } from "vitest";
import { commitMatches, layoutGraph, refLabels, type Lanes } from "../lib/gitGraph";

const c = (sha: string, ...parents: string[]) => ({ sha, parents });

describe("commit graph layout", () => {
  it("keeps a straight history in one lane", () => {
    const rows = layoutGraph([c("c", "b"), c("b", "a"), c("a")]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(rows[0]).toEqual({ col: 0, into: [], through: [], out: [0], width: 1 });
    expect(rows[1]).toEqual({ col: 0, into: [0], through: [], out: [0], width: 1 });
    expect(rows[2]).toEqual({ col: 0, into: [0], through: [], out: [], width: 1 });
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
    const lanes: Lanes = [];
    const paged = [...layoutGraph(all.slice(0, 2), lanes), ...layoutGraph(all.slice(2), lanes)];
    expect(paged).toEqual(whole);
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
