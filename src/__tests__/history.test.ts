import { describe, expect, it } from "vitest";
import { historyLabel } from "../components/HistoryMenu";
import { addEntry, MAX_ENTRY_CHARS, sanitizeEntries } from "../lib/searchHistory";

describe("find / replace history", () => {
  it("puts new entries first and moves a repeated one to the top", () => {
    let l = addEntry([], "a", 1, 0);
    l = addEntry(l, "b", 2, 0);
    l = addEntry(l, "a", 3, 0);
    expect(l).toEqual([{ text: "a", at: 3, count: 2 }, { text: "b", at: 2, count: 1 }]);
  });
  it("is unlimited with limit 0 and trims the oldest with a limit", () => {
    let l: ReturnType<typeof addEntry> = [];
    for (let i = 0; i < 1000; i++) l = addEntry(l, `t${i}`, i, 0);
    expect(l).toHaveLength(1000);
    l = addEntry(l, "new", 2000, 3);
    expect(l.map((e) => e.text)).toEqual(["new", "t999", "t998"]);
  });
  it("drops malformed, duplicate and oversized entries read from disk", () => {
    const out = sanitizeEntries([{ text: "x", at: 5, count: 4 }, { text: "x", at: 6 }, { text: "" }, null, 7, { text: "y", count: -2 }, { text: "z".repeat(MAX_ENTRY_CHARS + 1), at: 1 }]);
    expect(out).toEqual([{ text: "x", at: 5, count: 4 }, { text: "y", at: 0, count: 1 }]);
    expect(sanitizeEntries("nope")).toEqual([]);
  });
  it("counts repeats instead of adding copies", () => {
    let l: ReturnType<typeof addEntry> = [];
    for (let i = 0; i < 5; i++) l = addEntry(l, "same", i, 0);
    expect(l).toEqual([{ text: "same", at: 4, count: 5 }]);
  });
  it("shows multi-line entries on one line", () => {
    expect(historyLabel("a\nb\r\nc")).toBe("a ⏎ b ⏎ c");
    expect(historyLabel("q".repeat(400)).length).toBe(301);
    expect(historyLabel("    ")).toBe("(4 whitespace characters)");
  });
});
