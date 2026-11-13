import { describe, expect, it } from "vitest";
import { nextChangeIndex, statusBarBranch } from "../lib/gitStatus";
import type { GitFile } from "../lib/gitApi";

describe("next / previous change", () => {
  const starts = [10, 40, 90];
  it("goes to the next change after the cursor line", () => {
    expect(starts[nextChangeIndex(starts, 12, 1)]).toBe(40);
    expect(starts[nextChangeIndex(starts, 10, 1)]).toBe(40); // on a change: the one after it
  });
  it("goes to the previous change before the cursor line", () => {
    expect(starts[nextChangeIndex(starts, 50, -1)]).toBe(40);
    expect(starts[nextChangeIndex(starts, 40, -1)]).toBe(10);
  });
  it("wraps around at either end", () => {
    expect(starts[nextChangeIndex(starts, 95, 1)]).toBe(10);
    expect(starts[nextChangeIndex(starts, 5, -1)]).toBe(90);
  });
  it("has nowhere to go without changes", () => {
    expect(nextChangeIndex([], 1, 1)).toBe(-1);
  });
});

describe("status bar branch", () => {
  const file = { path: "C:\\r\\a.ts" } as GitFile;
  const repo = { root: "C:\\r", branch: "main", head: "1a2b3c4", upstream: "origin/main", ahead: 3, behind: 1, files: [file, file] };

  it("shows the branch, changes and counts", () => {
    expect(statusBarBranch(repo, null)).toEqual({
      text: "main* ↓1 ↑3",
      title: "C:\\r\nBranch main, tracking origin/main (3 to push, 1 to pull)\n2 changed files\nClick to switch branch",
    });
  });
  it("shows just the branch when clean", () => {
    expect(statusBarBranch({ ...repo, ahead: 0, behind: 0, files: [] }, null).text).toBe("main");
  });
  it("names detached, empty and busy states", () => {
    const clean = { ...repo, ahead: 0, behind: 0, files: [] };
    expect(statusBarBranch({ ...clean, branch: null }, null).text).toBe("1a2b3c4 (detached)");
    expect(statusBarBranch({ ...clean, branch: null, head: null }, null).text).toBe("no commits");
    expect(statusBarBranch(clean, "Pushing…").text).toBe("main · Pushing…");
  });
});
