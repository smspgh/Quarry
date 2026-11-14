import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import type { GitFile, GitStatus } from "../lib/gitApi";

// CONFLICT-006: the "No conflicts left in <file>" offer. Seen live: aborting a rebase reloaded the
// open tab (markers gone) before the status in the store was refreshed, so the offer to "Save and
// Mark Resolved" came up for a rebase that no longer existed. The offer now asks git first.
const answers = vi.hoisted(() => ({ status: null as unknown, fail: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd === "git_status") {
      if (answers.fail) throw new Error("git is not available");
      return answers.status;
    }
    return undefined;
  },
}));

const { conflictsCleared, useGit } = await import("../lib/git");
const { useStore } = await import("../lib/store");

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const PATH = `${ROOT}\\notes.txt`;
const conflicted: GitFile = { path: PATH, origPath: null, index: "U", worktree: "U", conflicted: true, untracked: false };
const repo = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "9f2c0aa", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], ...extra });
const view = {} as EditorView; // not a pane's view: the active document is used
const dialog = () => useStore.getState().dialog;

describe("the offer after the last conflict of a file is gone", () => {
  beforeEach(() => {
    answers.fail = false;
    useStore.setState({ folder: ROOT, docs: [{ id: "d1", kind: "text", path: PATH, name: "notes.txt", dirty: false } as never], activeId: "d1", dialog: null, toasts: [] });
    // What the store still says right after an Abort: the rebase and its conflicted file.
    useGit.setState({ available: true, repos: { [KEY]: repo({ operation: "rebase", files: [conflicted] }) }, current: KEY, busy: null });
  });
  afterEach(() => {
    dialog()?.actions.find((a) => a.cancel)?.run();
  });

  it("is made while git still lists the file as conflicted, worded for the operation", async () => {
    answers.status = repo({ operation: "rebase", files: [conflicted] });
    void conflictsCleared(view);
    await vi.waitFor(() => expect(dialog()?.title).toBe("No conflicts left in notes.txt"));
    expect(dialog()!.message).toContain("after this, Continue Rebase carries on");
  });

  it("is not made when git no longer lists the file: the tab was reloaded by an Abort", async () => {
    answers.status = repo(); // the rebase was aborted; the store has not caught up yet
    await conflictsCleared(view);
    expect(dialog()).toBeNull();
  });

  it("is not made after one side of the whole file was taken (the file is staged, not in conflict)", async () => {
    answers.status = repo({ operation: "rebase", files: [{ ...conflicted, index: "M", worktree: " ", conflicted: false }] });
    await conflictsCleared(view);
    expect(dialog()).toBeNull();
  });

  it("falls back to what the store knows when git cannot be asked", async () => {
    answers.fail = true;
    void conflictsCleared(view);
    await vi.waitFor(() => expect(dialog()?.title).toBe("No conflicts left in notes.txt"));
  });

  it("is not made for a file the store does not list as conflicted (CONFLICT-006.6)", async () => {
    useGit.setState({ repos: { [KEY]: repo() } });
    answers.status = repo({ files: [conflicted] });
    await conflictsCleared(view);
    expect(dialog()).toBeNull();
  });
});
