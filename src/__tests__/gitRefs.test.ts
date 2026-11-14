import { describe, expect, it } from "vitest";
import type { GitBranch, GitStatus } from "../lib/gitApi";
import { refLabels } from "../lib/gitGraph";
import { branchPick, pickList, REF_COMMANDS, refMenu, rowMenu } from "../lib/gitRefs";

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

// Branch and tag housekeeping (specs/git-branches.md): the label menu grows around the merge and
// rebase entries once the caller says which remotes there are.
describe("the housekeeping entries of a ref label's menu", () => {
  const ctx = (extra = {}) => ({ repo: repo(), busy: null as string | null, remotes: ["origin"], upstreams: {} as Record<string, string>, defaults: {} as Record<string, string>, ...extra });
  const shape = (m: ReturnType<typeof refMenu>) => m!.entries.map((e) => `${e.group ? "| " : ""}${e.label}${e.disabled ? " (off)" : ""}`);

  it("a local branch: Switch; merge, rebase; rename, upstream, push, delete; copy", () => {
    const m = refMenu(label(["refs/heads/feature"], "feature"), ctx())!;
    expect(m.heading).toBe("Branch feature");
    expect(shape(m)).toEqual(["Switch to feature", "| Merge feature into main…", "Rebase main onto feature…", "| Rename Branch…", "Set Upstream…", "Push feature to origin", "Delete Branch…", "| Copy Branch Name"]);
    expect(m.entries.map((e) => e.id)).toEqual(["switch", "merge", "rebase", "rename", "upstream", "push", "delete", "copy"]);
    expect(m.entries.find((e) => e.id === "delete")!.danger).toBe(true);
  });
  it("the branch you are on: no Switch, Delete greyed out with the reason, push names its upstream", () => {
    const m = refMenu(label(["HEAD", "refs/heads/main"], "main"), ctx({ upstreams: { main: "origin/main" } }))!;
    expect(m.entries.map((e) => `${e.group ? "| " : ""}${e.id}${e.disabled ? " (off)" : ""}`)).toEqual(["merge (off)", "rebase (off)", "| rename", "upstream", "push", "delete (off)", "| copy"]);
    expect(m.entries.find((e) => e.id === "push")!.label).toBe("Push main to origin/main");
    expect(m.entries.find((e) => e.id === "delete")!.disabled).toBe("You are on this branch. Switch to another branch first.");
  });
  it("a remote branch: Switch, merge, rebase, delete from its remote, copy; no rename, upstream or push", () => {
    const m = refMenu(label(["refs/remotes/origin/topic"], "origin/topic"), ctx({ defaults: { origin: "main" } }))!;
    expect(shape(m)).toEqual(["Switch to origin/topic", "| Merge origin/topic into main…", "Rebase main onto origin/topic…", "| Delete topic from origin…", "| Copy Branch Name"]);
    expect(m.entries.map((e) => e.id)).toEqual(["switch", "merge", "rebase", "delete-remote", "copy"]);
  });
  it("a remote's default branch cannot be deleted", () => {
    const m = refMenu(label(["refs/remotes/origin/main"], "origin/main"), ctx({ defaults: { origin: "main" } }))!;
    const del = m.entries.find((e) => e.id === "delete-remote")!;
    expect([del.label, del.disabled]).toEqual(["Delete main from origin…", "main is origin's default branch."]);
  });
  it("the right remote and the whole branch name", () => {
    const m = refMenu(label(["refs/remotes/backup/feature/login"], "backup/feature/login"), ctx({ remotes: ["origin", "backup"] }))!;
    expect(m.entries.find((e) => e.id === "delete-remote")!.label).toBe("Delete feature/login from backup…");
  });
  it("a tag: merge, rebase, push, delete, copy; no Switch", () => {
    const m = refMenu(label(["refs/tags/v1.2.0"], "v1.2.0"), ctx())!;
    expect(shape(m)).toEqual(["Merge v1.2.0 into main…", "Rebase main onto v1.2.0…", "| Push v1.2.0 to origin", "Delete Tag…", "| Copy Tag Name"]);
    expect(m.entries.map((e) => e.id)).toEqual(["merge", "rebase", "push-tag", "delete-tag", "copy"]);
  });
  it("which remote a push names", () => {
    const push = (remotes: string[], upstreams = {}) => refMenu(label(["refs/heads/feature"], "feature"), ctx({ remotes, upstreams }))!.entries.find((e) => e.id === "push")!;
    expect(push(["origin", "backup"]).label).toBe("Push feature to origin");
    expect(push(["backup", "work"]).label).toBe("Push feature to backup");
    expect(push(["origin"], { feature: "origin/review" }).label).toBe("Push feature to origin/review");
    const tagPush = (remotes: string[]) => refMenu(label(["refs/tags/v1.2.0"], "v1.2.0"), ctx({ remotes }))!.entries.find((e) => e.id === "push-tag")!;
    expect([tagPush(["backup", "work"]).label, tagPush(["backup", "origin"]).label]).toEqual(["Push v1.2.0 to backup", "Push v1.2.0 to origin"]);
  });
  it("no remote yet: the push entries stay available and end in an ellipsis", () => {
    const m = refMenu(label(["refs/heads/feature"], "feature"), ctx({ remotes: [] }))!;
    expect(m.entries.filter((e) => e.id === "push" || e.id === "upstream").map((e) => [e.label, e.disabled])).toEqual([["Set Upstream…", null], ["Push feature…", null]]);
    const t = refMenu(label(["refs/tags/v1.2.0"], "v1.2.0"), ctx({ remotes: [] }))!;
    expect(t.entries.find((e) => e.id === "push-tag")).toMatchObject({ label: "Push v1.2.0…", disabled: null });
  });
  it("while git is busy everything but Copy is greyed out", () => {
    for (const refs of [["refs/heads/feature"], ["refs/remotes/origin/topic"], ["refs/tags/v1.2.0"]]) {
      const m = refMenu(refLabels(refs)[0], ctx({ busy: "Pushing…" }))!;
      expect(m.entries.filter((e) => !e.disabled).map((e) => e.id)).toEqual(["copy"]);
      expect(m.entries.filter((e) => e.disabled).every((e) => e.disabled === "Another git action is running")).toBe(true);
    }
  });
  it("the detached HEAD and stash labels still have no menu", () => {
    expect(refMenu(label(["HEAD"], "HEAD"), ctx({ repo: repo({ branch: null }) }))).toBeNull();
    expect(refMenu(refLabels(["refs/stash"])[0], ctx())).toBeNull();
  });
  it("every housekeeping entry has a command", () => {
    const ids = [["refs/heads/feature"], ["refs/remotes/origin/topic"], ["refs/tags/v1"]].flatMap((refs) => refMenu(refLabels(refs)[0], ctx())!.entries.map((e) => e.id));
    for (const id of ids) if (!["switch", "merge", "rebase", "copy"].includes(id)) expect(REF_COMMANDS[id], id).toMatch(/^git\./);
  });
});

describe("the row menu of the branch picker", () => {
  const ctx = { repo: repo(), busy: null, remotes: ["origin"], upstreams: {}, defaults: { origin: "main" } };
  const b = (name: string, extra = {}) => ({ name, remote: false, current: false, ...extra });
  it("a local branch: the housekeeping and Copy entries, without Switch, merge and rebase", () => {
    const rows = rowMenu(b("feature"), ctx);
    expect(rows.map((e) => e.label)).toEqual(["Rename Branch…", "Set Upstream…", "Push feature to origin", "Delete Branch…", "Copy Branch Name"]);
    expect(rows[0].group).toBeFalsy();
  });
  it("a remote branch: delete from its remote, and Copy, only", () => {
    expect(rowMenu(b("origin/topic", { remote: true }), ctx).map((e) => e.label)).toEqual(["Delete topic from origin…", "Copy Branch Name"]);
  });
  it("the current branch: Delete greyed out with the reason", () => {
    const del = rowMenu(b("main", { current: true }), ctx).find((e) => e.id === "delete")!;
    expect(del.disabled).toBe("You are on this branch. Switch to another branch first.");
  });
});

describe("the branch picker's housekeeping purposes", () => {
  const branch = (name: string, extra: Partial<GitBranch> = {}): GitBranch => ({ name, remote: false, current: false, upstream: null, sha: "0".repeat(40), time: 0, summary: "", ...extra });
  const list = [branch("feature"), branch("main", { current: true }), branch("origin/main", { remote: true })];
  it("the prompt and the command come with the purpose; never a Create row", () => {
    expect(branchPick("delete-branch", "main", { command: "git.deleteBranch" })).toEqual({ prompt: "Delete which branch?", command: "git.deleteBranch", create: false });
    expect(branchPick("tag", "main", { command: "git.pushTag", remote: "origin" })).toEqual({ prompt: "Push which tag to origin?", command: "git.pushTag", create: false });
    expect(branchPick("new-name", "main", { command: "git.renameBranch", target: "fix" }).prompt).toBe('New name for "fix"…');
  });
  it("which refs each purpose lists", () => {
    expect(pickList("delete-branch", list).map((x) => x.name)).toEqual(["feature"]);
    expect(pickList("local-branch", list).map((x) => x.name)).toEqual(["main", "feature"]);
    expect(pickList("remote-branch", list).map((x) => x.name)).toEqual(["origin/main"]);
    expect(pickList("upstream", list).map((x) => x.name)).toEqual(["origin/main"]);
    expect(pickList("tag", list)).toEqual([]);
  });
});
