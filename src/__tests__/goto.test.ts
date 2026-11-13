import { describe, expect, it } from "vitest";
import { parseGoto } from "../lib/goto";

describe("Go to Line parsing", () => {
  it("takes a line, with column 1 by default", () => {
    expect(parseGoto("120")).toEqual({ line: 120, col: 1 });
    expect(parseGoto("  7 ")).toEqual({ line: 7, col: 1 });
  });
  it("takes a column after a colon or a comma", () => {
    expect(parseGoto("120:8")).toEqual({ line: 120, col: 8 });
    expect(parseGoto("120,8")).toEqual({ line: 120, col: 8 });
    expect(parseGoto("120 : 8")).toEqual({ line: 120, col: 8 });
  });
  it("ignores a separator without a column", () => {
    expect(parseGoto("120:")).toEqual({ line: 120, col: 1 });
  });
  it("needs a leading number", () => {
    expect(parseGoto("abc")).toBeNull();
    expect(parseGoto("")).toBeNull();
    expect(parseGoto(":8")).toBeNull();
  });
});
