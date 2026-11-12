import { readText as readClipboard, writeText as writeClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { useSyncExternalStore } from "react";
import { editor } from "../editor/manager";
import { appData, fs } from "./ipc";
import { displayPath, resolveFolder, safeFileName } from "./macros";
import { activeDoc, useStore } from "./store";
import type { Script } from "./types";

export { displayPath, safeFileName };

const TIMEOUT_MS = 60_000;
const EXT = ".js";

// ---------- applicability ----------

/** Does a script's `when` filter accept this document? Scripts without a filter apply everywhere. */
export function scriptApplies(script: Pick<Script, "when">, doc: { language?: string; name?: string; path?: string | null } | null | undefined): boolean {
  if (!script.when) return true;
  if (!doc) return false;
  const { languages, extensions } = script.when;
  if (languages && doc.language && languages.includes(doc.language)) return true;
  if (extensions) {
    const n = (doc.path ?? doc.name ?? "").toLowerCase();
    if (extensions.some((e) => n.endsWith(e.toLowerCase()))) return true;
  }
  return false;
}

/** Human-readable summary of a script's filter for tooltips ("JSON only", ".csv, .tsv files only"). */
export function describeWhen(script: Pick<Script, "when">): string {
  if (!script.when) return "";
  const parts: string[] = [];
  if (script.when.languages?.length) parts.push(script.when.languages.join(" / "));
  if (script.when.extensions?.length) parts.push(script.when.extensions.join(", ") + " files");
  return parts.join(" or ") + " only";
}

/**
 * Scripts can declare their filter in header comments:
 *   // @languages JSON, YAML
 *   // @extensions .csv, .tsv
 */
function parseWhen(source: string): Script["when"] {
  const head = source.split("\n", 20).join("\n");
  const langs = /^\s*\/\/\s*@languages?\s*:?\s*(.+)$/im.exec(head)?.[1];
  const exts = /^\s*\/\/\s*@extensions?\s*:?\s*(.+)$/im.exec(head)?.[1];
  if (!langs && !exts) return undefined;
  const list = (s?: string) => s?.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  return { languages: list(langs), extensions: list(exts) };
}

// ---------- running ----------

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL("./scriptWorker.ts", import.meta.url), { type: "module" });
  return worker;
}

export interface ScriptRunResult {
  ok: boolean;
  message?: string;
}

// ---------- running indicator (tiny external store so panels and the status bar can subscribe) ----------

export interface ScriptRunState {
  running: boolean;
  /** Name of the script being run (or the document name for ad-hoc source). */
  name: string;
  startedAt: number;
}

let runState: ScriptRunState = { running: false, name: "", startedAt: 0 };
const runListeners = new Set<() => void>();
function setRunState(next: ScriptRunState) {
  runState = next;
  runListeners.forEach((l) => l());
}
export function getScriptRunState() {
  return runState;
}
/** React hook: current script run state. */
export function useScriptRunState(): ScriptRunState {
  return useSyncExternalStore(
    (l) => {
      runListeners.add(l);
      return () => runListeners.delete(l);
    },
    () => runState,
  );
}

let cancelCurrent: (() => void) | null = null;
/** Terminate the running script (the worker is killed and recreated on the next run). */
export function cancelScript() {
  cancelCurrent?.();
}

/** Lines the worker prepends to the script source inside the generated function (see scriptWorker.ts). */
export interface FormattedScriptError {
  /** One-line summary, e.g. `ReferenceError: foo is not defined`. */
  message: string;
  /** 1-based line in the user's script, when the stack points into it. */
  line?: number;
  column?: number;
  /** Stack with worker/blob URLs removed and positions mapped to script lines (for the console). */
  stack: string;
}

/**
 * Pure helper: map a worker error stack to the user's script. `lineOffset` is how many lines the
 * wrapper puts before script line 1 (so wrapperLine - lineOffset = scriptLine).
 */
export function formatScriptError(raw: string, lineOffset: number): FormattedScriptError {
  const lines = String(raw ?? "").split(/\r?\n/);
  const message = (lines[0] ?? "Script error").trim() || "Script error";
  let line: number | undefined;
  let column: number | undefined;
  const m = /<anonymous>:(\d+):(\d+)/.exec(raw);
  if (m) {
    const l = Number(m[1]) - lineOffset;
    if (l >= 1) {
      line = l;
      column = Number(m[2]);
    }
  }
  const frames = lines
    .slice(1)
    .filter((f) => !/scriptWorker|blob:|https?:\/\/|self\.onmessage/.test(f) || /<anonymous>:\d+:\d+/.test(f))
    .map((f) =>
      f
        .replace(/\(eval at [^()]*\([^()]*\),\s*/, "(")
        .replace(/<anonymous>:(\d+):(\d+)/g, (_, l: string, c: string) => `script:${Math.max(1, Number(l) - lineOffset)}:${c}`)
        .replace(/\bat eval\b/, "at script"),
    );
  const stack = [message, ...frames].join("\n");
  return { message, line, column, stack };
}

export async function runScript(source: string, args?: unknown, script?: Pick<Script, "name" | "when">): Promise<ScriptRunResult> {
  const store = useStore.getState();
  const doc = activeDoc(store);
  if (!doc || doc.kind !== "text") {
    store.toast("Scripts run on a regular text document. Open one first.", "warning");
    return { ok: false };
  }
  const view = editor.view;
  if (!view || editor.currentDocId !== doc.id) return { ok: false };
  if (script && !scriptApplies(script, doc)) {
    store.toast(`"${script.name}" is for ${describeWhen(script).replace(/ only$/, "")} documents.`, "warning");
    return { ok: false };
  }
  const text = view.state.doc.toString();
  const selections = view.state.selection.ranges.map((r) => ({ from: r.from, to: r.to }));
  let clip = "";
  try {
    clip = (await readClipboard()) ?? "";
  } catch {
    /* clipboard may be empty or non-text */
  }

  if (runState.running) {
    store.toast("A script is already running. Cancel it first.", "warning");
    return { ok: false, message: "busy" };
  }

  store.set({ bottomVisible: true, bottomTab: "console" });
  store.log(`▶ Running script on ${doc.name}`, "info");
  const w = getWorker();
  const started = performance.now();
  setRunState({ running: true, name: script?.name ?? "script", startedAt: Date.now() });

  return new Promise<ScriptRunResult>((resolveRaw) => {
    let settled = false;
    const resolve = (r: ScriptRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cancelCurrent = null;
      setRunState({ running: false, name: "", startedAt: 0 });
      resolveRaw(r);
    };
    const kill = (why: string, kind: "error" | "info") => {
      w.terminate();
      worker = null;
      store.log(why, kind);
      store.toast(why, kind === "error" ? "error" : "info", 4000);
    };
    const timer = setTimeout(() => {
      kill(`Script timed out after ${TIMEOUT_MS / 1000}s and was terminated.`, "error");
      resolve({ ok: false, message: "timeout" });
    }, TIMEOUT_MS);
    cancelCurrent = () => {
      kill("Script cancelled.", "info");
      resolve({ ok: false, message: "cancelled" });
    };

    w.onmessage = async (ev: MessageEvent) => {
      const msg = ev.data;
      for (const l of msg.logs ?? []) store.log(l.text, l.kind);
      if (msg.type === "error") {
        const err = formatScriptError(msg.message, typeof msg.lineOffset === "number" ? msg.lineOffset : 0);
        store.log(err.stack, "error");
        store.toast(err.line ? `Script failed at line ${err.line}: ${err.message}` : `Script failed: ${err.message}`, "error", 6000);
        resolve({ ok: false, message: err.message });
        return;
      }
      const selTexts: (string | null)[] = msg.selectionTexts ?? [];
      const editsSelection = selTexts.some((s) => s !== null);
      const fail = (why: string) => {
        store.log(why, "error");
        store.toast(why, "error", 6000);
        resolve({ ok: false, message: why });
      };
      if (editsSelection && typeof msg.text === "string") {
        // Selection offsets refer to the original text, so they can't be applied on top of doc edits.
        fail("The script changed both the document (doc) and the selection. Use one or the other in a run; nothing was changed.");
        return;
      }
      const cur = editor.view;
      if (!cur || editor.currentDocId !== doc.id) {
        if (editsSelection || typeof msg.text === "string" || msg.newSelection) {
          fail(`The script finished after you switched away from ${doc.name}, so its changes were not applied.`);
          return;
        }
      } else {
        // Apply edits as one undoable transaction.
        if (editsSelection) {
          const ranges = cur.state.selection.ranges;
          const changes = ranges
            .map((r, i) => (selTexts[i] !== null && selTexts[i] !== undefined ? { from: r.from, to: r.to, insert: selTexts[i] as string } : null))
            .filter((c): c is { from: number; to: number; insert: string } => !!c);
          cur.dispatch({ changes, userEvent: "input.script" });
        } else if (typeof msg.text === "string") {
          editor.replaceAll(doc.id, msg.text);
        }
        if (msg.newSelection) editor.selectRange(msg.newSelection.from, msg.newSelection.to);
      }
      if (typeof msg.clipboard === "string") {
        try {
          await writeClipboard(msg.clipboard);
        } catch {
          /* ignore */
        }
      }
      const ms = Math.round(performance.now() - started);
      store.log(`✓ Done in ${ms} ms`, "success");
      resolve({ ok: true });
    };
    w.onerror = (e) => {
      const err = formatScriptError(String(e.message ?? e), 0);
      store.log(err.stack, "error");
      store.toast(`Script failed: ${err.message}`, "error", 6000);
      resolve({ ok: false, message: err.message });
    };
    w.postMessage({
      type: "run",
      source,
      text,
      selections,
      path: doc.path,
      name: doc.name,
      eol: doc.eol,
      clipboard: clip,
      args,
    });
  });
}

/** Run a script N times in a row; stops early on failure. Returns how many runs completed. */
export async function runScriptTimes(script: Script, times: number): Promise<number> {
  let n = 0;
  for (; n < times; n++) {
    const r = await runScript(script.source, undefined, script);
    if (!r.ok) break;
  }
  return n;
}

/**
 * Repeat a script until it stops changing anything (document text and selection unchanged),
 * with an iteration guard. Mirrors "play macro until end of file".
 */
export async function runScriptToEnd(script: Script, maxIterations = 10_000): Promise<number> {
  let n = 0;
  for (; n < maxIterations; n++) {
    const v = editor.view;
    if (!v) break;
    const beforeText = v.state.doc.toString();
    const beforeSel = v.state.selection.toJSON();
    const r = await runScript(script.source, undefined, script);
    if (!r.ok) break;
    const after = editor.view;
    if (!after) break;
    if (after.state.doc.toString() === beforeText && JSON.stringify(after.state.selection.toJSON()) === JSON.stringify(beforeSel)) {
      n++;
      break;
    }
  }
  return n;
}

// ---------- folder-backed scripts ----------
// Every script is a plain .js file in the scripts folder or one of its subfolders (Settings › Folders,
// default <app data>\scripts). The file name is the script name; scripts are edited in ordinary tabs.

/** Resolve the scripts folder (see resolveFolder in macros.ts). */
export function scriptsDir(): Promise<string> {
  return resolveFolder("scriptsDir", "scripts", "Scripts");
}

/** Is this file a script (by extension)? */
export function isScriptPath(path: string): boolean {
  return path.toLowerCase().endsWith(EXT);
}

/** A script's name: its file name without `.js`. */
export function scriptNameOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return isScriptPath(base) ? base.slice(0, -EXT.length) : base;
}

/** File name for a new script typed into the tree: `.js` is added unless an extension was given. */
export function newScriptFileName(name: string): string {
  return /\.[A-Za-z0-9]+$/.test(name) ? name : name + EXT;
}

/** What a new script starts with. */
export const NEW_SCRIPT_SOURCE = "// Transform the current document.\n// See the API reference (book icon in the Scripts panel) for doc, selection, util, clipboard.\n\ndoc.mapLines((line, i) => line);\n";

/**
 * Read a script for running. When its file is open in a tab, the tab's text is used (unsaved edits
 * included), so a script can be tried before it is saved.
 */
export async function readScript(path: string): Promise<Script> {
  const open = useStore.getState().docs.find((d) => d.kind === "text" && d.path?.toLowerCase() === path.toLowerCase());
  const live = open ? editor.stateOf(open.id)?.doc.toString() : undefined;
  const source = live ?? (await fs.readText(path)).content;
  return { id: path, path, name: scriptNameOf(path), source, updatedAt: Date.now(), when: parseWhen(source) };
}

/** One-time import of the old scripts.json store into individual files. */
export async function migrateLegacyScripts() {
  try {
    const raw = await appData.read("scripts.json");
    if (!raw) return;
    const dir = await scriptsDir();
    const old = JSON.parse(raw) as { name: string; source: string; builtin?: boolean }[];
    for (const s of old) {
      if (s.builtin) continue;
      const p = `${dir}\\${safeFileName(s.name)}${EXT}`;
      if (!(await fs.exists(p))) await fs.writeText(p, s.source);
    }
    await appData.write("scripts.json", "");
  } catch {
    /* ignore */
  }
}

// ---------- API reference ----------
// Keep in sync with the objects built in scriptWorker.ts; the panel renders this list.

export interface ApiEntry {
  sig: string;
  desc: string;
}
export interface ApiGroup {
  name: string;
  items: ApiEntry[];
}

export const SCRIPT_API: ApiGroup[] = [
  {
    name: "doc",
    items: [
      { sig: "doc.text", desc: "whole document (read / assign)" },
      { sig: "doc.lines", desc: "array of lines (read / assign)" },
      { sig: "doc.lineCount", desc: "number of lines" },
      { sig: "doc.length", desc: "length in characters" },
      { sig: "doc.name", desc: "file name" },
      { sig: "doc.path", desc: "full path or null" },
      { sig: "doc.eol", desc: "line ending in use" },
      { sig: "doc.mapLines((line, i) => …)", desc: "transform lines; return null to delete" },
      { sig: "doc.filterLines((line, i) => bool)", desc: "keep matching lines" },
      { sig: "doc.replace(pattern, repl)", desc: "string or RegExp replace, document-wide" },
      { sig: "doc.insert(offset, text)", desc: "insert at a character offset" },
      { sig: "doc.append(text)", desc: "add to the end" },
      { sig: "doc.prepend(text)", desc: "add to the start" },
      { sig: "doc.lineAt(offset)", desc: "1-based line number at an offset" },
      { sig: "doc.select(from, to)", desc: "set the selection after the run" },
    ],
  },
  {
    name: "selection",
    items: [
      { sig: "selection.text", desc: "selected text (read / assign)" },
      { sig: "selection.lines", desc: "selected text as lines (read / assign)" },
      { sig: "selection.all", desc: "every range: { from, to, text }" },
      { sig: "selection.isEmpty", desc: "true when nothing is selected" },
      { sig: "selection.map((text, i, range) => …)", desc: "transform each range (column mode)" },
    ],
  },
  {
    name: "util",
    items: [
      { sig: "util.sort(lines, { numeric, desc, caseInsensitive })", desc: "locale-aware sort" },
      { sig: "util.unique(lines)", desc: "drop duplicate lines" },
      { sig: "util.trimLines(lines)", desc: "strip trailing whitespace" },
      { sig: "util.pad(text, width, ch)", desc: "left-pad to a width" },
      { sig: "util.csvSplit(line, delim)", desc: "split one CSV line (quotes aware)" },
      { sig: "util.json.parse(text)", desc: "JSON.parse" },
      { sig: "util.json.stringify(value, indent)", desc: "pretty JSON" },
    ],
  },
  {
    name: "clipboard / console",
    items: [
      { sig: "clipboard.text", desc: "clipboard contents (read / assign)" },
      { sig: "console.log / info / warn / error", desc: "appear in the Console panel" },
      { sig: "args", desc: "value passed when run from a command" },
      { sig: "return \"…\"", desc: "a returned string replaces the document" },
    ],
  },
  {
    name: "header comments",
    items: [
      { sig: "// @languages JSON, YAML", desc: "offer only for these languages" },
      { sig: "// @extensions .csv, .tsv", desc: "offer only for these file types" },
    ],
  },
];

/** Plain-text version of the reference (comment block for new scripts / copy). */
export const SCRIPT_API_HELP = SCRIPT_API.map((g) => `// ${g.name}\n` + g.items.map((i) => `//   ${i.sig}  — ${i.desc}`).join("\n")).join("\n");
