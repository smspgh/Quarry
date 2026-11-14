import { describe, expect, it } from "vitest";
import type { GitBranch, GitTag } from "../lib/gitApi";
import { defaultRemote, deleteQuestion, housekeepingPrompt, housekeepingRows, isHousekeeping, isNotMerged, pushLabel, pushRejected, pushTarget, refDone, rejectedDialog, remoteDeleteQuestion, remotePlace, renameCheck, splitRemoteRef, tagDeleteQuestion, tagRejected, tagRejectedText, unmergedQuestion } from "../lib/gitBranches";

// Branch and tag housekeeping, the pure part (specs/git-branches.md).
const branch = (name: string, extra: Partial<GitBranch> = {}): GitBranch => ({ name, remote: false, current: false, upstream: null, sha: "0".repeat(7), time: 0, summary: "", ...extra });
const tag = (name: string): GitTag => ({ name, sha: "1a2b3c4", time: 0, summary: "" });
const info = (extra = {}) => ({ name: "feature", sha: "1a2b3c4", base: "main" as string | null, baseSha: "9f2c0aa" as string | null, unmerged: 0, ...extra });
const defaults = (a: { choices: { label: string; default?: boolean; cancel?: boolean }[] }) => a.choices.filter((c) => c.default).map((c) => c.label);

describe("which remote", () => {
  it("splits a remote branch by the longest remote name", () => {
    expect(splitRemoteRef("origin/topic", ["origin"])).toEqual({ remote: "origin", branch: "topic" });
    expect(splitRemoteRef("backup/feature/login", ["origin", "backup"])).toEqual({ remote: "backup", branch: "feature/login" });
    expect(splitRemoteRef("team/a/x", ["team", "team/a"])).toEqual({ remote: "team/a", branch: "x" });
    expect(splitRemoteRef("feature/login", ["origin"])).toBeNull();
    expect(splitRemoteRef("origin/", ["origin"])).toBeNull();
    // Remotes not known (yet): the part before the first slash.
    expect(splitRemoteRef("origin/feature/login", [])).toEqual({ remote: "origin", branch: "feature/login" });
  });
  it("a push goes to the upstream, else origin, else the first remote", () => {
    expect(pushTarget("feature", "origin/feature", ["origin"])).toEqual({ remote: "origin", to: "origin/feature", branch: "origin/feature", tracked: true });
    expect(pushTarget("feature", "origin/review", ["backup", "origin"])).toMatchObject({ remote: "origin", to: "origin/review", tracked: true });
    expect(pushTarget("feature", null, ["origin", "backup"])).toEqual({ remote: "origin", to: "origin", branch: "origin/feature", tracked: false });
    expect(pushTarget("feature", null, ["backup", "origin"]).to).toBe("origin");
    expect(pushTarget("feature", undefined, ["backup", "work"])).toMatchObject({ remote: "backup", to: "backup", branch: "backup/feature" });
    expect(pushTarget("feature", null, [])).toEqual({ remote: null, to: null, branch: null, tracked: false });
    // An upstream that is another local branch is not a remote to push to.
    expect(pushTarget("feature", "main", ["origin"])).toMatchObject({ remote: "origin", to: "origin", tracked: false });
    expect([defaultRemote(["backup", "origin"]), defaultRemote(["backup", "work"]), defaultRemote([])]).toEqual(["origin", "backup", null]);
  });
  it("the entry always names where it goes", () => {
    expect(pushLabel("feature", "origin")).toBe("Push feature to origin");
    expect(pushLabel("main", "origin/main")).toBe("Push main to origin/main");
    expect(pushLabel("v1.2.0", null)).toBe("Push v1.2.0…");
  });
  it("shows a remote's address without scheme, .git or token", () => {
    expect(remotePlace("https://github.com/acme/app.git")).toBe("github.com/acme/app");
    expect(remotePlace("https://ada:tok@github.com/acme/app.git")).toBe("github.com/acme/app");
    expect(remotePlace("git@github.com:acme/app.git")).toBe("github.com/acme/app");
    expect(remotePlace("C:\\repos\\app.git")).toBe("C:\\repos\\app.git");
    expect(remotePlace(null)).toBe("");
  });
});

describe("the questions before a delete", () => {
  it("a merged branch: one question, Cancel is the default", () => {
    const q = deleteQuestion(info());
    expect(q.title).toBe('Delete branch "feature"?');
    expect(q.text).toBe('All its commits are in "main", so nothing is lost. The branch on a remote, if there is one, is not touched.');
    expect(q.choices.map((c) => c.label)).toEqual(["Delete Branch", "Cancel"]);
    expect(defaults(q)).toEqual(["Cancel"]);
    expect(q.choices[1].cancel).toBe(true);
    expect(deleteQuestion(info({ name: "review", base: "origin/review" })).text).toContain('All its commits are in "origin/review", so nothing is lost.');
  });
  it("an unmerged branch: the first question says a second follows, the second is the danger one", () => {
    const i = info({ name: "experiment", sha: "9f8e7d6", unmerged: 2 });
    expect(deleteQuestion(i).text).toBe('2 commits on "experiment" are not in "main": you are asked once more before they are lost. The branch on a remote, if there is one, is not touched.');
    const q = unmergedQuestion(i);
    expect(q.title).toBe('Delete "experiment" and lose 2 commits?');
    expect(q.text).toBe('2 commits on "experiment" are not in "main". Deleting the branch leaves them on no branch. Its last commit is 9f8e7d6, should you need it back.');
    expect(q.choices.map((c) => [c.label, c.kind])).toEqual([["Delete Anyway", "danger"], ["Cancel", undefined]]);
    expect(defaults(q)).toEqual(["Cancel"]);
    const one = unmergedQuestion(info({ name: "review", base: "origin/review", unmerged: 1 }));
    expect(one.title).toBe('Delete "review" and lose 1 commit?');
    expect(one.text).toContain('1 commit on "review" is not in "origin/review". Deleting the branch leaves it on no branch.');
  });
  it("a detached HEAD is named as the commit you are on", () => {
    expect(unmergedQuestion(info({ base: null, baseSha: "1a2b3c4", unmerged: 3 })).text).toContain('3 commits on "feature" are not in the commit you are on (1a2b3c4).');
    expect(deleteQuestion(info({ base: null, baseSha: "1a2b3c4" })).text).toContain("All its commits are in the commit you are on (1a2b3c4)");
  });
  it("git refused the safe delete but nothing is counted: still a danger question", () => {
    const q = unmergedQuestion(info({ unmerged: 0 }));
    expect(q.title).toBe('Delete "feature" anyway?');
    expect(defaults(q)).toEqual(["Cancel"]);
  });
  it("a remote branch: names the remote, its address and the commits found nowhere else", () => {
    const q = remoteDeleteQuestion("origin", "topic", "https://github.com/acme/app.git", 0);
    expect(q.title).toBe('Delete "topic" from origin?');
    expect(q.text).toBe('This deletes the branch "topic" in the remote repository origin (github.com/acme/app), for everyone who uses it. Your local branches are kept.');
    expect(q.choices.map((c) => [c.label, c.kind])).toEqual([["Delete from origin", "danger"], ["Cancel", undefined]]);
    expect(defaults(q)).toEqual(["Cancel"]);
    expect(remoteDeleteQuestion("origin", "topic", null, 3).text).toMatch(/remote repository origin, for everyone.*\n\n3 commits are only on origin\/topic \(as of the last fetch\)\. They are lost unless someone else has them\.$/s);
    expect(remoteDeleteQuestion("backup", "feature/login", null, 1).text).toContain("1 commit is only on backup/feature/login (as of the last fetch). It is lost unless someone else has it.");
  });
  it("a tag: local only, and says so", () => {
    const q = tagDeleteQuestion("v1.2.0", "18bc71d");
    expect(q.title).toBe('Delete tag "v1.2.0"?');
    expect(q.text).toBe("Removes the tag from this computer. The commit 18bc71d and its branch are not changed. If the tag was pushed, the remote keeps its copy.");
    expect(q.choices.map((c) => c.label)).toEqual(["Delete Tag", "Cancel"]);
    expect(defaults(q)).toEqual(["Cancel"]);
  });
});

describe("what is said afterwards", () => {
  it("notifications", () => {
    expect(refDone({ what: "branch-deleted", name: "feature", was: "1a2b3c4" })).toBe("Deleted branch feature (was 1a2b3c4)");
    expect(refDone({ what: "tag-deleted", name: "v1.2.0", was: "18bc71d" })).toBe("Deleted tag v1.2.0 (was 18bc71d)");
    expect(refDone({ what: "renamed", name: "fix", to: "fix-login-timeout", upstream: "", remotes: ["origin"] })).toBe("Renamed fix to fix-login-timeout");
    expect(refDone({ what: "renamed", name: "fix", to: "fix-login-timeout", upstream: "origin/fix", remotes: ["origin"] })).toBe("Renamed fix to fix-login-timeout. It still tracks origin/fix; the branch on origin keeps its name.");
    expect(refDone({ what: "upstream", name: "feature", upstream: "origin/feature" })).toBe("feature now tracks origin/feature");
    expect(refDone({ what: "upstream", name: "feature", upstream: null })).toBe("feature no longer tracks a remote branch");
    expect(refDone({ what: "pushed", name: "feature", result: { remote: "origin", upToDate: false, tracking: null } })).toBe("Pushed feature to origin");
    expect(refDone({ what: "pushed", name: "feature", result: { remote: "origin", upToDate: false, tracking: "origin/feature" } })).toBe("Pushed feature to origin; it now tracks origin/feature");
    expect(refDone({ what: "pushed", name: "feature", result: { remote: "origin", upToDate: true, tracking: null } })).toBe("feature is already up to date on origin");
    expect(refDone({ what: "tag-pushed", name: "v1.2.0", result: { remote: "origin", upToDate: false, tracking: null } })).toBe("Pushed tag v1.2.0 to origin");
    expect(refDone({ what: "tag-pushed", name: "v1.2.0", result: { remote: "origin", upToDate: true, tracking: null } })).toBe("v1.2.0 is already on origin");
    expect(refDone({ what: "remote-deleted", result: { remote: "origin", branch: "topic", was: "4c5d6e7", gone: false } })).toBe("Deleted topic from origin (was 4c5d6e7)");
    expect(refDone({ what: "remote-deleted", result: { remote: "origin", branch: "topic", was: "4c5d6e7", gone: true } })).toBe("topic was already gone from origin");
  });
  it("recognises a rejected push, and a tag the remote has elsewhere", () => {
    const branchErr = "To C:/x.git\n ! [rejected]        feature -> feature (fetch first)\nerror: failed to push some refs to 'C:/x.git'\nhint: Updates were rejected because the remote contains work that you do not";
    const tagErr = "To C:/x.git\n ! [rejected]        v1.2.0 -> v1.2.0 (already exists)\nerror: failed to push some refs to 'C:/x.git'\nhint: Updates were rejected because the tag already exists in the remote.";
    expect([pushRejected(branchErr), tagRejected(branchErr)]).toEqual([true, false]);
    expect([pushRejected(tagErr), tagRejected(tagErr)]).toEqual([false, true]);
    expect(pushRejected(" ! [rejected] main -> main (non-fast-forward)")).toBe(true);
    expect(pushRejected("fatal: unable to access 'https://x/': Could not resolve host")).toBe(false);
    expect(tagRejectedText("origin", "v1.2.0", "! [rejected] v1.2.0")).toBe("origin already has a tag v1.2.0 on another commit. Quarry does not overwrite tags on a remote.\n\n! [rejected] v1.2.0");
    expect([isNotMerged("NOT_MERGED"), isNotMerged("Error: NOT_MERGED"), isNotMerged("error: something else")]).toEqual([true, true, false]);
  });
  it("the rejection dialog offers the way out, with Close as the default", () => {
    const d = rejectedDialog("origin", "feature", "origin/feature", false, "! [rejected] feature -> feature (fetch first)");
    expect(d.title).toBe("origin did not accept feature");
    expect(d.text).toBe('origin/feature has commits that "feature" does not have. Switch to "feature" and pull, then push again.\n\n! [rejected] feature -> feature (fetch first)');
    expect(d.choices.map((c) => c.label)).toEqual(["Switch to feature", "Close"]);
    expect(defaults(d)).toEqual(["Close"]);
    const here = rejectedDialog("origin", "main", "origin/main", true, "x");
    expect(here.text).toContain('origin/main has commits that "main" does not have. Pull, then push again.');
    expect(here.choices.map((c) => c.label)).toEqual(["Pull", "Close"]);
  });
});

describe("rename check", () => {
  const existing = ["fix", "main", "Feature"];
  it("an empty or unchanged name is not a rename, and says nothing", () => {
    expect(renameCheck("fix", "", existing)).toEqual({ name: "", ok: false, error: null });
    expect(renameCheck("fix", "  fix ", existing)).toEqual({ name: "fix", ok: false, error: null });
  });
  it("a taken name is refused; a change of letter case is not taken", () => {
    expect(renameCheck("fix", "main", existing)).toEqual({ name: "main", ok: false, error: 'A branch named "main" already exists.' });
    expect(renameCheck("fix", "MAIN", existing).error).toBe('A branch named "main" already exists.');
    expect(renameCheck("Feature", "feature", existing)).toEqual({ name: "feature", ok: true, error: null });
    expect(renameCheck("fix", "fix-login-timeout", existing).ok).toBe(true);
  });
  it("the picker turns spaces into hyphens; the graph's strip leaves the name to git", () => {
    expect(renameCheck("fix", "fix login  timeout", existing, true).name).toBe("fix-login-timeout");
    expect(renameCheck("fix", "bad name", existing).name).toBe("bad name");
  });
});

describe("the picker's housekeeping lists", () => {
  const branches = [branch("feature"), branch("main", { current: true, upstream: "origin/main" }), branch("old-idea"), branch("origin/main", { remote: true }), branch("origin/topic", { remote: true }), branch("origin/feature", { remote: true })];
  const data = (extra = {}) => ({ branches, tags: [tag("v1.1"), tag("v1.0")], remotes: ["origin"], query: "", ...extra });
  const names = (rows: { title: string }[]) => rows.map((r) => r.title);

  it("knows its purposes and prompts", () => {
    expect([isHousekeeping("delete-branch"), isHousekeeping("new-name"), isHousekeeping("switch"), isHousekeeping("merge")]).toEqual([true, true, false, false]);
    expect(housekeepingPrompt("delete-branch", { command: "git.deleteBranch" })).toBe("Delete which branch?");
    expect(housekeepingPrompt("local-branch", { command: "git.renameBranch" })).toBe("Rename which branch?");
    expect(housekeepingPrompt("local-branch", { command: "git.setUpstream" })).toBe("Set the upstream of which branch?");
    expect(housekeepingPrompt("local-branch", { command: "git.pushBranch" })).toBe("Push which branch?");
    expect(housekeepingPrompt("remote-branch", { command: "git.deleteRemoteBranch" })).toBe("Delete which branch on the remote?");
    expect(housekeepingPrompt("tag", { command: "git.deleteTag" })).toBe("Delete which tag?");
    expect(housekeepingPrompt("tag", { command: "git.pushTag", remote: "origin" })).toBe("Push which tag to origin?");
    expect(housekeepingPrompt("upstream", { command: "git.setUpstream", target: "feature" })).toBe('Which remote branch should "feature" track?');
    expect(housekeepingPrompt("new-name", { command: "git.renameBranch", target: "fix" })).toBe('New name for "fix"…');
  });
  it("Delete Branch…: local branches without the current one", () => {
    const r = housekeepingRows("delete-branch", { command: "git.deleteBranch" }, data());
    expect(names(r.rows)).toEqual(["feature", "old-idea"]);
    expect(r.rows[0]).toMatchObject({ command: "git.deleteBranch", arg: { name: "feature" } });
    expect(housekeepingRows("delete-branch", { command: "git.deleteBranch" }, data({ branches: [branch("main", { current: true })] }))).toMatchObject({ rows: [], empty: "There is no other branch to delete" });
  });
  it("Rename / Set Upstream / Push Branch…: every local branch, the current one first", () => {
    const r = housekeepingRows("local-branch", { command: "git.pushBranch", root: "C:\\r" }, data());
    expect(r.rows.map((x) => [x.category, x.title])).toEqual([["current", "main"], ["", "feature"], ["", "old-idea"]]);
    expect(r.rows[1].arg).toEqual({ name: "feature", root: "C:\\r" });
  });
  it("Delete Remote Branch…: remote branches only", () => {
    const r = housekeepingRows("remote-branch", { command: "git.deleteRemoteBranch" }, data());
    expect(names(r.rows)).toEqual(["origin/main", "origin/topic", "origin/feature"]);
    expect(housekeepingRows("remote-branch", { command: "git.deleteRemoteBranch" }, data({ branches: [branch("main")] })).empty).toBe("This repository has no remote branches");
  });
  it("Delete Tag… / Push Tag…: tags only, in the order given (newest first)", () => {
    const r = housekeepingRows("tag", { command: "git.pushTag" }, data());
    expect(names(r.rows)).toEqual(["v1.1", "v1.0"]);
    expect(r.rows[0]).toMatchObject({ command: "git.pushTag", arg: { name: "v1.1" } });
    expect(housekeepingRows("tag", { command: "git.deleteTag" }, data({ tags: [] }))).toMatchObject({ rows: [], empty: "This repository has no tags" });
  });
  it("Set Upstream…: the remote branch of the same name first; no local branches", () => {
    const r = housekeepingRows("upstream", { command: "git.setUpstream", target: "feature" }, data());
    expect(names(r.rows)).toEqual(["origin/feature", "origin/main", "origin/topic"]);
    expect(r.rows[0]).toMatchObject({ command: "git.setUpstream", arg: { name: "feature", upstream: "origin/feature" }, category: "" });
  });
  it("Set Upstream… on a tracking branch: a Stop tracking row first, the tracked one labelled", () => {
    const r = housekeepingRows("upstream", { command: "git.setUpstream", target: "main" }, data());
    expect(r.rows.map((x) => [x.category, x.title])).toEqual([["", 'Stop tracking "origin/main"'], ["tracking", "origin/main"], ["", "origin/topic"], ["", "origin/feature"]]);
    expect(r.rows[0].arg).toEqual({ name: "main", upstream: null });
  });
  it("Set Upstream… with a remote but no remote branches: offers to push and track", () => {
    const r = housekeepingRows("upstream", { command: "git.setUpstream", target: "feature" }, data({ branches: [branch("feature"), branch("main", { current: true })] }));
    expect(r.note).toBe("No remote branches yet");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ title: 'Push "feature" to origin and track it', command: "git.pushBranch", arg: { name: "feature" }, fixed: true });
  });
  it("New name: the one row is the rename, spaces become hyphens", () => {
    const pick = { command: "git.renameBranch", target: "feature" };
    expect(housekeepingRows("new-name", pick, data({ query: "feature" }))).toMatchObject({ rows: [], empty: 'Type a new name for "feature"' });
    expect(housekeepingRows("new-name", pick, data({ query: "" })).rows).toEqual([]);
    const r = housekeepingRows("new-name", pick, data({ query: "feature login timeout" }));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ title: 'Rename "feature" to "feature-login-timeout"', command: "git.renameBranch", arg: { name: "feature", to: "feature-login-timeout" } });
    expect(housekeepingRows("new-name", pick, data({ query: "main" }))).toMatchObject({ rows: [], empty: 'A branch named "main" already exists.' });
  });
});
