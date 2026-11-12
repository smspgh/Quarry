import { describe, expect, it } from "vitest";
import { displayUrl, isMissingRepo, remoteWebUrl, repoNameFor } from "../lib/gitStatus";

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
