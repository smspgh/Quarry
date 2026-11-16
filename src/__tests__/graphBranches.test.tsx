import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitGraphCommit, GitStatus } from "../lib/gitApi";
import type { Doc } from "../lib/store";

// GraphView's ref-label menu with the branch and tag housekeeping entries (specs/git-branches.md,
// BRANCH-001 and the graph halves of BRANCH-003, 004, 007, 008). The Tauri side is replaced; the
// real commands are registered, so choosing an entry runs through its question.
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ map: {} as Record<string, (args: Record<string, unknown>) => unknown> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    const f = answers.map[cmd];
    return f ? f(args) : undefined;
  },
}));
const clip = vi.hoisted(() => ({ writeText: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: clip.writeText }));

const { render, cleanup, flush, fire, act } = await import("./helpers/render");
const { GraphView } = await import("../components/GraphView");
const { useGit } = await import("../lib/git");
const { useStore } = await import("../lib/store");
const { registerGitCommands } = await import("../lib/gitCommands");

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const sha = (n: number) => `${n}`.repeat(40);
const commit = (n: number, refs: string[] = []): GitGraphCommit => ({ sha: sha(n), short: `${n}`.repeat(7), parents: n < 5 ? [sha(n + 1)] : [], author: "Ada", email: "ada@example.com", time: 1_700_000_000 - n * 3600, refs, summary: `Commit number ${n}` });
const PAGE = [commit(1, ["HEAD", "refs/heads/main", "refs/remotes/origin/main"]), commit(2, ["refs/heads/feature"]), commit(3), commit(4, ["refs/heads/topic", "refs/remotes/origin/topic", "refs/tags/v1.2.0"]), commit(5)];
const doc = { id: "graph-1", kind: "graph", name: "Graph", graph: { root: ROOT } } as unknown as Doc;
const repo = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "1111111", upstream: "origin/main", upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [{ name: "origin", url: "https://github.com/acme/app.git" }], ...extra });

const rows = () => [...document.querySelectorAll<HTMLElement>(".graph-list [role=option]")];
const selectedRow = () => document.querySelector<HTMLElement>(".graph-list [aria-selected=true]");
const menus = () => [...document.querySelectorAll<HTMLElement>(".graph-menu[role=menu]")];
const head = () => menus()[0].querySelector(".graph-menu-head")?.textContent;
const entries = () => [...menus()[0].querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
const labels = () => entries().map((b) => b.textContent);
const entry = (text: string) => {
  const b = entries().find((x) => x.textContent === text);
  if (!b) throw new Error(`no entry "${text}" in ${labels().join(" | ")}`);
  return b;
};
const badge = (within: ParentNode, name: string) => {
  const b = [...within.querySelectorAll<HTMLElement>(".graph-ref")].find((x) => x.textContent?.trim() === name);
  if (!b) throw new Error(`no label ${name}`);
  return b;
};
const dialog = () => useStore.getState().dialog;
const toasts = () => useStore.getState().toasts.map((t) => t.message);
const ran = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);
const strip = () => document.querySelector<HTMLElement>(".graph-naming");
const press = async (label: string) => {
  await act(async () => dialog()!.actions.find((a) => a.label === label)!.run());
  await flush();
};
async function type(el: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const show = async (status: GitStatus = repo()) => {
  answers.map.git_status = () => status;
  useGit.setState({ repos: { [KEY]: status }, current: null, busy: null });
  await render(<GraphView doc={doc} visible />);
  await flush();
};
const info = (extra = {}) => ({ name: "feature", sha: "2222222", fullSha: sha(2), current: false, upstream: null, base: "main", baseSha: "1111111", unmerged: 0, defaultBranch: false, ...extra });

describe("GraphView: branch and tag housekeeping from a ref label", () => {
  beforeAll(() => registerGitCommands());
  beforeEach(() => {
    calls.length = 0;
    clip.writeText.mockClear();
    answers.map = {
      git_graph: () => PAGE,
      git_graph_indexed: () => true,
      git_stash_list: () => [],
      git_ref_info: () => ({ upstreams: { main: "origin/main", topic: "origin/topic" }, defaults: { origin: "main" } }),
    };
    useStore.setState({ dialog: null, toasts: [], folder: ROOT, docs: [], palette: null });
    useGit.setState({ refInfo: {}, refsTick: 0 });
  });
  afterEach(async () => {
    dialog()?.actions.find((a) => a.cancel)?.run();
    await cleanup();
    useGit.setState({ repos: {}, busy: null });
  });

  it("a local branch label: the commit is selected and the menu has its entries in order", async () => {
    await show();
    await fire.contextMenu(badge(rows()[1], "feature"));
    expect(selectedRow()?.textContent).toContain("Commit number 2");
    expect(menus()).toHaveLength(1);
    expect(head()).toBe("Branch feature");
    expect(labels()).toEqual(["Switch to feature", "Merge feature into main…", "Rebase main onto feature…", "Rename Branch…", "Set Upstream…", "Push feature to origin", "Delete Branch…", "Copy Branch Name"]);
    expect(labels()).not.toContain("Cherry-pick onto main…");
    expect(badge(rows()[1], "feature").classList.contains("menu-open")).toBe(true);
  });

  it("the label of the branch I am on: no Switch, Delete greyed out with the reason, push names the upstream", async () => {
    await show();
    await fire.contextMenu(badge(rows()[0], "main"));
    expect(head()).toBe("Branch main");
    expect(labels()).toEqual(["Rename Branch…", "Set Upstream…", "Push main to origin/main", "Delete Branch…", "Copy Branch Name"]);
    expect(entry("Delete Branch…").disabled).toBe(true);
    expect(entry("Delete Branch…").title).toBe("You are on this branch. Switch to another branch first.");
    for (const text of ["Rename Branch…", "Set Upstream…", "Push main to origin/main"]) expect(entry(text).disabled).toBe(false);
  });

  it("a remote branch label, and a remote's default branch", async () => {
    await show();
    await fire.contextMenu(badge(rows()[3], "origin/topic"));
    expect(head()).toBe("Remote branch origin/topic");
    expect(labels()).toEqual(["Switch to origin/topic", "Merge origin/topic into main…", "Rebase main onto origin/topic…", "Delete topic from origin…", "Copy Branch Name"]);
    await fire.contextMenu(badge(rows()[0], "origin/main"));
    expect(entry("Delete main from origin…").disabled).toBe(true);
    expect(entry("Delete main from origin…").title).toBe("main is origin's default branch.");
  });

  it("a tag label", async () => {
    await show();
    await fire.contextMenu(badge(rows()[3], "v1.2.0"));
    expect(head()).toBe("Tag v1.2.0");
    expect(labels()).toEqual(["Merge v1.2.0 into main…", "Rebase main onto v1.2.0…", "Push v1.2.0 to origin", "Delete Tag…", "Copy Tag Name"]);
  });

  it("a right-click beside the labels still gives the commit menu, with its Switch entries", async () => {
    await show();
    await fire.contextMenu(rows()[3]);
    expect(head()).toContain("4444444");
    expect(labels()).toContain("Switch to topic");
    expect(labels()).toContain("Cherry-pick onto main…");
    expect(labels()).not.toContain("Delete Branch…");
  });

  it("no remote: the push entries stay available and lead to the Add Remote form", async () => {
    await show(repo({ remotes: [], upstream: null }));
    await fire.contextMenu(badge(rows()[1], "feature"));
    expect(entry("Push feature…").disabled).toBe(false);
    await fire.click(entry("Push feature…"));
    await flush();
    expect(ran("git_push_ref")).toEqual([]);
    expect(useGit.getState().addingRemote).toBe(true);
    expect(toasts()).toContain("This repository has no remote yet. Add one in Source Control.");
  });

  it("nothing can be started while git is busy, except copying the name", async () => {
    await show();
    await act(async () => useGit.setState({ busy: "Pushing…" }));
    await fire.contextMenu(badge(rows()[1], "feature"));
    expect(entries().filter((b) => !b.disabled).map((b) => b.textContent)).toEqual(["Copy Branch Name"]);
    await fire.contextMenu(badge(rows()[3], "v1.2.0"));
    expect(entries().filter((b) => !b.disabled).map((b) => b.textContent)).toEqual(["Copy Tag Name"]);
  });

  it("Copy Branch Name", async () => {
    await show();
    await fire.contextMenu(badge(rows()[3], "origin/topic"));
    await fire.click(entry("Copy Branch Name"));
    await flush();
    expect(clip.writeText).toHaveBeenCalledWith("origin/topic");
    expect(toasts()).toEqual(["Copied the branch name"]);
    expect(menus()).toHaveLength(0);
  });

  it("Switch to … switches as the commit menu does", async () => {
    await show();
    await fire.contextMenu(badge(rows()[1], "feature"));
    await fire.click(entry("Switch to feature"));
    await flush();
    expect(ran("git_checkout")).toEqual([{ root: ROOT, name: "feature", create: false }]);
  });

  it("Delete Branch… asks first with Cancel as the default; confirming deletes and the graph reloads", async () => {
    answers.map.git_branch_info = () => info();
    answers.map.git_ref_action = () => "2222222";
    await show();
    const loads = ran("git_graph").length;
    await fire.contextMenu(badge(rows()[1], "feature"));
    await fire.click(entry("Delete Branch…"));
    await flush();
    expect(menus()).toHaveLength(0);
    expect(dialog()?.title).toBe('Delete branch "feature"?');
    expect(dialog()?.actions.find((a) => a.default)?.label).toBe("Cancel");
    expect(ran("git_ref_action")).toEqual([]);
    await press("Delete Branch");
    expect(ran("git_ref_action")).toEqual([{ root: ROOT, action: "branch-delete", name: "feature", arg: null }]);
    expect(toasts()).toContain("Deleted branch feature (was 2222222)");
    expect(ran("git_graph").length).toBeGreaterThan(loads);
    expect(selectedRow()?.textContent).toContain("Commit number 2");
  });

  it("an unmerged branch is deleted only after the second, danger question", async () => {
    answers.map.git_branch_info = () => info({ unmerged: 2 });
    answers.map.git_ref_action = () => "2222222";
    await show();
    await fire.contextMenu(badge(rows()[1], "feature"));
    await fire.click(entry("Delete Branch…"));
    await flush();
    await press("Delete Branch");
    expect(ran("git_ref_action")).toEqual([]);
    expect(dialog()?.title).toBe('Delete "feature" and lose 2 commits?');
    expect(dialog()?.actions.map((a) => [a.label, a.kind, !!a.default])).toEqual([["Delete Anyway", "danger", false], ["Cancel", undefined, true]]);
    await press("Cancel");
    expect(ran("git_ref_action")).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it("Rename Branch… opens the strip with the current name; the same or an empty name does nothing", async () => {
    answers.map.git_ref_action = () => "";
    await show();
    await fire.contextMenu(badge(rows()[1], "feature"));
    await fire.click(entry("Rename Branch…"));
    expect(strip()?.textContent).toContain("Rename branch feature to:");
    const box = strip()!.querySelector<HTMLInputElement>("input")!;
    const button = () => [...strip()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Rename")!;
    expect(box.value).toBe("feature");
    expect(button().disabled).toBe(true);
    await fire.keyDown(box, "Enter");
    expect(strip()).not.toBeNull();
    await type(box, "");
    expect(button().disabled).toBe(true);
    await fire.keyDown(box, "Enter");
    expect(ran("git_ref_action")).toEqual([]);
    // A new name renames; the graph reloads.
    const loads = ran("git_graph").length;
    await type(box, "feature-2");
    expect(button().disabled).toBe(false);
    await fire.keyDown(box, "Enter");
    await flush();
    expect(strip()).toBeNull();
    expect(ran("git_ref_action")).toEqual([{ root: ROOT, action: "branch-rename", name: "feature", arg: "feature-2" }]);
    expect(toasts()).toEqual(["Renamed feature to feature-2"]);
    expect(ran("git_graph").length).toBeGreaterThan(loads);
  });

  it("the rename strip closes on Escape, and an invalid name is git's to refuse", async () => {
    answers.map.git_ref_action = () => { throw '"bad name" is not a valid name'; };
    await show();
    await fire.contextMenu(badge(rows()[1], "feature"));
    await fire.click(entry("Rename Branch…"));
    await fire.keyDown(strip()!.querySelector("input")!, "Escape");
    expect(strip()).toBeNull();
    expect(ran("git_ref_action")).toEqual([]);
    await fire.contextMenu(badge(rows()[1], "feature"));
    await fire.click(entry("Rename Branch…"));
    await type(strip()!.querySelector<HTMLInputElement>("input")!, "bad name");
    await fire.keyDown(strip()!.querySelector("input")!, "Enter");
    await flush();
    expect(ran("git_ref_action")).toEqual([{ root: ROOT, action: "branch-rename", name: "feature", arg: "bad name" }]);
    expect(toasts()).toEqual(['"bad name" is not a valid name']);
  });

  it("Set Upstream… opens the one picker for that branch", async () => {
    answers.map.git_branches = () => [];
    await show();
    await fire.contextMenu(badge(rows()[1], "feature"));
    await fire.click(entry("Set Upstream…"));
    await flush();
    expect(useStore.getState().palette).toBe("branch");
    expect([useGit.getState().branchPick, useGit.getState().branchPickFor]).toEqual(["upstream", { command: "git.setUpstream", root: ROOT, target: "feature" }]);
  });

  it("Delete topic from origin… names the remote and sends nothing before the click", async () => {
    answers.map.git_branch_info = () => info({ name: "origin/topic", sha: "4444444" });
    answers.map.git_push_ref = () => ({ remote: "origin", branch: "topic", upToDate: false, tracking: null, was: "4444444", gone: false });
    await show();
    await fire.contextMenu(badge(rows()[3], "origin/topic"));
    await fire.click(entry("Delete topic from origin…"));
    await flush();
    expect(dialog()?.title).toBe('Delete "topic" from origin?');
    expect(dialog()?.message).toContain("in the remote repository origin (github.com/acme/app), for everyone who uses it");
    expect(dialog()?.actions.map((a) => [a.label, a.kind, !!a.default])).toEqual([["Delete from origin", "danger", false], ["Cancel", undefined, true]]);
    expect(ran("git_push_ref")).toEqual([]);
    await press("Delete from origin");
    expect(ran("git_push_ref")).toEqual([{ root: ROOT, kind: "delete", name: "origin/topic" }]);
    expect(toasts()).toEqual(["Deleted topic from origin (was 4444444)"]);
  });

  it("Delete Tag… asks once; Push v1.2.0 to origin does not ask", async () => {
    answers.map.git_branch_info = () => info({ name: "v1.2.0", sha: "4444444" });
    answers.map.git_ref_action = () => "4444444";
    answers.map.git_push_ref = () => ({ remote: "origin", branch: "v1.2.0", upToDate: false, tracking: null, was: null, gone: false });
    await show();
    await fire.contextMenu(badge(rows()[3], "v1.2.0"));
    await fire.click(entry("Push v1.2.0 to origin"));
    await flush();
    expect(dialog()).toBeNull();
    expect(ran("git_push_ref")).toEqual([{ root: ROOT, kind: "tag", name: "v1.2.0" }]);
    expect(toasts()).toEqual(["Pushed tag v1.2.0 to origin"]);
    await fire.contextMenu(badge(rows()[3], "v1.2.0"));
    await fire.click(entry("Delete Tag…"));
    await flush();
    expect(dialog()?.title).toBe('Delete tag "v1.2.0"?');
    expect(dialog()?.actions.find((a) => a.default)?.label).toBe("Cancel");
    await press("Delete Tag");
    expect(ran("git_ref_action")).toEqual([{ root: ROOT, action: "tag-delete", name: "v1.2.0", arg: null }]);
  });

  it("labels in the details pane open the same menu", async () => {
    await show();
    await fire.click(rows()[3]);
    await flush();
    await fire.contextMenu(badge(document.querySelector(".graph-detail")!, "topic"));
    expect(head()).toBe("Branch topic");
    expect(labels()).toContain("Push topic to origin/topic");
    expect(labels()).toContain("Delete Branch…");
  });
});
