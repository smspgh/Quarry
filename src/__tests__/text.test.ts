import { describe, expect, it } from "vitest";
import { bareTitle, fuzzy, fuzzyCommand, fuzzyPath, shiftIndices } from "../lib/fuzzy";
import { sniffLanguage } from "../editor/cmSetup";
import { csvSplit, csvToJson, jsonToCsv, topLevelKeys } from "../lib/convert";
import { describeCopiedPath, formatPath, nodeAtOffset, parseJsonTree, pathSegments, valueClipboardText } from "../lib/jsonPath";
import { locateMatch } from "../components/panels/SearchPanel";

describe("fuzzy", () => {
  it("prefers camel humps and contiguous runs", () => {
    const a = fuzzy("cmpal", "src/components/CommandPalette.tsx")!;
    const b = fuzzy("cmpal", "src/components/BottomPanel.tsx")!; // c-m-p-a-l spread over the path
    expect(a.score).toBeGreaterThan(b.score);
    expect(fuzzy("cmpal", "CommandPalette.tsx")!.idx).toEqual([0, 2, 7, 8, 9]);
    expect(fuzzy("cmpal", "BottomPanel.tsx")).toBeNull();
  });
  it("returns null when characters are missing and empty match for an empty query", () => {
    expect(fuzzy("xyz", "abc")).toBeNull();
    expect(fuzzy("", "abc")).toEqual({ score: 0, idx: [] });
  });
  it("fuzzyPath favours the basename and shifts indices to the full path", () => {
    const m = fuzzyPath("cmpal", "src/components/CommandPalette.tsx")!;
    expect(m.idx[0]).toBe("src/components/".length);
    expect(fuzzyPath("cmpal", "src/components/CommandPalette.tsx")!.score).toBeGreaterThan(fuzzyPath("cmpal", "src/components/BottomPanel.tsx")!.score);
  });
  it("fuzzyCommand matches the displayed category and ranks title matches first", () => {
    const big = fuzzyCommand("large file", "Large File", "File Info")!;
    expect(big).not.toBeNull();
    expect(big.idx[0]).toBe(0); // highlight starts in the category
    expect(fuzzyCommand("json", "JSON", "Format Document")).not.toBeNull();
    const titleHit = fuzzyCommand("json", "View", "Toggle JSON Panel")!;
    const categoryOnly = fuzzyCommand("json", "JSON", "Minify")!;
    expect(titleHit.score).toBeGreaterThan(categoryOnly.score);
    // indices always point into "category: title"
    expect("View: Toggle JSON Panel".slice(titleHit.idx[0], titleHit.idx[0] + 4)).toBe("JSON");
    expect(fuzzyCommand("zzz", "JSON", "Minify")).toBeNull();
    // a "JSON: " title prefix is not scored twice; indices point into "JSON: Validate"
    const v = fuzzyCommand("val", "JSON", "JSON: Validate")!;
    expect(v.idx).toEqual([6, 7, 8]);
    expect(bareTitle("Macro: Stop Playback")).toBe("Stop Playback");
    expect(bareTitle("Toggle JSON Panel")).toBe("Toggle JSON Panel");
  });
  it("shiftIndices drops indices before the offset", () => {
    expect(shiftIndices([1, 5, 9], 4)).toEqual([1, 5]);
  });
});

describe("sniffLanguage", () => {
  it.each([
    ['{"a": 1}', "JSON"],
    ["[1, 2]", "JSON"],
    ["<!DOCTYPE html><html>", "HTML"],
    ['<?xml version="1.0"?>', "XML"],
    ["#!/usr/bin/env python3\nprint(1)", "Python"],
    ["use std::fs;\nfn main() {}", "Rust"],
    ["import x from 'y';\nconst a: string = '';", "TypeScript"],
    ["const a = 1;", "JavaScript"],
    ["#include <stdio.h>\nint main() {}", "C++"], // C is detected as C++ too
    ["SELECT * FROM t", "SQL"],
    ["# Title\ntext", "Markdown"],
    ["key: value\nother: 2", "YAML"],
    ["just some prose", null],
    ["", null],
  ])("%j → %s", (text, lang) => {
    expect(sniffLanguage(text)).toBe(lang);
  });
});

describe("CSV", () => {
  it("csvSplit honours quotes, escaped quotes and delimiters", () => {
    expect(csvSplit('a,"b,c","d""e",,f')).toEqual(["a", "b,c", 'd"e', "", "f"]);
    expect(csvSplit("a;b", ";")).toEqual(["a", "b"]);
  });
  it("csvToJson keeps surplus cells under _extra and refuses header-only input", () => {
    const r = csvToJson("a,b\n1,2,3\n4,5\n", 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.parse(r.output)).toEqual([{ a: "1", b: "2", _extra: ["3"] }, { a: "4", b: "5" }]);
      expect(r.rows).toBe(2);
      expect(r.warnings.length).toBe(1);
    }
    expect(csvToJson("a,b,c\n").ok).toBe(false);
  });
  it("jsonToCsv unions keys in first-seen order and quotes as needed", () => {
    const r = jsonToCsv('[{"a":1,"b":"x,y"},{"b":"q\\"r","c":null}]');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.split(/\r?\n/)).toEqual(["a,b,c", '1,"x,y",', ',"q""r",']);
      expect(r.columns).toBe(3);
    }
    expect(jsonToCsv("nope").ok).toBe(false);
  });
  it("topLevelKeys lists object keys", () => {
    expect(topLevelKeys('{"b":1,"a":{"c":2}}')).toEqual({ ok: true, keys: ["b", "a"] });
    expect(topLevelKeys("[1]").ok).toBe(false);
  });
});

describe("JSON paths", () => {
  const segs = ["users", 0, "first name", "x-y"];
  it("formats every style and escapes awkward keys", () => {
    expect(formatPath(segs, "dot")).toBe("users[0].first name.x-y");
    expect(formatPath(segs, "js")).toBe('users[0]["first name"]["x-y"]');
    expect(formatPath(segs, "bracket")).toBe('["users"][0]["first name"]["x-y"]');
    expect(formatPath(segs, "jsonpath")).toBe("$.users[0]['first name']['x-y']");
    expect(formatPath(["a/b", "c~d"], "pointer")).toBe("/a~1b/c~0d");
  });
  it("root is $ for path styles and the empty string for pointers", () => {
    expect(formatPath([], "dot")).toBe("$");
    expect(formatPath([], "jsonpath")).toBe("$");
    expect(formatPath([], "pointer")).toBe("");
    expect(describeCopiedPath("", "pointer")).toContain("empty string");
  });
  it("parses a tree, finds the node at an offset and copies values cleanly", () => {
    const src = '{\n  "s": "hi",\n  "o": {\n    "n": 1,\n    "l": [1, 2]\n  }\n}';
    const r = parseJsonTree(src);
    expect(r.root).not.toBeNull();
    const n = nodeAtOffset(r.root, src.indexOf('"n"') + 6)!;
    expect(pathSegments(n)).toEqual(["o", "n"]);
    const s = nodeAtOffset(r.root, src.indexOf('"hi"') + 1)!;
    expect(valueClipboardText(src, s)).toBe("hi");
    const o = nodeAtOffset(r.root, src.indexOf("{\n    "))!;
    expect(valueClipboardText(src, o)).toBe('{\n  "n": 1,\n  "l": [1, 2]\n}');
  });
  it("reports the error offset for invalid text", () => {
    const r = parseJsonTree('{"a": 1,, "b": 2}');
    expect(r.root).toBeNull();
    expect(r.error?.offset).toBe(8);
    expect(r.error?.message).toMatch(/./);
  });
});

describe("locateMatch", () => {
  const m = { line: 3, col: 4, len: 6, preview: "foo needle bar", previewCol: 4 } as never;
  it("keeps a hit that is still in place", () => {
    expect(locateMatch("a\nb\nfoo needle bar\n", m)).toEqual({ line: 3, col: 4 });
  });
  it("relocates a hit that moved within the radius and gives up beyond it", () => {
    expect(locateMatch("x\na\nb\nc\nfoo needle bar\n", m)).toEqual({ line: 5, col: 4 });
    expect(locateMatch("a\nb\nc\nd\ne\nf\ng\nh\ni\nfoo needle bar\n", m)).toBeNull();
  });
});
