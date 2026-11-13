import { describe, expect, it } from "vitest";
import { budgetRows, unlistedNote } from "../components/panels/SearchPanel";

describe("Replace All: matches that are not listed", () => {
  const base = { hidden: 0, extra: 0, maxHit: false, maxResults: 20_000, cappedFiles: 0 };
  it("says nothing when every match is listed", () => {
    expect(unlistedNote(base)).toBe("");
  });
  it("counts results past the first 500 of a file", () => {
    expect(unlistedNote({ ...base, hidden: 300 })).toBe("300 of them are not listed (only the first 500 results of a file are) and will be replaced too.");
    expect(unlistedNote({ ...base, hidden: 1 })).toContain("1 of them is not listed");
  });
  it("gives the exact number beyond Max when it is known", () => {
    expect(unlistedNote({ ...base, extra: 1200 })).toBe("1,200 more matches that are not listed (past Max, 20,000) will also be replaced.");
    expect(unlistedNote({ ...base, extra: 1 })).toContain("1 more match that is not listed");
  });
  it("says 'may' when the number is not known", () => {
    expect(unlistedNote({ ...base, maxHit: true })).toBe("More matches that are not listed may also be replaced: the search stopped at Max (20,000).");
    expect(unlistedNote({ ...base, cappedFiles: 2 })).toBe("More matches that are not listed may also be replaced: a line in 2 files has more than 1,000 matches.");
    expect(unlistedNote({ ...base, hidden: 5, maxHit: true, cappedFiles: 1 })).toBe(
      "5 of them are not listed (only the first 500 results of a file are) and will be replaced too.\n\nMore matches that are not listed may also be replaced: the search stopped at Max (20,000), and a line in 1 file has more than 1,000 matches.",
    );
  });
});

describe("search results row budget", () => {
  it("renders headers and matches until the budget is spent", () => {
    const files = [{ matches: 3, collapsed: false }, { matches: 5, collapsed: false }, { matches: 1, collapsed: false }];
    expect(budgetRows(files, 100)).toEqual([3, 5, 1]);
    expect(budgetRows(files, 6)).toEqual([3, 1, -1]); // 1+3, 1+1 → budget gone
    expect(budgetRows(files, 4)).toEqual([3, -1, -1]);
  });
  it("collapsed files cost one row and per-file cap applies", () => {
    expect(budgetRows([{ matches: 900, collapsed: true }, { matches: 900, collapsed: false }], 2000, 500)).toEqual([0, 500]);
  });
  it("5 000 files with 1 match each render at most ~budget rows", () => {
    const files = Array.from({ length: 5000 }, () => ({ matches: 1, collapsed: false }));
    const shown = budgetRows(files, 1500);
    expect(shown.filter((n) => n >= 0).length).toBe(750);
  });
});
