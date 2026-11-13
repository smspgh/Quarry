import { beforeEach, describe, expect, it, vi } from "vitest";

// git.ts with the Tauri side replaced: what doRefresh makes of git's answers.
const api = vi.hoisted(() => ({
  available: vi.fn<() => Promise<string | null>>(),
  status: vi.fn<(path: string) => Promise<unknown>>(),
}));
vi.mock("../lib/gitApi", () => ({ git: { available: api.available, status: api.status, show: vi.fn(async () => null) } }));

import { currentRepo, followOpenFolder, refreshGit, repoOf, rescanGit, setSourceControlContext, useGit } from "../lib/git";
import { pathArg } from "../lib/gitCommands";
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

describe("the panel follows the open folder", () => {
  const OLD = "C:\\old";
  const NEW = "C:\\new";
  const PLAIN = "C:\\plain"; // not a repository
  const tab = (path: string) => ({ id: path, kind: "text" as const, path, name: "a.txt", dirty: false, encoding: "UTF-8", bom: false, eol: "LF" as const, language: "Plain Text", readonly: false, modifiedMs: 0 });
  const answer = async (p: string) => (p.startsWith(PLAIN) ? null : status(p.startsWith(NEW) ? NEW : OLD));

  beforeEach(async () => {
    api.available.mockReset().mockResolvedValue("git version 2.53.0");
    api.status.mockReset().mockImplementation(answer);
    useGit.setState({ available: null, repos: {}, statusErrors: [], current: null });
    // The first folder, with one of its files still open in a tab.
    useStore.setState({ folder: OLD, docs: [tab(`${OLD}\\a.txt`)] });
    await settle(() => followOpenFolder(OLD));
    expect(currentRepo()?.root).toBe(OLD);
  });

  it("moves to the newly opened folder's repository", async () => {
    useStore.setState({ folder: NEW });
    await settle(() => followOpenFolder(NEW));
    expect(currentRepo()?.root).toBe(NEW);
  });

  it("is not kept on the first folder by a refresh that was already running", async () => {
    // A refresh (for example the window regaining focus after the Open Folder dialog) starts while
    // the old folder is open and answers only after the new folder is set.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    api.status.mockImplementation(async (p: string) => {
      await gate;
      return answer(p);
    });
    vi.useFakeTimers();
    refreshGit(0);
    await vi.advanceTimersByTimeAsync(0); // the refresh is now waiting on git
    useStore.setState({ folder: NEW });
    followOpenFolder(NEW);
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(currentRepo()?.root).toBe(NEW);
    expect(useGit.getState().current).toBe(NEW.toLowerCase());
  });

  it("shows no repository for a folder that is not in one, even with another repository's file open", async () => {
    useStore.setState({ folder: PLAIN });
    await settle(() => followOpenFolder(PLAIN));
    expect(currentRepo()).toBeNull();
    expect(Object.keys(useGit.getState().repos)).toEqual([OLD.toLowerCase()]); // still known for the tab's markers
  });

  it("Set as Source Control Context shows that folder's repository and keeps it", async () => {
    useStore.setState({ folder: PLAIN, docs: [] });
    await settle(() => followOpenFolder(PLAIN));
    await settle(() => void setSourceControlContext(`${NEW}\\src`));
    expect(currentRepo()?.root).toBe(NEW);
    expect(useStore.getState().sidebarPanel === "git" || useStore.getState().pinnedPanels.includes("git")).toBe(true);
    await settle(() => refreshGit(0)); // stays known though nothing else points at it
    expect(currentRepo()?.root).toBe(NEW);
    // Opening another folder replaces it.
    useStore.setState({ folder: OLD });
    await settle(() => followOpenFolder(OLD));
    expect(currentRepo()?.root).toBe(OLD);
    expect(useGit.getState().repos[NEW.toLowerCase()]).toBeUndefined();
  });

  it("Set as Source Control Context on a folder outside any repository says so and changes nothing", async () => {
    const toast = vi.spyOn(useStore.getState(), "toast");
    await settle(() => void setSourceControlContext(`${PLAIN}\\docs`));
    expect(currentRepo()?.root).toBe(OLD);
    expect(toast).toHaveBeenCalledWith("docs is not in a git repository.", "info", undefined);
  });
});

describe("pathArg", () => {
  it("reads a command's { path } argument", () => {
    expect(pathArg({ path: "C:\\x" })).toBe("C:\\x");
    expect(pathArg({ path: "" })).toBeNull();
    expect(pathArg({ docId: "1" })).toBeNull();
    expect(pathArg(undefined)).toBeNull();
    expect(pathArg("C:\\x")).toBeNull();
  });
});
