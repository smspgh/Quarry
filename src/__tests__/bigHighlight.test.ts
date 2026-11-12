import { describe, expect, it } from "vitest";
import { bigLanguageOf, segments, tokenize, type BigLang } from "../lib/bigHighlight";

/** Each token as `cls:text`, for readable expectations. */
const show = (lang: BigLang, line: string) => tokenize(lang, line).map((t) => `${t.cls}:${line.slice(t.from, t.to)}`);

describe("bigLanguageOf", () => {
  it("goes by the extension first", () => {
    expect(bigLanguageOf("export.JSON")).toBe("json");
    expect(bigLanguageOf("events.ndjson")).toBe("json");
    expect(bigLanguageOf("app.log")).toBe("log");
    expect(bigLanguageOf("orders.csv")).toBe("csv");
    expect(bigLanguageOf("orders.tsv")).toBe("tsv");
    expect(bigLanguageOf("feed.xml")).toBe("xml");
    expect(bigLanguageOf("dump.sql")).toBe("sql");
  });
  it("sniffs the first lines when the extension says nothing", () => {
    expect(bigLanguageOf("server.txt", ["2026-01-01T00:00:00Z INFO started", "2026-01-01T00:00:01Z WARN slow"])).toBe("log");
    expect(bigLanguageOf("data", ['{"a": 1}', '{"a": 2}'])).toBe("json");
    expect(bigLanguageOf("notes.txt", ["Dear reader,", "this is prose."])).toBeNull();
    expect(bigLanguageOf("empty.txt")).toBeNull();
  });
});

describe("tokenize", () => {
  it("JSON: keys, strings, numbers, literals and punctuation", () => {
    expect(show("json", '  "id": 12, "ok": true, "tag": "a\\"b", "n": null')).toEqual([
      'key:"id"', "punc::", "num:12", "punc:,", 'key:"ok"', "punc::", "bool:true", "punc:,", 'key:"tag"', "punc::", 'str:"a\\"b"', "punc:,", 'key:"n"', "punc::", "bool:null",
    ]);
    expect(show("json", "[-1.5e3, 2]")).toEqual(["punc:[", "num:-1.5e3", "punc:,", "num:2", "punc:]"]);
  });
  it("logs: timestamp, first level word, [tags], key=value and numbers", () => {
    expect(show("log", "2026-01-01T00:00:00.123Z ERROR [worker-3] req=ab12 status=500 ms=12 took 7 ms")).toEqual([
      "time:2026-01-01T00:00:00.123Z", "lvl-err:ERROR", "tag:[worker-3]", "key:req", "key:status", "num:500", "key:ms", "num:12", "num:7",
    ]);
    expect(show("log", "Oct 26 12:00:01 host WARN disk 91% full")[0]).toBe("time:Oct 26 12:00:01");
    expect(show("log", "INFO then ERROR").map((t) => t.split(":")[0])).toEqual(["lvl-info"]);
  });
  it("CSV: one colour per column, quoted commas stay in their field", () => {
    expect(show("csv", 'a,"b, c",,d')).toEqual(["col0:a", "punc:,", 'col1:"b, c"', "punc:,", "punc:,", "col3:d"]);
    expect(show("tsv", "x\ty")).toEqual(["col0:x", "punc:\t", "col1:y"]);
  });
  it("XML: tags, attributes, values and comments", () => {
    expect(show("xml", '<item id="7"/> text <!-- c -->')).toEqual(["punc:<", "tagname:item", "attr:id", "punc:=", 'str:"7"', "punc:/", "punc:>", "com:<!-- c -->"]);
  });
  it("SQL: keywords, strings, numbers and comments", () => {
    expect(show("sql", "INSERT INTO `t` VALUES (1, 'it''s', NULL); -- done")).toEqual(["kw:INSERT", "kw:INTO", "key:`t`", "kw:VALUES", "num:1", "str:'it'", "str:'s'", "bool:NULL", "com:-- done"]);
  });
});

describe("segments", () => {
  it("cuts the line at tokens and marks the search hit across them", () => {
    const line = '"key": 123';
    const toks = tokenize("json", line);
    expect(segments(line, toks, null)).toEqual([
      { text: '"key"', cls: "key", hit: false },
      { text: ":", cls: "punc", hit: false },
      { text: " ", cls: null, hit: false },
      { text: "123", cls: "num", hit: false },
    ]);
    const hit = segments(line, toks, [3, 8]).filter((s) => s.hit).map((s) => `${s.cls}:${s.text}`);
    expect(hit).toEqual(['key:y"', "punc::", "null: ", "num:1"]);
    expect(segments("plain", [], null)).toEqual([{ text: "plain", cls: null, hit: false }]);
  });
});

describe("filter quick buttons", () => {
  it("Errors and Warnings match the level words, as whole words", async () => {
    const { LEVEL_FILTERS } = await import("../components/BigFilterPane");
    const errors = new RegExp(LEVEL_FILTERS.errors);
    const warnings = new RegExp(LEVEL_FILTERS.warnings);
    for (const l of ["x ERROR y", "FATAL boom", "job FAILED", "CRITICAL", "ERR disk"]) expect(errors.test(l)).toBe(true);
    for (const l of ["ERRORS_TOTAL=0", "info only", "TERRIFIC"]) expect(errors.test(l)).toBe(false);
    expect(warnings.test("2026 WARN low disk")).toBe(true);
    expect(warnings.test("WARNING: x")).toBe(true);
    expect(warnings.test("FOREWARNED")).toBe(false);
  });
});
