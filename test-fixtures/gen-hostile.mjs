// Generates the hostile-input fixtures used by the polish pass (Phase 3) into test-fixtures/hostile/.
// Usage: node test-fixtures/gen-hostile.mjs [--big]   (--big adds the 100 MB / 500 MB files and the 50k-file tree)
// Everything it writes is git-ignored; rerun it to recreate the files.
import { mkdirSync, writeFileSync, openSync, writeSync, closeSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "hostile");
const big = process.argv.includes("--big");
mkdirSync(root, { recursive: true });
const put = (name, data) => writeFileSync(join(root, name), data);

// ---- JSON
put("deep-10k.json", "[".repeat(10_000) + "1" + "]".repeat(10_000));
{
  const parts = [];
  for (let i = 0; i < 200_000; i++) parts.push(`  "key${i}": ${i}`);
  put("wide-200k.json", "{\n" + parts.join(",\n") + "\n}\n");
}
put(
  "awkward-keys.json",
  String.raw`{
  "quote\"key": 1,
  "back\\slash": 2,
  "new\nline": 3,
  "tilde~0": 4,
  "slash/key": 5,
  "emoji😀": 6,
  "lone\ud800surrogate": 7,
  "dot.key": 8,
  "": 9,
  "nested": { "it's": { "a/b~c": [10] } }
}
`,
);
put("numbers.json", '{\n  "huge": 1e400,\n  "negzero": -0,\n  "trailing": 0.10,\n  "big": 1234567890123456789012345678901234567890,\n  "small": 1E-7\n}\n');
put("nan.json", '{ "a": NaN, "b": Infinity }\n');
put("duplicate-keys.json", '{ "a": 1, "b": 2, "a": 3 }\n');
put("bom.json", "﻿" + '{ "bom": true }\n');
put("utf16le.json", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{ "utf16": "héllo 世界" }\r\n', "utf16le")]));
put("crlf-strings.json", '{\r\n  "text": "line1\\r\\nline2",\r\n  "n": 1\r\n}\r\n');

// ---- CSV
put("quoted-newlines.csv", 'id,note\r\n1,"first line\r\nsecond line"\r\n2,"has ""quotes"" and, commas"\r\n');
put("semicolon.csv", "id;name;amount\n1;Alice;3,50\n2;Bob;7,00\n");
put("ragged.csv", "a,b,c\n1,2\n3,4,5,6\n\n7\n");
put("duplicate-headers.csv", "name,name,value,\nx,y,1,z\n");
{
  const fd = openSync(join(root, "rows-1m.csv"), "w");
  writeSync(fd, "id,name,city,amount\n");
  let chunk = "";
  for (let i = 1; i <= 1_000_000; i++) {
    chunk += `${i},Name${i},City${i % 97},${(i * 1.25).toFixed(2)}\n`;
    if (chunk.length > 1 << 20) { writeSync(fd, chunk); chunk = ""; }
  }
  writeSync(fd, chunk);
  closeSync(fd);
}

// ---- Big-file edge cases (open with the large-file threshold set to 1 MB)
const lines = (n, eol, f = (i) => `line ${i} ${"x".repeat(40)}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join(eol);
put("big-cr-only.log", lines(40_000, "\r") + "\r");
put("big-mixed-eol.log", Array.from({ length: 40_000 }, (_, i) => `line ${i + 1} ${"y".repeat(40)}` + ["\n", "\r\n", "\r"][i % 3]).join(""));
put("big-no-trailing-newline.log", lines(40_000, "\n"));
put("empty.log", "");
{
  // Valid UTF-8 mixed with Latin-1 bytes and a few invalid sequences.
  const parts = [];
  for (let i = 0; i < 60_000; i++) {
    parts.push(Buffer.from(`row ${i} café `, "utf8"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0xff, 0xfe, 0xc3, 0x28, 0x0a]));
  }
  put("big-invalid-utf8.log", Buffer.concat(parts));
}
put("big-utf16le.log", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(lines(30_000, "\r\n", (i) => `utf16 line ${i} é世`) + "\r\n", "utf16le")]));

if (big) {
  // 100 MB JSON array of objects.
  {
    const fd = openSync(join(root, "huge-100mb.json"), "w");
    writeSync(fd, "[\n");
    let written = 2, i = 0, chunk = "";
    while (written < 100 * 1024 * 1024) {
      const rec = `${i ? ",\n" : ""}  {"id": ${i}, "name": "item ${i}", "tags": ["a", "b"], "value": ${i * 0.5}}`;
      chunk += rec; written += rec.length; i++;
      if (chunk.length > 1 << 20) { writeSync(fd, chunk); chunk = ""; }
    }
    writeSync(fd, chunk + "\n]\n");
    closeSync(fd);
  }
  // 500 MB single line.
  {
    const fd = openSync(join(root, "one-line-500mb.log"), "w");
    const block = Buffer.alloc(1 << 20, "abcdefghij");
    for (let i = 0; i < 500; i++) writeSync(fd, block);
    closeSync(fd);
  }
  // 500 MB of ordinary lines for edit / find / replace-all.
  {
    const fd = openSync(join(root, "lines-500mb.log"), "w");
    let chunk = "", written = 0, i = 0;
    while (written < 500 * 1024 * 1024) {
      const l = `2026-10-24T10:00:00Z INFO request ${i} took ${i % 1000} ms needle-${i % 50}\n`;
      chunk += l; written += l.length; i++;
      if (chunk.length > 4 << 20) { writeSync(fd, chunk); chunk = ""; }
    }
    writeSync(fd, chunk);
    closeSync(fd);
  }
  // Folder with 50 000 small files plus a big file, for Search in Files.
  const tree = join(root, "search-tree");
  if (!existsSync(join(tree, "d49", "f999.txt"))) {
    for (let d = 0; d < 50; d++) {
      const dir = join(tree, `d${d}`);
      mkdirSync(dir, { recursive: true });
      for (let f = 0; f < 1000; f++) writeFileSync(join(dir, `f${f}.txt`), `file ${d}/${f}\n${f % 10 === 0 ? "needle here\n" : "nothing\n"}`);
    }
  }
  const fd = openSync(join(tree, "big.log"), "w");
  let chunk = "";
  for (let i = 0; i < 1_500_000; i++) {
    chunk += `line ${i} ${i % 1000 === 0 ? "needle" : "hay"} ${"z".repeat(30)}\n`;
    if (chunk.length > 4 << 20) { writeSync(fd, chunk); chunk = ""; }
  }
  writeSync(fd, chunk);
  closeSync(fd);
}
console.log("fixtures written to", root);
