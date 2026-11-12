/** Small data-conversion helpers used by the JSON menu commands (previously built-in scripts). */

export function csvSplit(line: string, delim = ","): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * JSON → CSV. An array of objects becomes a header row (union of keys, in first-seen order) plus
 * one row per record; a single object becomes one row. Nested values are written as JSON text.
 */
export function jsonToCsv(text: string): { ok: true; output: string; rows: number; columns: number } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const rows = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
  if (rows.some((r) => r === null || typeof r !== "object" || Array.isArray(r))) {
    return { ok: false, error: "Expected an object or an array of objects." };
  }
  const header: string[] = [];
  for (const r of rows) for (const k of Object.keys(r ?? {})) if (!header.includes(k)) header.push(k);
  const out = [header.map(csvCell).join(",")];
  for (const r of rows) out.push(header.map((k) => csvCell(r?.[k])).join(","));
  return { ok: true, output: out.join("\n"), rows: rows.length, columns: header.length };
}

/**
 * Split CSV text into records (RFC 4180): quoted cells may contain the delimiter, `""` and line
 * breaks; records end at LF, CRLF or a lone CR outside quotes. Blank lines are skipped.
 */
export function csvRecords(text: string, delim = ","): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  let any = false; // the current record has content (so a blank line is not a record)
  const endRow = () => {
    if (any || row.length) {
      row.push(cell);
      out.push(row);
    }
    row = [];
    cell = "";
    any = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      q = true;
      any = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
      any = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      cell += ch;
      if (ch !== " " && ch !== "\t") any = true;
    }
  }
  endRow();
  return out;
}

/** Most likely delimiter: the candidate that splits the first few records into the most, most consistent columns. */
export function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 64 * 1024);
  let best = ",";
  let bestScore = 0;
  for (const d of [",", ";", "\t", "|"]) {
    const recs = csvRecords(sample, d).slice(0, 20);
    if (recs.length === 0) continue;
    const width = recs[0].length;
    if (width < 2) continue;
    const consistent = recs.filter((r) => r.length === width).length / recs.length;
    const score = width * consistent;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/**
 * CSV/TSV → JSON array of objects keyed by the header row. The delimiter is sniffed (comma,
 * semicolon, tab or pipe) and quoted cells may span lines. Cells stay strings (no type inference).
 * Duplicate or empty header names are made unique (`name_2`, `column_3`); rows with more cells
 * than the header keep the surplus under `_extra`. `warnings` lists anything the caller should surface.
 */
export function csvToJson(text: string, indent = 2): { ok: true; output: string; rows: number; warnings: string[] } | { ok: false; error: string } {
  if (!text.trim()) return { ok: false, error: "The document is empty." };
  const delim = sniffDelimiter(text);
  const records = csvRecords(text, delim);
  if (records.length === 0) return { ok: false, error: "The document is empty." };
  if (records[0].length < 2 && !records.some((r) => r.length > 1)) {
    return { ok: false, error: "This does not look like CSV or TSV (no comma-, semicolon-, tab- or pipe-separated columns)." };
  }
  if (records.length < 2) return { ok: false, error: "Only a header row was found; there are no data rows to convert." };
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  let renamed = 0;
  const header = records[0].map((raw, i) => {
    let h = raw.trim() || `column_${i + 1}`;
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    if (n > 1 || !raw.trim()) renamed++;
    if (n > 1) h = `${h}_${n}`;
    return h;
  });
  let extraRows = 0;
  let shortRows = 0;
  const rows = records.slice(1).map((cells) => {
    const rec: Record<string, unknown> = {};
    for (let i = 0; i < header.length; i++) rec[header[i]] = cells[i] ?? "";
    if (cells.length > header.length) {
      extraRows++;
      rec._extra = cells.slice(header.length);
    } else if (cells.length < header.length) shortRows++;
    return rec;
  });
  if (delim !== ",") warnings.push(`Detected ${delim === "\t" ? "tab" : delim === ";" ? "semicolon" : "pipe"}-separated values.`);
  if (renamed) warnings.push(`${renamed} header name${renamed === 1 ? " was" : "s were"} empty or duplicated and renamed (e.g. "name_2").`);
  if (extraRows) warnings.push(`${extraRows} row${extraRows === 1 ? " has" : "s have"} more cells than the header; the surplus is kept under "_extra".`);
  if (shortRows) warnings.push(`${shortRows} row${shortRows === 1 ? " has" : "s have"} fewer cells than the header; missing cells are empty strings.`);
  return { ok: true, output: JSON.stringify(rows, null, indent), rows: rows.length, warnings };
}

/** Top-level keys of an object, or of the first element when the root is an array. */
export function topLevelKeys(text: string): { ok: true; keys: string[] } | { ok: false; error: string } {
  try {
    const data = JSON.parse(text);
    const obj = Array.isArray(data) ? data[0] ?? {} : data;
    if (obj === null || typeof obj !== "object") return { ok: false, error: "Root value has no keys." };
    return { ok: true, keys: Object.keys(obj) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
