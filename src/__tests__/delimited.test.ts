import { describe, expect, it } from "vitest";
import { growWidths, isNumeric, splitDelimited } from "../lib/delimited";

const texts = (line: string, sep = ",") => splitDelimited(line, sep).map((f) => f.text);

describe("splitDelimited", () => {
  it("splits plain and quoted CSV fields, keeping each field's span", () => {
    expect(texts('1,"Smith, Jo","say ""hi""",,end')).toEqual(["1", "Smith, Jo", 'say "hi"', "", "end"]);
    const f = splitDelimited('a,"b,c",d', ",");
    expect(f.map((x) => [x.start, x.end])).toEqual([[0, 1], [2, 7], [8, 9]]);
  });
  it("handles empty lines, a trailing separator and TSV", () => {
    expect(texts("")).toEqual([""]);
    expect(texts("a,")).toEqual(["a", ""]);
    expect(texts('x\t"y"\tz', "\t")).toEqual(["x", '"y"', "z"]); // TSV has no quoting
  });
  it("keeps going after an unterminated quote", () => {
    expect(texts('a,"open, never closed')).toEqual(["a", "open, never closed"]);
  });
});

describe("grid helpers", () => {
  it("isNumeric spots numbers to right-align", () => {
    for (const s of ["42", "-3.5", "1,234,567.89", "1e9", ".5"]) expect(isNumeric(s)).toBe(true);
    for (const s of ["", "12a", "2026-01-01", "1,23", "N/A"]) expect(isNumeric(s)).toBe(false);
  });
  it("growWidths only widens, within 3 and 40 characters", () => {
    const w1 = growWidths([], [splitDelimited("id,name", ","), splitDelimited("1,Ann", ",")]);
    expect(w1).toEqual([3, 4]);
    const w2 = growWidths(w1, [splitDelimited(`22,${"x".repeat(100)},extra`, ",")]);
    expect(w2).toEqual([3, 40, 5]);
    expect(growWidths(w2, [splitDelimited("1,a", ",")])).toEqual(w2);
  });
});
