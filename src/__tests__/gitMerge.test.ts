import { beforeEach, describe, expect, it, vi } from "vitest";

// Starting a merge / rebase and Force Push (specs/git-merge-rebase.md): the pure wording and rules
// of gitMerge.ts, then the actions of git.ts with the Tauri side replaced.
const api = vi.hoisted(() => ({
  available: vi.fn(async () => "git version 2.53.0"),
  status: vi.fn<(path: string) => Promise<unknown>>(),
  show: vi.fn(async () => null),
  stashList: vi.fn(async () => []),
  mergePreview: vi.fn<(root: string, target: string) => Promise<unknown>>(),
  merge: vi.fn<(root: string, target: string, mode: string) => Promise<string>>(),
  rebase: vi.fn<(root: string, target: string) => Promise<string>>(),
  forcePushPreview: vi.fn<(root: string) => Promise<unknown>>(),
  remote: vi.fn<(root: string, op: string) => Promise<string>>(),
  continueOp: vi.fn<(root: string, how: string) => Promise<string>>(),
  abort: vi.fn<(root: string) => Promise<string>>(),
}));
vi.mock("../lib/gitApi", () => ({ git: api }));
vi.mock("../lib/actions", () => ({ checkExternalChanges: vi.fn(async () => {}), askDialog: vi.fn(async () => true) }));

import { abortOperation, continueOperation, forcePush, pickBranch, startMerge, startRebase, useGit } from "../lib/git";
import type { GitCommitRef, GitFile, GitMergePreview, GitStatus } from "../lib/gitApi";
import { commitLines, dirtyRefusal, entryLabels, forcePushBlocked, forcePushConfirm, forcePushDone, isRewritten, mergeConfirm, mergeDone, rebaseConfirm, rebaseDone, startBlocked, startEntries, targetOf, trackedChanges } from "../lib/gitMerge";
import { finishFirst, syncLine } from "../lib/gitStatus";
import { isPanelShown } from "../lib/panels";
import { useStore } from "../lib/store";

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const sha = (n: number) => `${n % 10}`.repeat(40);
const commitRef = (n: number): GitCommitRef => ({ sha: sha(n), short: `${n % 10}`.repeat(7), summary: `Commit ${n}` });
const file = (name: string, extra: Partial<GitFile> = {}): GitFile => ({ path: `${ROOT}\\${name}`, origPath: null, index: ".", worktree: "M", conflicted: false, untracked: false, ...extra });
const status = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "9f2c0aa", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], ...extra });
const preview = (extra: Partial<GitMergePreview> = {}): GitMergePreview => ({ target: "refs/heads/feature", kind: "branch", sha: sha(1), short: "18bc71d", summary: "Add the parser", ahead: 2, behind: 3, merges: 0, pushed: 0, pushedOn: null, pushedCommits: [], ...extra });
const labelsOf = (choices: { label: string }[]) => choices.map((c) => c.label);
const ask = <T,>(plan: { nothing?: string } & Partial<{ title: string; text: string; choices: T[] }>) => {
  if (plan.nothing !== undefined || !plan.title || !plan.text || !plan.choices) throw new Error(`no dialog: ${plan.nothing}`);
  return { title: plan.title, text: plan.text, choices: plan.choices };
};

describe("what a graph commit stands for", () => {
  const commit = (refs: string[]) => ({ sha: sha(1), short: "18bc71d", refs });
  it("a commit with no branch label is used by its id", () => {
    const t = targetOf(commit([]), "main");
    expect(t).toEqual({ ref: sha(1), label: "18bc71d", named: false });
    expect(entryLabels(t, "main")).toEqual({ merge: "Merge 18bc71d into main…", rebase: "Rebase main onto This…" });
  });
  it("exactly one other branch label makes it that branch", () => {
    const t = targetOf(commit(["refs/heads/feature", "refs/tags/v1"]), "main");
    expect(t).toEqual({ ref: "refs/heads/feature", label: "feature", named: true });
    expect(entryLabels(t, "main")).toEqual({ merge: "Merge feature into main…", rebase: "Rebase main onto feature…" });
    expect(targetOf(commit(["refs/remotes/origin/topic"]), "main").label).toBe("origin/topic");
  });
  it("several branch labels, or only the current branch's, mean the commit", () => {
    expect(targetOf(commit(["refs/heads/feature", "refs/remotes/origin/feature"]), "main").named).toBe(false);
    expect(targetOf(commit(["HEAD", "refs/heads/main"]), "main").named).toBe(false);
    // The current branch's label does not count against the one other branch.
    expect(targetOf(commit(["HEAD", "refs/heads/main", "refs/heads/feature"]), "main").label).toBe("feature");
  });
  it("words the entries for a detached HEAD", () => {
    expect(entryLabels(targetOf(commit([]), null), null)).toEqual({ merge: "Merge 18bc71d into Here…", rebase: "Rebase onto This…" });
  });
});

describe("why a merge or rebase cannot start", () => {
  it("names the stopped operation, from the shared sentence", () => {
    expect(finishFirst("rebase")).toBe("Finish or abort the rebase first");
    expect(finishFirst("am")).toBe("Finish or abort the patch series first");
    expect(startBlocked(status({ operation: "cherry-pick" }), "merge")).toBe("Finish or abort the cherry-pick first");
    expect(startBlocked(status({ operation: "merge" }), "rebase")).toBe("Finish or abort the merge first");
  });
  it("needs a repository with commits, nothing running, and a branch for a rebase", () => {
    expect(startBlocked(null, "merge")).toBe("The open folder is not in a git repository");
    expect(startBlocked(status(), "merge", "Pulling…")).toBe("Another git action is running");
    expect(startBlocked(status({ head: null, branch: "main" }), "merge")).toBe("This repository has no commits yet");
    expect(startBlocked(status({ branch: null }), "rebase")).toBe("Switch to a branch first: a rebase moves a branch");
    expect(startBlocked(status({ branch: null }), "merge")).toBeNull();
    expect(startBlocked(status(), "rebase")).toBeNull();
  });
  it("does not grey anything out for uncommitted changes, and counts only tracked files", () => {
    const dirty = status({ files: [file("a.txt"), file("b.txt", { index: "M", worktree: "." }), file("scratch.txt", { untracked: true, index: "?", worktree: "?" })] });
    expect(startBlocked(dirty, "merge")).toBeNull();
    expect(trackedChanges(dirty)).toBe(2);
    expect(trackedChanges(status({ files: [file("scratch.txt", { untracked: true })] }))).toBe(0);
  });
  it("greys out the entries of the commit or branch you are on", () => {
    const t = { ref: sha(1), label: "9f2c0aa", named: false };
    expect(startEntries(t, status(), null, "commit").map((e) => e.disabled)).toEqual(["This is the commit you are on", "This is the commit you are on"]);
    expect(startEntries({ ref: "refs/heads/main", label: "main", named: true }, status(), null, "branch").map((e) => e.disabled)).toEqual(["This is the branch you are on", "This is the branch you are on"]);
    // A stopped operation or a detached HEAD is the stronger reason.
    expect(startEntries(t, status({ operation: "rebase" }), null, "commit")[0].disabled).toBe("Finish or abort the rebase first");
    const detached = startEntries({ ref: sha(1), label: "18bc71d", named: false }, status({ branch: null }), null);
    expect(detached.map((e) => [e.label, e.disabled])).toEqual([["Merge 18bc71d into Here…", null], ["Rebase onto This…", "Switch to a branch first: a rebase moves a branch"]]);
  });
});

describe("the merge dialog", () => {
  it("both sides have commits: one way to merge, Cancel the default", () => {
    const d = ask(mergeConfirm(preview(), "feature", "main"));
    expect(d.title).toBe("Merge feature into main?");
    expect(d.text).toContain("The 3 commits of feature that main does not have are brought into main and joined with a merge commit.");
    expect(d.text).toContain("Nothing is rewritten");
    expect(d.text).toContain("the merge stops and Source Control shows the files to resolve");
    expect(labelsOf(d.choices)).toEqual(["Merge", "Cancel"]);
    expect(d.choices.filter((c) => c.default).map((c) => c.label)).toEqual(["Cancel"]);
    expect(d.choices.filter((c) => c.cancel).map((c) => c.label)).toEqual(["Cancel"]);
    expect(d.choices[0].value).toBe("no-ff");
  });
  it("a fast-forward is possible: the choice, Cancel still the default", () => {
    const d = ask(mergeConfirm(preview({ ahead: 0 }), "feature", "main"));
    expect(d.text).toContain("main has no commits of its own, so main can simply move forward by 3 commits");
    expect(d.text).toContain("a merge commit can record that feature was a separate branch");
    expect(d.choices.map((c) => [c.label, c.value, !!c.default])).toEqual([["Fast-forward", "ff-only", false], ["Create a Merge Commit", "no-ff", false], ["Cancel", null, true]]);
  });
  it("nothing to merge is said, not asked", () => {
    expect(mergeConfirm(preview({ behind: 0 }), "feature", "main")).toEqual({ nothing: "main already contains feature: nothing to merge." });
  });
  it("says what a remote branch, a tag and a commit id mean", () => {
    expect(ask(mergeConfirm(preview({ kind: "remote" }), "origin/topic", "main")).text).toContain("origin/topic is used as it was last fetched");
    const tag = ask(mergeConfirm(preview({ kind: "tag" }), "v1.2.0", "main"));
    expect(tag.title).toBe("Merge v1.2.0 into main?");
    expect(tag.text).toContain('The commit the tag points at (18bc71d "Add the parser") is merged.');
    const byId = ask(mergeConfirm(preview({ kind: "commit" }), "18bc71d", "main"));
    expect(byId.title).toBe("Merge 18bc71d into main?");
    expect(byId.text).toContain('"Add the parser"');
  });
  it("a detached HEAD merges into the current commit", () => {
    const d = ask(mergeConfirm(preview(), "feature", null));
    expect(d.title).toBe("Merge feature into the current commit?");
    expect(d.text).toContain("You are not on a branch, so the result belongs to no branch until you create one.");
  });
  it("words the notifications", () => {
    expect(mergeDone("no-ff", preview(), "feature", "main")).toBe("Merged feature into main");
    expect(mergeDone("ff-only", preview({ ahead: 0 }), "feature", "main")).toBe("main moved forward to feature (3 commits)");
    expect(mergeDone("no-ff", preview(), "18bc71d", "main")).toBe("Merged 18bc71d into main");
  });
});

describe("the rebase dialog", () => {
  it("says what is replayed, Cancel the default", () => {
    const d = ask(rebaseConfirm(preview(), "feature", "main"));
    expect(d.title).toBe("Rebase main onto feature?");
    expect(d.text).toContain("The 2 commits of main that feature does not have are replayed on top of feature one by one and get new ids.");
    expect(d.text).toContain("the rebase stops and Source Control shows the files to resolve");
    expect(d.choices.map((c) => [c.label, c.kind, !!c.default])).toEqual([["Rebase", "primary", false], ["Cancel", undefined, true]]);
  });
  it("nothing to rebase, or only a fast-forward", () => {
    expect(rebaseConfirm(preview({ behind: 0 }), "feature", "main")).toEqual({ nothing: "main is already based on feature: nothing to rebase." });
    // No commits of its own: a fast-forward, with no warning even though its commits are pushed.
    const ff = ask(rebaseConfirm(preview({ ahead: 0, pushed: 0 }), "feature", "main"));
    expect(ff.text).toContain("main has no commits of its own to replay, so it simply moves forward by 3 commits");
    expect(ff.choices.map((c) => [c.label, c.value, !!c.default])).toEqual([["Fast-forward", "ff", false], ["Cancel", null, true]]);
    expect(rebaseDone("ff", preview({ ahead: 0 }), "feature", "main")).toBe("main moved forward to feature (3 commits)");
  });
  it("says that merge commits are not kept", () => {
    const d = ask(rebaseConfirm(preview({ ahead: 4, merges: 1 }), "feature", "main"));
    expect(d.text).toContain("1 of them is a merge commit; a rebase does not keep it: the changes it brought in are replayed as ordinary commits.");
  });
  it("quotes the commit when rebasing onto an id", () => {
    const d = ask(rebaseConfirm(preview({ kind: "commit" }), "18bc71d", "main"));
    expect(d.title).toBe("Rebase main onto 18bc71d?");
    expect(d.text).toContain('"Add the parser"');
  });
  it("warns instead when commits to replay are already pushed", () => {
    const p = preview({ ahead: 5, pushed: 3, pushedOn: "origin/main", pushedCommits: [commitRef(1), commitRef(2), commitRef(3)] });
    const d = ask(rebaseConfirm(p, "feature", "main"));
    expect(d.title).toBe("Rebase commits that are already pushed?");
    expect(d.text).toContain("3 of the 5 commits to replay are already on origin/main:");
    expect(d.text).toContain("1111111  Commit 1\n2222222  Commit 2\n3333333  Commit 3");
    expect(d.text).toContain("main and origin/main will no longer agree");
    expect(d.text).toContain("A normal Push will be refused and Quarry will then offer Force Push");
    expect(d.text).toContain("will have to repair their copy");
    expect(d.text).toContain("Merging feature into main instead rewrites nothing.");
    expect(d.choices.map((c) => [c.label, c.kind, !!c.default])).toEqual([["Rebase Anyway", "danger", false], ["Cancel", undefined, true]]);
    expect(rebaseDone("rebase", p, "feature", "main")).toBe("Rebased main onto feature (5 commits replayed)");
    // Pushed somewhere other than the upstream: that branch is named.
    expect(ask(rebaseConfirm(preview({ pushed: 2, pushedOn: "backup/main", pushedCommits: [commitRef(1), commitRef(2)] }), "feature", "main")).text).toContain("already on backup/main");
  });
});

describe("the refusal for uncommitted changes", () => {
  it("is one dialog for merge, rebase and history edits, Close the default", () => {
    const d = dirtyRefusal("merge", 3);
    expect(d.title).toBe("Commit or discard your changes first");
    expect(d.text).toContain("There are 3 uncommitted changes to tracked files. A merge is only started from a clean state, so that Abort can bring everything back");
    expect(d.choices.map((c) => [c.label, !!c.default, !!c.cancel])).toEqual([["Show Source Control", false, false], ["Close", true, true]]);
    expect(dirtyRefusal("rebase", 1).text).toContain("There is 1 uncommitted change to tracked files. A rebase is only started");
    expect(dirtyRefusal("history", 2).text).toContain("A history edit is only started");
  });
});

describe("force push wording", () => {
  it("lists what the remote loses, at most 12 lines", () => {
    const commits = Array.from({ length: 20 }, (_, i) => commitRef(i + 1));
    expect(commitLines(commits).split("\n")).toHaveLength(13);
    expect(commitLines(commits)).toMatch(/\nand 8 more$/);
    // The count can exceed what was listed by git.
    expect(commitLines(commits.slice(0, 3), 3)).not.toContain("more");
    expect(commitLines(commits, 70)).toMatch(/\nand 58 more$/);
    const d = ask(forcePushConfirm({ branch: "main", upstream: "origin/main", lost: 3, commits: commits.slice(0, 3) }));
    expect(d.title).toBe("Replace origin/main with your main?");
    expect(d.text).toContain("The 3 commits that are only on origin/main will be removed from it:");
    expect(d.text).toContain("1111111  Commit 1");
    expect(d.text).toContain("Anyone who pulled them will have to repair their copy.");
    expect(d.choices.map((c) => [c.label, c.kind, !!c.default])).toEqual([["Force Push", "danger", false], ["Cancel", undefined, true]]);
    expect(forcePushConfirm({ branch: "main", upstream: "origin/main", lost: 0, commits: [] })).toEqual({ nothing: "origin/main has nothing to replace: use Push." });
    expect(forcePushDone({ branch: "main", upstream: "origin/main" })).toBe("Replaced origin/main with your main.");
  });
  it("needs a branch with an upstream, nothing stopped, nothing running", () => {
    const tracked = status({ upstream: "origin/main" });
    expect(forcePushBlocked(tracked)).toBeNull();
    expect(forcePushBlocked(status())).toBe("main has no remote branch to replace");
    expect(forcePushBlocked(status({ upstream: "origin/main", upstreamGone: true }))).toBe("main has no remote branch to replace");
    expect(forcePushBlocked(status({ branch: null, upstream: null }))).toBe("You are not on a branch");
    expect(forcePushBlocked(status({ upstream: "origin/main", operation: "rebase" }))).toBe("Finish or abort the rebase first");
    expect(forcePushBlocked(tracked, "Pulling…")).toBe("Another git action is running");
    expect(forcePushBlocked(null)).not.toBeNull();
  });
  it("the status line of a rewritten branch advises Force Push, never a pull", () => {
    expect(syncLine(0, 5, 3, "origin/main", "main")).toEqual({ kind: "warn", text: "main was rewritten: origin/main still has the 3 old commits. Force Push replaces them with yours." });
    expect(syncLine(2, 1, 1, "origin/main", "main").text).toBe("2 uncommitted changes. main was rewritten: origin/main still has the old commit. Force Push replaces it with yours.");
    // Nothing left on the remote to replace, or nothing rewritten: the ordinary lines.
    expect(syncLine(0, 5, 0, "origin/main", "main").text).toBe("5 commits to push to origin/main.");
    expect(syncLine(0, 2, 1, "origin/main").text).toBe("Diverged from origin/main: 2 commits to push, 1 to pull. Pull first, then push.");
  });
  it("the status line only offers it for the rewritten branch while the upstream has old commits", () => {
    const repo = status({ upstream: "origin/main", ahead: 5, behind: 3 });
    expect(isRewritten("main", repo)).toBe(true);
    expect(isRewritten(undefined, repo)).toBe(false);
    expect(isRewritten("main", { ...repo, branch: "feature" })).toBe(false);
    expect(isRewritten("main", { ...repo, behind: 0 })).toBe(false);
    expect(isRewritten("main", { ...repo, upstream: null })).toBe(false);
  });
});

// ---------- the actions ----------

/** What `git.status` answers; the mocked git commands change it like the real ones would. */
let now: GitStatus;
const dialog = () => useStore.getState().dialog;
const toasts = () => useStore.getState().toasts.map((t) => t.message);
const openDialog = () => vi.waitFor(() => { const d = dialog(); if (!d) throw new Error("no dialog yet"); return d; });
const press = (label: string) => {
  const a = dialog()?.actions.find((x) => x.label === label);
  if (!a) throw new Error(`no button ${label} in ${dialog()?.actions.map((x) => x.label)}`);
  a.run();
};
/** What Enter does on the open dialog. */
const defaultButton = () => dialog()?.actions.find((a) => a.default)?.label;

describe("starting a merge or rebase", () => {
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset();
    api.available.mockResolvedValue("git version 2.53.0");
    api.show.mockResolvedValue(null);
    now = status({ upstream: "origin/main", remotes: [{ name: "origin", url: "https://example.com/r.git" }] });
    api.status.mockImplementation(async () => now);
    api.mergePreview.mockResolvedValue(preview());
    api.merge.mockResolvedValue("");
    api.rebase.mockResolvedValue("");
    useStore.setState({ folder: ROOT, docs: [], toasts: [], dialog: null, sidebarVisible: false, pinnedPanels: [] });
    useGit.setState({ available: true, repos: { [KEY]: now }, current: KEY, busy: null, rewrotePushed: {}, branchPick: "switch", branches: null });
  });

  it("asks first: Cancel is the default and runs nothing", async () => {
    const done = startMerge(ROOT, "feature");
    const d = await openDialog();
    expect(d.title).toBe("Merge feature into main?");
    expect(defaultButton()).toBe("Cancel");
    press("Cancel");
    expect(await done).toBe(false);
    expect(api.merge).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });

  it("merges what the preview resolved and says so", async () => {
    const done = startMerge(ROOT, { ref: sha(1), label: "18bc71d", named: false });
    await openDialog();
    press("Merge");
    expect(await done).toBe(true);
    expect(api.mergePreview).toHaveBeenCalledWith(ROOT, sha(1));
    expect(api.merge).toHaveBeenCalledWith(ROOT, "refs/heads/feature", "no-ff");
    expect(toasts()).toEqual(["Merged 18bc71d into main"]);
  });

  it("offers the fast-forward choice and runs the one picked", async () => {
    api.mergePreview.mockResolvedValue(preview({ ahead: 0 }));
    const done = startMerge(ROOT, "feature");
    const d = await openDialog();
    expect(d.actions.map((a) => a.label)).toEqual(["Fast-forward", "Create a Merge Commit", "Cancel"]);
    expect(defaultButton()).toBe("Cancel");
    press("Fast-forward");
    expect(await done).toBe(true);
    expect(api.merge).toHaveBeenCalledWith(ROOT, "refs/heads/feature", "ff-only");
    expect(toasts()).toEqual(["main moved forward to feature (3 commits)"]);
  });

  it("says when there is nothing to merge, without a dialog", async () => {
    api.mergePreview.mockResolvedValue(preview({ behind: 0 }));
    expect(await startMerge(ROOT, "feature")).toBe(false);
    expect(dialog()).toBeNull();
    expect(api.merge).not.toHaveBeenCalled();
    expect(toasts()).toEqual(["main already contains feature: nothing to merge."]);
  });

  it("refuses with uncommitted changes to tracked files, and can show Source Control", async () => {
    now = { ...now, files: [file("a.txt"), file("b.txt"), file("c.txt", { index: "M", worktree: "." })] };
    const done = startMerge(ROOT, "feature");
    const d = await openDialog();
    expect(d.title).toBe("Commit or discard your changes first");
    expect(d.message).toContain("There are 3 uncommitted changes");
    expect(defaultButton()).toBe("Close");
    press("Show Source Control");
    expect(await done).toBe(false);
    expect(isPanelShown(useStore.getState(), "git")).toBe(true);
    expect(api.mergePreview).not.toHaveBeenCalled();
    expect(api.merge).not.toHaveBeenCalled();
    // The same refusal for a rebase.
    const again = startRebase(ROOT, "feature");
    expect((await openDialog()).message).toContain("A rebase is only started from a clean state");
    press("Close");
    expect(await again).toBe(false);
    expect(api.rebase).not.toHaveBeenCalled();
  });

  it("untracked files do not block", async () => {
    now = { ...now, files: [file("scratch.txt", { untracked: true, index: "?", worktree: "?" })] };
    const done = startMerge(ROOT, "feature");
    expect((await openDialog()).title).toBe("Merge feature into main?");
    press("Cancel");
    await done;
  });

  it("the hidden commands' path refuses during a stopped operation and on a detached HEAD", async () => {
    now = { ...now, operation: "rebase", branch: null };
    expect(await startMerge(ROOT, "feature")).toBe(false);
    expect(toasts()).toEqual(["Finish or abort the rebase first."]);
    useStore.setState({ toasts: [] });
    now = { ...now, operation: null, branch: null };
    expect(await startRebase(ROOT, "feature")).toBe(false);
    expect(toasts()).toEqual(["Switch to a branch first: a rebase moves a branch."]);
    expect(dialog()).toBeNull();
    expect(api.mergePreview).not.toHaveBeenCalled();
    expect(api.merge).not.toHaveBeenCalled();
    expect(api.rebase).not.toHaveBeenCalled();
  });

  it("the branch list does not open for a merge or rebase that cannot start", async () => {
    useGit.setState({ repos: { [KEY]: { ...now, operation: "merge" } } });
    await pickBranch("merge");
    expect(useStore.getState().palette).not.toBe("branch");
    expect(toasts()).toEqual(["Finish or abort the merge first."]);
  });

  it("a name that is no branch or commit is an error, with no dialog", async () => {
    api.mergePreview.mockRejectedValue('"feature" is not a branch or commit in this repository.');
    expect(await startMerge(ROOT, "feature")).toBe(false);
    expect(dialog()).toBeNull();
    expect(toasts()).toEqual(['"feature" is not a branch or commit in this repository.']);
  });

  it("a merge that stops on a conflict shows Source Control and no success message", async () => {
    api.merge.mockImplementation(async () => {
      now = { ...now, operation: "merge", files: [file("notes.txt", { conflicted: true, index: "U", worktree: "U" })] };
      throw "Auto-merging notes.txt\nCONFLICT (content): Merge conflict in notes.txt\nAutomatic merge failed; fix conflicts and then commit the result.";
    });
    const done = startMerge(ROOT, "feature");
    await openDialog();
    press("Merge");
    expect(await done).toBe(false);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatch(/^Stopped on a conflict\. Resolve the files under Merge Changes in Source Control and commit, or press Abort to go back\./);
    expect(toasts()[0]).toContain("CONFLICT (content): Merge conflict in notes.txt");
    expect(isPanelShown(useStore.getState(), "git")).toBe(true);
    expect(useGit.getState().repos[KEY].operation).toBe("merge");
  });

  it("a refusal by git (nothing in progress) leaves Source Control alone", async () => {
    api.merge.mockRejectedValue("fatal: refusing to merge unrelated histories\nhint: try something");
    const done = startMerge(ROOT, "imported");
    await openDialog();
    press("Merge");
    expect(await done).toBe(false);
    expect(toasts()).toEqual(["fatal: refusing to merge unrelated histories"]);
    expect(isPanelShown(useStore.getState(), "git")).toBe(false);
  });

  it("a rebase with nothing of its own to replay is a fast-forward", async () => {
    api.mergePreview.mockResolvedValue(preview({ ahead: 0 }));
    const done = startRebase(ROOT, "feature");
    const d = await openDialog();
    expect(d.actions.map((a) => a.label)).toEqual(["Fast-forward", "Cancel"]);
    press("Fast-forward");
    expect(await done).toBe(true);
    expect(api.rebase).not.toHaveBeenCalled();
    expect(api.merge).toHaveBeenCalledWith(ROOT, "refs/heads/feature", "ff-only");
    expect(toasts()).toEqual(["main moved forward to feature (3 commits)"]);
    expect(useGit.getState().rewrotePushed).toEqual({});
  });

  it("an ordinary rebase leaves no Force Push offer", async () => {
    api.rebase.mockImplementation(async () => {
      now = { ...now, ahead: 5, behind: 0 };
      return "";
    });
    const done = startRebase(ROOT, "feature");
    expect((await openDialog()).title).toBe("Rebase main onto feature?");
    expect(defaultButton()).toBe("Cancel");
    press("Rebase");
    expect(await done).toBe(true);
    expect(api.rebase).toHaveBeenCalledWith(ROOT, "refs/heads/feature");
    expect(toasts()).toEqual(["Rebased main onto feature (2 commits replayed)"]);
    expect(useGit.getState().rewrotePushed).toEqual({});
  });
});

describe("rewriting pushed commits and Force Push", () => {
  const pushed = preview({ ahead: 5, pushed: 3, pushedOn: "origin/main", pushedCommits: [commitRef(1), commitRef(2), commitRef(3)] });
  const rewritten = () => isRewritten(useGit.getState().rewrotePushed[KEY], useGit.getState().repos[KEY]);
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset();
    api.available.mockResolvedValue("git version 2.53.0");
    api.show.mockResolvedValue(null);
    now = status({ upstream: "origin/main", remotes: [{ name: "origin", url: "https://example.com/r.git" }] });
    api.status.mockImplementation(async () => now);
    api.mergePreview.mockResolvedValue(pushed);
    api.rebase.mockImplementation(async () => {
      now = { ...now, ahead: 8, behind: 3 }; // origin/main still has the 3 old commits
      return "";
    });
    api.forcePushPreview.mockImplementation(async () => ({ branch: "main", upstream: "origin/main", lost: now.behind, commits: pushed.pushedCommits.slice(0, now.behind) }));
    api.remote.mockImplementation(async () => {
      now = { ...now, ahead: 0, behind: 0 };
      return "";
    });
    useStore.setState({ folder: ROOT, docs: [], toasts: [], dialog: null, sidebarVisible: false, pinnedPanels: [] });
    useGit.setState({ available: true, repos: { [KEY]: now }, current: KEY, busy: null, rewrotePushed: {}, remoteCheck: {} });
  });

  it("Cancel is the default of the warning and nothing runs", async () => {
    const done = startRebase(ROOT, "feature");
    const d = await openDialog();
    expect(d.title).toBe("Rebase commits that are already pushed?");
    expect(d.actions.map((a) => [a.label, a.kind])).toEqual([["Rebase Anyway", "danger"], ["Cancel", undefined]]);
    expect(defaultButton()).toBe("Cancel");
    press("Cancel");
    expect(await done).toBe(false);
    expect(api.rebase).not.toHaveBeenCalled();
    expect(rewritten()).toBe(false);
  });

  it("Rebase Anyway pushes nothing and marks the branch as rewritten", async () => {
    const done = startRebase(ROOT, "feature");
    await openDialog();
    press("Rebase Anyway");
    expect(await done).toBe(true);
    expect(toasts()).toEqual(["Rebased main onto feature (5 commits replayed)"]);
    expect(api.remote).not.toHaveBeenCalled();
    expect(useGit.getState().rewrotePushed).toEqual({ [KEY]: "main" });
    expect(rewritten()).toBe(true);
    // Switching branch, or an upstream with nothing left to replace, drops the mark.
    useGit.setState({ repos: { [KEY]: { ...now, branch: "feature" } } });
    expect(useGit.getState().rewrotePushed).toEqual({});
  });

  it("no upstream: nothing to replace, so no mark", async () => {
    now = { ...now, upstream: null };
    api.mergePreview.mockResolvedValue({ ...pushed, pushedOn: "backup/main" });
    api.rebase.mockResolvedValue("");
    const done = startRebase(ROOT, "feature");
    expect((await openDialog()).message).toContain("already on backup/main");
    press("Rebase Anyway");
    expect(await done).toBe(true);
    expect(useGit.getState().rewrotePushed).toEqual({});
  });

  it("a rebase of pushed commits that stops is only marked once Continue finishes it; Abort forgets it", async () => {
    const stop = async () => {
      now = { ...now, operation: "rebase", branch: null, operationStep: [1, 5] };
      throw "CONFLICT (content): Merge conflict in notes.txt\nerror: could not apply 1111111... Commit 1";
    };
    api.rebase.mockImplementation(stop);
    let done = startRebase(ROOT, "feature");
    await openDialog();
    press("Rebase Anyway");
    expect(await done).toBe(false);
    expect(isPanelShown(useStore.getState(), "git")).toBe(true);
    expect(useGit.getState().rewrotePushed).toEqual({});
    // Aborted: nothing was rewritten.
    api.abort.mockImplementation(async () => {
      now = { ...now, operation: null, branch: "main", operationStep: null };
      return "rebase";
    });
    await abortOperation(ROOT, "rebase");
    // Even when the branch later differs from its upstream and some other operation is continued.
    now = { ...now, ahead: 1, behind: 1 };
    api.continueOp.mockImplementation(async () => "rebase");
    await continueOperation(ROOT, "rebase", "continue");
    expect(useGit.getState().rewrotePushed).toEqual({});

    // Again, and this time continued to the end.
    done = startRebase(ROOT, "feature");
    await openDialog();
    press("Rebase Anyway");
    expect(await done).toBe(false);
    api.continueOp.mockImplementation(async () => {
      now = { ...now, operation: null, branch: "main", operationStep: null, ahead: 8, behind: 3 };
      return "rebase";
    });
    await continueOperation(ROOT, "rebase", "continue");
    expect(useGit.getState().rewrotePushed).toEqual({ [KEY]: "main" });
    expect(rewritten()).toBe(true);
  });

  it("Force Push asks on its own, Cancel the default, and clears the mark when it went through", async () => {
    now = { ...now, ahead: 8, behind: 3 };
    useGit.setState({ repos: { [KEY]: now }, rewrotePushed: { [KEY]: "main" } });
    let done = forcePush(ROOT);
    const d = await openDialog();
    expect(d.title).toBe("Replace origin/main with your main?");
    expect(d.message).toContain("The 3 commits that are only on origin/main will be removed from it:");
    expect(d.actions.map((a) => [a.label, a.kind])).toEqual([["Force Push", "danger"], ["Cancel", undefined]]);
    expect(defaultButton()).toBe("Cancel");
    press("Cancel");
    expect(await done).toBe(false);
    expect(api.remote).not.toHaveBeenCalled();
    expect(rewritten()).toBe(true);

    done = forcePush(ROOT);
    await openDialog();
    press("Force Push");
    expect(await done).toBe(true);
    expect(api.remote).toHaveBeenCalledWith(ROOT, "push-force");
    expect(toasts()).toEqual(["Replaced origin/main with your main."]);
    expect(useGit.getState().rewrotePushed).toEqual({});
  });

  it("a refused force push keeps the offer and shows why", async () => {
    now = { ...now, ahead: 8, behind: 3 };
    useGit.setState({ repos: { [KEY]: now }, rewrotePushed: { [KEY]: "main" } });
    api.remote.mockRejectedValue("origin/main has commits you have not fetched. Fetch and look at them first.");
    const done = forcePush(ROOT);
    await openDialog();
    press("Force Push");
    expect(await done).toBe(false);
    expect(toasts()).toEqual(["origin/main has commits you have not fetched. Fetch and look at them first."]);
    expect(rewritten()).toBe(true);
  });

  it("nothing to replace, no upstream, or a stopped operation: nothing is forced", async () => {
    expect(await forcePush(ROOT)).toBe(false); // behind is 0
    expect(toasts()).toEqual(["origin/main has nothing to replace: use Push."]);
    useStore.setState({ toasts: [] });
    now = { ...now, upstream: null };
    expect(await forcePush(ROOT)).toBe(false);
    expect(toasts()).toEqual(["main has no remote branch to replace."]);
    useStore.setState({ toasts: [] });
    now = { ...now, upstream: "origin/main", operation: "merge" };
    expect(await forcePush(ROOT)).toBe(false);
    expect(toasts()).toEqual(["Finish or abort the merge first."]);
    expect(dialog()).toBeNull();
    expect(api.remote).not.toHaveBeenCalled();
  });
});
