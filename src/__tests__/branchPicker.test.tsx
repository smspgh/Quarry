import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBranch, GitStatus } from "../lib/gitApi";

// The one branch picker (palette mode "branch") rendered from useGit state: what it lists and runs
// depends on why it was opened (`pickBranch(purpose)`; MERGE-003 for merge / rebase, GIT-007 for switch).
const spy = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => undefined }));
vi.mock("../lib/commands", async (orig) => ({ ...(await orig<typeof import("../lib/commands")>()), runCommand: spy.runCommand }));

const { render, cleanup, flush, fire, act } = await import("./helpers/render");
const { CommandPalette } = await import("../components/CommandPalette");
const { useGit } = await import("../lib/git");
const { useStore } = await import("../lib/store");

// jsdom has no scrollIntoView; the palette keeps its active row in view with it.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const repo = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "9f2c0aa", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], ...extra });
const branch = (name: string, extra: Partial<GitBranch> = {}): GitBranch => ({ name, remote: false, current: false, upstream: null, sha: "0".repeat(40), time: 0, summary: "", ...extra });
const BRANCHES = [branch("main", { current: true }), branch("feature"), branch("origin/topic", { remote: true })];

const input = () => document.querySelector<HTMLInputElement>(".palette input")!;
const rowTexts = () => [...document.querySelectorAll<HTMLElement>(".palette-list .palette-item")].map((r) => r.textContent);
const empty = () => document.querySelector(".palette-empty")?.textContent;
async function type(text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function open(purpose: "switch" | "merge" | "rebase" | "compare", status: GitStatus = repo(), branches: GitBranch[] = BRANCHES) {
  useGit.setState({ repos: { [KEY]: status }, current: KEY, branches, branchPick: purpose });
  useStore.setState({ palette: "branch" });
  await render(<CommandPalette />);
  await flush();
}

describe("branch picker", () => {
  beforeEach(() => {
    spy.runCommand.mockClear();
    useStore.setState({ folder: ROOT, docs: [] });
  });
  afterEach(async () => {
    await cleanup();
    useStore.setState({ palette: null });
  });

  it("merge: lists the other branches, local first, and a picked row runs the merge command", async () => {
    await open("merge");
    expect(input().placeholder).toBe("Merge which branch into main?");
    expect(rowTexts()).toEqual(["feature", "remote: origin/topic"]);
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.mergeRef", "feature");
    expect(useStore.getState().palette).toBeNull();
  });

  it("merge: a name that is no branch gives No matches, and Enter does nothing", async () => {
    await open("merge");
    await type("no-such-branch");
    expect(rowTexts()).toEqual([]);
    expect(empty()).toBe("No matches");
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).not.toHaveBeenCalled();
  });

  it("merge: Escape closes the list and nothing runs", async () => {
    await open("merge");
    await fire.keyDown(input(), "Escape");
    expect(useStore.getState().palette).toBeNull();
    expect(spy.runCommand).not.toHaveBeenCalled();
  });

  it("merge: with only the current branch the list is empty", async () => {
    await open("merge", repo(), [branch("main", { current: true })]);
    expect(rowTexts()).toEqual([]);
    expect(empty()).toBe("No matches");
  });

  it("merge on a detached HEAD asks for the current commit", async () => {
    await open("merge", repo({ branch: null }), [branch("feature")]);
    expect(input().placeholder).toBe("Merge which branch into the current commit?");
  });

  it("rebase: its own prompt and command", async () => {
    await open("rebase");
    expect(input().placeholder).toBe("Rebase main onto which branch?");
    expect(rowTexts()).toEqual(["feature", "remote: origin/topic"]);
    await type("topic");
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.rebaseOnto", "origin/topic");
  });

  it("switch: still lists the current branch and offers to create a typed name", async () => {
    await open("switch");
    expect(input().placeholder).toBe("Switch to a branch, or type a name to create one…");
    expect(rowTexts()).toEqual(["current: main", "feature", "remote: origin/topic"]);
    await type("new idea");
    expect(rowTexts()).toEqual(['Create branch "new-idea" from here']);
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.createBranch", "new-idea");
  });

  // Compare with Branch… (COMMITCMP-005.1, .8, .9).
  it("compare: local then remote branches with the current one, no Create row, and a picked row runs the compare command", async () => {
    await open("compare");
    expect(input().placeholder).toBe("Compare with a branch…");
    expect(rowTexts()).toEqual(["current: main", "feature", "remote: origin/topic"]);
    await type("does-not-exist");
    expect(rowTexts()).toEqual([]);
    expect(empty()).toBe("No matches");
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).not.toHaveBeenCalled();
    await type("topic");
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.compareBranchPick", "origin/topic");
  });

  it("a list that opens under a resting pointer keeps its first row; a pointer that moves highlights (UI-005.8)", async () => {
    await open("merge");
    const rows = () => [...document.querySelectorAll<HTMLElement>(".palette-list .palette-item")];
    const active = () => rows().findIndex((r) => r.classList.contains("active"));
    expect(active()).toBe(0);
    // What the browser sends when the list appears under a pointer that did not move: over / enter, no move.
    await act(async () => { rows()[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    expect(active()).toBe(0);
    await act(async () => { rows()[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); });
    expect(active()).toBe(1);
    await fire.keyDown(input(), "Enter");
    expect(spy.runCommand).toHaveBeenCalledWith("git.mergeRef", "origin/topic");
  });

  it("compare: Escape closes the picker and nothing runs", async () => {
    await open("compare");
    await fire.keyDown(input(), "Escape");
    expect(useStore.getState().palette).toBeNull();
    expect(spy.runCommand).not.toHaveBeenCalled();
  });
});
