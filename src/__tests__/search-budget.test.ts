import { describe, expect, it } from "vitest";
import { budgetRows } from "../components/panels/SearchPanel";

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
