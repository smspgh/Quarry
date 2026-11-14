import { beforeEach, describe, expect, it, vi } from "vitest";

// GRAPH-019: Show Commit Graph stays in the palette without a repository and says what it needs.
vi.mock("../lib/gitApi", () => ({ git: { available: vi.fn(async () => null), status: vi.fn(async () => null), show: vi.fn(async () => null) } }));

import { allCommands, runCommand } from "../lib/commands";
import { useGit } from "../lib/git";
import { registerGitCommands } from "../lib/gitCommands";
import { useStore } from "../lib/store";
import type { GitStatus } from "../lib/gitApi";

const ROOT = "C:\\work\\quarry";
const status: GitStatus = { root: ROOT, branch: "main", head: "abc", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [] };
const key = (p: string) => p.toLowerCase();

const listed = () => allCommands().filter((c) => c.category === "Git").map((c) => c.id);
const toasts = () => useStore.getState().toasts.map((t) => t.message);
const graphTabs = () => useStore.getState().docs.filter((d) => d.kind === "graph");

describe("Show Commit Graph without a repository (GRAPH-019)", () => {
  beforeEach(() => {
    registerGitCommands();
    useStore.setState({ folder: null, docs: [], activeId: null, toasts: [] });
    useGit.setState({ repos: {}, current: null });
  });

  it("is listed in the palette with nothing open (GRAPH-019.1)", () => {
    const cmd = allCommands().find((c) => c.id === "git.graph");
    expect(cmd?.title).toBe("Show Commit Graph");
    expect(cmd?.category).toBe("Git");
  });

  it("says what it needs and opens no tab (GRAPH-019.2, .7)", async () => {
    await runCommand("git.graph");
    expect(graphTabs()).toEqual([]);
    expect(toasts()).toEqual(["Open a folder in a git repository"]);
    await runCommand("git.graph");
    expect(graphTabs()).toEqual([]);
    expect(toasts().every((m) => m === "Open a folder in a git repository")).toBe(true);
  });

  it("does the same for a folder that is not a repository (GRAPH-019.3)", async () => {
    useStore.setState({ folder: "C:\\notes" });
    await runCommand("git.graph");
    expect(graphTabs()).toEqual([]);
    expect(toasts()).toEqual(["Open a folder in a git repository"]);
  });

  it("keeps the other repository commands out of the palette (GRAPH-019.6)", () => {
    const ids = listed();
    for (const id of ["git.fetch", "git.pull", "git.push", "git.switchBranch", "git.addRemote"]) expect(ids).not.toContain(id);
    for (const id of ["git.graph", "git.showPanel", "git.refresh"]) expect(ids).toContain(id);
  });

  it("opens the graph tab with a repository, without a notification (GRAPH-019.5)", async () => {
    useStore.setState({ folder: ROOT });
    useGit.setState({ repos: { [key(ROOT)]: status }, current: key(ROOT) });
    expect(listed()).toContain("git.fetch");
    await runCommand("git.graph");
    expect(graphTabs().map((d) => d.name)).toEqual(["Graph · quarry"]);
    expect(toasts()).toEqual([]);
  });
});
