import { beforeEach, describe, expect, it, vi } from "vitest";

// The pure stash helpers, then lib/git.ts's stash actions with the Tauri side replaced.
const api = vi.hoisted(() => ({
  available: vi.fn(async () => "git version 2.53.0"),
  status: vi.fn<(path: string) => Promise<unknown>>(),
  show: vi.fn(async () => null),
  stashList: vi.fn<(root: string) => Promise<unknown[]>>(),
  stashPush: vi.fn<(root: string, message: string, untracked: boolean) => Promise<string>>(),
  stashFiles: vi.fn<(root: string, sha: string) => Promise<unknown[]>>(),
  stashOp: vi.fn<(root: string, sha: string, op: string) => Promise<string>>(),
}));
vi.mock("../lib/gitApi", () => ({ git: api }));

import { dropConfirm, dropOffer, isStashConflict, STASH_CONFLICT, stashBlocked, stashConflictStrip, stashConflictWarning, stashCounts, stashDone, stashErrorText, stashSideTitle, stashTitle, stashWhere } from "../lib/gitStash";
import { commitFileKind, finishFirst, KIND_LETTER } from "../lib/gitStatus";
import { refLabels, stashMenu } from "../lib/gitGraph";
import { showStashes, showStashForm, stashAction, stashChanges, stashLatest, useGit } from "../lib/git";
import { dismissDialog } from "../lib/dialogs";
import { getCommand, isEnabled } from "../lib/commands";
import { registerGitCommands } from "../lib/gitCommands";
import { useStore } from "../lib/store";
import type { GitFile, GitStash, GitStatus } from "../lib/gitApi";

const ROOT = "C:\\work\\proj";
const file = (name: string, extra: Partial<GitFile> = {}): GitFile => ({ path: `${ROOT}\\${name}`, origPath: null, index: ".", worktree: "M", conflicted: false, untracked: false, ...extra });
const untracked = (name: string) => file(name, { index: "?", worktree: "?", untracked: true });
const conflicted = (name: string) => file(name, { index: "U", worktree: "U", conflicted: true });
const status = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "1a2b3c4", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], stash: null, stashCount: 0, ...extra });
const sha = (c: string) => c.repeat(40);
const stash = (c: string, subject: string, extra: Partial<GitStash> = {}): GitStash => ({ sha: sha(c), short: c.repeat(7), base: sha("b"), author: "Ada", email: "ada@example.com", time: Math.floor(Date.now() / 1000) - 7200, subject, untracked: false, ...extra });

describe("stashTitle", () => {
  it("shows the message of a named stash and the branch it was made on", () => {
    expect(stashTitle("On main: WIP parser")).toEqual({ title: "WIP parser", branch: "main" });
    expect(stashTitle("On feature/x: fix: the thing")).toEqual({ title: "fix: the thing", branch: "feature/x" });
  });
  it("turns git's subject for a stash without a message into WIP at <commit>", () => {
    expect(stashTitle("WIP on main: 1a2b3c4 Fix tab order")).toEqual({ title: "WIP at 1a2b3c4 Fix tab order", branch: "main" });
  });
  it("has no branch for a stash made on a detached HEAD, and keeps an unknown subject as it is", () => {
    expect(stashTitle("WIP on (no branch): 1a2b3c4 Fix tab order")).toEqual({ title: "WIP at 1a2b3c4 Fix tab order", branch: null });
    expect(stashTitle("On (no branch): try")).toEqual({ title: "try", branch: null });
    expect(stashTitle("something else")).toEqual({ title: "something else", branch: null });
  });
  it("names where and when under the title", () => {
    expect(stashWhere("main", "2 hours ago")).toBe("main · 2 hours ago");
    expect(stashWhere(null, "yesterday")).toBe("no branch · yesterday");
  });
});

describe("stashCounts and stashBlocked", () => {
  it("counts tracked changes and untracked files apart", () => {
    expect(stashCounts([file("a.ts"), file("b.ts", { index: "M", worktree: "." }), untracked("notes.txt"), untracked("draft.ts")])).toEqual({ tracked: 2, untracked: 2 });
    expect(stashCounts([])).toEqual({ tracked: 0, untracked: 0 });
  });
  it("lets a stash run only with changes, a commit, no stopped operation and no conflicts", () => {
    expect(stashBlocked(status({ files: [file("a.ts")] }), "stash")).toBeNull();
    expect(stashBlocked(status(), "stash")).toBe("There are no uncommitted changes to stash");
    expect(stashBlocked(status({ head: null, files: [untracked("a.ts")] }), "stash")).toBe("Make a first commit before stashing");
    expect(stashBlocked(status({ operation: "rebase", files: [conflicted("a.ts")] }), "stash")).toBe("Finish or abort the rebase first");
    expect(stashBlocked(status({ files: [conflicted("a.ts")] }), "stash")).toBe("Resolve the conflicts first");
  });
  it("lets apply and pop run on a clean or changed folder, but not during an operation or with conflicts", () => {
    expect(stashBlocked(status(), "apply")).toBeNull();
    expect(stashBlocked(status({ files: [file("a.ts")] }), "pop")).toBeNull();
    expect(stashBlocked(status({ operation: "cherry-pick" }), "apply")).toBe("Finish or abort the cherry-pick first");
    expect(stashBlocked(status({ operation: "am" }), "pop")).toBe("Finish or abort the patch series first");
    expect(stashBlocked(status({ files: [conflicted("a.ts")] }), "pop")).toBe("Resolve the conflicts first");
  });
  it("finishFirst names the stopped operation, without a full stop", () => {
    expect(finishFirst("merge")).toBe("Finish or abort the merge first");
    expect(finishFirst("revert")).toBe("Finish or abort the revert first");
  });
});

describe("stash notifications and errors", () => {
  it("says what was done", () => {
    expect(stashDone("stash", "WIP parser", 3)).toBe("Stashed 3 files: WIP parser");
    expect(stashDone("stash", "", 4)).toBe("Stashed 4 files");
    expect(stashDone("stash", "  ", 1)).toBe("Stashed 1 file");
    expect(stashDone("apply", "WIP parser")).toBe("Applied stash: WIP parser. It is still in the list.");
    expect(stashDone("pop", "WIP parser")).toBe("Popped stash: WIP parser");
    expect(stashDone("drop", "WIP parser")).toBe("Dropped stash: WIP parser");
  });
  it("turns git's would-be-overwritten refusal into a sentence naming the files", () => {
    const raw = "error: Your local changes to the following files would be overwritten by merge:\n\tapp.ts\nPlease commit your changes or stash them before you merge.\nAborting";
    expect(stashErrorText(raw, "apply")).toBe("app.ts has uncommitted changes that this stash would overwrite. Commit or stash them first, then apply again.");
    expect(stashErrorText(raw, "pop")).toBe("app.ts has uncommitted changes that this stash would overwrite. Commit or stash them first, then pop again.");
    const two = "error: Your local changes to the following files would be overwritten by merge:\n\tsrc/app.ts\n\tstore.ts\nPlease commit your changes or stash them before you merge.";
    expect(stashErrorText(two, "apply")).toBe("src\\app.ts and store.ts have uncommitted changes that this stash would overwrite. Commit or stash them first, then apply again.");
  });
  it("names an untracked file that is already in the folder", () => {
    const raw = "notes.txt already exists, no checkout\nerror: could not restore untracked files from stash";
    expect(stashErrorText(raw, "apply")).toBe("notes.txt is already in the folder, and this stash holds an untracked file with that name. Move or delete it, then apply again.");
    const many = "a.txt already exists, no checkout\nb.txt already exists, no checkout\nerror: could not restore untracked files from stash";
    expect(stashErrorText(many, "pop")).toBe("a.txt and b.txt are already in the folder, and this stash holds untracked files with those names. Move or delete them, then pop again.");
  });
  it("passes on a stash that is gone, and drops git's hint lines from anything else", () => {
    expect(stashErrorText("That stash no longer exists.", "apply")).toBe("That stash no longer exists.");
    expect(stashErrorText("Error: fatal: something odd\nhint: try this", "pop")).toBe("fatal: something odd");
  });
});

describe("drop dialog and stash-conflict wording", () => {
  it("says exactly what a drop loses", () => {
    const w = dropConfirm({ title: "WIP parser", branch: "main" }, "2 hours ago", 3);
    expect(w.title).toBe("Drop this stash?");
    expect(w.text).toBe('"WIP parser" (3 files, made on main 2 hours ago) will be deleted. Its changes are not in your files or in any commit, and Quarry cannot bring it back.');
    expect([w.drop, w.cancel]).toEqual(["Drop Stash", "Cancel"]);
    expect(dropConfirm({ title: "x", branch: null }, "yesterday", null).text).toContain('"x" (made yesterday) will be deleted');
    expect(dropConfirm({ title: "x", branch: "main" }, "now", 1).text).toContain("(1 file, made on main now)");
  });
  it("words a pop and an apply that conflict, never mentioning Abort", () => {
    expect(stashConflictWarning("WIP parser", true, 1)).toBe("Stash WIP parser conflicts with your files in 1 file. Resolve it under Merge Changes. The stash is kept until you drop it.");
    expect(stashConflictWarning("WIP parser", false, 2)).toBe("Stash WIP parser conflicts with your files in 2 files. Resolve them under Merge Changes. The stash stays in the list.");
    expect(stashConflictStrip(2)).toBe("A stash was applied with conflicts: 2 files have conflicts. Resolve them in Source Control.");
    expect(stashConflictStrip(1)).toBe("A stash was applied with conflicts: 1 file has conflicts. Resolve it in Source Control.");
    expect(STASH_CONFLICT.badge).toBe("Stash conflicts");
    expect(STASH_CONFLICT.sidesNote).toBe("Stash: Current is your files as they are now, Incoming is the stash.");
    expect(STASH_CONFLICT.lastFilePop).toBe("It is the last file: after this, Quarry offers to drop the stash.");
    expect(stashSideTitle("ours")).toContain(STASH_CONFLICT.sidesNote);
    expect(stashSideTitle("theirs")).toContain("the stash's version");
    const offer = dropOffer("WIP parser");
    expect(offer.title).toBe("Conflicts resolved: drop the stash?");
    expect([offer.drop, offer.keep]).toEqual(["Drop Stash", "Keep Stash"]);
    // Resolving with Current keeps the stash's change out of the files: the text must not claim otherwise.
    expect(offer.text).toContain("where you kept Current, they are only in the stash");
    expect(offer.text).not.toMatch(/^The changes of .* are now in your files\./);
    const all = [stashConflictWarning("x", true, 1), stashConflictStrip(1), stashSideTitle("ours"), stashSideTitle("theirs"), offer.text, ...Object.values(STASH_CONFLICT)].join(" ");
    expect(all).not.toMatch(/abort/i);
    expect(all).not.toMatch(/you can commit to finish/);
  });
  it("takes conflicts with no operation in progress as a stash conflict", () => {
    expect(isStashConflict(status({ files: [conflicted("a.ts")] }))).toBe(true);
    expect(isStashConflict(status({ operation: "merge", files: [conflicted("a.ts")] }))).toBe(false);
    expect(isStashConflict(status({ files: [file("a.ts")] }))).toBe(false);
  });
});

describe("stash rows in the graph", () => {
  it("an untracked file of a stash shows U", () => {
    expect(KIND_LETTER[commitFileKind("?")]).toBe("U");
    expect(commitFileKind("M")).toBe("modified");
  });
  it("labels a stash row", () => {
    expect(refLabels(["refs/stash"])).toEqual([{ kind: "stash", name: "stash", full: "refs/stash" }]);
  });
  it("offers Apply, Pop, Drop and Copy only, and blocks Apply / Pop with the reason", () => {
    const free = stashMenu(null, false);
    expect(free.map((m) => m.label)).toEqual(["Apply Stash", "Pop Stash", "Drop Stash…", "Copy Message"]);
    expect(free.every((m) => m.disabled === null)).toBe(true);
    expect(free.filter((m) => m.danger).map((m) => m.id)).toEqual(["drop"]);
    const blocked = stashMenu("Finish or abort the rebase first", false);
    expect(blocked.map((m) => m.disabled)).toEqual(["Finish or abort the rebase first", "Finish or abort the rebase first", null, null]);
    expect(stashMenu(null, true).map((m) => !!m.disabled)).toEqual([true, true, true, false]);
  });
});

// ---------- the actions (lib/git.ts) ----------

const toasts = () => useStore.getState().toasts.map((t) => t.message);
const dialog = () => useStore.getState().dialog;
const press = (label: string) => dialog()!.actions.find((a) => a.label === label)!.run();
const tick = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const WIP = stash("a", "On main: WIP parser");

describe("stash actions", () => {
  beforeEach(() => {
    for (let i = 0; i < 5; i++) dismissDialog();
    for (const f of Object.values(api)) f.mockReset();
    api.available.mockResolvedValue("git version 2.53.0");
    api.show.mockResolvedValue(null);
    api.status.mockResolvedValue(status({ files: [file("app.ts"), file("store.ts", { index: "M", worktree: "." }), untracked("notes.txt")] }));
    api.stashList.mockResolvedValue([WIP]);
    api.stashFiles.mockResolvedValue([{}, {}, {}]);
    api.stashPush.mockResolvedValue(sha("a"));
    api.stashOp.mockResolvedValue("ok");
    useStore.setState({ folder: ROOT, docs: [], toasts: [], dialog: null, sidebarVisible: false });
    useGit.setState({ available: true, busy: null, current: ROOT.toLowerCase(), repos: { [ROOT.toLowerCase()]: status({ files: [file("app.ts")], stash: sha("a"), stashCount: 1 }) }, stashes: {}, stashForm: false, stashPending: null });
  });

  it("stashes with the message and the untracked choice, and says how many files went", async () => {
    useGit.setState({ stashForm: true });
    expect(await stashChanges(ROOT, "WIP parser", true)).toBe(true);
    expect(api.stashPush).toHaveBeenCalledWith(ROOT, "WIP parser", true);
    expect(toasts()).toContain("Stashed 3 files: WIP parser");
    expect(useGit.getState().stashForm).toBe(false);
    expect(useGit.getState().stashes[ROOT.toLowerCase()]).toEqual([WIP]);

    expect(await stashChanges(ROOT, "", false)).toBe(true);
    expect(api.stashPush).toHaveBeenLastCalledWith(ROOT, "", false);
    expect(toasts()).toContain("Stashed 2 files");
  });

  it("checks the guards on a fresh status before anything runs", async () => {
    api.status.mockResolvedValue(status({ operation: "merge", files: [conflicted("app.ts")] }));
    expect(await stashChanges(ROOT, "x", true)).toBe(false);
    expect(toasts()).toContain("Finish or abort the merge first.");
    api.status.mockResolvedValue(status());
    expect(await stashChanges(ROOT, "x", true)).toBe(false);
    expect(toasts()).toContain("There are no uncommitted changes to stash.");
    api.status.mockResolvedValue(status({ files: [untracked("notes.txt")] }));
    expect(await stashChanges(ROOT, "x", false)).toBe(false);
    api.status.mockResolvedValue(status({ head: null, files: [untracked("notes.txt")] }));
    expect(await stashChanges(ROOT, "x", true)).toBe(false);
    expect(toasts()).toContain("Make a first commit before stashing.");
    expect(api.stashPush).not.toHaveBeenCalled();
  });

  it("keeps the form open when git refuses, showing its message without hint lines", async () => {
    useGit.setState({ stashForm: true });
    api.stashPush.mockRejectedValue("error: could not write index\nhint: try again");
    expect(await stashChanges(ROOT, "WIP parser", true)).toBe(false);
    expect(toasts()).toContain("error: could not write index");
    expect(useGit.getState().stashForm).toBe(true);
  });

  it("applies and pops by commit id without asking", async () => {
    expect(await stashAction(ROOT, WIP, "apply")).toBe(true);
    expect(api.stashOp).toHaveBeenCalledWith(ROOT, sha("a"), "apply");
    expect(toasts()).toContain("Applied stash: WIP parser. It is still in the list.");
    expect(await stashAction(ROOT, WIP, "pop")).toBe(true);
    expect(api.stashOp).toHaveBeenLastCalledWith(ROOT, sha("a"), "pop");
    expect(toasts()).toContain("Popped stash: WIP parser");
    expect(dialog()).toBeNull();
    expect(useGit.getState().stashPending).toBeNull();
  });

  it("refuses apply and pop during a stopped operation or with conflicts, but still drops", async () => {
    api.status.mockResolvedValue(status({ operation: "cherry-pick", files: [conflicted("app.ts")] }));
    expect(await stashAction(ROOT, WIP, "apply")).toBe(false);
    expect(toasts()).toContain("Finish or abort the cherry-pick first.");
    api.status.mockResolvedValue(status({ files: [conflicted("app.ts")] }));
    expect(await stashAction(ROOT, WIP, "pop")).toBe(false);
    expect(toasts()).toContain("Resolve the conflicts first.");
    expect(api.stashOp).not.toHaveBeenCalled();
    const dropping = stashAction(ROOT, WIP, "drop");
    await tick();
    press("Drop Stash");
    expect(await dropping).toBe(true);
    expect(api.stashOp).toHaveBeenCalledWith(ROOT, sha("a"), "drop");
  });

  it("turns a refusal into a sentence and reloads the list", async () => {
    api.stashOp.mockRejectedValue("error: Your local changes to the following files would be overwritten by merge:\n\tapp.ts\nPlease commit your changes or stash them before you merge.\nAborting");
    expect(await stashAction(ROOT, WIP, "pop")).toBe(false);
    expect(toasts()).toContain("app.ts has uncommitted changes that this stash would overwrite. Commit or stash them first, then pop again.");
    api.stashOp.mockRejectedValue("That stash no longer exists.");
    api.stashList.mockResolvedValue([]);
    expect(await stashAction(ROOT, WIP, "apply")).toBe(false);
    expect(toasts()).toContain("That stash no longer exists.");
    expect(useGit.getState().stashes[ROOT.toLowerCase()]).toEqual([]);
  });

  it("drop asks first, with Cancel as the default, and names the stash", async () => {
    const asked = stashAction(ROOT, WIP, "drop");
    await tick();
    expect(dialog()?.title).toBe("Drop this stash?");
    expect(dialog()?.message).toContain('"WIP parser" (3 files, made on main 2 hours ago) will be deleted');
    expect(dialog()?.actions.map((a) => [a.label, !!a.default, !!a.cancel])).toEqual([["Drop Stash", false, false], ["Cancel", true, true]]);
    press("Cancel");
    expect(await asked).toBe(false);
    expect(api.stashOp).not.toHaveBeenCalled();

    const again = stashAction(ROOT, WIP, "drop");
    await tick();
    press("Drop Stash");
    expect(await again).toBe(true);
    expect(api.stashOp).toHaveBeenCalledWith(ROOT, sha("a"), "drop");
    expect(toasts()).toContain("Dropped stash: WIP parser");
    expect(dialog()).toBeNull(); // no second question
  });

  it("a pop that conflicts is not an error: it is remembered and Source Control opens", async () => {
    api.stashOp.mockResolvedValue("conflicts");
    api.status.mockResolvedValueOnce(status()).mockResolvedValue(status({ files: [conflicted("app.ts"), file("store.ts", { index: "M", worktree: "." })] }));
    expect(await stashAction(ROOT, WIP, "pop")).toBe(true);
    expect(useGit.getState().stashPending).toEqual({ root: ROOT, sha: sha("a"), title: "WIP parser", pop: true });
    const warning = toasts().find((m) => m.startsWith("Stash WIP parser conflicts"));
    expect(warning).toBe("Stash WIP parser conflicts with your files in 1 file. Resolve it under Merge Changes. The stash is kept until you drop it.");
    expect(warning).not.toMatch(/abort/i);
    expect(useStore.getState().sidebarPanel).toBe("git");
    expect(useStore.getState().toasts.find((t) => t.message === warning)?.kind).toBe("warning");
  });

  it("an apply that conflicts ends with the stash staying in the list", async () => {
    api.stashOp.mockResolvedValue("conflicts");
    api.status.mockResolvedValueOnce(status()).mockResolvedValue(status({ files: [conflicted("app.ts"), conflicted("b.ts")] }));
    await stashAction(ROOT, WIP, "apply");
    expect(useGit.getState().stashPending?.pop).toBe(false);
    expect(toasts()).toContain("Stash WIP parser conflicts with your files in 2 files. Resolve them under Merge Changes. The stash stays in the list.");
  });

  it("once the files of a pop are resolved it offers the drop, Keep Stash being the default", async () => {
    api.stashOp.mockResolvedValue("conflicts");
    api.status.mockResolvedValueOnce(status()).mockResolvedValue(status({ files: [conflicted("app.ts")] }));
    await stashAction(ROOT, WIP, "pop");
    await tick(); // the refresh after the pop still sees the conflict
    expect(dialog()).toBeNull();
    expect(useGit.getState().stashPending).not.toBeNull();

    // The file is marked resolved: the next refresh finds no conflicts.
    api.status.mockResolvedValue(status({ files: [file("app.ts", { index: "M", worktree: "." })] }));
    const { refreshGit } = await import("../lib/git");
    refreshGit(0);
    await tick(12);
    expect(dialog()?.title).toBe("Conflicts resolved: drop the stash?");
    expect(dialog()?.actions.map((a) => [a.label, !!a.default])).toEqual([["Drop Stash", false], ["Keep Stash", true]]);
    expect(useGit.getState().stashPending).toBeNull();
    api.stashOp.mockClear();
    press("Keep Stash");
    await tick();
    expect(api.stashOp).not.toHaveBeenCalled();
    refreshGit(0);
    await tick(12);
    expect(dialog()).toBeNull(); // not asked again
  });

  it("Drop Stash in that offer drops without a second question", async () => {
    api.stashOp.mockResolvedValue("conflicts");
    api.status.mockResolvedValueOnce(status()).mockResolvedValue(status({ files: [conflicted("app.ts")] }));
    await stashAction(ROOT, WIP, "pop");
    api.status.mockResolvedValue(status());
    const { refreshGit } = await import("../lib/git");
    refreshGit(0);
    await tick(12);
    api.stashOp.mockReset().mockResolvedValue("ok");
    press("Drop Stash");
    await tick(12);
    expect(api.stashOp).toHaveBeenCalledWith(ROOT, sha("a"), "drop");
    expect(dialog()).toBeNull();
    expect(toasts()).toContain("Dropped stash: WIP parser");
  });

  it("offers nothing after an apply, or when the stash was dropped in the meantime", async () => {
    const { refreshGit } = await import("../lib/git");
    api.stashOp.mockResolvedValue("conflicts");
    api.status.mockResolvedValueOnce(status()).mockResolvedValue(status({ files: [conflicted("app.ts")] }));
    await stashAction(ROOT, WIP, "apply");
    api.status.mockResolvedValue(status());
    refreshGit(0);
    await tick(12);
    expect(dialog()).toBeNull();
    expect(useGit.getState().stashPending).toBeNull();

    api.status.mockResolvedValueOnce(status()).mockResolvedValue(status({ files: [conflicted("app.ts")] }));
    await stashAction(ROOT, WIP, "pop");
    api.stashList.mockResolvedValue([]); // dropped by hand
    api.status.mockResolvedValue(status());
    refreshGit(0);
    await tick(12);
    expect(dialog()).toBeNull();
    expect(useGit.getState().stashPending).toBeNull();
  });

  it("the form opens only when there is something to stash", () => {
    showStashForm();
    expect(useGit.getState().stashForm).toBe(true);
    expect(useStore.getState().sidebarPanel).toBe("git");
    expect(api.stashPush).not.toHaveBeenCalled(); // nothing is stashed until Stash is pressed

    useGit.setState({ stashForm: false, repos: { [ROOT.toLowerCase()]: status() } });
    showStashForm();
    expect(useGit.getState().stashForm).toBe(false);
    expect(toasts()).toContain("There are no uncommitted changes to stash.");
    useGit.setState({ repos: { [ROOT.toLowerCase()]: status({ operation: "merge", files: [conflicted("a.ts")] }) } });
    showStashForm();
    expect(toasts()).toContain("Finish or abort the merge first.");
    useGit.setState({ repos: { [ROOT.toLowerCase()]: status({ head: null, files: [untracked("a.ts")] }) } });
    showStashForm();
    expect(toasts()).toContain("Make a first commit before stashing.");
    expect(useGit.getState().stashForm).toBe(false);
  });

  it("Show Stashes opens the panel and asks the section to take the focus", () => {
    const before = useGit.getState().stashReveal;
    showStashes();
    expect(useStore.getState().sidebarPanel).toBe("git");
    expect(useGit.getState().stashReveal).toBe(before + 1);
  });

  it("the latest-stash commands act on the newest stash through the same guards", async () => {
    const newer = stash("c", "On main: newer");
    api.stashList.mockResolvedValue([newer, WIP]);
    await stashLatest("pop");
    expect(api.stashOp).toHaveBeenCalledWith(ROOT, sha("c"), "pop");
    expect(toasts()).toContain("Popped stash: newer");

    const dropping = stashLatest("drop");
    await tick();
    expect(dialog()?.message).toContain('"newer"');
    press("Cancel");
    await dropping;
    expect(api.stashOp).toHaveBeenCalledTimes(1);

    useGit.setState({ repos: { [ROOT.toLowerCase()]: status({ operation: "merge", files: [conflicted("a.ts")] }) } });
    await stashLatest("apply");
    expect(toasts()).toContain("Finish or abort the merge first.");
    expect(api.stashOp).toHaveBeenCalledTimes(1);
  });
});

describe("stash commands", () => {
  const ids = ["git.stash", "git.stashApply", "git.stashPop", "git.stashDrop", "git.showStashes"];
  const cmd = (id: string) => getCommand(id)!;
  beforeEach(() => {
    if (!getCommand("git.stash")) registerGitCommands();
    useStore.setState({ folder: ROOT, docs: [] });
  });

  it("registers the five commands, with their menu titles and no shortcuts", () => {
    expect(ids.map((id) => cmd(id).title)).toEqual(["Stash Changes…", "Apply Latest Stash", "Pop Latest Stash", "Drop Latest Stash…", "Show Stashes"]);
    expect(ids.every((id) => !cmd(id).keys && !cmd(id).hidden)).toBe(true);
    expect(getCommand("git.stashClear") ?? getCommand("git.stashDropAll")).toBeUndefined();
  });

  it("greys out the latest-stash commands with no stashes, and all five with no repository", () => {
    useGit.setState({ current: ROOT.toLowerCase(), repos: { [ROOT.toLowerCase()]: status({ stashCount: 0 }) } });
    expect(ids.map((id) => isEnabled(cmd(id)))).toEqual([true, false, false, false, true]);
    // Still enabled while a stash cannot run: running one says why.
    useGit.setState({ repos: { [ROOT.toLowerCase()]: status({ operation: "merge", stash: sha("a"), stashCount: 2 }) } });
    expect(ids.map((id) => isEnabled(cmd(id)))).toEqual([true, true, true, true, true]);
    useGit.setState({ current: null, repos: {} });
    expect(ids.map((id) => isEnabled(cmd(id)))).toEqual([false, false, false, false, false]);
  });
});
