import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBranch, GitStatus, GitTag } from "../lib/gitApi";
import type { BranchPickFor } from "../lib/gitBranches";
import type { BranchPurpose } from "../lib/gitRefs";

// Branch and tag housekeeping in the one branch picker (specs/git-branches.md, BRANCH-002 and the
// picker halves of BRANCH-003..009): the row menu of the Switch Branch list, and the lists the
// seven commands open when they have no target.
const spy = vi.hoisted(() => ({ runCommand: vi.fn(), writeText: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => undefined }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: spy.writeText }));
vi.mock("../lib/commands", async (orig) => ({ ...(await orig<typeof import("../lib/commands")>()), runCommand: spy.runCommand }));

const { render, cleanup, flush, fire, act } = await import("./helpers/render");
const { CommandPalette } = await import("../components/CommandPalette");
const { useGit } = await import("../lib/git");
const { useStore } = await import("../lib/store");

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const repo = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "9f2c0aa", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [{ name: "origin", url: "https://example.com/acme/app.git" }], ...extra });
const branch = (name: string, extra: Partial<GitBranch> = {}): GitBranch => ({ name, remote: false, current: false, upstream: null, sha: "0".repeat(40), time: 0, summary: "", ...extra });
const tag = (name: string): GitTag => ({ name, sha: "1a2b3c4", time: 0, summary: "" });
const BRANCHES = [branch("main", { current: true }), branch("feature"), branch("old-idea"), branch("origin/main", { remote: true }), branch("origin/topic", { remote: true })];

const input = () => document.querySelector<HTMLInputElement>(".palette input")!;
const rows = () => [...document.querySelectorAll<HTMLElement>(".palette-list .palette-item")];
const rowTexts = () => rows().map((r) => r.textContent);
const row = (text: string) => rows().find((r) => r.textContent === text)!;
const empty = () => document.querySelector(".palette-empty")?.textContent;
const menu = () => document.querySelector<HTMLElement>(".branch-row-menu");
const menuItems = () => [...(menu()?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
const menuLabels = () => menuItems().map((b) => b.textContent);
const menuItem = (text: string) => menuItems().find((b) => b.textContent === text)!;
const highlighted = () => menuItems().filter((b) => b.classList.contains("active")).map((b) => b.textContent);
async function type(text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
let seq = 0;
async function open(purpose: BranchPurpose, pickFor: BranchPickFor | null = null, extra: { status?: GitStatus; branches?: GitBranch[]; tags?: GitTag[] | null } = {}) {
  const status = extra.status ?? repo();
  useGit.setState({ repos: { [KEY]: status }, current: KEY, busy: null, branches: extra.branches ?? BRANCHES, tags: extra.tags === undefined ? [] : extra.tags, branchPick: purpose, branchPickFor: pickFor, branchPickSeq: ++seq, refInfo: { [KEY]: { upstreams: {}, defaults: { origin: "main" } } } });
  useStore.setState({ palette: "branch" });
  await render(<CommandPalette />);
  await flush();
}

describe("branch picker: the row menu (purpose switch)", () => {
  beforeEach(() => {
    spy.runCommand.mockClear();
    spy.writeText.mockClear();
    useStore.setState({ folder: ROOT, docs: [], toasts: [] });
  });
  afterEach(async () => {
    await cleanup();
    useStore.setState({ palette: null });
  });

  it("the ⋯ button opens the row's menu; the picker stays open and nothing is switched", async () => {
    await open("switch");
    expect(menu()).toBeNull();
    await fire.click(row("feature").querySelector(".palette-more")!);
    expect(menuLabels()).toEqual(["Rename Branch…", "Set Upstream…", "Push feature to origin", "Delete Branch…", "Copy Branch Name"]);
    expect(useStore.getState().palette).toBe("branch");
    expect(spy.runCommand).not.toHaveBeenCalled();
  });

  it("a right-click on the row opens the same menu", async () => {
    await open("switch");
    await fire.contextMenu(row("feature"), { clientX: 40, clientY: 60 });
    expect(menuLabels()).toEqual(["Rename Branch…", "Set Upstream…", "Push feature to origin", "Delete Branch…", "Copy Branch Name"]);
    expect(spy.runCommand).not.toHaveBeenCalled();
  });

  it("Shift+F10 opens it for the highlighted row; Up / Down move, Enter runs, Escape returns to the picker", async () => {
    await open("switch");
    await fire.keyDown(input(), "ArrowDown"); // main → feature
    await fire.keyDown(input(), "F10", { shiftKey: true });
    expect(menu()?.getAttribute("aria-label")).toBe("Actions for feature");
    expect(highlighted()).toEqual(["Rename Branch…"]);
    await fire.keyDown(input(), "ArrowDown");
    await fire.keyDown(input(), "ArrowDown");
    expect(highlighted()).toEqual(["Push feature to origin"]);
    await fire.keyDown(input(), "ArrowUp");
    expect(highlighted()).toEqual(["Set Upstream…"]);
    // Escape closes the menu only.
    await fire.keyDown(input(), "Escape");
    expect(menu()).toBeNull();
    expect(useStore.getState().palette).toBe("branch");
    expect(spy.runCommand).not.toHaveBeenCalled();
    // Again, and run an entry with Enter.
    await fire.keyDown(input(), "F10", { shiftKey: true });
    await fire.keyDown(input(), "ArrowDown");
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.setUpstream", { name: "feature" });
    expect(useStore.getState().palette).toBeNull();
  });

  it("the menu matches the kind of row", async () => {
    await open("switch");
    await fire.click(row("remote: origin/topic").querySelector(".palette-more")!);
    expect(menuLabels()).toEqual(["Delete topic from origin…", "Copy Branch Name"]);
    await fire.click(row("remote: origin/main").querySelector(".palette-more")!);
    expect(menuItem("Delete main from origin…").disabled).toBe(true);
    expect(menuItem("Delete main from origin…").title).toBe("main is origin's default branch.");
    await fire.click(row("current: main").querySelector(".palette-more")!);
    expect(menuItem("Delete Branch…").disabled).toBe(true);
    expect(menuItem("Delete Branch…").title).toBe("You are on this branch. Switch to another branch first.");
    expect(menuItem("Rename Branch…").disabled).toBe(false);
  });

  it("the keyboard skips an entry that is greyed out", async () => {
    await open("switch");
    await fire.keyDown(input(), "F10", { shiftKey: true }); // the current branch, main
    for (let i = 0; i < 3; i++) await fire.keyDown(input(), "ArrowDown");
    expect(highlighted()).toEqual(["Copy Branch Name"]);
  });

  it("Enter and a click on the row still switch, and open no menu", async () => {
    await open("switch");
    await fire.keyDown(input(), "ArrowDown");
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.checkoutTo", "feature");
    expect(menu()).toBeNull();
    await cleanup();
    spy.runCommand.mockClear();
    await open("switch");
    await fire.click(row("old-idea"));
    expect(spy.runCommand).toHaveBeenCalledWith("git.checkoutTo", "old-idea");
  });

  it("choosing an action closes the picker and runs its command with the branch's name", async () => {
    await open("switch");
    await fire.click(row("feature").querySelector(".palette-more")!);
    await fire.click(menuItem("Delete Branch…"));
    expect(useStore.getState().palette).toBeNull();
    expect(spy.runCommand).toHaveBeenCalledTimes(1);
    expect(spy.runCommand).toHaveBeenCalledWith("git.deleteBranch", { name: "feature" });
  });

  it("Copy Branch Name copies and says so", async () => {
    await open("switch");
    await fire.click(row("remote: origin/topic").querySelector(".palette-more")!);
    await fire.click(menuItem("Copy Branch Name"));
    await flush();
    expect(spy.writeText).toHaveBeenCalledWith("origin/topic");
    expect(useStore.getState().toasts.map((t) => t.message)).toEqual(["Copied the branch name"]);
    expect(spy.runCommand).not.toHaveBeenCalled();
  });

  it("while git is busy only Copy can be chosen", async () => {
    await open("switch");
    await act(async () => useGit.setState({ busy: "Pushing…" }));
    await fire.click(row("feature").querySelector(".palette-more")!);
    expect(menuItems().filter((b) => !b.disabled).map((b) => b.textContent)).toEqual(["Copy Branch Name"]);
  });

  it("typing closes the menu, and the Create row has none", async () => {
    await open("switch");
    await fire.click(row("feature").querySelector(".palette-more")!);
    await type("brand new");
    expect(menu()).toBeNull();
    expect(rowTexts()).toEqual(['Create branch "brand-new" from here']);
    expect(rows()[0].querySelector(".palette-more")).toBeNull();
    await fire.keyDown(input(), "F10", { shiftKey: true });
    expect(menu()).toBeNull();
  });

  it("lists opened for another purpose have no row menu", async () => {
    await open("merge");
    expect(document.querySelector(".palette-more")).toBeNull();
    await fire.contextMenu(rows()[0]);
    await fire.keyDown(input(), "F10", { shiftKey: true });
    expect(menu()).toBeNull();
    await cleanup();
    await open("delete-branch", { command: "git.deleteBranch" });
    expect(document.querySelector(".palette-more")).toBeNull();
    await fire.keyDown(input(), "F10", { shiftKey: true });
    expect(menu()).toBeNull();
  });
});

describe("branch picker: the lists of the housekeeping commands", () => {
  beforeEach(() => {
    spy.runCommand.mockClear();
    useStore.setState({ folder: ROOT, docs: [], toasts: [] });
  });
  afterEach(async () => {
    await cleanup();
    useStore.setState({ palette: null });
  });

  it("Delete Branch…: local branches without the current one; a picked row runs the command with the name", async () => {
    await open("delete-branch", { command: "git.deleteBranch" });
    expect(input().placeholder).toBe("Delete which branch?");
    expect(rowTexts()).toEqual(["feature", "old-idea"]);
    await type("old");
    expect(rowTexts()).toEqual(["old-idea"]);
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.deleteBranch", { name: "old-idea" });
    expect(useStore.getState().palette).toBeNull();
  });

  it("Escape leaves everything as it was; a typed name that is no branch offers nothing", async () => {
    await open("delete-branch", { command: "git.deleteBranch" });
    await type("no-such-branch");
    expect(rowTexts()).toEqual([]);
    expect(empty()).toBe("No matches");
    await fire.keyDown(input(), "Enter");
    await fire.keyDown(input(), "Escape");
    expect(useStore.getState().palette).toBeNull();
    expect(spy.runCommand).not.toHaveBeenCalled();
  });

  it("Rename / Set Upstream / Push Branch…: every local branch, the current one first", async () => {
    await open("local-branch", { command: "git.pushBranch" });
    expect(input().placeholder).toBe("Push which branch?");
    expect(rowTexts()).toEqual(["current: main", "feature", "old-idea"]);
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.pushBranch", { name: "main" });
  });

  it("Delete Remote Branch…: remote branches only", async () => {
    await open("remote-branch", { command: "git.deleteRemoteBranch" });
    expect(input().placeholder).toBe("Delete which branch on the remote?");
    expect(rowTexts()).toEqual(["origin/main", "origin/topic"]);
    await fire.click(row("origin/topic"));
    expect(spy.runCommand).toHaveBeenCalledWith("git.deleteRemoteBranch", { name: "origin/topic" });
  });

  it("Delete Tag… / Push Tag…: tags only, newest first, with their own prompts", async () => {
    await open("tag", { command: "git.pushTag", remote: "origin" }, { tags: [tag("v1.1"), tag("v1.0")] });
    expect(input().placeholder).toBe("Push which tag to origin?");
    expect(rowTexts()).toEqual(["v1.1", "v1.0"]);
    await fire.keyDown(input(), "ArrowDown");
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.pushTag", { name: "v1.0" });
    await cleanup();
    await open("tag", { command: "git.deleteTag" }, { tags: [tag("v1.1")] });
    expect(input().placeholder).toBe("Delete which tag?");
  });

  it("nothing to choose from says so, and Enter does nothing", async () => {
    await open("tag", { command: "git.deleteTag" }, { tags: [] });
    expect(rowTexts()).toEqual([]);
    expect(empty()).toBe("This repository has no tags");
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).not.toHaveBeenCalled();
    await cleanup();
    await open("tag", { command: "git.deleteTag" }, { tags: null });
    expect(empty()).toBe("Loading…");
  });

  it("Set Upstream…: remote branches, the one of the same name first, no local branches", async () => {
    const branches = [branch("main", { current: true }), branch("topic"), branch("origin/main", { remote: true }), branch("origin/topic", { remote: true })];
    await open("upstream", { command: "git.setUpstream", target: "topic" }, { branches });
    expect(input().placeholder).toBe('Which remote branch should "topic" track?');
    expect(rowTexts()).toEqual(["origin/topic", "origin/main"]);
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.setUpstream", { name: "topic", upstream: "origin/topic" });
  });

  it("Set Upstream… on a tracking branch: Stop tracking first, the tracked branch labelled", async () => {
    const branches = [branch("main", { current: true }), branch("topic", { upstream: "origin/topic" }), branch("origin/main", { remote: true }), branch("origin/topic", { remote: true })];
    await open("upstream", { command: "git.setUpstream", target: "topic" }, { branches });
    expect(rowTexts()).toEqual(['Stop tracking "origin/topic"', "tracking: origin/topic", "origin/main"]);
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.setUpstream", { name: "topic", upstream: null });
  });

  it("Set Upstream… with a remote that has no branches yet: one row that pushes and tracks", async () => {
    await open("upstream", { command: "git.setUpstream", target: "feature" }, { branches: [branch("main", { current: true }), branch("feature")] });
    expect(document.querySelector(".palette-list")?.getAttribute("data-note")).toBe("No remote branches yet");
    expect(rowTexts()).toEqual(['Push "feature" to origin and track it']);
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.pushBranch", { name: "feature" });
  });

  it("New name: starts from the current name; the one row is the rename, spaces become hyphens", async () => {
    await open("new-name", { command: "git.renameBranch", target: "feature" });
    expect(input().placeholder).toBe('New name for "feature"…');
    expect(input().value).toBe("feature");
    expect(rowTexts()).toEqual([]);
    expect(empty()).toBe('Type a new name for "feature"');
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).not.toHaveBeenCalled();
    await type("feature login timeout");
    expect(rowTexts()).toEqual(['Rename "feature" to "feature-login-timeout"']);
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.renameBranch", { name: "feature", to: "feature-login-timeout" });
    expect(useStore.getState().palette).toBeNull();
  });

  it("New name: a taken name is refused in the list, and Escape renames nothing", async () => {
    await open("new-name", { command: "git.renameBranch", target: "feature" });
    await type("main");
    expect(rowTexts()).toEqual([]);
    expect(empty()).toBe('A branch named "main" already exists.');
    await fire.keyDown(input(), "Enter");
    await fire.keyDown(input(), "Escape");
    expect(spy.runCommand).not.toHaveBeenCalled();
    expect(useStore.getState().palette).toBeNull();
  });

  it("an action started in a graph tab keeps its repository", async () => {
    await open("upstream", { command: "git.setUpstream", target: "feature", root: ROOT });
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.setUpstream", { name: "feature", upstream: "origin/main", root: ROOT });
  });
});
