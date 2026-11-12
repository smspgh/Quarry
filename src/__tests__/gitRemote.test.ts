import { describe, expect, it } from "vitest";
import { commitLabel, displayUrl, isMissingRepo, remoteWebUrl, repoNameFor, syncLine } from "../lib/gitStatus";

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
