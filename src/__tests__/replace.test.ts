import { describe, expect, it } from "vitest";
import { expandReplacement, preserveCase, replaceMatches } from "../lib/replace";
import { activeFilterCount, buildJsRegex, deletedPatch, effectiveScope, folderLabel, explorerRoots, leaveOutPatch, searchTexts, targetSummary } from "../components/panels/SearchPanel";
import { DEFAULT_SEARCH_QUERY } from "../lib/store";
import type { FileMatch } from "../lib/types";

describe("preserveCase", () => {
  it("follows all-caps, lower case and a leading capital", () => {
    expect(preserveCase("FOO", "bar")).toBe("BAR");
    expect(preserveCase("foo", "Bar")).toBe("bar");
    expect(preserveCase("Foo", "bar")).toBe("Bar");
    expect(preserveCase("F", "bar")).toBe("Bar");
    expect(preserveCase("FOO_1", "bar_2")).toBe("BAR_2");
  });
  it("leaves mixed case and letterless matches as typed", () => {
    expect(preserveCase("fOO", "bar")).toBe("bar");
    expect(preserveCase("123", "Bar")).toBe("Bar");
    expect(preserveCase("Foo", "")).toBe("");
    expect(preserveCase("Foo", "été")).toBe("Été");
  });
});

describe("expandReplacement", () => {
  const exec = (re: RegExp, s: string) => re.exec(s)!;
  it("expands groups, named groups and the special patterns", () => {
    const m = exec(/(?<k>\w+)=(\d+)/, "x key=42 y");
    expect(expandReplacement("$2:$1", m)).toBe("42:key");
    expect(expandReplacement("$<k>!", m)).toBe("key!");
    expect(expandReplacement("${k}", m)).toBe("${k}");
    expect(expandReplacement("[$&] $$", m)).toBe("[key=42] $");
    expect(expandReplacement("$`|$'", m)).toBe("x | y");
  });
  it("reads $12 as $1 then 2 when there is no group 12, and keeps unknown references", () => {
    const m = exec(/(a)/, "a");
    expect(expandReplacement("$12", m)).toBe("a2");
    expect(expandReplacement("$3 $<n>", m)).toBe("$3 $<n>");
  });
});

describe("replaceMatches", () => {
  it("replaces like String.replace, with Preserve Case on request", () => {
    expect(replaceMatches("foo Foo FOO", /foo/gi, "bar", { isRegex: false }).text).toBe("bar bar bar");
    expect(replaceMatches("foo Foo FOO", /foo/gi, "bar", { isRegex: false, preserveCase: true })).toEqual({ text: "bar Bar BAR", count: 3 });
    expect(replaceMatches("a1 b2", /(\w)(\d)/g, "$2$1", { isRegex: true }).text).toBe("1a 2b");
    expect(replaceMatches("cost $1", /cost/g, "$1", { isRegex: false }).text).toBe("$1 $1");
  });
  it("skips left-out matches by line and UTF-16 column", () => {
    const text = "x 😀x\nx x";
    const r = replaceMatches(text, /x/g, "y", { isRegex: false, skip: new Set(["1:4", "2:0"]) });
    expect(r).toEqual({ text: "y 😀x\nx y", count: 2 });
  });
  it("returns the text unchanged when nothing is replaced, and survives empty matches", () => {
    expect(replaceMatches("abc", /z/g, "y", { isRegex: false })).toEqual({ text: "abc", count: 0 });
    expect(replaceMatches("ab", /x*/g, "-", { isRegex: false }).text).toBe("-a-b-");
  });
});

describe("Find in Files panel helpers", () => {
  it("effectiveScope falls back when there is no file or no tab to search", () => {
    expect(effectiveScope("doc", true, true)).toBe("doc");
    expect(effectiveScope("doc", false, true)).toBe("open");
    expect(effectiveScope("doc", false, false)).toBe("folder");
    expect(effectiveScope("open", false, false)).toBe("folder");
    expect(effectiveScope("custom", false, false)).toBe("custom");
  });

  it("explorerRoots searches the Explorer's picks inside the open folder, without overlaps", () => {
    const r = String.raw;
    expect(explorerRoots([r`C:\p\src`], r`C:\p`)).toEqual([r`C:\p\src`]);
    expect(explorerRoots([r`C:\p\a.txt`, r`C:\p\src`, r`C:\p\src\b.txt`, r`c:\P\SRC`], r`C:\p`)).toEqual([r`C:\p\a.txt`, r`C:\p\src`]);
    expect(explorerRoots([r`D:\other`], r`C:\p`)).toEqual([r`C:\p`]);
    expect(explorerRoots([], r`C:\p`)).toEqual([r`C:\p`]);
    expect(explorerRoots([r`C:\p\src`], null)).toEqual([]);
    expect(targetSummary([r`C:\w\Q\a.txt`, r`C:\w\Q\src`], r`C:\w\Q`)).toBe("2 items: a.txt, src");
    expect(targetSummary([r`C:\w\Q\src\a.txt`], r`C:\w\Q`)).toBe(r`Q\src\a.txt`);
    expect(folderLabel(r`C:\work\Quarry\src\lib`, r`C:\work\Quarry`)).toBe(r`Quarry\src\lib`);
    expect(folderLabel(r`C:\work\Quarry`, r`C:\work\Quarry`)).toBe("Quarry");
    expect(folderLabel(r`D:\x`, r`C:\work\Quarry`)).toBe(r`D:\x`);
  });

  it("activeFilterCount counts filters that differ from the defaults", () => {
    expect(activeFilterCount(DEFAULT_SEARCH_QUERY, true)).toBe(0);
    const q = { ...DEFAULT_SEARCH_QUERY, include: ["*.ts"], respectGitignore: false, dotAll: true, maxResults: 5 };
    expect(activeFilterCount(q, true)).toBe(4);
    expect(activeFilterCount(q, false)).toBe(2);
  });

  const mk = (path: string, line: number, col: number): FileMatch => ({ path, line, col, len: 1, preview: "x", previewCol: 0 });
  const a1 = mk("a", 1, 0);
  const a2 = mk("a", 2, 3);
  const b1 = mk("b", 1, 0);
  const st = { files: [{ path: "a", matches: [a1, a2] }, { path: "b", matches: [b1] }], excluded: {}, totalMatches: 3, leftOut: 0 };

  it("leaveOutPatch removes one match and remembers it for the replace", () => {
    const p = leaveOutPatch(st, "a", a2)!;
    expect(p.files!.map((f) => f.matches.length)).toEqual([1, 1]);
    expect(p.excluded).toEqual({ a: ["2:3"] });
    expect([p.totalMatches, p.leftOut]).toEqual([2, 1]);
  });
  it("leaveOutPatch drops a file (and what was remembered for it) when nothing is left", () => {
    const p = leaveOutPatch({ ...st, excluded: { a: ["9:9"] } }, "a")!;
    expect(p.files!.map((f) => f.path)).toEqual(["b"]);
    expect(p.excluded).toEqual({});
    expect([p.totalMatches, p.leftOut]).toEqual([1, 2]);
    expect(leaveOutPatch(st, "b", b1)!.files!.map((f) => f.path)).toEqual(["a"]);
    expect(leaveOutPatch(st, "zzz")).toBeNull();
  });
  it("deletedPatch drops a deleted file's results, left-out positions and current result", () => {
    const cur = { ...st, excluded: { a: ["9:9"], b: ["5:5", "6:6"] }, leftOut: 3, activeKey: "b:1:0" };
    const p = deletedPatch(cur, ["b"]);
    expect(p.files!.map((f) => f.path)).toEqual(["a"]);
    expect(p.excluded).toEqual({ a: ["9:9"] });
    expect([p.totalMatches, p.leftOut, p.activeKey]).toEqual([2, 1, null]);
    expect("activeKey" in deletedPatch({ ...cur, activeKey: "a:1:0" }, ["b"])).toBe(false);
  });
});

describe("buildJsRegex", () => {
  const ww = (pattern: string) => buildJsRegex({ pattern, isRegex: false, wholeWord: true, caseSensitive: false, dotAll: false })!;
  it("Whole Word wants no word character beside the match, like the folder search", () => {
    expect("x -2 y a-2 -2b".match(ww("-2"))).toEqual(["-2"]);
    expect("cat category cat.".match(ww("cat"))).toEqual(["cat", "cat"]);
    // The replace preview runs the regex on the hit alone.
    expect(ww("-2").test("-2")).toBe(true);
  });
});

describe("searchTexts", () => {
  const docs = [
    { path: "a", text: "x x\nx" },
    { path: "b", text: "x x" },
  ];
  const q = (maxResults: number) => ({ ...DEFAULT_SEARCH_QUERY, pattern: "x", maxResults });
  it("Max caps the total across documents and reports the limit", () => {
    const r = searchTexts(q(4), docs);
    expect(r.files.map((f) => [f.path, f.matches.length])).toEqual([["a", 3], ["b", 1]]);
    expect(r.truncated).toBe(true);
    expect(searchTexts(q(2), docs).files.map((f) => f.path)).toEqual(["a"]);
  });
  it("is not truncated under the limit", () => {
    const r = searchTexts(q(10), docs);
    expect(r.files.reduce((n, f) => n + f.matches.length, 0)).toBe(5);
    expect(r.truncated).toBe(false);
  });
});
