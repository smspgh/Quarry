import { beforeEach, describe, expect, it, vi } from "vitest";

// git.ts with the Tauri side replaced: what doRefresh makes of git's answers.
const api = vi.hoisted(() => ({
  available: vi.fn<() => Promise<string | null>>(),
  status: vi.fn<(path: string) => Promise<unknown>>(),
}));
vi.mock("../lib/gitApi", () => ({ git: { available: api.available, status: api.status, show: vi.fn(async () => null) } }));

import { currentRepo, refreshGit, repoOf, rescanGit, useGit } from "../lib/git";
import { useStore } from "../lib/store";
import type { GitStatus } from "../lib/gitApi";

const FOLDER = "C:\\work\\proj";
const status = (root: string): GitStatus => ({ root, branch: "main", head: "abc", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [] });

async function settle(run: () => void) {
  vi.useFakeTimers();
  run();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
}

describe("refreshing git status", () => {
  beforeEach(async () => {
    api.available.mockReset().mockResolvedValue("git version 2.53.0");
    api.status.mockReset();
    useStore.setState({ folder: FOLDER, docs: [] });
    useGit.setState({ available: null, repos: {}, statusErrors: [], current: null });
    api.status.mockRejectedValue("offline"); // a failure is not cached
    await settle(rescanGit); // forget what earlier tests cached
    api.status.mockReset();
  });

  it("remembers a folder git says is not a repository, until a rescan", async () => {
    api.status.mockResolvedValue(null);
    await settle(() => refreshGit(0));
    await settle(() => refreshGit(0));
    expect(api.status).toHaveBeenCalledTimes(1);
    api.status.mockResolvedValue(status(FOLDER));
    await settle(rescanGit);
    expect(Object.keys(useGit.getState().repos)).toEqual([FOLDER.toLowerCase()]);
  });

  it("reports a git failure instead of caching it as not a repository", async () => {
    api.status.mockRejectedValue("fatal: detected dubious ownership in repository at 'C:/work/proj'");
    await settle(() => refreshGit(0));
    expect(useGit.getState().statusErrors).toEqual([{ path: FOLDER, error: "fatal: detected dubious ownership in repository at 'C:/work/proj'" }]);
    api.status.mockResolvedValue(status(FOLDER));
    await settle(() => refreshGit(0)); // asked again without a rescan
    expect(useGit.getState().statusErrors).toEqual([]);
    expect(Object.keys(useGit.getState().repos)).toEqual([FOLDER.toLowerCase()]);
  });

  it("keeps a known repository's last status when one read fails", async () => {
    api.status.mockResolvedValue(status(FOLDER));
    await settle(() => refreshGit(0));
    api.status.mockRejectedValue("fatal: Unable to create 'index.lock': File exists.");
    await settle(() => refreshGit(0));
    expect(useGit.getState().repos[FOLDER.toLowerCase()]?.branch).toBe("main");
    expect(useGit.getState().statusErrors).toEqual([]);
  });

  it("looks for git again on a rescan after it was not found", async () => {
    api.available.mockResolvedValue(null);
    useGit.setState({ available: null });
    await settle(() => refreshGit(0));
    expect(useGit.getState().available).toBe(false);
    await settle(() => refreshGit(0));
    expect(api.available).toHaveBeenCalledTimes(2); // beforeEach + first refresh only
    api.available.mockResolvedValue("git version 2.53.0");
    api.status.mockResolvedValue(status(FOLDER));
    await settle(rescanGit);
    expect(useGit.getState().available).toBe(true);
    expect(Object.keys(useGit.getState().repos)).toEqual([FOLDER.toLowerCase()]);
  });
});

describe("more than one repository", () => {
  const NOTES = "C:\\notes";
  beforeEach(async () => {
    api.available.mockReset().mockResolvedValue("git version 2.53.0");
    api.status.mockReset().mockImplementation(async (p: string) => status(p.startsWith(NOTES) ? NOTES : FOLDER));
    useGit.setState({ available: null, repos: {}, statusErrors: [], current: null });
    const doc = { id: "n", kind: "text" as const, path: `${NOTES}\\todo.md`, name: "todo.md", dirty: false, encoding: "UTF-8", bom: false, eol: "LF" as const, language: "Markdown", readonly: false, modifiedMs: 0 };
    useStore.setState({ folder: FOLDER, docs: [doc] });
    await settle(rescanGit);
  });

  it("shows the open folder's repository by default and keeps a picked one", async () => {
    expect(Object.keys(useGit.getState().repos).sort()).toEqual([NOTES.toLowerCase(), FOLDER.toLowerCase()].sort());
    expect(currentRepo()?.root).toBe(FOLDER);
    useGit.setState({ current: NOTES.toLowerCase() });
    await settle(() => refreshGit(0));
    expect(currentRepo()?.root).toBe(NOTES);
  });

  it("gives a file the deepest repository that holds it", () => {
    const inner = status(`${FOLDER}\\vendor\\lib`);
    useGit.setState((g) => ({ repos: { ...g.repos, [inner.root.toLowerCase()]: inner } }));
    expect(repoOf(`${FOLDER}\\vendor\\lib\\x.c`)?.root).toBe(inner.root);
    expect(repoOf(`${FOLDER}\\src\\y.c`)?.root).toBe(FOLDER);
    expect(repoOf("D:\\elsewhere\\z.c")).toBeNull();
  });
});
