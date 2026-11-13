import { describe, expect, it } from "vitest";
import { commitLabel, displayUrl, gitErrorText, hasConflictMarkers, isMissingRepo, remoteWebUrl, repoNameFor, syncLine } from "../lib/gitStatus";

describe("remote URLs", () => {
  it("finds the web page of https and ssh remotes", () => {
    expect(remoteWebUrl("https://github.com/ada/demo.git")).toBe("https://github.com/ada/demo");
    expect(remoteWebUrl("https://ada:tok@github.com/ada/demo")).toBe("https://github.com/ada/demo");
    expect(remoteWebUrl("git@github.com:ada/demo.git")).toBe("https://github.com/ada/demo");
    expect(remoteWebUrl("ssh://git@gitlab.com/group/sub/demo.git")).toBe("https://gitlab.com/group/sub/demo");
    expect(remoteWebUrl("C:\\repos\\demo.git")).toBeNull();
  });

  it("hides a token in a URL", () => {
    expect(displayUrl("https://ada:ghp_secret@github.com/ada/demo.git")).toBe("https://github.com/ada/demo.git");
    expect(displayUrl("git@github.com:ada/demo.git")).toBe("git@github.com:ada/demo.git");
  });

  it("names a new GitHub repository after the folder", () => {
    expect(repoNameFor("C:\\coding_projects\\Quarry")).toBe("Quarry");
    expect(repoNameFor("C:\\work\\My Project (old)\\")).toBe("My-Project-old");
    expect(repoNameFor("D:\\ü")).toBe("repository");
  });

  it("recognises a remote repository that isn't there", () => {
    expect(isMissingRepo("remote: Repository not found.\nfatal: repository 'https://github.com/smspgh/Quarry.git/' not found")).toBe(true);
    expect(isMissingRepo("fatal: 'C:\\repos\\gone.git' does not appear to be a git repository")).toBe(true);
    expect(isMissingRepo("fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com")).toBe(false);
    expect(isMissingRepo(null)).toBe(false);
  });
});

describe("source control status line", () => {
  it("never calls a branch with uncommitted work up to date", () => {
    expect(syncLine(0, 0, 0, "origin/main")).toEqual({ kind: "ok", text: "Everything is committed and matches origin/main." });
    expect(syncLine(14, 0, 0, "origin/main")).toEqual({ kind: "local", text: "14 uncommitted changes. Your commits match origin/main." });
    expect(syncLine(1, 2, 0, "origin/main")).toEqual({ kind: "todo", text: "1 uncommitted change, 2 commits to push to origin/main." });
    expect(syncLine(0, 0, 1, "origin/main")).toEqual({ kind: "todo", text: "1 commit to pull from origin/main." });
    expect(syncLine(3, 1, 2, "origin/main").kind).toBe("warn");
    expect(syncLine(3, 1, 2, "origin/main").text).toBe("3 uncommitted changes. Diverged from origin/main: 1 commit to push, 2 to pull. Pull first, then push.");
  });
  it("labels the commit button with what it takes", () => {
    expect(commitLabel(0, 14, false)).toBe("Commit All (14 files)");
    expect(commitLabel(3, 14, false)).toBe("Commit 3 Staged");
    expect(commitLabel(0, 1, false)).toBe("Commit All (1 file)");
    expect(commitLabel(0, 0, false)).toBe("Commit All");
    expect(commitLabel(3, 14, true)).toBe("Amend Last Commit");
  });
});

describe("git error text", () => {
  it("drops hint lines and explains a conflict", () => {
    const raw = "Error: CONFLICT (modify/delete): exp.txt deleted in HEAD and modified in 18bc71d (Experiment B).  Version 18bc71d (Experiment B) of exp.txt left in tree.\nerror: could not apply 18bc71d... Experiment B\nhint: After resolving the conflicts, mark them with\nhint: \"git add/rm <pathspec>\", then run\nhint: \"git cherry-pick --continue\".";
    const text = gitErrorText(raw);
    expect(text).toMatch(/^Stopped on a conflict\. Resolve the files under Merge Changes/);
    expect(text).toContain("CONFLICT (modify/delete): exp.txt");
    expect(text).not.toMatch(/hint:|cherry-pick --continue|could not apply/);
  });
  it("keeps other errors, minus hints and the Error: prefix", () => {
    expect(gitErrorText("Error: fatal: a branch named 'x' already exists\nhint: use -f")).toBe("fatal: a branch named 'x' already exists");
    expect(gitErrorText("plain")).toBe("plain");
  });
});

describe("conflicts", () => {
  it("spots conflict markers only when both ends start a line", () => {
    expect(hasConflictMarkers("a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> 18bc71d (Experiment B)\nb")).toBe(true);
    expect(hasConflictMarkers("a\r\n<<<<<<< HEAD\r\nx\r\n=======\r\ny\r\n>>>>>>> other\r\n")).toBe(true);
    expect(hasConflictMarkers("resolved text")).toBe(false);
    expect(hasConflictMarkers("a heading\n=======\n")).toBe(false);
    expect(hasConflictMarkers("say <<<<<<< in a sentence >>>>>>> here")).toBe(false);
    expect(hasConflictMarkers("<<<<<<<< eight is not a marker\n>>>>>>>> either")).toBe(false);
  });
  it("turns the commit button into what is in the way", () => {
    expect(commitLabel(0, 3, false, 1)).toBe("Resolve 1 Conflict First");
    expect(commitLabel(2, 3, true, 2)).toBe("Resolve 2 Conflicts First");
  });
});

describe("commit button during a rebase", () => {
  it("continues instead of committing, once conflicts are gone", () => {
    expect(commitLabel(0, 0, false, 0, "rebase")).toBe("Continue Rebase");
    expect(commitLabel(1, 1, false, 2, "rebase")).toBe("Resolve 2 Conflicts First");
    expect(commitLabel(1, 1, false, 0, "cherry-pick")).toBe("Commit 1 Staged");
  });
});
