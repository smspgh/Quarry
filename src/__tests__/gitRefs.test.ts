import { describe, expect, it } from "vitest";
import type { GitBranch, GitStatus } from "../lib/gitApi";
import { refLabels } from "../lib/gitGraph";
import { branchPick, pickList, refMenu } from "../lib/gitRefs";

const repo = (extra: Partial<GitStatus> = {}) => ({ branch: "main" as string | null, head: "9f2c0aa" as string | null, operation: null as GitStatus["operation"], files: [], ...extra });
const label = (refs: string[], name: string) => refLabels(refs).find((l) => l.name === name)!;

describe("the menu of a ref label", () => {
  it("a local branch: headed by its name, with the merge and rebase entries", () => {
    const m = refMenu(label(["refs/heads/feature", "refs/remotes/origin/feature"], "feature"), { repo: repo(), busy: null })!;
    expect(m.heading).toBe("Branch feature");
    expect([m.kind, m.name, m.full, m.current]).toEqual(["branch", "feature", "refs/heads/feature", false]);
    expect(m.entries.map((e) => [e.id, e.label, e.disabled])).toEqual([["merge", "Merge feature into main…", null], ["rebase", "Rebase main onto feature…", null]]);
  });
  it("a remote branch and a tag", () => {
    const remote = refMenu(label(["refs/remotes/origin/topic"], "origin/topic"), { repo: repo(), busy: null })!;
    expect(remote.heading).toBe("Remote branch origin/topic");
    expect(remote.entries.map((e) => e.label)).toEqual(["Merge origin/topic into main…", "Rebase main onto origin/topic…"]);
    const tag = refMenu(label(["refs/tags/v1.2.0"], "v1.2.0"), { repo: repo(), busy: null })!;
    expect([tag.heading, tag.kind, tag.full]).toEqual(["Tag v1.2.0", "tag", "refs/tags/v1.2.0"]);
    expect(tag.entries.map((e) => e.label)).toEqual(["Merge v1.2.0 into main…", "Rebase main onto v1.2.0…"]);
  });
  it("the branch you are on: both entries greyed out", () => {
    const m = refMenu(label(["HEAD", "refs/heads/main"], "main"), { repo: repo(), busy: null })!;
    expect([m.heading, m.current]).toEqual(["Branch main", true]);
    expect(m.entries.map((e) => e.disabled)).toEqual(["This is the branch you are on", "This is the branch you are on"]);
  });
  it("the detached HEAD label has no menu", () => {
    expect(refMenu(label(["HEAD"], "HEAD"), { repo: repo({ branch: null }), busy: null })).toBeNull();
  });
  it("shares the disabled states of the commit menu", () => {
    const feature = label(["refs/heads/feature"], "feature");
    expect(refMenu(feature, { repo: repo({ operation: "rebase", branch: null }), busy: null })!.entries.map((e) => e.disabled)).toEqual(["Finish or abort the rebase first", "Finish or abort the rebase first"]);
    expect(refMenu(feature, { repo: repo({ branch: null }), busy: null })!.entries.map((e) => [e.label, e.disabled])).toEqual([
      ["Merge feature into Here…", null],
      ["Rebase onto feature…", "Switch to a branch first: a rebase moves a branch"],
    ]);
    expect(refMenu(feature, { repo: repo(), busy: "Pulling…" })!.entries.every((e) => e.disabled === "Another git action is running")).toBe(true);
    expect(refMenu(feature, { repo: null, busy: null })!.entries.every((e) => !!e.disabled)).toBe(true);
  });
});

describe("the branch picker's purposes", () => {
  const branch = (name: string, extra: Partial<GitBranch> = {}): GitBranch => ({ name, remote: false, current: false, upstream: null, sha: "0".repeat(40), time: 0, summary: "", ...extra });
  const list = [branch("main", { current: true }), branch("feature"), branch("origin/main", { remote: true }), branch("origin/topic", { remote: true })];
  it("switch: every branch, a Create row, the checkout command", () => {
    expect(branchPick("switch", "main")).toEqual({ prompt: "Switch to a branch, or type a name to create one…", command: "git.checkoutTo", create: true });
    expect(pickList("switch", list)).toEqual(list);
  });
  it("merge and rebase: no current branch, no Create row, their own prompt and command", () => {
    expect(branchPick("merge", "main")).toEqual({ prompt: "Merge which branch into main?", command: "git.mergeRef", create: false });
    expect(branchPick("merge", null).prompt).toBe("Merge which branch into the current commit?");
    expect(branchPick("rebase", "main")).toEqual({ prompt: "Rebase main onto which branch?", command: "git.rebaseOnto", create: false });
    for (const purpose of ["merge", "rebase"] as const) expect(pickList(purpose, list).map((b) => b.name)).toEqual(["feature", "origin/main", "origin/topic"]);
    expect(pickList("merge", [branch("main", { current: true })])).toEqual([]);
  });
  it("compare: every branch, the current one included, no Create row (COMMITCMP-005)", () => {
    expect(branchPick("compare", "main")).toEqual({ prompt: "Compare with a branch…", command: "git.compareBranchPick", create: false });
    expect(pickList("compare", list)).toEqual(list);
  });
});
