import { describe, expect, it } from "vitest";
import { isInside, needsSavePromptOnExit, nextUntitledNumber, normalizePath, samePath, sanitizeSettings } from "../lib/actions";
import { cleanDirSetting, displayPath, safeFileName } from "../lib/macros";
import { DEFAULT_SETTINGS } from "../lib/types";
import { isBigJson } from "../lib/commands";
import { ancestorDirs, collapseUnder, compareEntries, fileNameProblem, rangeOf, toggleIn } from "../components/panels/ExplorerPanel";
import { relativeDir } from "../components/panels/SearchPanel";
import { displayRecent } from "../components/Welcome";

describe("fileNameProblem", () => {
  it("accepts ordinary names and rejects what Windows refuses", () => {
    expect(fileNameProblem("README.md")).toBeNull();
    expect(fileNameProblem(".gitignore")).toBeNull();
    expect(fileNameProblem("sub\\x.txt")).not.toBeNull();
    expect(fileNameProblem("a/b")).not.toBeNull();
    expect(fileNameProblem("what?.txt")).not.toBeNull();
    expect(fileNameProblem("name.")).not.toBeNull();
    expect(fileNameProblem("CON")).not.toBeNull();
    expect(fileNameProblem("nul.txt")).not.toBeNull();
    expect(fileNameProblem("console.log")).toBeNull();
  });
});

describe("normalizePath / samePath", () => {
  it("canonicalises separators, case and trailing slashes", () => {
    expect(normalizePath("C:/Users/x/file.TXT")).toBe("c:\\users\\x\\file.txt");
    expect(normalizePath("C:\\Users\\x\\")).toBe("c:\\users\\x");
    expect(normalizePath("C:")).toBe("c:\\");
    expect(normalizePath("C:\\")).toBe("c:\\");
  });
  it("strips Windows verbatim prefixes", () => {
    expect(normalizePath("\\\\?\\C:\\x\\y.txt")).toBe("c:\\x\\y.txt");
    expect(normalizePath("\\\\?\\UNC\\srv\\share\\f")).toBe("\\\\srv\\share\\f");
    expect(samePath("\\\\?\\C:\\x\\y.txt", "c:/x/y.txt")).toBe(true);
  });
  it("treats null / empty as never equal", () => {
    expect(samePath(null, "c:\\x")).toBe(false);
    expect(samePath("", "")).toBe(false);
  });
});

describe("sanitizeSettings", () => {
  it("clamps numbers to the Settings panel bounds and keeps valid values", () => {
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, fontSize: 0, tabSize: 99, jsonIndent: 3, largeFileThresholdMb: -5 });
    expect(s.fontSize).toBe(8);
    expect(s.tabSize).toBe(16);
    expect(s.jsonIndent).toBe(3);
    expect(s.largeFileThresholdMb).toBe(1);
  });
  it("falls back to defaults for junk enums and strips newlines from folders", () => {
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, theme: "neon" as never, menuPosition: 3 as never, defaultEol: "CR" as never, scriptsDir: " C:\\s\n ", fontSize: NaN });
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(s.menuPosition).toBe(DEFAULT_SETTINGS.menuPosition);
    expect(s.defaultEol).toBe(DEFAULT_SETTINGS.defaultEol);
    expect(s.scriptsDir).toBe("C:\\s");
    expect(s.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });
});

describe("nextUntitledNumber", () => {
  it("uses the lowest number no open Untitled tab has", () => {
    expect(nextUntitledNumber([])).toBe(1);
    expect(nextUntitledNumber(["notes.txt", "Untitled-2"])).toBe(1);
    expect(nextUntitledNumber(["Untitled-1", "Untitled-2", "Untitled-4"])).toBe(3);
    expect(nextUntitledNumber(["Untitled-1", "untitled-2", "Untitled-2.txt"])).toBe(2);
  });
});

describe("needsSavePromptOnExit (hot exit)", () => {
  const untitled = { dirty: true, path: null, kind: "text" as const };
  const file = { dirty: true, path: "C:\\a.txt", kind: "text" as const };
  it("never prompts for clean documents", () => {
    expect(needsSavePromptOnExit({ ...file, dirty: false }, 0, true)).toBe(false);
    expect(needsSavePromptOnExit({ ...untitled, dirty: false }, 10, true)).toBe(false);
  });
  it("always prompts for dirty file-backed and big documents", () => {
    expect(needsSavePromptOnExit(file, 0, true)).toBe(true);
    expect(needsSavePromptOnExit({ dirty: true, path: "C:\\big.log", kind: "big" }, 0, true)).toBe(true);
  });
  it("skips untitled buffers the session will restore, but not oversized or empty ones", () => {
    expect(needsSavePromptOnExit(untitled, 100, true)).toBe(false);
    expect(needsSavePromptOnExit(untitled, 2 * 1024 * 1024 + 1, true)).toBe(true);
    expect(needsSavePromptOnExit(untitled, 0, true)).toBe(true);
  });
  it("prompts for untitled buffers when session restore is off", () => {
    expect(needsSavePromptOnExit(untitled, 100, false)).toBe(true);
  });
});

describe("folder / file name helpers", () => {
  it("cleanDirSetting strips control characters", () => {
    expect(cleanDirSetting("C:\\a\n\u0007 ")).toBe("C:\\a");
    expect(cleanDirSetting(42)).toBe("");
  });
  it("safeFileName replaces reserved characters and never returns empty", () => {
    expect(safeFileName('a<b>:"/\\|?*c')).toBe("a_b________c");
    expect(safeFileName("   ")).toBe("untitled");
  });
  it("displayPath collapses mixed separators", () => {
    expect(displayPath("C:/a//b\\\\c/d")).toBe("C:\\a\\b\\c\\d");
  });
  it("displayRecent dedupes by slash direction and case", () => {
    expect(displayRecent(["C:/a/b.txt", "c:\\A\\B.TXT", "C:\\c.txt"], 5)).toEqual(["C:\\a\\b.txt", "C:\\c.txt"]);
    expect(displayRecent(["1", "2", "3"], 2)).toEqual(["1", "2"]);
  });
});

describe("Explorer helpers", () => {
  const e = (name: string, isDir = false) => ({ name, isDir, path: `C:\\r\\${name}` }) as never;
  it("sorts folders first, then naturally", () => {
    const sorted = [e("f10.txt"), e("b", true), e("f2.txt"), e("A", true), e("f1.txt")].sort(compareEntries).map((x: { name: string }) => x.name);
    expect(sorted).toEqual(["A", "b", "f1.txt", "f2.txt", "f10.txt"]);
  });
  it("Collapse All closes the folder and everything expanded beneath it", () => {
    const r = String.raw;
    const open = new Set([r`C:\r`, r`C:\r\a`, r`C:\r\a\b`, r`C:\r\ab`, r`C:\r\c`]);
    expect([...collapseUnder(open, r`C:\r\A`)]).toEqual([r`C:\r`, r`C:\r\ab`, r`C:\r\c`]);
  });
  it("Shift+click ranges and Ctrl+click toggles", () => {
    const rows = ["a", "b", "c", "d"];
    expect(rangeOf(rows, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeOf(rows, "D", "b")).toEqual(["b", "c", "d"]);
    expect(rangeOf(rows, "gone", "c")).toEqual(["c"]);
    expect(toggleIn(["a", "c"], "C")).toEqual(["a"]);
    expect(toggleIn(["a"], "b")).toEqual(["a", "b"]);
  });
  it("ancestorDirs lists the root and every directory above the file", () => {
    expect(ancestorDirs("C:\\r", "C:\\r\\a\\b\\f.txt")).toEqual(["C:\\r", "C:\\r\\a", "C:\\r\\a\\b"]);
    expect(ancestorDirs("C:\\r", "C:\\r\\f.txt")).toEqual(["C:\\r"]);
    expect(ancestorDirs("C:\\r", "D:\\elsewhere\\f.txt")).toEqual([]);
  });
});

describe("relativeDir", () => {
  it("is empty at the root, relative below it, absolute outside", () => {
    expect(relativeDir("C:\\r\\f.txt", ["C:\\r\\"])).toBe("");
    expect(relativeDir("C:\\r\\n\\m\\f.txt", ["C:\\other", "c:\\R"])).toBe("n\\m");
    expect(relativeDir("D:\\x\\f.txt", ["C:\\r"])).toBe("D:\\x");
  });
});

describe("isInside", () => {
  const r = String.raw;
  it("matches files below a folder, at any depth, ignoring case and slash style", () => {
    expect(isInside(r`C:\proj\src\a.ts`, r`C:\proj`)).toBe(true);
    expect(isInside("c:/PROJ/src/deep/b.ts", "C:\\proj\\")).toBe(true);
  });
  it("does not match the folder itself, siblings or name prefixes", () => {
    expect(isInside(r`C:\proj`, r`C:\proj`)).toBe(false);
    expect(isInside(r`C:\project2\a.ts`, r`C:\proj`)).toBe(false);
    expect(isInside(r`D:\proj\a.ts`, r`C:\proj`)).toBe(false);
  });
});

describe("isBigJson", () => {
  it("recognises large-file tabs that hold JSON by their extension", () => {
    expect(isBigJson({ kind: "big", name: "export.JSON" })).toBe(true);
    expect(isBigJson({ kind: "big", name: "settings.jsonc" })).toBe(true);
    expect(isBigJson({ kind: "big", name: "events.jsonl" })).toBe(false);
    expect(isBigJson({ kind: "text", name: "small.json" })).toBe(false);
    expect(isBigJson(null)).toBe(false);
  });
});
