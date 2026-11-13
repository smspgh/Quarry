/**
 * Command registry: every user-facing action has an id, a title, an optional
 * keybinding and a run function. The palette, shortcuts, macros and menus all go through here.
 */
import {
  copyLineDown,
  copyLineUp,
  cursorMatchingBracket,
  deleteLine,
  indentLess,
  indentMore,
  moveLineDown,
  moveLineUp,
  redo,
  selectAll,
  toggleBlockComment,
  toggleComment,
  undo,
} from "@codemirror/commands";
import { foldAll, foldCode, unfoldAll, unfoldCode } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { detectLanguage, sniffLanguage } from "../editor/cmSetup";
import { formatDocument } from "./format";
import * as lineFns from "./lineTransforms";
import { findNext, findPrevious, selectNextOccurrence } from "@codemirror/search";
import { MAX_OCCURRENCES, occurrenceSelection, selectAllFindMatches } from "../editor/bulkEdit";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { editor } from "../editor/manager";
import { blockCommands } from "../editor/columnMode";
import {
  closeAll,
  hasClosedTabs,
  reopenClosedTab,
  closeDocument,
  closeOthers,
  formatBytes,
  newDocument,
  nextTab,
  openFileDialog,
  dirName,
  openFolder,
  openFolderDialog,
  openPath,
  samePath,
  persistSettings,
  revertDocument,
  saveAll,
  saveDocument,
  showInExplorerPanel,
  showInWindowsExplorer,
} from "./actions";
import { bus } from "./bus";
import { compareCandidate, compareWithSelected, openCompare, patchDiff, selectForCompare, swapDiff } from "./diff";
import { stepChange } from "../components/DiffView";
import { hasLsp, lspCommands, restartServers, useLsp } from "./lsp";
import { nextDiagnostic, previousDiagnostic } from "@codemirror/lint";
import { startCompletion } from "@codemirror/autocomplete";
import { openClaudeTerminal } from "./terminal";
import { appendToDraft, claudeBusy, claudeEnabled, claudeTabFor, contextFor, interruptClaude, newClaudeSession, openClaudeTab } from "./claude";
import { makeRoom } from "./tabLimit";
import { big, json as jsonIpc } from "./ipc";
import { copyJsonPath, copyJsonValue, dropJsonTree } from "./jsonModel";
import { csvToJson, jsonToCsv, topLevelKeys } from "./convert";
import { readText as readClipboardText, writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import { clipboardText, cutSpec, foldLineSpec, foldTreeSpec, pasteSpec } from "../editor/lineMenu";
import { bindAppKeyFallback, bindCommandRunner, guarded, pausePlayback, playDetail, playSteps, playToEnd, recordCommand, stageMacros, startRecording, stopPlayback, stopRecording, TO_END_DETAIL } from "./macros";
import { readScript, runScript, runScriptTimes, runScriptToEnd, scriptNameOf, SCRIPT_API_HELP } from "./scripting";
import { activeDoc, useStore, type Doc, type SidebarPanel } from "./store";
import { DEFAULT_SETTINGS, type Macro, type Script } from "./types";
import { undoReplaceInFiles } from "./replaceUndo";
import { focusPane, openToSide, toggleSplit } from "./split";
import { registerGitCommands } from "./gitCommands";
import { showAbout } from "./about";
import { showPanel as showPanelOnly, toggleAllPanels, togglePanel } from "./panels";
import { choose, inform } from "./dialogs";

export interface Command {
  id: string;
  title: string;
  category: string;
  keys?: string;
  /** Return false when the command does not apply in the current context. */
  run: (args?: unknown) => boolean | void | Promise<boolean | void>;
  hidden?: boolean;
  /**
   * When this returns false the command is greyed out in menus and omitted from the palette.
   * `args` is what `runCommand` was given (e.g. `{ docId }` from a tab's right-click menu).
   */
  enabled?: (args?: unknown) => boolean;
  /** Context-sensitive label for menus (e.g. "Stop Macro Recording" while recording). */
  dynamicTitle?: () => string;
  /**
   * Extra guard for the *shortcut* path only: when it returns false the key is not matched
   * and falls through to whatever has focus (e.g. Tab/Ctrl+A must not be stolen from inputs).
   * `keys` is still shown in menus and the palette, and the command remains runnable from them.
   */
  when?: () => boolean;
}

export function isEnabled(cmd: Command, args?: unknown): boolean {
  return cmd.enabled ? cmd.enabled(args) !== false : true;
}

/**
 * The document a command should act on: `{ docId }` (a tab's right-click menu passes it) names a
 * tab, anything else means the active one. Pure.
 */
export function docIdArg(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const id = (args as { docId?: unknown }).docId;
  return typeof id === "string" ? id : undefined;
}

/** The tab named by `{ docId }`, else the active one; undefined when the named tab is gone. */
export function targetDoc(args?: unknown): Doc | undefined {
  const st = useStore.getState();
  const id = docIdArg(args);
  return id !== undefined ? st.docs.find((d) => d.id === id) : activeDoc(st);
}

const registry = new Map<string, Command>();
const byKey = new Map<string, Command[]>();
/** First strokes of two-key chords such as "Ctrl+K M" (normalized). */
const chordPrefixes = new Set<string>();

export function register(cmd: Command) {
  registry.set(cmd.id, cmd);
  if (cmd.keys) {
    const k = normalizeKeys(cmd.keys);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(cmd);
    const [first, second] = k.split(" ");
    if (second) chordPrefixes.add(first);
  }
}

const matchesWhen = (c: Command) => (c.when ? c.when() !== false : true);

export function allCommands(): Command[] {
  return [...registry.values()].filter((c) => !c.hidden && isEnabled(c));
}

export function getCommand(id: string) {
  return registry.get(id);
}

/**
 * Commands a key stroke would trigger right now (used by App.tsx to decide whether to swallow the
 * event). While a chord is pending, or for a chord prefix, a placeholder is returned so the stroke
 * is swallowed even though no single command matches it.
 */
export function getCommandsForKeys(normalized: string): Command[] {
  if (pendingChord !== null || chordPrefixes.has(normalized)) return [CHORD_PLACEHOLDER];
  return (byKey.get(normalized) ?? []).filter(matchesWhen);
}

export async function runCommand(id: string, args?: unknown): Promise<boolean> {
  const cmd = registry.get(id);
  if (!cmd) return false;
  // Disabled commands (greyed in menus) are no-ops everywhere, including shortcuts and panel buttons.
  if (!isEnabled(cmd, args)) return false;
  recordCommand(id, args);
  const r = await cmd.run(args);
  return r !== false;
}

// ---------- keys ----------

/** Normalize one stroke ("ctrl+shift+k" → "Ctrl+Shift+K"); chords are space-separated strokes ("Ctrl+K M"). */
export function normalizeKeys(keys: string): string {
  return keys
    .trim()
    .split(/\s+/)
    .map((stroke) => {
      const parts = stroke.split("+").map((p) => p.trim());
      const key = parts.pop()!;
      const mods = new Set(parts.map((m) => m.toLowerCase()));
      return [mods.has("ctrl") ? "Ctrl" : "", mods.has("alt") ? "Alt" : "", mods.has("shift") ? "Shift" : "", key.length === 1 ? key.toUpperCase() : key]
        .filter(Boolean)
        .join("+");
    })
    .join(" ");
}

export function eventToKeys(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.startsWith("Arrow")) key = key.slice(5);
  else if (key === "+") key = "Plus";
  else if (key.length === 1) {
    // Use the physical key for letters so shortcuts work on any layout / with Shift held.
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else key = key.toUpperCase();
  }
  return [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : "", key].filter(Boolean).join("+");
}

export function prettyKeys(keys: string): string {
  return normalizeKeys(keys).replace("Plus", "+");
}

// Two-key chord state ("Ctrl+K" pressed, waiting for the second stroke).
const CHORD_TIMEOUT_MS = 1500;
// Never registered: getCommandsForKeys returns it so App.tsx swallows a chord's strokes.
const CHORD_PLACEHOLDER: Command = { id: "ui.chordPending", title: "Chord pending", category: "View", hidden: true, run: () => true };
let pendingChord: string | null = null;
let chordTimer = 0;

function clearPendingChord() {
  pendingChord = null;
  window.clearTimeout(chordTimer);
}

/** Exposed for tests / status UI. */
export function getPendingChord() {
  return pendingChord;
}

/**
 * Pure matcher: given the stroke just pressed and the pending chord prefix (if any), decide what to do.
 * Kept free of DOM/store so it is unit-testable.
 */
export function resolveStroke(stroke: string, pending: string | null): { kind: "run"; cmds: Command[] } | { kind: "chordStart" } | { kind: "chordMiss"; keys: string } | { kind: "none" } {
  if (pending !== null) {
    const full = `${pending} ${stroke}`;
    const cmds = (byKey.get(full) ?? []).filter(matchesWhen);
    return cmds.length ? { kind: "run", cmds } : { kind: "chordMiss", keys: full };
  }
  if (chordPrefixes.has(stroke)) return { kind: "chordStart" };
  const cmds = (byKey.get(stroke) ?? []).filter(matchesWhen);
  return cmds.length ? { kind: "run", cmds } : { kind: "none" };
}

export async function handleKeyEvent(e: KeyboardEvent): Promise<boolean> {
  const k = eventToKeys(e);
  if (!k) return false;
  const store = useStore.getState();
  const res = resolveStroke(k, pendingChord);
  if (pendingChord !== null) {
    // Second stroke of a chord: never let it reach the editor as typing, whether or not it matched.
    clearPendingChord();
    e.preventDefault();
    e.stopPropagation();
  }
  if (res.kind === "chordStart") {
    pendingChord = k;
    e.preventDefault();
    e.stopPropagation();
    chordTimer = window.setTimeout(() => {
      pendingChord = null;
    }, CHORD_TIMEOUT_MS);
    store.toast(`${prettyKeys(k)} pressed, waiting for second key…`, "info", CHORD_TIMEOUT_MS);
    return true;
  }
  if (res.kind === "chordMiss") {
    store.toast(`${prettyKeys(res.keys)} is not a shortcut`, "info", 1500);
    return true;
  }
  if (res.kind === "none") return false;
  for (const cmd of res.cmds) {
    // Shortcuts must honour enabled() like menus and the palette do: greyed-out commands are no-ops.
    if (!isEnabled(cmd)) {
      if (!cmd.hidden) store.toast(`${cmd.dynamicTitle?.() ?? cmd.title} is not available here`, "info", 1800);
      continue;
    }
    recordCommand(cmd.id);
    const r = await cmd.run();
    if (r !== false) return true;
  }
  // A matched-but-disabled shortcut is swallowed (true) so it does not fall through as typing.
  return res.cmds.some((c) => !isEnabled(c));
}

// ---------- helpers ----------

function cmCommand(fn: (view: NonNullable<typeof editor.view>) => boolean) {
  return () => {
    const s = useStore.getState();
    const doc = activeDoc(s);
    if (!doc || doc.kind !== "text" || !editor.view) return false;
    // A document shown in both panes keeps one undo history (see editor/manager.ts).
    const r = fn(fn === undo || fn === redo ? editor.historyView(editor.view) : editor.view);
    editor.view.focus();
    return r;
  };
}

/** A `cmCommand` that changes the text: does nothing on a read-only document (CodeMirror's own commands check this too). */
function cmEdit(fn: (view: NonNullable<typeof editor.view>) => boolean) {
  return cmCommand((view) => !view.state.readOnly && fn(view));
}

/** True while the main CodeMirror view owns keyboard focus (shortcut guard for Tab, Ctrl+A, Ctrl+Z…). */
const editorFocused = () => !!editor.view?.hasFocus;

/** Wrap a CodeMirror comment command so a silent no-op (no comment tokens for the language) explains itself. */
function withCommentSyntax(fn: (view: NonNullable<typeof editor.view>) => boolean) {
  return (view: NonNullable<typeof editor.view>) => {
    if (fn(view)) return true;
    const doc = activeDoc(useStore.getState());
    useStore.getState().toast(`No comment syntax for ${doc?.kind === "text" ? doc.language : "this language"}`, "info", 2000);
    return true;
  };
}

function textDocOnly(fn: () => boolean | void | Promise<boolean | void>) {
  return () => {
    const doc = activeDoc(useStore.getState());
    if (!doc || doc.kind !== "text") return false;
    return fn();
  };
}

const showPanel = (panel: SidebarPanel) => togglePanel(panel);

/** Error toasts for the same problem stack up when a shortcut is pressed repeatedly: show each message once. */
function toastOnce(message: string, kind: "error" | "warning" | "info" | "success" = "error", timeout?: number) {
  const s = useStore.getState();
  if (s.toasts.some((t) => t.message === message)) return;
  s.toast(message, kind, timeout);
}

const jsonErrorText = (e: { line: number; column: number; message: string }, dialect = "JSON") => `Invalid ${dialect} at line ${e.line.toLocaleString()}, column ${e.column.toLocaleString()}: ${e.message}`;

/** Files that are JSON with comments by convention: Validate accepts comments and trailing commas in them. */
export function jsoncDialect(path: string | null | undefined, name: string): "JSONC" | "JSON5" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json5")) return "JSON5";
  if (lower.endsWith(".jsonc") || lower.endsWith(".code-workspace")) return "JSONC";
  if (/^[tj]sconfig(\..*)?\.json$/.test(lower)) return "JSONC";
  if (path && /[\\/]\.vscode[\\/][^\\/]+\.json$/i.test(path)) return "JSONC";
  return null;
}

/** Show the JSON panel the way openPath does for JSON files (restored when the user leaves JSON docs). */
function autoShowJsonPanel() {
  const s = useStore.getState();
  if (s.pinnedPanels.includes("json") && s.pinnedHidden) s.set({ pinnedHidden: false });
}

/** Unsubscribes the "clear Validate's marker on the next edit" listener, if one is installed. */
let clearValidationOnEdit: (() => void) | null = null;

async function jsonTransform(kind: "format" | "minify") {
  const s = useStore.getState();
  const doc = activeDoc(s);
  if (!doc || doc.kind !== "text") return false;
  const text = editor.textOf(doc.id);
  const r = kind === "format" ? await jsonIpc.format(text, s.settings.jsonIndent, !s.settings.insertSpaces) : await jsonIpc.minify(text);
  if (!r.ok && r.error) {
    // Line 0 means the JSON is fine but the result cannot be produced (e.g. pretty output too large).
    if (r.error.line === 0) {
      s.toast(`Cannot ${kind === "format" ? "pretty-print" : "minify"}: ${r.error.message}`, "warning", 6000);
      return true;
    }
    editor.goTo(r.error.line, r.error.column);
    toastOnce(jsonErrorText(r.error));
    return true;
  }
  if (r.output !== null) {
    editor.replaceAll(doc.id, r.output);
    dropJsonTree(doc.id);
    s.toast(kind === "format" ? "JSON formatted" : r.stripped ? "JSON minified (comments and trailing commas removed)" : "JSON minified", "success", r.stripped ? 3000 : 1500);
  }
  return true;
}

/** A large-file tab holding JSON (by extension: large files have no language detection). */
export const isBigJson = (d: { kind: string; name: string } | null | undefined) => d?.kind === "big" && /\.(json|jsonc|json5|geojson|har)$/i.test(d.name);

/** JSON: Validate on a large-file tab: checks the file in place in Rust, whatever its size. */
async function bigJsonValidate(doc: NonNullable<ReturnType<typeof activeDoc>>) {
  const s = useStore.getState();
  if (doc.bigId === undefined) return false;
  if (doc.dirty) {
    s.toast("Save your changes first: JSON: Validate checks a large file as saved.", "warning", 5000);
    return true;
  }
  const dialect = jsoncDialect(doc.path, doc.name);
  const started = performance.now();
  const slow = window.setTimeout(() => s.toast(`Validating ${doc.name}…`, "info", 60000), 400);
  try {
    const r = await big.jsonValidate(doc.bigId, dialect !== null);
    window.clearTimeout(slow);
    useStore.setState((st) => ({ toasts: st.toasts.filter((t) => !t.message.startsWith("Validating ")) }));
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    if (r.ok) s.toast(`Valid ${dialect ?? "JSON"} ✓ (${formatBytes(doc.size ?? 0)} checked in ${secs} s)`, "success", 3000);
    else if (r.error) {
      if (r.error.line > 0) bus.emitFor(doc.id, "big.goto", { line: r.error.line });
      toastOnce(jsonErrorText(r.error, dialect ?? "JSON"));
    }
  } catch (e) {
    window.clearTimeout(slow);
    s.toast(`Cannot validate: ${e}`, "warning", 6000);
  }
  return true;
}

async function jsonValidate() {
  const s = useStore.getState();
  const doc = activeDoc(s);
  if (doc && isBigJson(doc)) return bigJsonValidate(doc);
  if (!doc || doc.kind !== "text") return false;
  const dialect = jsoncDialect(doc.path, doc.name);
  const r = await jsonIpc.validate(editor.textOf(doc.id), dialect !== null);
  if (r.ok) {
    editor.setDiagnostics(doc.id, []);
    s.toast(`Valid ${dialect ?? "JSON"} ✓`, "success", 1500);
  } else if (r.error) {
    const d = editor.docOf(doc.id)!;
    const line = d.line(Math.min(d.lines, r.error.line));
    const from = Math.min(line.to, line.from + Math.max(0, r.error.column - 1));
    editor.setDiagnostics(doc.id, [{ from, to: Math.min(line.to, from + 1) || from, message: r.error.message }]);
    editor.goTo(r.error.line, r.error.column);
    // Quarry checks JSON5 files as JSONC; say so when JSON5-only syntax is the likely cause.
    const json5Note = dialect === "JSON5" ? " (Quarry checks JSON5 files as JSONC: comments and trailing commas are fine, unquoted keys and single quotes are not.)" : "";
    toastOnce(jsonErrorText(r.error, dialect ?? "JSON") + json5Note);
    // The marker describes the text as it was: clear it on the next edit so a fixed error does not linger.
    clearValidationOnEdit?.();
    const off = editor.onDocUpdate((id, u) => {
      if (id !== doc.id || !u.docChanged) return;
      editor.setDiagnostics(doc.id, []);
      clearValidationOnEdit?.();
    });
    clearValidationOnEdit = () => {
      off();
      clearValidationOnEdit = null;
    };
  }
  return true;
}

/** Ask before running a script or macro (configurable in Settings). Resolves true to proceed. Panels use it too. */
export async function confirmRun(kind: "script" | "macro", item: { id: string; name: string }, detail?: string): Promise<boolean> {
  const store = useStore.getState();
  if (!store.settings.confirmRuns) return true;
  const doc = activeDoc(store);
  const choice = await choose<"run" | "review" | "cancel">(
    `Run ${kind} "${item.name}"?`,
    `${detail ? detail + " " : ""}This will edit ${doc?.name ?? "the current document"}. You can undo with Ctrl+Z.\n\n"Review first" opens the ${kind} in ${kind === "script" ? "a tab" : "its panel"} without running it.`,
    [
      { label: "Run", kind: "primary", value: "run" },
      { label: "Review first", value: "review" },
      { label: "Cancel", value: "cancel" },
    ],
    "cancel",
  );
  if (choice === "review") {
    // A script's id is its file: review it in a tab.
    if (kind === "script") void openPath(item.id);
    else store.set({ sidebarVisible: true, sidebarPanel: "macros", activeMacroId: item.id });
  }
  return choice === "run";
}

/** Once, a number of times in a row, or until a run changes nothing. */
export type ScriptRunHow = "once" | "toEnd" | { times: number };

/**
 * Run a script file on the document in front (after the Run / Review first prompt). It becomes the
 * current script. Resolves false when nothing ran.
 */
export async function runScriptPath(path: string, how: ScriptRunHow = "once"): Promise<boolean> {
  const st = useStore.getState();
  const doc = activeDoc(st);
  if (doc?.path && samePath(doc.path, path)) {
    st.toast("This tab is the script itself. Go to the document it should change, then run it.", "warning");
    return false;
  }
  let sc: Script;
  try {
    sc = await readScript(path);
  } catch (e) {
    st.toast(`Could not read the script: ${String(e)}`, "error");
    return false;
  }
  st.set({ activeScriptId: path });
  const detail = how === "once" ? undefined : how === "toEnd" ? "Repeats until the script stops changing the document or selection." : `Runs ${how.times} time${how.times === 1 ? "" : "s"} in a row.`;
  if (!(await confirmRun("script", sc, detail))) return false;
  if (how === "once") {
    await runScript(sc.source, undefined, sc);
    return true;
  }
  const n = how === "toEnd" ? await runScriptToEnd(sc) : await runScriptTimes(sc, how.times);
  useStore.getState().toast(`Ran ${n} time${n === 1 ? "" : "s"}`, n ? "success" : "info");
  return n > 0;
}

/**
 * Help > Script API Reference: the reference as a tab (comments in a JavaScript document, so it can
 * be searched and copied from). An open one is reused.
 */
async function showScriptApi() {
  const name = "Script API Reference.js";
  const st = useStore.getState();
  const open = st.docs.find((d) => d.kind === "text" && !d.path && d.name === name);
  if (open) {
    st.setActive(open.id);
    return;
  }
  const doc = await newDocument(`// Quarry script API. A script is a .js file in your scripts folder (Scripts menu).\n// Full guide with examples: docs/scripting.md\n\n${SCRIPT_API_HELP}\n`, name);
  // Nothing of the user's: closing it should not ask to save.
  useStore.getState().updateDoc(doc.id, { dirty: false });
}

/**
 * The macro Play Last plays, kept as a reference and looked up in the current list on each use, so
 * an edit or rename (new objects via stageMacros / saveMacro) is played as it is now and a deleted
 * one is not played at all. The path finds it again after a reload, which re-ids macros by path.
 */
let lastMacroRef: { id: string; path?: string } | null = null;
export function setLastMacro(m: Macro | null) {
  lastMacroRef = m ? { id: m.id, path: m.path } : null;
}
export function getLastMacro(): Macro | null {
  const ref = lastMacroRef;
  if (!ref) return null;
  const list = useStore.getState().macros;
  const m = list.find((x) => x.id === ref.id) ?? (ref.path ? list.find((x) => !!x.path && samePath(x.path, ref.path!)) : undefined);
  if (m) lastMacroRef = { id: m.id, path: m.path };
  return m ?? null;
}

function toggleRecording() {
  const s = useStore.getState();
  if (s.recording) {
    const steps = stopRecording();
    if (steps.length === 0) {
      s.toast("Nothing was recorded.", "info");
      return;
    }
    const target = s.recordTargetId ? s.macros.find((m) => m.id === s.recordTargetId) : undefined;
    if (target) {
      // Recording started from the macro editor: append to that macro instead of creating a new one.
      const updated: Macro = { ...target, steps: [...target.steps, ...steps], unsaved: true };
      setLastMacro(updated);
      stageMacros(s.macros.map((m) => (m.id === target.id ? updated : m)));
      s.toast(`Added ${steps.length} step${steps.length === 1 ? "" : "s"} to "${target.name}". Save it to keep the change.`, "success", 4000);
      s.set({ sidebarVisible: true, sidebarPanel: "macros", activeMacroId: target.id, recordTargetId: null });
      return;
    }
    const macro: Macro = { id: `m-${Date.now().toString(36)}`, name: `Macro ${s.macros.length + 1}`, steps, createdAt: Date.now(), unsaved: true };
    setLastMacro(macro);
    stageMacros([macro, ...s.macros]);
    s.toast(`Recorded ${steps.length} steps as "${macro.name}". Save it in the Macros panel to keep it.`, "success", 4000);
    s.set({ sidebarVisible: true, sidebarPanel: "macros", activeMacroId: macro.id });
  } else {
    if (!activeDoc(s) || activeDoc(s)!.kind !== "text") {
      s.toast("Open a text document before recording a macro.", "warning");
      return;
    }
    startRecording();
    s.toast("Recording macro… press Ctrl+Shift+R to stop.", "info", 2500);
    editor.focus();
  }
}

// ---------- registrations ----------

const hasDoc = () => !!activeDoc(useStore.getState());
/** A file tab (text or large file), not a Claude Code or terminal tab. */
const hasFileDoc = () => { const d = activeDoc(useStore.getState()); return d?.kind === "text" || d?.kind === "big"; };
const hasText = () => activeDoc(useStore.getState())?.kind === "text";
const hasJson = () => { const d = activeDoc(useStore.getState()); return d?.kind === "text" && d.language === "JSON"; };

/** Commands that only make sense with a document get a default `enabled` unless they define their own. */
function applyDefaultEnabled() {
  // Big (disk-backed) documents support find/goto/save through the bus, so those only need *a* document.
  const textOnly = /^(edit|code|selection|json)\.|^view\.toggle(Wrap|Whitespace)$/;
  const fileOnly = /^find\.(open|replace|next|prev)$|^goto\.line$|^file\.(save|saveAs|revert)$/;
  const docOnly = /^file\.(close|closeF4|closeOthers|closeAll|saveAll|nextTab|prevTab)$/;
  for (const c of registry.values()) {
    if (c.enabled) continue;
    if (c.id.startsWith("json.")) c.enabled = hasJson;
    else if (textOnly.test(c.id)) c.enabled = hasText;
    else if (fileOnly.test(c.id)) c.enabled = hasFileDoc;
    else if (docOnly.test(c.id)) c.enabled = hasDoc;
  }
}

export function registerAllCommands() {
  const s = () => useStore.getState();

  // File
  register({ id: "file.new", title: "New File", category: "File", keys: "Ctrl+N", run: async () => {
    // Counts towards the open-tab limit like any other tab.
    if ((await makeRoom(["Untitled"], (id) => closeDocument(id))) > 0) await newDocument();
  } });
  register({ id: "file.open", title: "Open File…", category: "File", keys: "Ctrl+O", run: () => void openFileDialog() });
  register({ id: "file.openFolder", title: "Open Folder…", category: "File", keys: "Ctrl+Shift+O", run: () => void openFolderDialog() });
  register({ id: "file.save", title: "Save", category: "File", keys: "Ctrl+S", enabled: () => hasFileDoc() || (activeDoc(s())?.kind === "diff" && !!activeDoc(s())?.dirty), run: () => void saveDocument() });
  register({ id: "file.saveAs", title: "Save As…", category: "File", keys: "Ctrl+Shift+S", run: () => void saveDocument(undefined, true) });
  register({ id: "file.saveAll", title: "Save All", category: "File", keys: "Ctrl+Alt+S", run: () => void saveAll() });
  // Tab commands take an optional { docId } (the tab's right-click menu); without it they act on the active tab.
  register({ id: "file.close", title: "Close Tab", category: "File", keys: "Ctrl+W", run: (a) => void closeDocument(docIdArg(a)) });
  register({ id: "file.closeF4", title: "Close Tab", category: "File", keys: "Ctrl+F4", hidden: true, run: (a) => void closeDocument(docIdArg(a)) });
  register({ id: "file.closeAll", title: "Close All Tabs", category: "File", run: () => void closeAll() });
  register({ id: "file.reopenClosedTab", title: "Reopen Closed Tab", category: "File", keys: "Ctrl+Shift+T", enabled: hasClosedTabs, run: () => void reopenClosedTab() });
  const targetPath = (a?: unknown) => targetDoc(a)?.path ?? null;
  register({ id: "file.showInQuarryExplorer", title: "Show in Quarry Explorer", category: "File", enabled: (a) => !!targetPath(a), run: (a) => { const p = targetPath(a); if (p) void showInExplorerPanel(p); } });
  register({ id: "file.showInWindowsExplorer", title: "Show in Windows Explorer", category: "File", enabled: (a) => !!targetPath(a), run: (a) => { const p = targetPath(a); if (p) void showInWindowsExplorer(p); } });
  register({
    id: "file.copyPath",
    title: "Copy Path of Active File",
    category: "File",
    enabled: (a) => !!targetPath(a),
    run: async (a) => {
      const p = targetPath(a);
      if (!p) return false;
      await writeClipboardText(p);
      s().toast("Path copied", "success", 1200);
    },
  });
  register({ id: "file.closeOthers", title: "Close Other Tabs", category: "File", run: (a) => { const d = targetDoc(a); if (d) void closeOthers(d.id); } });
  register({ id: "file.openToSide", title: "Open to the Side", category: "File", enabled: (a) => targetDoc(a)?.kind === "text", run: (a) => { const d = targetDoc(a); return d ? openToSide(d.id) : false; } });
  register({ id: "file.revert", title: "Revert File", category: "File", enabled: () => { const d = activeDoc(s()); return d?.kind === "text" && !!d.path; }, run: () => void revertDocument() });
  // Encoding / line endings / indentation: the status-bar pickers run these; from the palette (no
  // argument) they open the picker.
  const textDoc = () => { const d = activeDoc(s()); return d?.kind === "text" ? d : undefined; };
  register({
    id: "file.setEncoding",
    title: "Change File Encoding…",
    category: "File",
    enabled: () => !!textDoc(),
    run: (args) => {
      const d = textDoc();
      if (!d) return false;
      if (typeof args !== "string") return void bus.emit("status.encoding");
      if (args === d.encoding) return;
      s().updateDoc(d.id, { encoding: args, dirty: true });
      s().toast(`Will save as ${args}`, "info", 1500);
    },
  });
  register({
    id: "file.setEol",
    title: "Change Line Endings…",
    category: "File",
    enabled: () => !!textDoc(),
    run: (args) => {
      const d = textDoc();
      if (!d) return false;
      // CR (classic Mac) is only offered while the document uses it, but it is a valid choice.
      if (args !== "CRLF" && args !== "LF" && args !== "CR") return void bus.emit("status.eol");
      if (args !== d.eol) s().updateDoc(d.id, { eol: args, dirty: true });
    },
  });
  register({
    id: "view.setTabSize",
    title: "Change Tab Size…",
    category: "View",
    run: (args) => {
      if (typeof args !== "number" || !(args >= 1 && args <= 16)) return void bus.emit("status.tabSize");
      s().updateSettings({ tabSize: args });
      editor.applySettings(s().settings);
      persistSettings();
    },
  });
  register({
    id: "file.reopenWithEncoding",
    title: "Reopen with Encoding…",
    category: "File",
    enabled: () => { const d = textDoc(); return !!d?.path; },
    run: async (args) => {
      const d = textDoc();
      if (!d?.path) return false;
      if (typeof args !== "string") return void s().set({ palette: "encoding" });
      await revertDocument(d.id, { encoding: args });
    },
  });
  register({ id: "file.openRecent", title: "Open Recent File", category: "File", hidden: true, run: (args) => { if (typeof args !== "string") return false; void openPath(args); } });
  register({ id: "file.openRecentFolder", title: "Open Recent Folder", category: "File", hidden: true, run: (args) => { if (typeof args !== "string") return false; void openFolder(args); } });
  register({ id: "file.clearRecent", title: "Clear Recent Files", category: "File", enabled: () => s().recentFiles.length > 0, run: () => s().set({ recentFiles: [] }) });
  register({ id: "file.clearRecentFolders", title: "Clear Recent Folders", category: "File", enabled: () => s().recentFolders.length > 0, run: () => s().set({ recentFolders: [] }) });
  register({ id: "file.quickOpen", title: "Quick Open File…", category: "File", keys: "Ctrl+P", run: () => s().set({ palette: "files" }) });
  register({ id: "file.nextTab", title: "Next Tab", category: "View", keys: "Ctrl+Tab", run: () => nextTab(1) });
  register({ id: "file.prevTab", title: "Previous Tab", category: "View", keys: "Ctrl+Shift+Tab", run: () => nextTab(-1) });
  register({ id: "file.nextTabPg", title: "Next Tab", category: "View", keys: "Ctrl+PageDown", hidden: true, run: () => nextTab(1) });
  register({ id: "file.prevTabPg", title: "Previous Tab", category: "View", keys: "Ctrl+PageUp", hidden: true, run: () => nextTab(-1) });
  register({ id: "app.exit", title: "Exit", category: "File", keys: "Alt+F4", run: () => void getCurrentWindow().close() });

  // Edit (CodeMirror)
  // Undo/Redo/Select All/Indent/Outdent carry their keys so menus and the palette show them and macros
  // record them as commands. `when: editorFocused` keeps the global handler from stealing Tab / Ctrl+A /
  // Ctrl+Z from inputs, the find bar or the big-file view (those keep their native behaviour).
  const hasBig = () => activeDoc(s())?.kind === "big";
  register({ id: "edit.undo", title: "Undo", category: "Edit", keys: "Ctrl+Z", when: editorFocused, enabled: () => hasText() || hasBig(), run: () => { const d = activeDoc(s()); if (d?.kind === "big") { bus.emit("big.undo"); return true; } return cmCommand(undo)(); } });
  register({ id: "edit.redo", title: "Redo", category: "Edit", keys: "Ctrl+Y", when: editorFocused, enabled: () => hasText() || hasBig(), run: () => { const d = activeDoc(s()); if (d?.kind === "big") { bus.emit("big.redo"); return true; } return cmCommand(redo)(); } });
  register({ id: "edit.redoAlt", title: "Redo", category: "Edit", keys: "Ctrl+Shift+Z", hidden: true, when: editorFocused, enabled: hasText, run: cmCommand(redo) });
  // Clipboard commands for the editor's right-click menu (Ctrl+X / C / V stay CodeMirror's own).
  register({
    id: "edit.cut",
    title: "Cut",
    category: "Edit",
    run: cmCommand((view) => {
      if (view.state.readOnly) return false;
      void writeClipboardText(clipboardText(view.state).text);
      view.dispatch(cutSpec(view.state));
      return true;
    }),
  });
  register({ id: "edit.copy", title: "Copy", category: "Edit", run: cmCommand((view) => (void writeClipboardText(clipboardText(view.state).text), true)) });
  register({
    id: "edit.paste",
    title: "Paste",
    category: "Edit",
    run: async () => {
      const view = editor.view;
      if (!hasText() || !view || view.state.readOnly) return false;
      const text = await readClipboardText().catch(() => "");
      if (text && editor.view === view) view.dispatch(pasteSpec(view.state, text));
      view.focus();
      return true;
    },
  });
  register({ id: "edit.selectAll", title: "Select All", category: "Edit", keys: "Ctrl+A", when: editorFocused, run: cmCommand(selectAll) });
  register({ id: "edit.duplicateLine", title: "Duplicate Line Down", category: "Edit", keys: "Ctrl+Shift+D", run: cmCommand(copyLineDown) });
  register({ id: "edit.duplicateLineUp", title: "Duplicate Line Up", category: "Edit", run: cmCommand(copyLineUp) });
  register({ id: "edit.deleteLine", title: "Delete Line", category: "Edit", keys: "Ctrl+Shift+K", run: cmCommand(deleteLine) });
  register({ id: "edit.moveLineUp", title: "Move Line Up", category: "Edit", keys: "Alt+Up", run: cmCommand(moveLineUp) });
  register({ id: "edit.moveLineDown", title: "Move Line Down", category: "Edit", keys: "Alt+Down", run: cmCommand(moveLineDown) });
  register({ id: "edit.toggleComment", title: "Toggle Line Comment", category: "Edit", keys: "Ctrl+/", run: cmCommand(withCommentSyntax(toggleComment)) });
  register({ id: "edit.indent", title: "Indent", category: "Edit", keys: "Tab", when: editorFocused, run: cmCommand(indentMore) });
  register({ id: "edit.outdent", title: "Outdent", category: "Edit", keys: "Shift+Tab", when: editorFocused, run: cmCommand(indentLess) });
  register({ id: "edit.selectNextOccurrence", title: "Add Selection to Next Find Match", category: "Selection", keys: "Ctrl+D", run: cmCommand(selectNextOccurrence) });
  register({
    id: "edit.selectAllOccurrences",
    title: "Select All Occurrences",
    category: "Selection",
    keys: "Ctrl+Shift+L",
    // Not CodeMirror's selectSelectionMatches: it silently does nothing past 1 000 matches.
    run: cmCommand((view) => {
      const r = occurrenceSelection(view.state);
      if (!r) return false;
      view.dispatch({ selection: r.selection, userEvent: "select", scrollIntoView: true });
      if (r.capped) s().toast(`Selected the first ${MAX_OCCURRENCES.toLocaleString()} occurrences.`, "warning", 4000);
      return true;
    }),
  });
  register({
    id: "edit.selectAllMatches",
    title: "Select All Find Matches",
    category: "Selection",
    keys: "Alt+Enter",
    run: cmCommand((v) => {
      const r = selectAllFindMatches(v, (m) => s().toast(m, "warning", 4000));
      // The find bar has done its job once every match is selected: close it so the cursors are usable.
      if (r && s().findBar.open) s().setFindBar({ open: false });
      return r;
    }),
  });
  register({
    id: "edit.upper",
    title: "Transform to Uppercase",
    category: "Edit",
    run: cmEdit((v) => {
      v.dispatch(v.state.changeByRange((r) => ({ changes: { from: r.from, to: r.to, insert: v.state.sliceDoc(r.from, r.to).toUpperCase() }, range: r })));
      return true;
    }),
  });
  register({
    id: "edit.lower",
    title: "Transform to Lowercase",
    category: "Edit",
    run: cmEdit((v) => {
      v.dispatch(v.state.changeByRange((r) => ({ changes: { from: r.from, to: r.to, insert: v.state.sliceDoc(r.from, r.to).toLowerCase() }, range: r })));
      return true;
    }),
  });

  // Code (language-aware tools)
  register({ id: "code.format", title: "Format Document", category: "Code", keys: "Shift+Alt+F", run: textDocOnly(() => formatDocument()) });
  register({ id: "code.toggleBlockComment", title: "Toggle Block Comment", category: "Code", keys: "Shift+Alt+A", run: cmCommand(withCommentSyntax(toggleBlockComment)) });
  register({ id: "code.fold", title: "Fold Region", category: "Code", keys: "Ctrl+Shift+[", run: cmCommand(foldCode) });
  register({ id: "code.unfold", title: "Unfold Region", category: "Code", keys: "Ctrl+Shift+]", run: cmCommand(unfoldCode) });
  register({ id: "code.foldAll", title: "Fold All", category: "Code", run: cmCommand(foldAll) });
  register({ id: "code.unfoldAll", title: "Unfold All", category: "Code", run: cmCommand(unfoldAll) });
  // The editor's right-click menu: fold / unfold the line clicked (`{ line }`), not the cursor's;
  // the Tree variants also take every region nested in it.
  const foldLine = (fold: boolean, spec = foldLineSpec) => (args?: unknown) => {
    const view = editor.view;
    const line = (args as { line?: number } | undefined)?.line;
    if (!view || typeof line !== "number") return false;
    const tr = spec(view.state, line, fold);
    if (tr) view.dispatch(tr);
    view.focus();
    return !!tr;
  };
  register({ id: "code.foldLine", title: "Fold Region at Line", category: "Code", hidden: true, run: foldLine(true) });
  register({ id: "code.unfoldLine", title: "Unfold Region at Line", category: "Code", hidden: true, run: foldLine(false) });
  register({ id: "code.foldTree", title: "Fold Region and Its Children at Line", category: "Code", hidden: true, run: foldLine(true, foldTreeSpec) });
  register({ id: "code.unfoldTree", title: "Unfold Region and Its Children at Line", category: "Code", hidden: true, run: foldLine(false, foldTreeSpec) });
  register({ id: "code.gotoBracket", title: "Go to Matching Bracket", category: "Code", keys: "Ctrl+Shift+\\", run: cmCommand(cursorMatchingBracket) });
  const lineTransform = (title: string, id: string, fn: () => lineFns.LineFn, keys?: string, category = "Edit") =>
    register({
      id,
      title,
      category,
      keys,
      run: cmEdit((v) => {
        const spec = lineFns.lineTransformSpec(v.state, fn());
        if (spec) v.dispatch(spec);
        return true;
      }),
    });
  lineTransform("Sort Lines Ascending", "code.sortAsc", () => lineFns.sortAsc);
  lineTransform("Sort Lines Descending", "code.sortDesc", () => lineFns.sortDesc);
  lineTransform("Reverse Lines", "code.reverseLines", () => lineFns.reverseLines);
  lineTransform("Remove Duplicate Lines", "code.dedupe", () => lineFns.dedupe);
  lineTransform("Delete Blank Lines", "code.removeBlank", () => lineFns.removeBlank);
  lineTransform("Delete Empty Lines", "code.removeEmpty", () => lineFns.removeEmpty);
  lineTransform("Trim Trailing Whitespace", "code.trimTrailing", () => lineFns.trimTrailing);
  lineTransform("Join Lines", "code.joinLines", () => lineFns.joinLines);
  lineTransform("Number Lines", "edit.numberLines", () => lineFns.numberLines);
  lineTransform("Indentation: Convert to Spaces", "code.indentToSpaces", () => lineFns.indentToSpaces(s().settings.tabSize), undefined, "Code");
  lineTransform("Indentation: Convert to Tabs", "code.indentToTabs", () => lineFns.indentToTabs(s().settings.tabSize), undefined, "Code");
  register({
    id: "edit.quoteSelections",
    title: "Wrap Selections in Quotes",
    category: "Edit",
    enabled: () => !!editor.view && hasText() && editor.view.state.selection.ranges.some((r) => !r.empty),
    run: cmEdit((v) => {
      v.dispatch(v.state.changeByRange((r) => {
        const ins = JSON.stringify(v.state.sliceDoc(r.from, r.to));
        return { changes: { from: r.from, to: r.to, insert: ins }, range: EditorSelection.range(r.from, r.from + ins.length) };
      }), { userEvent: "input.transform" });
      return true;
    }),
  });
  register({
    id: "code.titleCase",
    title: "Transform to Title Case",
    category: "Code",
    run: cmEdit((v) => {
      v.dispatch(v.state.changeByRange((r) => ({ changes: { from: r.from, to: r.to, insert: lineFns.titleCase(v.state.sliceDoc(r.from, r.to)) }, range: r })));
      return true;
    }),
  });
  register({
    id: "code.setLanguage",
    title: "Change Language Mode…",
    category: "Code",
    keys: "Ctrl+K M",
    run: async (args?: unknown) => {
      const d = activeDoc(s());
      if (!d || d.kind !== "text") return false;
      if (typeof args === "string") {
        const name = await editor.setLanguage(d.id, args);
        s().updateDoc(d.id, { language: name });
        return true;
      }
      s().set({ palette: "language" });
      return true;
    },
  });
  register({
    id: "code.detectLanguage",
    title: "Auto-detect Language",
    category: "Code",
    run: async () => {
      const d = activeDoc(s());
      if (!d || d.kind !== "text") return false;
      const head = editor.textOf(d.id).slice(0, 400);
      const info = d.path ? detectLanguage(d.path, head) : { name: sniffLanguage(head) ?? "Plain Text" };
      const name = await editor.setLanguage(d.id, info.name);
      s().updateDoc(d.id, { language: name });
      s().toast(`Language: ${name}`, "info", 1500);
      return true;
    },
  });

  // Column / block mode
  register({
    id: "selection.toggleColumnMode",
    title: "Toggle Column (Block) Selection Mode",
    category: "Selection",
    keys: "Alt+Shift+C",
    run: () => {
      const on = !s().columnMode;
      s().set({ columnMode: on });
      editor.applyColumnMode(on);
      s().toast(on ? "Column mode ON — drag or Shift+arrows select a block. Typing edits every row." : "Column mode off", "info", 2200);
      editor.focus();
    },
  });
  register({
    id: "view.toggleTabFocus",
    title: "Toggle Tab Key Moves Focus",
    category: "View",
    keys: "Ctrl+M",
    run: () => {
      const on = !s().tabMovesFocus;
      s().set({ tabMovesFocus: on });
      // CodeMirror's own Tab handling (indentWithTab) honours its tab-focus mode; keep them in step
      // in both panes of a split (a pane mounted later picks the setting up in editor.mount).
      for (const pane of [0, 1] as const) editor.paneView(pane)?.setTabFocusMode(on);
      s().toast(on ? "Tab moves focus. Press Ctrl+M again to indent with Tab." : "Tab indents again", "info", 2500);
    },
  });
  register({ id: "selection.addCursorBelow", title: "Add Cursor Below", category: "Selection", keys: "Ctrl+Alt+Down", run: cmCommand(blockCommands.addCursorBelow) });
  register({ id: "selection.addCursorAbove", title: "Add Cursor Above", category: "Selection", keys: "Ctrl+Alt+Up", run: cmCommand(blockCommands.addCursorAbove) });
  register({ id: "selection.blockToCursors", title: "Split Block Selection into Cursors", category: "Selection", keys: "Alt+Shift+I", run: cmCommand(blockCommands.blockToCursors) });

  // Find
  register({ id: "find.open", title: "Find", category: "Find", keys: "Ctrl+F", run: () => { const d = activeDoc(s()); if (d?.kind === "big") { bus.emit("big.find"); return true; } if (!d) return false; s().setFindBar({ open: true, replace: false }); return true; } });
  register({ id: "find.replace", title: "Replace", category: "Find", keys: "Ctrl+H", run: () => { const d = activeDoc(s()); if (d?.kind === "big") { bus.emit("big.find", { replace: true }); return true; } if (!d) return false; s().setFindBar({ open: true, replace: true }); return true; } });
  register({ id: "find.next", title: "Find Next", category: "Find", keys: "F3", run: () => { const d = activeDoc(s()); if (d?.kind === "big") { bus.emit("big.findNext"); return true; } return cmCommand(findNext)(); } });
  register({ id: "find.prev", title: "Find Previous", category: "Find", keys: "Shift+F3", run: () => { const d = activeDoc(s()); if (d?.kind === "big") { bus.emit("big.findPrev"); return true; } return cmCommand(findPrevious)(); } });
  register({ id: "find.inFiles", title: "Find in Files", category: "Find", keys: "Ctrl+Shift+F", run: () => { showPanelOnly("search"); bus.emit("search.focus"); } });
  register({ id: "find.replaceInFiles", title: "Replace in Files", category: "Find", keys: "Ctrl+Shift+H", run: () => { showPanelOnly("search"); s().setSearch({ showReplace: true }); bus.emit("search.focus"); } });
  // Step through Find-in-Files results; handled by SearchPanel (opened first if hidden).
  const stepResult = (dir: 1 | -1) => () => {
    if (s().search.files.length === 0) return false;
    showPanelOnly("search");
    setTimeout(() => bus.emit("search.step", { dir }), 0);
    return true;
  };
  register({ id: "help.checkUpdates", title: "Check for Updates…", category: "Help", run: () => void import("./updater").then((m) => m.checkForUpdates(false)) });
  register({ id: "help.about", title: "About Quarry", category: "Help", run: () => void showAbout() });
  register({ id: "find.undoReplaceInFiles", title: "Undo Replace in Files", category: "Find", enabled: () => !!s().replaceUndo, run: () => void undoReplaceInFiles() });
  register({ id: "find.nextResult", title: "Next Search Result", category: "Find", keys: "F4", enabled: () => s().search.files.length > 0, run: stepResult(1) });
  register({ id: "find.prevResult", title: "Previous Search Result", category: "Find", keys: "Shift+F4", enabled: () => s().search.files.length > 0, run: stepResult(-1) });
  register({ id: "goto.line", title: "Go to Line…", category: "Go", keys: "Ctrl+G", run: () => s().set({ palette: "goto" }) });

  // View
  register({ id: "view.commandPalette", title: "Command Palette", category: "View", keys: "Ctrl+Shift+P", run: () => s().set({ palette: "commands" }) });
  register({ id: "view.commandPaletteF1", title: "Command Palette", category: "View", keys: "F1", hidden: true, run: () => s().set({ palette: "commands" }) });
  register({ id: "view.toggleSidebar", title: "Collapse / Restore Side Panels", category: "View", keys: "Ctrl+B", run: toggleAllPanels });
  register({ id: "view.splitEditor", title: "Split Editor", category: "View", keys: "Ctrl+\\", dynamicTitle: () => (s().split ? "Close Split Editor" : "Split Editor"), enabled: () => !!s().split || hasText(), run: toggleSplit });
  register({ id: "view.focusLeftPane", title: "Focus Left Editor Pane", category: "View", keys: "Ctrl+1", enabled: () => !!s().split, run: () => focusPane(0) });
  register({ id: "view.focusRightPane", title: "Focus Right Editor Pane", category: "View", keys: "Ctrl+2", enabled: () => !!s().split, run: () => focusPane(1) });
  register({ id: "view.togglePanel", title: "Toggle Bottom Panel", category: "View", keys: "Ctrl+J", run: () => s().set({ bottomVisible: !s().bottomVisible }) });
  register({ id: "view.explorer", title: "Show Explorer", category: "View", keys: "Ctrl+Shift+E", run: () => showPanel("explorer") });
  register({ id: "view.json", title: "Show JSON Tools", category: "View", keys: "Ctrl+Shift+J", run: () => showPanel("json") });
  register({ id: "view.macros", title: "Show Macros", category: "View", run: () => showPanel("macros") });
  register({ id: "view.scripts", title: "Show Scripts", category: "View", run: () => showPanel("scripts") });
  register({ id: "view.settings", title: "Settings", category: "View", keys: "Ctrl+,", run: () => showPanel("settings") });
  register({ id: "view.toggleWrap", title: "Toggle Word Wrap", category: "View", keys: "Alt+Z", run: () => { s().updateSettings({ wordWrap: !s().settings.wordWrap }); editor.applySettings(s().settings); persistSettings(); } });
  register({ id: "view.zoomIn", title: "Zoom In", category: "View", keys: "Ctrl+=", run: () => { s().updateSettings({ fontSize: Math.min(40, s().settings.fontSize + 1) }); editor.applySettings(s().settings); persistSettings(); } });
  register({ id: "view.zoomInPlus", title: "Zoom In", category: "View", keys: "Ctrl+Plus", hidden: true, run: () => runCommand("view.zoomIn") });
  register({ id: "view.zoomOut", title: "Zoom Out", category: "View", keys: "Ctrl+-", run: () => { s().updateSettings({ fontSize: Math.max(8, s().settings.fontSize - 1) }); editor.applySettings(s().settings); persistSettings(); } });
  register({ id: "view.zoomReset", title: "Reset Zoom", category: "View", keys: "Ctrl+0", run: () => { s().updateSettings({ fontSize: DEFAULT_SETTINGS.fontSize }); editor.applySettings(s().settings); persistSettings(); } });
  register({
    id: "view.toggleTheme",
    title: "Toggle Light/Dark Theme",
    category: "View",
    run: () => {
      const cur = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      s().updateSettings({ theme: cur === "dark" ? "light" : "dark" });
      persistSettings();
    },
  });
  register({ id: "view.toggleWhitespace", title: "Toggle Render Whitespace", category: "View", run: () => { s().updateSettings({ renderWhitespace: !s().settings.renderWhitespace }); editor.applySettings(s().settings); persistSettings(); } });

  // JSON
  register({ id: "json.format", title: "JSON: Format / Pretty-print", category: "JSON", keys: "Ctrl+Alt+F", run: () => jsonTransform("format") });
  register({ id: "json.minify", title: "JSON: Minify / Compress", category: "JSON", keys: "Ctrl+Alt+M", run: () => jsonTransform("minify") });
  register({ id: "json.validate", title: "JSON: Validate", category: "JSON", keys: "Ctrl+Alt+V", run: () => jsonValidate(), enabled: () => hasJson() || isBigJson(activeDoc(useStore.getState())) });
  register({ id: "json.copyPath", title: "JSON: Copy Path at Cursor (dot)", category: "JSON", keys: "Ctrl+Alt+P", run: textDocOnly(() => void copyJsonPath("dot")) });
  register({ id: "json.copyJsonPath", title: "JSON: Copy JSONPath at Cursor ($.a.b)", category: "JSON", run: textDocOnly(() => void copyJsonPath("jsonpath")) });
  register({ id: "json.copyPointer", title: "JSON: Copy JSON Pointer at Cursor (/a/b)", category: "JSON", run: textDocOnly(() => void copyJsonPath("pointer")) });
  register({ id: "json.copyBracket", title: "JSON: Copy Bracket Path at Cursor", category: "JSON", run: textDocOnly(() => void copyJsonPath("bracket")) });
  register({ id: "json.copyValue", title: "JSON: Copy Value at Cursor", category: "JSON", keys: "Ctrl+Alt+C", run: textDocOnly(() => void copyJsonValue()) });
  // Conversions (previously built-in scripts).
  const isCsvDoc = () => {
    const d = activeDoc(s());
    if (!d || d.kind !== "text") return false;
    const n = (d.path ?? d.name).toLowerCase();
    return n.endsWith(".csv") || n.endsWith(".tsv") || d.language === "CSV";
  };
  register({
    id: "json.toCsv",
    title: "JSON: Convert to CSV",
    category: "JSON",
    run: cmCommand((v) => {
      const d = activeDoc(s())!;
      const r = jsonToCsv(v.state.doc.toString());
      if (!r.ok) {
        s().toast(`Cannot convert: ${r.error}`, "error");
        return false;
      }
      editor.replaceAll(d.id, r.output);
      s().toast(`Converted ${r.rows} record${r.rows === 1 ? "" : "s"}, ${r.columns} column${r.columns === 1 ? "" : "s"}. Use Save As to keep it as .csv.`, "success", 3500);
      return true;
    }),
  });
  register({
    id: "json.fromCsv",
    title: "JSON: Convert CSV to JSON",
    category: "JSON",
    enabled: isCsvDoc,
    run: cmCommand((v) => {
      const d = activeDoc(s())!;
      const r = csvToJson(v.state.doc.toString(), s().settings.jsonIndent);
      if (!r.ok) {
        s().toast(`Cannot convert: ${r.error}`, "error");
        return false;
      }
      editor.replaceAll(d.id, r.output);
      void editor.setLanguage(d.id, "JSON").then((l) => s().updateDoc(d.id, { language: l }));
      autoShowJsonPanel();
      s().toast(`Converted ${r.rows} row${r.rows === 1 ? "" : "s"} to JSON (values kept as strings). Use Save As to keep it as .json.`, "success", 3500);
      for (const w of r.warnings) s().toast(w, "warning", 6000);
      return true;
    }),
  });
  register({
    id: "json.copyKeys",
    title: "JSON: Copy Top-level Keys",
    category: "JSON",
    run: cmCommand((v) => {
      const r = topLevelKeys(v.state.doc.toString());
      if (!r.ok) {
        s().toast(`Cannot read keys: ${r.error}`, "error");
        return false;
      }
      void writeClipboardText(r.keys.join("\n"));
      s().toast(`Copied ${r.keys.length} key${r.keys.length === 1 ? "" : "s"} to the clipboard`, "success", 2000);
      return true;
    }),
  });

  // Macros
  register({
    id: "macro.toggleRecord",
    title: "Macro: Start/Stop Recording",
    category: "Macros",
    keys: "Ctrl+Shift+R",
    enabled: () => hasText() || s().recording,
    dynamicTitle: () => (s().recording ? `Stop Macro Recording (${s().recordingSteps} steps)` : "Start Macro Recording"),
    run: () => toggleRecording(),
  });
  const macroReady = () => hasText() && !s().recording && !s().macroPlaying && !!(getLastMacro() ?? s().macros[0]);
  register({
    id: "macro.stop",
    title: "Macro: Stop Playback",
    category: "Macros",
    keys: "Shift+Escape",
    enabled: () => s().macroPlaying,
    run: () => stopPlayback(),
  });
  register({
    id: "macro.pause",
    title: "Macro: Pause / Resume Playback",
    category: "Macros",
    enabled: () => s().macroPlaying,
    dynamicTitle: () => (s().macroPaused ? "Resume Macro Playback" : "Pause Macro Playback"),
    run: () => pausePlayback(!s().macroPaused),
  });
  register({
    id: "macro.recordInto",
    title: "Macro: Record More Steps into Macro",
    category: "Macros",
    hidden: true,
    enabled: () => hasText() && !s().recording && !s().macroPlaying,
    run: (args?: unknown) => {
      const m = s().macros.find((x) => x.id === args);
      if (!m) return false;
      startRecording(m.id);
      s().toast(`Recording into "${m.name}"… press Ctrl+Shift+R to stop.`, "info", 2500);
      editor.focus();
    },
  });
  register({
    id: "macro.playLast",
    title: "Macro: Play Last Recorded",
    category: "Macros",
    keys: "Ctrl+Shift+M",
    enabled: macroReady,
    dynamicTitle: () => { const m = getLastMacro() ?? s().macros[0]; return m ? `Play Macro "${m.name}"` : "Play Last Recorded Macro"; },
    run: async () => {
      const m = getLastMacro() ?? s().macros[0];
      if (!m) {
        s().toast("No macro recorded yet. Press Ctrl+Shift+R to start recording.", "info");
        return;
      }
      if (!(await confirmRun("macro", m, playDetail(m.steps.length)))) return false;
      await guarded(() => playSteps(m.steps, 1));
    },
  });
  register({
    id: "macro.playToEnd",
    title: "Macro: Play Last Until End of File",
    category: "Macros",
    enabled: macroReady,
    dynamicTitle: () => { const m = getLastMacro() ?? s().macros[0]; return m ? `Play "${m.name}" Until End of File` : "Play Last Macro Until End of File"; },
    run: async () => {
      const m = getLastMacro() ?? s().macros[0];
      if (!m) return;
      if (!(await confirmRun("macro", m, TO_END_DETAIL))) return false;
      const n = await guarded(() => playToEnd(m.steps));
      if (n !== undefined) s().toast(`Played ${n} time${n === 1 ? "" : "s"}`, "success");
    },
  });
  register({ id: "macro.panel", title: "Macro: Open Macros", category: "Macros", run: () => showPanel("macros") });
  register({
    id: "macro.play",
    title: "Macro: Play Macro by Id",
    category: "Macros",
    hidden: true,
    enabled: () => hasText() && !s().recording && !s().macroPlaying,
    run: async (args?: unknown) => {
      const id = typeof args === "object" && args ? (args as { id: string }).id : String(args);
      const toEnd = typeof args === "object" && args ? !!(args as { toEnd?: boolean }).toEnd : false;
      const m = s().macros.find((x) => x.id === id);
      if (!m) return false;
      setLastMacro(m);
      s().set({ activeMacroId: m.id });
      if (!(await confirmRun("macro", m, toEnd ? TO_END_DETAIL : playDetail(m.steps.length)))) return false;
      if (toEnd) {
        const n = await guarded(() => playToEnd(m.steps));
        if (n !== undefined) s().toast(`Played ${n} time${n === 1 ? "" : "s"}`, "success");
      } else await guarded(() => playSteps(m.steps, 1));
    },
  });
  register({
    id: "macro.edit",
    title: "Macro: Edit Macro by Id",
    category: "Macros",
    hidden: true,
    run: (args?: unknown) => {
      const m = s().macros.find((x) => x.id === args);
      if (!m) return false;
      s().set({ sidebarVisible: true, sidebarPanel: "macros", activeMacroId: m.id });
    },
  });

  // Scripts
  register({
    id: "script.runActive",
    title: "Script: Run Current Script",
    category: "Scripts",
    keys: "Ctrl+Shift+Enter",
    enabled: () => hasText() && !!s().activeScriptId,
    dynamicTitle: () => { const p = s().activeScriptId; return p ? `Run Script "${scriptNameOf(p)}"` : "Run Current Script"; },
    run: async () => {
      const p = s().activeScriptId;
      if (!p) {
        s().toast("No script selected. Select one in the Scripts panel.", "info");
        return false;
      }
      return runScriptPath(p);
    },
  });
  register({ id: "script.panel", title: "Script: Show Scripts", category: "Scripts", run: () => showPanelOnly("scripts") });
  register({ id: "help.scriptApi", title: "Script API Reference", category: "Help", run: () => void showScriptApi() });
  register({
    id: "script.edit",
    title: "Script: Edit Script by Path",
    category: "Scripts",
    hidden: true,
    run: async (args?: unknown) => {
      if (typeof args !== "string") return false;
      return !!(await openPath(args));
    },
  });
  register({
    id: "script.new",
    title: "Script: New Script",
    category: "Scripts",
    run: () => {
      showPanelOnly("scripts");
      requestAnimationFrame(() => bus.emit("script.new"));
    },
  });
  register({
    id: "script.run",
    title: "Script: Run Script by Path",
    category: "Scripts",
    hidden: true,
    enabled: () => hasText() && !s().recording && !s().macroPlaying,
    run: (args?: unknown) => (typeof args === "string" ? runScriptPath(args) : false),
  });

  // Large file
  // The palette prefixes titles with the category, so titles must not repeat "Large File:".
  register({ id: "big.gotoLine", title: "Go to Line", category: "Large File", hidden: true, enabled: hasBig, run: () => bus.emit("big.goto") });
  const forBig = (event: string) => () => {
    const d = activeDoc(s());
    if (!d || d.kind !== "big") return false;
    bus.emitFor(d.id, event);
  };
  register({ id: "big.filter", title: "Filter Lines", category: "Large File", enabled: hasBig, run: forBig("big.filter") });
  register({ id: "big.follow", title: "Follow (Show Lines as They Are Added)", category: "Large File", enabled: hasBig, run: forBig("big.follow") });
  register({
    id: "big.info",
    title: "Show Info",
    category: "Large File",
    enabled: hasBig,
    run: async () => {
      const d = activeDoc(s());
      if (!d || d.kind !== "big" || d.bigId === undefined) return false;
      const info = await big.info(d.bigId);
      const lines = [
        `Path: ${info.path}`,
        `Size: ${formatBytes(info.size)} (${info.size.toLocaleString()} bytes)`,
        `Lines: ${info.totalLines.toLocaleString()}`,
        `Line endings: ${info.eol}`,
        `Indexed: ${info.indexed ? "yes" : "in progress"}`,
        `Unsaved changes: ${info.dirty ? "yes" : "no"}`,
      ];
      void inform("Large file info", lines.join("\n"));
    },
  });

  // Claude Code (hidden everywhere while the integration is off; see settings.claudeEnabled)
  const claudeDoc = () => { const d = activeDoc(s()); return claudeEnabled() && d?.kind === "claude" ? d : undefined; };
  register({
    id: "claude.openHere",
    title: "Work with Claude Code Here",
    category: "Claude Code",
    enabled: claudeEnabled,
    // args: the folder; without one, the terminal tab's folder, the open folder, the active file's folder, or ask.
    run: async (args) => {
      let folder = typeof args === "string" ? args : null;
      const d = activeDoc(s());
      folder ??= (d?.kind === "terminal" ? d.terminal?.cwd : undefined) ?? s().folder ?? (d?.path ? dirName(d.path) : null);
      if (!folder) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({ directory: true, title: "Work with Claude Code in…" });
        if (!picked || Array.isArray(picked)) return false;
        folder = picked;
      }
      const name = `Claude · ${folder.split(/[\\/]/).filter(Boolean).pop() ?? folder}`;
      const open = s().docs.some((x) => x.kind === "claude" && samePath(x.claude?.cwd, folder));
      if (!open && (await makeRoom([name], (id) => closeDocument(id))) === 0) return false;
      await openClaudeTab(folder);
    },
  });
  register({
    id: "claude.openTerminal",
    title: "Open Claude Code Terminal Here",
    category: "Claude Code",
    enabled: claudeEnabled,
    // args: the folder (or { folder, resume }); without one, the Claude tab's folder, the open folder, the file's folder, or ask.
    run: async (args) => {
      const a = (typeof args === "string" ? { folder: args } : (args ?? {})) as { folder?: string; resume?: string };
      const d = activeDoc(s());
      let folder = a.folder ?? (d?.kind === "claude" ? d.claude?.cwd : undefined) ?? s().folder ?? (d?.path ? dirName(d.path) : null);
      if (!folder) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({ directory: true, title: "Claude Code terminal in…" });
        if (!picked || Array.isArray(picked)) return false;
        folder = picked;
      }
      const name = `Claude CLI · ${folder.split(/[\\/]/).filter(Boolean).pop() ?? folder}`;
      if ((await makeRoom([name], (id) => closeDocument(id))) === 0) return false;
      openClaudeTerminal(folder, a.resume);
    },
  });
  register({
    id: "claude.openFolder",
    title: "Work with Claude Code in Folder…",
    category: "Claude Code",
    enabled: claudeEnabled,
    run: async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, title: "Work with Claude Code in…" });
      if (!picked || Array.isArray(picked)) return false;
      return runCommand("claude.openHere", picked);
    },
  });
  /** Add the selection or the file of the active text tab to a Claude tab's message, opening one
   *  for the folder when none is open, and switch to it. */
  const toClaude = async (what: "selection" | "file") => {
    const d = activeDoc(s());
    if (d?.kind !== "text") return false;
    let target = claudeTabFor(d.path);
    if (!target) {
      if (!(await runCommand("claude.openHere", s().folder ?? (d.path ? dirName(d.path) : undefined)))) return false;
      target = claudeTabFor(d.path);
    }
    if (!target?.claude) return false;
    const text = contextFor(d, target.claude.cwd, what);
    if (!text) {
      s().toast(what === "selection" ? "Select some text first." : "Save the file first.", "info");
      return false;
    }
    appendToDraft(target.id, text);
    s().setActive(target.id);
  };
  const textForClaude = () => claudeEnabled() && activeDoc(s())?.kind === "text";
  register({ id: "claude.addSelection", title: "Add Selection to Claude Code", category: "Claude Code", keys: "Ctrl+Alt+L", enabled: textForClaude, run: () => toClaude("selection") });
  register({ id: "claude.addFile", title: "Mention This File to Claude Code", category: "Claude Code", enabled: () => textForClaude() && !!activeDoc(s())?.path, run: () => toClaude("file") });
  register({ id: "claude.newSession", title: "New Conversation", category: "Claude Code", enabled: () => !!claudeDoc(), run: () => { const d = claudeDoc(); if (!d) return false; newClaudeSession(d.id); } });
  register({ id: "claude.stop", title: "Stop", category: "Claude Code", enabled: () => { const d = claudeDoc(); return !!d && claudeBusy(d.id); }, run: () => { const d = claudeDoc(); if (!d) return false; interruptClaude(d.id); } });

  // Code intelligence (language servers, lib/lsp.ts). Keys follow VS Code.
  const lspReady = () => hasText() && hasLsp(activeDoc(s())?.id);
  const lspCmd = (id: string, title: string, run: () => boolean, keys?: string) =>
    register({ id, title, category: "Code", keys, when: keys ? editorFocused : undefined, enabled: lspReady, run });
  lspCmd("code.gotoDefinition", "Go to Definition", lspCommands.definition, "F12");
  lspCmd("code.gotoTypeDefinition", "Go to Type Definition", lspCommands.typeDefinition);
  lspCmd("code.gotoImplementation", "Go to Implementation", lspCommands.implementation, "Ctrl+F12");
  lspCmd("code.findReferences", "Find All References", lspCommands.references, "Shift+F12");
  lspCmd("code.renameSymbol", "Rename Symbol", lspCommands.rename, "F2");
  lspCmd("code.signatureHelp", "Show Parameter Hints", lspCommands.signature, "Ctrl+Shift+Space");
  lspCmd("code.formatWithServer", "Format Document with Language Server", lspCommands.format);
  register({ id: "code.triggerSuggest", title: "Show Suggestions", category: "Code", keys: "Ctrl+Space", when: editorFocused, enabled: hasText, run: () => { const v = editor.view; return v ? startCompletion(v) : false; } });
  const problemsHere = () => hasText() && (useLsp.getState().problems[activeDoc(s())!.id]?.length ?? 0) > 0;
  register({ id: "code.nextProblem", title: "Next Problem", category: "Code", keys: "F8", enabled: problemsHere, run: () => { const v = editor.view; if (!v) return false; v.focus(); return nextDiagnostic(v); } });
  register({ id: "code.prevProblem", title: "Previous Problem", category: "Code", keys: "Shift+F8", enabled: problemsHere, run: () => { const v = editor.view; if (!v) return false; v.focus(); return previousDiagnostic(v); } });
  register({ id: "view.problems", title: "Problems", category: "View", run: () => { s().set({ bottomVisible: true, bottomTab: "problems" }); } });
  register({
    id: "code.restartLanguageServers",
    title: "Restart Language Servers",
    category: "Code",
    enabled: () => s().settings.lspEnabled,
    run: async () => {
      await restartServers();
      s().toast("Language servers restarted", "info", 2500);
    },
  });

  // Compare (lib/diff.ts, components/DiffView.tsx)
  const activeDiff = () => { const d = activeDoc(s()); return d?.kind === "diff" ? d : undefined; };
  const pickFile = async (title: string) => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ title, multiple: false, directory: false });
    return typeof picked === "string" ? picked : null;
  };
  register({
    id: "compare.files",
    title: "Compare Two Files…",
    category: "Compare",
    // args: [left, right] paths; without them, ask for both.
    run: async (args) => {
      let pair = Array.isArray(args) && args.length === 2 ? (args as string[]) : null;
      if (!pair) {
        const a = await pickFile("Compare: first (original) file");
        if (!a) return false;
        const b = await pickFile("Compare: second (changed) file");
        if (!b) return false;
        pair = [a, b];
      }
      await openCompare({ kind: "file", path: pair[0] }, { kind: "file", path: pair[1] });
    },
  });
  register({
    id: "compare.activeWith",
    title: "Compare Active File With…",
    category: "Compare",
    enabled: () => activeDoc(s())?.kind === "text",
    run: async () => {
      const d = activeDoc(s());
      if (d?.kind !== "text") return false;
      const other = await pickFile(`Compare ${d.name} with…`);
      if (!other) return false;
      await openCompare({ kind: "file", path: other }, d.path && !d.dirty ? { kind: "file", path: d.path } : { kind: "tab", docId: d.id });
    },
  });
  register({
    id: "compare.withSaved",
    title: "Compare with Saved",
    category: "Compare",
    enabled: (a) => { const d = targetDoc(a); return d?.kind === "text" && !!d.path && d.dirty; },
    run: async (a) => {
      const d = targetDoc(a);
      if (d?.kind !== "text" || !d.path) return false;
      await openCompare({ kind: "file", path: d.path }, { kind: "tab", docId: d.id });
    },
  });
  register({
    id: "compare.withClipboard",
    title: "Compare with Clipboard",
    category: "Compare",
    enabled: (a) => targetDoc(a)?.kind === "text",
    run: async (a) => {
      const d = targetDoc(a);
      if (d?.kind !== "text") return false;
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      const clip = await readText().catch(() => "");
      if (!clip) {
        s().toast("The clipboard has no text.", "info");
        return false;
      }
      await openCompare({ kind: "text", label: "Clipboard", text: clip }, d.path && !d.dirty ? { kind: "file", path: d.path } : { kind: "tab", docId: d.id });
    },
  });
  // args: a path, or { docId }; without one, the active file.
  register({ id: "compare.selectForCompare", title: "Select Active File for Compare", category: "Compare", enabled: (a) => typeof a === "string" || (!!targetDoc(a)?.path && targetDoc(a)?.kind === "text"), run: (args) => { const p = typeof args === "string" ? args : targetDoc(args)?.path; if (!p) return false; selectForCompare(p); } });
  register({
    id: "compare.withSelected",
    title: "Compare Active File with Selected",
    category: "Compare",
    // Like Select for Compare, only a text tab: a large file can't be compared.
    enabled: (a) => { const c = compareCandidate(); if (typeof a === "string") return !!c && !samePath(c, a); const d = targetDoc(a); return !!c && d?.kind === "text" && !!d.path && !samePath(c, d.path); },
    run: (args) => { const d = targetDoc(args); const p = typeof args === "string" ? args : d?.kind === "text" ? d.path : null; if (!p) return false; compareWithSelected(p); },
  });
  register({ id: "compare.nextChange", title: "Next Change", category: "Compare", keys: "F7", enabled: () => !!activeDiff(), run: () => { const d = activeDiff(); return d ? stepChange(d.id, 1) : false; } });
  register({ id: "compare.prevChange", title: "Previous Change", category: "Compare", keys: "Shift+F7", enabled: () => !!activeDiff(), run: () => { const d = activeDiff(); return d ? stepChange(d.id, -1) : false; } });
  register({ id: "compare.swap", title: "Swap Sides", category: "Compare", enabled: () => !!activeDiff() && !activeDiff()!.dirty, run: () => { const d = activeDiff(); if (d) swapDiff(d.id); } });
  register({ id: "compare.toggleInline", title: "Toggle Inline / Side by Side", category: "Compare", enabled: () => !!activeDiff(), run: () => { const d = activeDiff(); if (d) patchDiff(d.id, (cur) => ({ inline: !cur.inline })); } });

  // Escape: close overlays
  register({
    id: "ui.escape",
    title: "Escape",
    category: "View",
    keys: "Escape",
    hidden: true,
    run: () => {
      const st = s();
      if (st.palette) {
        // The palette owns the close so Go to Line can restore the pre-preview position.
        bus.emit("palette.cancel");
        return true;
      }
      if (st.dialog) return false;
      if (st.findBar.open) {
        st.setFindBar({ open: false });
        editor.focus();
        return true;
      }
      return false;
    },
  });

  registerGitCommands();

  bindCommandRunner((id, args) => void runCommand(id, args));
  bindAppKeyFallback((e) => handleKeyEvent(e));
  applyDefaultEnabled();
}
