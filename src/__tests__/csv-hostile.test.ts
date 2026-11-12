import { describe, expect, it } from "vitest";
import { csvRecords, csvToJson, jsonToCsv, sniffDelimiter } from "../lib/convert";

const parse = (text: string) => {
  const r = csvToJson(text, 0);
  if (!r.ok) throw new Error(r.error);
  return { rows: JSON.parse(r.output) as Record<string, unknown>[], warnings: r.warnings };
};

describe("CSV: hostile inputs", () => {
  it("keeps quoted line breaks, quotes and delimiters inside one cell", () => {
    const { rows } = parse('id,note\r\n1,"first line\r\nsecond line"\r\n2,"has ""quotes"" and, commas"\r\n');
    expect(rows).toEqual([
      { id: "1", note: "first line\r\nsecond line" },
      { id: "2", note: 'has "quotes" and, commas' },
    ]);
  });

  it("sniffs semicolon, tab and pipe delimiters (decimal commas stay in the cell)", () => {
    expect(sniffDelimiter("id;name;amount\n1;Alice;3,50\n")).toBe(";");
    expect(sniffDelimiter("a\tb\n1\t2\n")).toBe("\t");
    expect(sniffDelimiter("a|b|c\n1|2|3\n")).toBe("|");
    expect(sniffDelimiter("a,b\n1,2\n")).toBe(",");
    const { rows, warnings } = parse("id;name;amount\n1;Alice;3,50\n2;Bob;7,00\n");
    expect(rows[0]).toEqual({ id: "1", name: "Alice", amount: "3,50" });
    expect(warnings.join(" ")).toContain("semicolon");
  });

  it("pads short rows, keeps surplus cells and skips blank lines", () => {
    const { rows, warnings } = parse("a,b,c\n1,2\n3,4,5,6\n\n7\n");
    expect(rows).toEqual([
      { a: "1", b: "2", c: "" },
      { a: "3", b: "4", c: "5", _extra: ["6"] },
      { a: "7", b: "", c: "" },
    ]);
    expect(warnings.some((w) => w.includes("fewer cells"))).toBe(true);
    expect(warnings.some((w) => w.includes("_extra"))).toBe(true);
  });

  it("renames duplicate and empty header names instead of dropping columns", () => {
    const { rows, warnings } = parse("name,name,value,\nx,y,1,z\n");
    expect(rows).toEqual([{ name: "x", name_2: "y", value: "1", column_4: "z" }]);
    expect(warnings.some((w) => w.includes("renamed"))).toBe(true);
  });

  it("handles CR-only line endings and a missing final newline", () => {
    expect(csvRecords("a,b\r1,2\r3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("converts 1 000 000 rows in a few seconds", () => {
    const parts = ["id,name,city,amount"];
    for (let i = 1; i <= 1_000_000; i++) parts.push(`${i},Name${i},City${i % 97},${(i * 1.25).toFixed(2)}`);
    const t0 = performance.now();
    const r = csvToJson(parts.join("\n"), 0);
    const ms = performance.now() - t0;
    expect(r.ok && r.rows).toBe(1_000_000);
    expect(ms).toBeLessThan(10_000);
  }, 30_000);

  it("round-trips CSV → JSON → CSV for awkward cells", () => {
    const src = 'a,b\n"x,1","line\nbreak"\n"q""uote",plain\n';
    const back = jsonToCsv(csvToJson(src, 0).ok ? (csvToJson(src, 0) as { output: string }).output : "[]");
    expect(back.ok && back.output).toBe(src.trimEnd());
  });
});
