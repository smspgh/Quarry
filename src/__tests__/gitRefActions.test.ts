import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBranchInfo, GitPushRef, GitStatus } from "../lib/gitApi";

// Branch and tag housekeeping, the actions (specs/git-branches.md): what is asked before git runs,
// what runs, and that no entry point (a command with a name, as a macro gives it) skips a question.
// The Tauri side is replaced by `answers`; every call is recorded.
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ map: {} as Record<string, (args: Record<string, unknown>) => unknown> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    const f = answers.map[cmd];
    return f ? f(args) : undefined;
  },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: async () => undefined }));

const { useGit } = await import("../lib/git");
const { useStore } = await import("../lib/store");
const { refAction, refArgs, refCommand, refRepo } = await import("../lib/gitRefActions");

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const ORIGIN = { name: "origin", url: "https://github.com/acme/app.git" };
const repo = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "9f2c0aa", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [ORIGIN], ...extra });
const info = (extra: Partial<GitBranchInfo> = {}): GitBranchInfo => ({ name: "feature", sha: "1a2b3c4", fullSha: "1a2b3c4".padEnd(40, "0"), current: false, upstream: null, base: "main", baseSha: "9f2c0aa", unmerged: 0, defaultBranch: false, ...extra });
const pushed = (extra: Partial<GitPushRef> = {}): GitPushRef => ({ remote: "origin", branch: "feature", upToDate: false, tracking: null, was: null, gone: false, ...extra });

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await tick(); };
const dialog = () => useStore.getState().dialog;
/** Wait for a dialog, check its title, and press a button. */
async function answer(title: string, button: string) {
  await settle();
  expect(dialog()?.title).toBe(title);
  dialog()!.actions.find((a) => a.label === button)!.run();
  await settle();
}
const ran = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);
const toasts = () => useStore.getState().toasts.map((t) => t.message);
function setRepo(status: GitStatus | null = repo()) {
  answers.map.git_status = () => status;
  useGit.setState({ repos: status ? { [KEY]: status } : {}, current: status ? KEY : null, busy: null });
}

describe("branch and tag actions", () => {
  beforeEach(() => {
    calls.length = 0;
    answers.map = { git_stash_list: () => [], git_ref_info: () => ({ upstreams: {}, defaults: {} }) };
    useStore.setState({ dialog: null, toasts: [], folder: ROOT, docs: [], palette: null });
    useGit.setState({ refsTick: 0, addingRemote: false, branchPick: "switch", branchPickFor: null, remoteCheck: {} });
    setRepo();
  });
  afterEach(async () => {
    dialog()?.actions.find((a) => a.cancel)?.run();
    await settle();
  });

  it("delete a merged branch: one question with Cancel as the default, then git's safe delete", async () => {
    answers.map.git_branch_info = () => info();
    answers.map.git_ref_action = () => "1a2b3c4";
    const p = refAction(ROOT, "branch-delete", "feature");
    await settle();
    expect(dialog()?.title).toBe('Delete branch "feature"?');
    expect(dialog()?.actions.map((a) => [a.label, !!a.default, !!a.cancel])).toEqual([["Delete Branch", false, false], ["Cancel", true, true]]);
    expect(ran("git_ref_action")).toEqual([]);
    await answer('Delete branch "feature"?', "Delete Branch");
    expect(await p).toBe(true);
    expect(ran("git_ref_action")).toEqual([{ root: ROOT, action: "branch-delete", name: "feature", arg: null }]);
    expect(toasts()).toContain("Deleted branch feature (was 1a2b3c4)");
    expect(useGit.getState().refsTick).toBe(1);
  });

  it("Cancel (what Enter and Escape do) deletes nothing and says nothing", async () => {
    answers.map.git_branch_info = () => info();
    const p = refAction(ROOT, "branch-delete", "feature");
    await answer('Delete branch "feature"?', "Cancel");
    expect(await p).toBe(false);
    expect(ran("git_ref_action")).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it("an unmerged branch needs the second, danger confirmation, and is forced only for the commit asked about", async () => {
    const i = info({ name: "experiment", sha: "9f8e7d6", fullSha: "9f8e7d6".padEnd(40, "0"), unmerged: 2 });
    answers.map.git_branch_info = () => i;
    answers.map.git_ref_action = () => "9f8e7d6";
    const p = refAction(ROOT, "branch-delete", "experiment");
    await answer('Delete branch "experiment"?', "Delete Branch");
    expect(ran("git_ref_action")).toEqual([]);
    expect(dialog()?.title).toBe('Delete "experiment" and lose 2 commits?');
    expect(dialog()?.actions.map((a) => [a.label, a.kind, !!a.default])).toEqual([["Delete Anyway", "danger", false], ["Cancel", undefined, true]]);
    await answer('Delete "experiment" and lose 2 commits?', "Delete Anyway");
    expect(await p).toBe(true);
    expect(ran("git_ref_action")).toEqual([{ root: ROOT, action: "branch-delete-force", name: "experiment", arg: i.fullSha }]);
    expect(toasts()).toContain("Deleted branch experiment (was 9f8e7d6)");
  });

  it("cancelling the second question keeps the branch", async () => {
    answers.map.git_branch_info = () => info({ unmerged: 2 });
    const p = refAction(ROOT, "branch-delete", "feature");
    await answer('Delete branch "feature"?', "Delete Branch");
    await answer('Delete "feature" and lose 2 commits?', "Cancel");
    expect(await p).toBe(false);
    expect(ran("git_ref_action")).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it("a branch that gained a commit while the question was open is asked about again, not forced", async () => {
    let unmerged = 0;
    answers.map.git_branch_info = () => info({ unmerged });
    answers.map.git_ref_action = (a) => {
      if (a.action === "branch-delete") {
        unmerged = 1;
        throw "NOT_MERGED";
      }
      return "1a2b3c4";
    };
    const p = refAction(ROOT, "branch-delete", "feature");
    await answer('Delete branch "feature"?', "Delete Branch");
    expect(dialog()?.title).toBe('Delete "feature" and lose 1 commit?');
    expect(ran("git_ref_action").map((a) => a.action)).toEqual(["branch-delete"]);
    await answer('Delete "feature" and lose 1 commit?', "Cancel");
    expect(await p).toBe(false);
    expect(ran("git_ref_action").map((a) => a.action)).toEqual(["branch-delete"]);
  });

  it("the current branch is never deleted, whatever route asks", async () => {
    answers.map.git_branch_info = () => info({ name: "main", current: true });
    expect(await refAction(ROOT, "branch-delete", "main")).toBe(false);
    expect(dialog()).toBeNull();
    expect(ran("git_ref_action")).toEqual([]);
    expect(toasts()).toEqual(["You are on main. Switch to another branch first."]);
  });

  it("git refusing for another reason is shown without hint lines, and nothing is forced", async () => {
    answers.map.git_branch_info = () => info();
    answers.map.git_ref_action = () => { throw "error: cannot delete branch 'feature' used by worktree at 'C:/wt'\nhint: try something"; };
    const p = refAction(ROOT, "branch-delete", "feature");
    await answer('Delete branch "feature"?', "Delete Branch");
    expect(await p).toBe(false);
    expect(ran("git_ref_action").map((a) => a.action)).toEqual(["branch-delete"]);
    expect(toasts()).toEqual(["error: cannot delete branch 'feature' used by worktree at 'C:/wt'"]);
  });

  it("rename: runs without a question and says what the branch still tracks", async () => {
    answers.map.git_ref_action = () => "origin/fix";
    expect(await refAction(ROOT, "branch-rename", "fix", "fix-login-timeout")).toBe(true);
    expect(ran("git_ref_action")).toEqual([{ root: ROOT, action: "branch-rename", name: "fix", arg: "fix-login-timeout" }]);
    expect(toasts()).toEqual(["Renamed fix to fix-login-timeout. It still tracks origin/fix; the branch on origin keeps its name."]);
    // The same or an empty name does nothing.
    expect(await refAction(ROOT, "branch-rename", "fix", "fix")).toBe(false);
    expect(await refAction(ROOT, "branch-rename", "fix", "  ")).toBe(false);
    expect(ran("git_ref_action")).toHaveLength(1);
  });

  it("rename refused by git: the error, no notification of success", async () => {
    answers.map.git_ref_action = () => { throw 'A branch named "main" already exists.'; };
    expect(await refAction(ROOT, "branch-rename", "fix", "main")).toBe(false);
    expect(toasts()).toEqual(['A branch named "main" already exists.']);
  });

  it("upstream: set, clear, and picking what it already tracks changes nothing", async () => {
    answers.map.git_ref_action = () => "";
    expect(await refAction(ROOT, "upstream-set", "feature", "origin/feature")).toBe(true);
    expect(ran("git_ref_action")).toEqual([{ root: ROOT, action: "upstream-set", name: "feature", arg: "origin/feature" }]);
    expect(toasts()).toEqual(["feature now tracks origin/feature"]);
    expect(await refAction(ROOT, "upstream-unset", "feature")).toBe(true);
    expect(toasts()[1]).toBe("feature no longer tracks a remote branch");
    answers.map.git_ref_info = () => ({ upstreams: { feature: "origin/feature" }, defaults: {} });
    expect(await refAction(ROOT, "upstream-set", "feature", "origin/feature")).toBe(true);
    expect(ran("git_ref_action")).toHaveLength(2);
    expect(toasts()).toHaveLength(2);
  });

  it("push a branch: no question, a busy label while it runs, and the result named", async () => {
    let busy: string | null = null;
    answers.map.git_push_ref = () => {
      busy = useGit.getState().busy;
      return pushed({ tracking: "origin/feature" });
    };
    expect(await refAction(ROOT, "branch-push", "feature")).toBe(true);
    expect(busy).toBe("Pushing feature…");
    expect(useGit.getState().busy).toBeNull();
    expect(dialog()).toBeNull();
    expect(ran("git_push_ref")).toEqual([{ root: ROOT, kind: "branch", name: "feature" }]);
    expect(toasts()).toEqual(["Pushed feature to origin; it now tracks origin/feature"]);
    answers.map.git_push_ref = () => pushed({ upToDate: true });
    await refAction(ROOT, "branch-push", "feature");
    expect(toasts()[1]).toBe("feature is already up to date on origin");
  });

  it("a rejected push is never forced: a dialog with the way out, Close as the default", async () => {
    answers.map.git_push_ref = () => { throw "To C:/x.git\n ! [rejected]        feature -> feature (fetch first)\nerror: failed to push some refs to 'C:/x.git'\nhint: Updates were rejected because the remote contains work"; };
    const p = refAction(ROOT, "branch-push", "feature");
    await settle();
    expect(dialog()?.title).toBe("origin did not accept feature");
    expect(dialog()?.message).toContain('origin/feature has commits that "feature" does not have. Switch to "feature" and pull, then push again.');
    expect(dialog()?.message).not.toContain("hint:");
    expect(dialog()?.actions.map((a) => [a.label, !!a.default])).toEqual([["Switch to feature", false], ["Close", true]]);
    await answer("origin did not accept feature", "Switch to feature");
    expect(await p).toBe(false);
    expect(ran("git_checkout")).toEqual([{ root: ROOT, name: "feature", create: false }]);
    expect(ran("git_push_ref")).toHaveLength(1);
  });

  it("a rejected push of the branch I am on offers Pull", async () => {
    answers.map.git_push_ref = () => { throw " ! [rejected] main -> main (non-fast-forward)"; };
    const p = refAction(ROOT, "branch-push", "main");
    await settle();
    expect(dialog()?.actions.map((a) => a.label)).toEqual(["Pull", "Close"]);
    await answer("origin did not accept main", "Close");
    expect(await p).toBe(false);
    expect(ran("git_remote")).toEqual([]);
  });

  it("a rejected push of a branch Quarry rewrote points at Force Push, not at Pull", async () => {
    setRepo(repo({ upstream: "origin/main", ahead: 1, behind: 1 })); // the mark only holds while the upstream has the old commits
    useGit.setState({ rewrotePushed: { [KEY]: "main" } });
    answers.map.git_push_ref = () => { throw " ! [rejected] main -> main (non-fast-forward)\nhint: pull first"; };
    expect(await refAction(ROOT, "branch-push", "main")).toBe(false);
    expect(dialog()).toBeNull();
    expect(toasts()).toEqual(["! [rejected] main -> main (non-fast-forward)\n\nmain was rewritten after it was pushed: use Git › Force Push (Replace Remote Branch)… instead of pulling."]);
    useGit.setState({ rewrotePushed: {} });
  });

  it("other push failures: git's message without hints; a missing repository reaches the panel's warning", async () => {
    answers.map.git_push_ref = () => { throw "remote: Repository not found.\nfatal: repository 'https://github.com/acme/app.git/' not found\nhint: check the URL"; };
    expect(await refAction(ROOT, "branch-push", "feature")).toBe(false);
    expect(dialog()).toBeNull();
    expect(toasts()).toEqual(["remote: Repository not found.\nfatal: repository 'https://github.com/acme/app.git/' not found"]);
    expect(useGit.getState().remoteCheck[KEY]?.error).toContain("Repository not found");
  });

  it("no remote configured: push and set-upstream run nothing and lead to the Add Remote form", async () => {
    setRepo(repo({ remotes: [] }));
    expect(await refAction(ROOT, "branch-push", "feature")).toBe(false);
    expect(await refAction(ROOT, "tag-push", "v1.2.0")).toBe(false);
    expect(refCommand("git.setUpstream", { name: "feature" })).toBe(true);
    expect(refCommand("git.pushTag", {})).toBe(true);
    expect(ran("git_push_ref")).toEqual([]);
    expect(ran("git_ref_action")).toEqual([]);
    expect(useStore.getState().palette).toBeNull();
    expect(useGit.getState().addingRemote).toBe(true);
    expect(new Set(toasts())).toEqual(new Set(["This repository has no remote yet. Add one in Source Control."]));
  });

  it("delete a remote branch: the question names the remote and its address, nothing is sent before the click", async () => {
    answers.map.git_branch_info = () => info({ name: "origin/topic", sha: "4c5d6e7", unmerged: 3 });
    answers.map.git_push_ref = () => pushed({ branch: "topic", was: "4c5d6e7" });
    const p = refAction(ROOT, "remote-branch-delete", "origin/topic");
    await settle();
    expect(dialog()?.title).toBe('Delete "topic" from origin?');
    expect(dialog()?.message).toContain('This deletes the branch "topic" in the remote repository origin (github.com/acme/app), for everyone who uses it. Your local branches are kept.');
    expect(dialog()?.message).toContain("3 commits are only on origin/topic (as of the last fetch).");
    expect(dialog()?.actions.map((a) => [a.label, a.kind, !!a.default])).toEqual([["Delete from origin", "danger", false], ["Cancel", undefined, true]]);
    expect(ran("git_push_ref")).toEqual([]);
    await answer('Delete "topic" from origin?', "Delete from origin");
    expect(await p).toBe(true);
    expect(ran("git_branch_info")).toEqual([{ root: ROOT, kind: "remote", name: "origin/topic" }]);
    expect(ran("git_push_ref")).toEqual([{ root: ROOT, kind: "delete", name: "origin/topic" }]);
    expect(toasts()).toEqual(["Deleted topic from origin (was 4c5d6e7)"]);
  });

  it("a remote branch that was already gone is said, not an error; Cancel sends nothing", async () => {
    answers.map.git_branch_info = () => info({ name: "origin/topic" });
    answers.map.git_push_ref = () => pushed({ branch: "topic", gone: true });
    let p = refAction(ROOT, "remote-branch-delete", "origin/topic");
    await answer('Delete "topic" from origin?', "Delete from origin");
    expect(await p).toBe(true);
    expect(toasts()).toEqual(["topic was already gone from origin"]);
    p = refAction(ROOT, "remote-branch-delete", "origin/topic");
    await answer('Delete "topic" from origin?', "Cancel");
    expect(await p).toBe(false);
    expect(ran("git_push_ref")).toHaveLength(1);
  });

  it("a remote's default branch is refused before any question, also from a macro", async () => {
    answers.map.git_branch_info = () => info({ name: "origin/main", defaultBranch: true });
    expect(refCommand("git.deleteRemoteBranch", { name: "origin/main" })).toBe(true);
    await settle();
    expect(dialog()).toBeNull();
    expect(ran("git_push_ref")).toEqual([]);
    expect(toasts()).toEqual(["main is origin's default branch."]);
  });

  it("delete a tag: one question, local only", async () => {
    answers.map.git_branch_info = () => info({ name: "v1.2.0", sha: "18bc71d" });
    answers.map.git_ref_action = () => "18bc71d";
    const p = refAction(ROOT, "tag-delete", "v1.2.0");
    await settle();
    expect(dialog()?.message).toBe("Removes the tag from this computer. The commit 18bc71d and its branch are not changed. If the tag was pushed, the remote keeps its copy.");
    expect(dialog()?.actions.map((a) => [a.label, !!a.default])).toEqual([["Delete Tag", false], ["Cancel", true]]);
    await answer('Delete tag "v1.2.0"?', "Delete Tag");
    expect(await p).toBe(true);
    expect(ran("git_branch_info")).toEqual([{ root: ROOT, kind: "tag", name: "v1.2.0" }]);
    expect(ran("git_ref_action")).toEqual([{ root: ROOT, action: "tag-delete", name: "v1.2.0", arg: null }]);
    expect(ran("git_push_ref")).toEqual([]);
    expect(toasts()).toEqual(["Deleted tag v1.2.0 (was 18bc71d)"]);
  });

  it("a tag that is already gone: an error, and open graphs reload", async () => {
    answers.map.git_branch_info = () => { throw 'The tag "v1.2.0" was not found.'; };
    expect(await refAction(ROOT, "tag-delete", "v1.2.0")).toBe(false);
    expect(dialog()).toBeNull();
    expect(toasts()).toEqual(['The tag "v1.2.0" was not found.']);
    expect(useGit.getState().refsTick).toBe(1);
  });

  it("push a tag: no question; already there; on another commit it is not overwritten", async () => {
    answers.map.git_push_ref = () => pushed({ branch: "v1.2.0" });
    expect(await refAction(ROOT, "tag-push", "v1.2.0")).toBe(true);
    expect(dialog()).toBeNull();
    expect(ran("git_push_ref")).toEqual([{ root: ROOT, kind: "tag", name: "v1.2.0" }]);
    answers.map.git_push_ref = () => pushed({ branch: "v1.2.0", upToDate: true });
    await refAction(ROOT, "tag-push", "v1.2.0");
    answers.map.git_push_ref = () => { throw " ! [rejected]        v1.2.0 -> v1.2.0 (already exists)\nhint: Updates were rejected because the tag already exists in the remote."; };
    expect(await refAction(ROOT, "tag-push", "v1.2.0")).toBe(false);
    expect(toasts()).toEqual(["Pushed tag v1.2.0 to origin", "v1.2.0 is already on origin", "origin already has a tag v1.2.0 on another commit. Quarry does not overwrite tags on a remote.\n\n! [rejected]        v1.2.0 -> v1.2.0 (already exists)"]);
  });

  it("nothing starts while another git action runs", async () => {
    useGit.setState({ busy: "Pulling…" });
    for (const kind of ["branch-delete", "branch-rename", "branch-push", "remote-branch-delete", "tag-delete", "tag-push", "upstream-unset"] as const) expect(await refAction(ROOT, kind, "x", "y")).toBe(false);
    expect(calls.filter((c) => c.cmd !== "git_status" && c.cmd !== "git_stash_list")).toEqual([]);
    expect(dialog()).toBeNull();
  });
});

describe("the seven commands", () => {
  beforeEach(() => {
    calls.length = 0;
    answers.map = { git_stash_list: () => [], git_ref_info: () => ({ upstreams: {}, defaults: {} }), git_branches: () => [], git_tags: () => [] };
    useStore.setState({ dialog: null, toasts: [], folder: ROOT, docs: [], palette: null });
    useGit.setState({ refsTick: 0, addingRemote: false, branchPick: "switch", branchPickFor: null });
    setRepo();
  });
  afterEach(async () => {
    dialog()?.actions.find((a) => a.cancel)?.run();
    await settle();
    useStore.setState({ palette: null });
  });

  it("reads `{ name, root, to, upstream }` or a bare name", () => {
    expect(refArgs("feature")).toEqual({ name: "feature" });
    expect(refArgs({ name: " feature ", to: "x", upstream: null, root: ROOT })).toEqual({ name: "feature", root: ROOT, to: "x", upstream: null });
    expect(refArgs({ name: 3 })).toEqual({ name: undefined, root: undefined, to: undefined, upstream: undefined });
    expect([refArgs(undefined), refArgs(""), refArgs(7)]).toEqual([{}, {}, {}]);
  });

  it("without a target a command opens the one picker with its purpose", async () => {
    const opened = async (id: Parameters<typeof refCommand>[0], args?: unknown) => {
      useStore.setState({ palette: null });
      expect(refCommand(id, args)).toBe(true);
      await settle();
      expect(useStore.getState().palette).toBe("branch");
      return [useGit.getState().branchPick, useGit.getState().branchPickFor];
    };
    expect(await opened("git.deleteBranch")).toEqual(["delete-branch", { command: "git.deleteBranch" }]);
    expect(await opened("git.renameBranch")).toEqual(["local-branch", { command: "git.renameBranch" }]);
    expect(await opened("git.renameBranch", { name: "fix" })).toEqual(["new-name", { command: "git.renameBranch", target: "fix" }]);
    expect(await opened("git.setUpstream")).toEqual(["local-branch", { command: "git.setUpstream" }]);
    expect(await opened("git.setUpstream", { name: "feature", root: ROOT })).toEqual(["upstream", { command: "git.setUpstream", root: ROOT, target: "feature" }]);
    expect(await opened("git.pushBranch")).toEqual(["local-branch", { command: "git.pushBranch" }]);
    expect(await opened("git.deleteRemoteBranch")).toEqual(["remote-branch", { command: "git.deleteRemoteBranch" }]);
    expect(await opened("git.deleteTag")).toEqual(["tag", { command: "git.deleteTag" }]);
    expect(await opened("git.pushTag")).toEqual(["tag", { command: "git.pushTag", remote: "origin" }]);
    expect(ran("git_tags")).toHaveLength(2);
    expect(ran("git_ref_action")).toEqual([]);
    expect(ran("git_push_ref")).toEqual([]);
  });

  it("with a target the command asks exactly as the menus do (a macro cannot skip the question)", async () => {
    answers.map.git_branch_info = () => info({ name: "old-idea" });
    expect(refCommand("git.deleteBranch", "old-idea")).toBe(true);
    await settle();
    expect(useStore.getState().palette).toBeNull();
    expect(dialog()?.title).toBe('Delete branch "old-idea"?');
    expect(ran("git_ref_action")).toEqual([]);
  });

  it("rename with a new name, and set upstream with a choice, run straight away", async () => {
    answers.map.git_ref_action = () => "";
    refCommand("git.renameBranch", { name: "fix", to: "fix-2" });
    await settle();
    refCommand("git.setUpstream", { name: "feature", upstream: null });
    await settle();
    expect(ran("git_ref_action").map((a) => [a.action, a.name, a.arg])).toEqual([["branch-rename", "fix", "fix-2"], ["upstream-unset", "feature", null]]);
  });

  it("without a repository nothing happens", async () => {
    setRepo(null);
    expect(refRepo()).toBeNull();
    for (const id of ["git.deleteBranch", "git.renameBranch", "git.setUpstream", "git.pushBranch", "git.deleteRemoteBranch", "git.deleteTag", "git.pushTag"] as const) expect(refCommand(id, { name: "x" })).toBe(false);
    await settle();
    expect(useStore.getState().palette).toBeNull();
    expect(dialog()).toBeNull();
    expect(calls).toEqual([]);
  });

  it("a graph tab's repository is used when it is named", () => {
    const other = "D:\\other";
    useGit.setState((g) => ({ repos: { ...g.repos, [other.toLowerCase()]: repo({ root: other }) } }));
    expect(refRepo({ root: other })?.root).toBe(other);
    expect(refRepo({ root: "E:\\nope" })).toBeNull();
    expect(refRepo()?.root).toBe(ROOT);
  });
});
