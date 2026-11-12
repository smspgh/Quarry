/**
 * Syntax colours for large-file mode. Only the lines on screen are drawn, so each is coloured on
 * its own by a small, fast tokenizer: the cost is the same for a 1 MB or a 50 GB file. Line by line
 * means no state carries across lines, which suits the formats large files come in (JSON, JSONL,
 * logs, CSV / TSV, XML, SQL dumps); a construct spanning lines (an XML comment, say) is coloured
 * only on its first line.
 */

export type BigLang = "json" | "log" | "csv" | "tsv" | "xml" | "sql";

/** A coloured span `[from, to)` of a line; `cls` is a CSS class suffix (`.hl-<cls>`). */
export interface Token {
  from: number;
  to: number;
  cls: string;
}

/** Colour at most this much of a line; the rest (rarely on screen anyway) stays plain. */
export const MAX_COLOURED = 4000;

const EXT: Record<string, BigLang> = {
  json: "json", jsonc: "json", json5: "json", jsonl: "json", ndjson: "json", geojson: "json", har: "json",
  log: "log", out: "log", err: "log",
  csv: "csv", tsv: "tsv", tab: "tsv",
  xml: "xml", html: "xml", htm: "xml", svg: "xml", xhtml: "xml", plist: "xml", xsd: "xml", kml: "xml", gpx: "xml",
  sql: "sql",
};

const TIMESTAMP = /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2}([.,]\d+)?)?(Z|\s?[+-]\d{2}:?\d{2})?|\d{1,2}\/\d{1,2}\/\d{2,4}[ T]\d{1,2}:\d{2}(:\d{2})?|[A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2})\]?/;
const LEVEL = /\b(FATAL|CRITICAL|CRIT|SEVERE|ERROR|ERR|FAIL(?:ED|URE)?|WARN(?:ING)?|NOTICE|INFO|DEBUG|TRACE|VERBOSE)\b/;

/**
 * Pure helper (testable): the colouring for a large file, from its name and (for files whose
 * extension says nothing, like .txt) its first lines. `null` = plain text.
 */
export function bigLanguageOf(name: string, firstLines: readonly string[] = []): BigLang | null {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (EXT[ext]) return EXT[ext];
  const sample = firstLines.filter((l) => l.trim()).slice(0, 40);
  if (sample.length === 0) return null;
  const share = (re: RegExp) => sample.filter((l) => re.test(l)).length / sample.length;
  if (share(TIMESTAMP) >= 0.5 || share(LEVEL) >= 0.6) return "log";
  if (share(/^\s*[{[]/) >= 0.8 && share(/"\s*:/) >= 0.5) return "json";
  if (share(/^\s*</) >= 0.7) return "xml";
  return null;
}

const JSON_NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WORD = /[A-Za-z_][\w$]*/y;

function stringEnd(s: string, i: number, quote: string): number {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "\\") j++;
    else if (s[j] === quote) return j + 1;
  }
  return s.length;
}

function json(s: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === '"') {
      const end = stringEnd(s, i, '"');
      let j = end;
      while (s[j] === " " || s[j] === "\t") j++;
      out.push({ from: i, to: end, cls: s[j] === ":" ? "key" : "str" });
      i = end;
    } else if (c === "/" && s[i + 1] === "/") {
      out.push({ from: i, to: s.length, cls: "com" });
      break;
    } else if (c === "-" || (c >= "0" && c <= "9")) {
      JSON_NUMBER.lastIndex = i;
      const m = JSON_NUMBER.exec(s);
      const end = m ? i + m[0].length : i + 1;
      out.push({ from: i, to: end, cls: "num" });
      i = end;
    } else if (/[A-Za-z]/.test(c)) {
      WORD.lastIndex = i;
      const w = WORD.exec(s)![0];
      if (w === "true" || w === "false" || w === "null") out.push({ from: i, to: i + w.length, cls: "bool" });
      i += w.length;
    } else if ("{}[],:".includes(c)) {
      out.push({ from: i, to: i + 1, cls: "punc" });
      i++;
    } else i++;
  }
  return out;
}

const LEVEL_CLASS: Record<string, string> = { FATAL: "err", CRITICAL: "err", CRIT: "err", SEVERE: "err", ERROR: "err", ERR: "err", FAIL: "err", FAILED: "err", FAILURE: "err", WARN: "warn", WARNING: "warn", NOTICE: "info", INFO: "info", DEBUG: "dbg", TRACE: "dbg", VERBOSE: "dbg" };

function log(s: string): Token[] {
  const out: Token[] = [];
  const ts = TIMESTAMP.exec(s);
  let i = ts ? ts[0].length : 0;
  if (ts) out.push({ from: 0, to: i, cls: "time" });
  let levelDone = false;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      const end = stringEnd(s, i, '"');
      out.push({ from: i, to: end, cls: "str" });
      i = end;
    } else if (c === "[") {
      const end = s.indexOf("]", i);
      if (end > i && end - i < 80) {
        out.push({ from: i, to: end + 1, cls: "tag" });
        i = end + 1;
      } else i++;
    } else if (/[A-Za-z_]/.test(c) && (i === 0 || !/[\w.]/.test(s[i - 1]))) {
      WORD.lastIndex = i;
      const w = WORD.exec(s)![0];
      const lvl = LEVEL_CLASS[w];
      if (lvl && !levelDone) {
        out.push({ from: i, to: i + w.length, cls: `lvl-${lvl}` });
        levelDone = true;
        i += w.length;
      } else if (s[i + w.length] === "=" || (s[i + w.length] === ":" && s[i + w.length + 1] === " ")) {
        out.push({ from: i, to: i + w.length, cls: "key" });
        i += w.length;
      } else i += w.length;
    } else if (c >= "0" && c <= "9" && (i === 0 || !/[\w.]/.test(s[i - 1]))) {
      let j = i;
      while (j < s.length && /[\d.]/.test(s[j])) j++;
      if (j === s.length || !/\w/.test(s[j])) out.push({ from: i, to: j, cls: "num" });
      i = j;
    } else i++;
  }
  return out;
}

/** CSV / TSV: each column gets one of six colours, so a row is easy to follow across the screen. */
function delimited(s: string, sep: string): Token[] {
  const out: Token[] = [];
  let col = 0;
  for (let i = 0; i <= s.length; ) {
    let end: number;
    if (s[i] === '"' && sep === ",") {
      // A quoted field: "" is an escaped quote.
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') j++;
          else break;
        }
      }
      end = s.indexOf(sep, j);
    } else end = s.indexOf(sep, i);
    if (end < 0) end = s.length;
    if (end > i) out.push({ from: i, to: end, cls: `col${col % 6}` });
    if (end >= s.length) break;
    out.push({ from: end, to: end + 1, cls: "punc" });
    i = end + 1;
    col++;
  }
  return out;
}

function xml(s: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < s.length; ) {
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i);
      const to = end < 0 ? s.length : end + 3;
      out.push({ from: i, to, cls: "com" });
      i = to;
    } else if (s[i] === "<") {
      let j = i + 1;
      if (s[j] === "/" || s[j] === "?" || s[j] === "!") j++;
      out.push({ from: i, to: j, cls: "punc" });
      let k = j;
      while (k < s.length && /[\w:.-]/.test(s[k])) k++;
      if (k > j) out.push({ from: j, to: k, cls: "tagname" });
      i = k;
      // Attributes until the end of the tag.
      while (i < s.length && s[i] !== ">") {
        if (/[\w:-]/.test(s[i])) {
          let a = i;
          while (a < s.length && /[\w:.-]/.test(s[a])) a++;
          out.push({ from: i, to: a, cls: "attr" });
          i = a;
        } else if (s[i] === '"' || s[i] === "'") {
          const end = stringEnd(s, i, s[i]);
          out.push({ from: i, to: end, cls: "str" });
          i = end;
        } else if (s[i] === "/" || s[i] === "?" || s[i] === "=") {
          out.push({ from: i, to: i + 1, cls: "punc" });
          i++;
        } else i++;
      }
      if (s[i] === ">") {
        out.push({ from: i, to: i + 1, cls: "punc" });
        i++;
      }
    } else {
      const next = s.indexOf("<", i);
      i = next < 0 ? s.length : next;
    }
  }
  return out;
}

const SQL_KEYWORDS = new Set(
  "select from where insert into values update set delete create table drop alter add column index primary key foreign references not null default unique and or in is like between join left right inner outer full cross on as group by order having limit offset union all distinct case when then else end begin commit rollback transaction exists if replace view trigger procedure function returns return declare int integer bigint smallint tinyint varchar char text date datetime timestamp time boolean bool float double decimal numeric real blob lock tables unlock engine charset collate auto_increment constraint check with grant revoke use database schema"
    .split(" "),
);

function sql(s: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === "-" && s[i + 1] === "-") {
      out.push({ from: i, to: s.length, cls: "com" });
      break;
    } else if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      const to = end < 0 ? s.length : end + 2;
      out.push({ from: i, to, cls: "com" });
      i = to;
    } else if (c === "'" || c === '"' || c === "`") {
      const end = stringEnd(s, i, c);
      out.push({ from: i, to: end, cls: c === "`" ? "key" : "str" });
      i = end;
    } else if (/[A-Za-z_]/.test(c)) {
      WORD.lastIndex = i;
      const w = WORD.exec(s)![0];
      if (SQL_KEYWORDS.has(w.toLowerCase())) out.push({ from: i, to: i + w.length, cls: w.toLowerCase() === "null" ? "bool" : "kw" });
      i += w.length;
    } else if (c >= "0" && c <= "9" && (i === 0 || !/\w/.test(s[i - 1]))) {
      let j = i;
      while (j < s.length && /[\d.]/.test(s[j])) j++;
      out.push({ from: i, to: j, cls: "num" });
      i = j;
    } else i++;
  }
  return out;
}

/** Pure helper (testable): the coloured spans of one line (sorted, non-overlapping). */
export function tokenize(lang: BigLang, line: string): Token[] {
  const s = line.length > MAX_COLOURED ? line.slice(0, MAX_COLOURED) : line;
  switch (lang) {
    case "json": return json(s);
    case "log": return log(s);
    case "csv": return delimited(s, ",");
    case "tsv": return delimited(s, "\t");
    case "xml": return xml(s);
    case "sql": return sql(s);
  }
}

/** A run of a line to draw: its text, its colour class (if any), and whether it is the search hit. */
export interface Segment {
  text: string;
  cls: string | null;
  hit: boolean;
}

/**
 * Pure helper (testable): the line cut into segments by `tokens`, with the search hit `[hit[0],
 * hit[1])` (if any) marked across whatever tokens it covers.
 */
export function segments(text: string, tokens: readonly Token[], hit: readonly [number, number] | null): Segment[] {
  const cuts = new Set<number>([0, text.length]);
  for (const t of tokens) {
    cuts.add(Math.min(t.from, text.length));
    cuts.add(Math.min(t.to, text.length));
  }
  if (hit) {
    cuts.add(Math.min(hit[0], text.length));
    cuts.add(Math.min(hit[1], text.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  let t = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k];
    const b = points[k + 1];
    if (b <= a) continue;
    while (t < tokens.length && tokens[t].to <= a) t++;
    const cls = t < tokens.length && tokens[t].from <= a && tokens[t].to >= b ? tokens[t].cls : null;
    const isHit = !!hit && a >= hit[0] && b <= hit[1];
    const last = out[out.length - 1];
    if (last && last.cls === cls && last.hit === isHit) last.text += text.slice(a, b);
    else out.push({ text: text.slice(a, b), cls, hit: isHit });
  }
  return out;
}
