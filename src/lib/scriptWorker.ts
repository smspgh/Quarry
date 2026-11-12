/**
 * Sandboxed script runner. Receives a snapshot of the active document, exposes a
 * small, friendly API, and posts back the edits plus console output.
 */

interface RunRequest {
  type: "run";
  source: string;
  text: string;
  selections: { from: number; to: number }[];
  path: string | null;
  name: string;
  eol: string;
  clipboard: string;
  args?: unknown;
}

interface SelectionApi {
  from: number;
  to: number;
  text: string;
}

const logs: { kind: "log" | "error" | "info"; text: string }[] = [];

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a, null, 2);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

self.onmessage = async (ev: MessageEvent<RunRequest>) => {
  const req = ev.data;
  if (req.type !== "run") return;
  logs.length = 0;

  const eol = req.eol === "CRLF" ? "\r\n" : req.eol === "CR" ? "\r" : "\n";
  let text = req.text;
  const selections: SelectionApi[] = req.selections.map((s) => ({ from: s.from, to: s.to, text: req.text.slice(s.from, s.to) }));
  const selectionTexts: (string | null)[] = selections.map(() => null);
  let clipboardOut: string | null = null;
  let newSelection: { from: number; to: number } | null = null;

  const splitLines = (s: string) => s.split(/\r\n|\r|\n/);

  const doc = {
    get text() {
      return text;
    },
    set text(v: string) {
      text = String(v);
    },
    get lines(): string[] {
      return splitLines(text);
    },
    set lines(v: string[]) {
      text = v.join(eol);
    },
    get lineCount() {
      return splitLines(text).length;
    },
    get length() {
      return text.length;
    },
    path: req.path,
    name: req.name,
    eol,
    /** Map every line through fn (return null to delete the line). */
    mapLines(fn: (line: string, index: number) => string | null | undefined) {
      const out: string[] = [];
      splitLines(text).forEach((l, i) => {
        const r = fn(l, i);
        if (r !== null && r !== undefined) out.push(String(r));
      });
      text = out.join(eol);
    },
    filterLines(fn: (line: string, index: number) => boolean) {
      text = splitLines(text).filter((l, i) => fn(l, i)).join(eol);
    },
    replace(pattern: string | RegExp, replacement: string | ((...m: string[]) => string)) {
      const re = typeof pattern === "string" ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : pattern;
      text = text.replace(re, replacement as string);
    },
    insert(offset: number, s: string) {
      text = text.slice(0, offset) + s + text.slice(offset);
    },
    append(s: string) {
      text += s;
    },
    prepend(s: string) {
      text = s + text;
    },
    lineAt(offset: number) {
      const before = text.slice(0, offset);
      return splitLines(before).length;
    },
    select(from: number, to: number) {
      newSelection = { from, to };
    },
  };

  const selection = {
    get all() {
      return selections;
    },
    get text() {
      return selections.map((s) => s.text).join(eol);
    },
    set text(v: string) {
      if (selections.length === 1) selectionTexts[0] = String(v);
      else {
        const parts = splitLines(String(v));
        selections.forEach((_, i) => (selectionTexts[i] = parts[i] ?? ""));
      }
    },
    get isEmpty() {
      return selections.every((s) => s.from === s.to);
    },
    /** Transform each selection's text independently (works with column-mode blocks). */
    map(fn: (text: string, index: number, sel: SelectionApi) => string) {
      selections.forEach((s, i) => (selectionTexts[i] = String(fn(s.text, i, s))));
    },
    get lines(): string[] {
      return splitLines(this.text);
    },
    set lines(v: string[]) {
      this.text = v.join(eol);
    },
  };

  const util = {
    sort: (lines: string[], opts: { numeric?: boolean; desc?: boolean; caseInsensitive?: boolean } = {}) => {
      const c = new Intl.Collator(undefined, { numeric: !!opts.numeric, sensitivity: opts.caseInsensitive ? "base" : "variant" });
      const out = [...lines].sort((a, b) => c.compare(a, b));
      return opts.desc ? out.reverse() : out;
    },
    unique: (lines: string[]) => Array.from(new Set(lines)),
    trimLines: (lines: string[]) => lines.map((l) => l.replace(/\s+$/, "")),
    pad: (s: string, n: number, ch = " ") => s.padStart(n, ch),
    csvSplit: (line: string, delim = ",") => {
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
    },
    json: {
      parse: (s: string) => JSON.parse(s),
      stringify: (v: unknown, indent = 2) => JSON.stringify(v, null, indent),
    },
  };

  const clipboard = {
    get text() {
      return req.clipboard;
    },
    set text(v: string) {
      clipboardOut = String(v);
    },
  };

  const console = {
    log: (...a: unknown[]) => logs.push({ kind: "log", text: fmt(a) }),
    info: (...a: unknown[]) => logs.push({ kind: "info", text: fmt(a) }),
    warn: (...a: unknown[]) => logs.push({ kind: "info", text: fmt(a) }),
    error: (...a: unknown[]) => logs.push({ kind: "error", text: fmt(a) }),
  };

  try {
    const fn = new AsyncFunction(...PARAMS, `${PRELUDE}${req.source}`);
    const result = await fn(doc, selection, util, clipboard, console, req.args);
    if (typeof result === "string" && result !== text && selectionTexts.every((s) => s === null)) {
      // Returning a string from the script replaces the document.
      text = result;
    }
    (self as unknown as Worker).postMessage({
      type: "done",
      text: text !== req.text ? text : null,
      selectionTexts,
      clipboard: clipboardOut,
      newSelection,
      logs,
    });
  } catch (e) {
    const err = e as Error;
    (self as unknown as Worker).postMessage({ type: "error", message: err?.stack || err?.message || String(e), logs, lineOffset: await wrapperLineOffset() });
  }
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (...args: unknown[]) => Promise<unknown>;
const PARAMS = ["doc", "selection", "util", "clipboard", "console", "args"];
/** Prepended to every script; its line count is part of the error line-number offset. */
const PRELUDE = '"use strict";\n';

let lineOffset: number | null = null;
/**
 * How many lines the generated function puts before script line 1 (the Function-constructor
 * header plus PRELUDE). Measured once by throwing from a probe body so it matches the engine exactly.
 */
async function wrapperLineOffset(): Promise<number> {
  if (lineOffset !== null) return lineOffset;
  try {
    await new AsyncFunction(...PARAMS, `${PRELUDE}throw new Error("probe");`)();
  } catch (e) {
    const m = /<anonymous>:(\d+):\d+/.exec((e as Error)?.stack ?? "");
    if (m) lineOffset = Number(m[1]) - 1;
  }
  if (lineOffset === null) lineOffset = PRELUDE.split("\n").length - 1 + 2;
  return lineOffset;
}
