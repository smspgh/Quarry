/**
 * Keyboard macro recorder/player.
 * Records editor keystrokes, typed text and app-level commands; replays them
 * through CodeMirror's own key dispatch so every binding behaves exactly as live.
 */
import { EditorState, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import { runScopeHandlers } from "@codemirror/view";
import { editor } from "../editor/manager";
import { askDialog, persistSettings } from "./actions";
import { useStore } from "./store";
import type { Macro, MacroStep } from "./types";
import { appData, fs } from "./ipc";

let steps: MacroStep[] = [];
let replaying = false;
let runCommandRef: ((id: string, args?: unknown) => Promise<void> | void) | null = null;

export function bindCommandRunner(run: (id: string, args?: unknown) => Promise<void> | void) {
  runCommandRef = run;
}

const IGNORED_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock", "ScrollLock", "Dead", "Process"]);

function isRecording() {
  return useStore.getState().recording && !replaying;
}

export function installRecorderHooks() {
  editor.hooks = {
    onKeydown: (e) => {
      if (!isRecording()) return;
      if (IGNORED_KEYS.has(e.key)) return;
      // Printable characters without modifiers arrive via inputHandler; skip to avoid duplicates.
      const printable = e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
      if (printable) return;
      push({ type: "key", key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
    },
    onInput: (text) => {
      if (!isRecording()) return;
      const last = steps[steps.length - 1];
      if (last && last.type === "input") last.text += text;
      else push({ type: "input", text });
    },
  };
}

function push(step: MacroStep) {
  steps.push(step);
  useStore.getState().set({ recordingSteps: steps.length });
}

/**
 * The arguments a macro step keeps. A `{ docId }` (a tab's right-click menu) names a tab of this
 * session and means nothing at replay, so it is dropped: the step then acts on the active tab.
 * Pure.
 */
export function recordableArgs(args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args) || !("docId" in args)) return args;
  const { docId: _drop, ...rest } = args as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Commands a recording never captures: macro commands, and script runs (refused while a macro records or plays). */
export function isUnrecordable(id: string): boolean {
  return id.startsWith("macro.") || id === "script.runActive" || id === "script.run";
}

/** Called by the command registry when a command executes. */
export function recordCommand(id: string, args?: unknown) {
  if (!isRecording()) return;
  if (isUnrecordable(id)) return;
  const kept = recordableArgs(args);
  push(kept === undefined ? { type: "command", id } : { type: "command", id, args: kept });
  // The command runs synchronously up to its first await: a picker it opens then marks this step.
  freshStep = steps.length - 1;
  queueMicrotask(() => (freshStep = null));
}

/** The step of a command that only opened a picker (`markPickerStep`), while that picker is open. */
let pickerStep: number | null = null;
/** The step recorded by the command that is running now (until its first await). */
let freshStep: number | null = null;

/**
 * Called by a command that opens a picker (the branch picker): its step is the one just recorded.
 * When a row is picked, `dropPickerStep` removes it, so the macro holds only the command the row
 * ran, with the picked name: replaying it does not open the picker again.
 */
export function markPickerStep() {
  // Only the step of the command opening the picker: a picker opened by a button records nothing.
  pickerStep = isRecording() && freshStep !== null && freshStep === steps.length - 1 ? freshStep : null;
}

/** A picker row is about to run its command: forget the step that opened the picker. */
export function dropPickerStep() {
  if (pickerStep !== null && pickerStep === steps.length - 1) {
    steps.pop();
    useStore.getState().set({ recordingSteps: steps.length });
  }
  pickerStep = null;
}

/** Why a script can't run right now because of a macro, or null. */
export function scriptBlockedByMacro(st: { recording: boolean; macroPlaying: boolean }): string | null {
  if (st.recording) return "Scripts can't run while a macro is recording. Stop recording first (Ctrl+Shift+R).";
  if (st.macroPlaying) return "Scripts can't run while a macro is playing.";
  return null;
}

export function startRecording(targetId: string | null = null) {
  steps = [];
  pickerStep = null;
  useStore.getState().set({ recording: true, recordingSteps: 0, recordTargetId: targetId });
}

export function stopRecording(): MacroStep[] {
  useStore.getState().set({ recording: false });
  const out = steps;
  steps = [];
  return out;
}

function syntheticKey(step: Extract<MacroStep, { type: "key" }>): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: step.key,
    code: step.code,
    ctrlKey: step.ctrl,
    shiftKey: step.shift,
    altKey: step.alt,
    metaKey: step.meta,
    bubbles: true,
    cancelable: true,
  });
}

// Playback control: Stop cancels at the next step; Pause holds there until resumed.
let cancelled = false;
let depth = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function stopPlayback() {
  cancelled = true;
  useStore.getState().set({ macroPaused: false });
}
export function pausePlayback(paused: boolean) {
  useStore.getState().set({ macroPaused: paused });
}
export class PlaybackCancelled extends Error {}

async function checkpoint() {
  while (useStore.getState().macroPaused && !cancelled) await sleep(60);
  if (cancelled) throw new PlaybackCancelled("stopped");
}

// ---------- single undo step ----------
// While a macro plays, every transaction is kept out of the history; when the outermost run ends
// the net change (before -> after) is re-applied as ONE history entry so Ctrl+Z undoes the whole run.
// Macros that themselves contain Undo/Redo steps are played with normal history (grouping would make
// their Undo step revert the user's pre-macro edit instead of the previous macro step).
let suppressHistory = false;
let snapshot: { docId: string | null; text: string } | null = null;

/** Hides macro-playback transactions from the undo history while `suppressHistory` is set. */
const macroHistoryExtension: Extension = EditorState.transactionExtender.of(() => (suppressHistory ? { annotations: Transaction.addToHistory.of(false) } : null));
/** Marker so the extension is appended to each editor state lineage only once (states are recreated per document). */
const installedMarker = StateField.define<boolean>({ create: () => true, update: (v) => v });

function ensureHistoryExtension(view: NonNullable<typeof editor.view>) {
  if (view.state.field(installedMarker, false) !== undefined) return;
  view.dispatch({ effects: StateEffect.appendConfig.of([installedMarker, macroHistoryExtension]), annotations: Transaction.addToHistory.of(false) });
}

function isUndoRedoStep(step: MacroStep): boolean {
  if (step.type === "command") return step.id === "edit.undo" || step.id === "edit.redo";
  if (step.type === "key") {
    const k = step.key.toLowerCase();
    return (step.ctrl || step.meta) && (k === "z" || k === "y");
  }
  return false;
}

/** Pure helper: can this macro be collapsed into one undo step? */
export function canGroupUndo(list: MacroStep[]): boolean {
  return !list.some(isUndoRedoStep);
}

function beginSession(list: MacroStep[]) {
  cancelled = false;
  useStore.getState().set({ macroPlaying: true, macroPaused: false });
  const view = editor.view;
  if (view && canGroupUndo(list)) {
    ensureHistoryExtension(view);
    snapshot = { docId: editor.currentDocId, text: view.state.doc.toString() };
    suppressHistory = true;
  } else snapshot = null;
}

function endSession() {
  replaying = false;
  suppressHistory = false;
  useStore.getState().set({ macroPlaying: false, macroPaused: false });
  const view = editor.view;
  const snap = snapshot;
  snapshot = null;
  if (view && snap && snap.docId === editor.currentDocId) {
    const after = view.state.doc.toString();
    if (after !== snap.text) {
      const afterSel = view.state.selection;
      // Revert silently, then re-apply the net change as a single undoable transaction.
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: snap.text }, annotations: Transaction.addToHistory.of(false) });
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: after }, selection: afterSel, userEvent: "input.macro", scrollIntoView: true });
    }
  }
  view?.focus();
}

export async function playSteps(list: MacroStep[], times = 1): Promise<void> {
  const view = editor.view;
  if (!view) return;
  replaying = true;
  if (depth++ === 0) beginSession(list);
  try {
    for (let n = 0; n < times; n++) {
      let i = 0;
      for (const step of list) {
        // Yield regularly so Stop/Pause and screen updates get a chance to run.
        if (i++ % 20 === 0) {
          await sleep(0);
          await checkpoint();
        }
        if (step.type === "input") {
          view.dispatch(view.state.replaceSelection(step.text), { userEvent: "input.type", scrollIntoView: true });
        } else if (step.type === "key") {
          const ev = syntheticKey(step);
          const handled = runScopeHandlers(view, ev, "editor");
          if (!handled) {
            // Fall back to app-level shortcuts (find, save, column mode...).
            await appKeyFallback?.(ev);
          }
        } else if (step.type === "command") {
          await runCommandRef?.(step.id, step.args);
        }
      }
    }
  } finally {
    if (--depth === 0) endSession();
  }
}

let appKeyFallback: ((e: KeyboardEvent) => Promise<boolean> | boolean) | null = null;
export function bindAppKeyFallback(fn: (e: KeyboardEvent) => Promise<boolean> | boolean) {
  appKeyFallback = fn;
}

/**
 * Pure decision for "play until end of file". Called with the cursor line before and after one
 * iteration (1-based) and the line count afterwards; returns true when playback should stop.
 * Stops when the macro no longer advances the cursor downwards, or the last line has been processed.
 */
export function shouldStopToEnd(lineBefore: number, lineAfter: number, lineCountAfter: number): boolean {
  // The macro did not move down: it would loop on the same line forever.
  if (lineAfter <= lineBefore) return true;
  // The iteration that just ran started on the last line, so every line has now been processed.
  // (Starting *below* the last line and landing on it means the last line still needs a pass.)
  if (lineBefore >= lineCountAfter) return true;
  return false;
}

/** Hard cap for "play until end of file". */
export const PLAY_TO_END_MAX = 10_000;

/** Confirmation detail for To end, the same from the panel, the menu and the palette. */
export const TO_END_DETAIL = "Repeats until the cursor reaches the last line or stops moving down.";

/** Confirmation detail for playing a macro once or `times` times in a row. */
export function playDetail(steps: number, times = 1): string {
  const s = `${steps} recorded step${steps === 1 ? "" : "s"}`;
  return times === 1 ? `${s}.` : `${s}, played ${times} times in a row.`;
}

/**
 * Play until the cursor reaches the last line, stops moving down, or the cap is hit.
 * Starting on the last line plays exactly once. Returns the number of iterations played.
 */
export async function playToEnd(list: MacroStep[], maxIterations = PLAY_TO_END_MAX): Promise<number> {
  const view = editor.view;
  if (!view) return 0;
  let i = 0;
  // Wrap in an outer playSteps "session" so Stop/Pause, the playing flag and the undo group span all iterations.
  depth++;
  beginSession(list);
  try {
    while (i < maxIterations) {
      const lineBefore = view.state.doc.lineAt(view.state.selection.main.head).number;
      await playSteps(list, 1);
      i++;
      const lineAfter = view.state.doc.lineAt(view.state.selection.main.head).number;
      if (shouldStopToEnd(lineBefore, lineAfter, view.state.doc.lines)) break;
      if (i % 5 === 0) {
        await sleep(0);
        await checkpoint();
      }
    }
  } finally {
    if (--depth === 0) endSession();
  }
  if (i >= maxIterations) useStore.getState().toast(`Stopped after ${maxIterations.toLocaleString()} repetitions (safety limit).`, "warning");
  return i;
}

/** Run a playback function, turning a Stop into a friendly toast instead of an error. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PlaybackCancelled) {
      useStore.getState().toast("Macro stopped", "info", 1500);
      return undefined;
    }
    throw e;
  }
}

export function describeStep(step: MacroStep): string {
  if (step.type === "input") return `Type ${JSON.stringify(step.text)}`;
  if (step.type === "command") return `Command ${step.id}`;
  const mods = [step.ctrl && "Ctrl", step.alt && "Alt", step.shift && "Shift"].filter(Boolean).join("+");
  const key = step.key === " " ? "Space" : step.key.length === 1 ? step.key.toUpperCase() : step.key.replace(/^Arrow/, "");
  return mods ? `${mods}+${key}` : key;
}

// ---------- folder-backed persistence ----------
// Every macro is a <name>.macro.json file in the macros folder (Settings › Folders, default <app data>\macros).
// Nothing touches disk until the user clicks Save.

const EXT = ".macro.json";

/** Strip control characters and whitespace from a folder setting; empty means "use the default". */
export function cleanDirSetting(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
}

const resolving = new Map<string, Promise<string>>();

/**
 * Resolve a scripts/macros folder setting, creating the folder if needed. When the custom folder is
 * unusable the setting is reset to "" (the default folder) and the user is told once; concurrent
 * callers share one attempt, so the warning never appears twice.
 */
export function resolveFolder(key: "scriptsDir" | "macrosDir", sub: string, label: string): Promise<string> {
  const custom = cleanDirSetting(useStore.getState().settings[key]);
  const id = `${key}|${custom}`;
  const pending = resolving.get(id);
  if (pending) return pending;
  const attempt = (async () => {
    const fallback = `${await appData.path()}\\${sub}`;
    if (custom) {
      try {
        if (!(await fs.exists(custom))) await fs.createDir(custom);
        return custom;
      } catch (e) {
        const st = useStore.getState();
        if (cleanDirSetting(st.settings[key]) === custom) {
          st.set({ settings: { ...st.settings, [key]: "" } });
          await persistSettings();
        }
        st.toast(`${label} folder "${custom}" is not usable (${String(e)}). The setting was reset to the default folder.`, "warning", 6000);
      }
    }
    if (!(await fs.exists(fallback))) await fs.createDir(fallback);
    return fallback;
  })().finally(() => resolving.delete(id));
  resolving.set(id, attempt);
  return attempt;
}

/** Resolve the macros folder (see resolveFolder). */
export function macrosDir(): Promise<string> {
  return resolveFolder("macrosDir", "macros", "Macros");
}

/** Why a folder reload happens: "switch" when the folder setting just changed (cancel reverts it). */
export type LoadReason = "reload" | "switch";

export function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "untitled";
}

/** File name a macro is written to (shown as a sub-label when it differs from the display name). */
export function macroFileName(name: string): string {
  return safeFileName(name) + EXT;
}

/** Normalise a path for display (Windows separators, no doubled slashes). */
export function displayPath(p: string): string {
  return p.replace(/[\\/]+/g, "\\");
}

let loadedDir: string | null = null;

/**
 * (Re)load all macros from the macros folder. Unsaved in-memory items are lost, so when there are
 * any the user is asked first; cancelling reverts a pending folder change. Returns null when cancelled.
 */
export async function loadMacros(reason: LoadReason = "reload"): Promise<Macro[] | null> {
  const st = useStore.getState();
  const unsaved = st.macros.filter((m) => m.unsaved).length;
  if (unsaved > 0) {
    const switching = reason === "switch" && loadedDir !== null;
    const ok = await askDialog(
      switching ? "Switch macros folder?" : "Reload macros from folder?",
      `${unsaved} unsaved macro${unsaved === 1 ? "" : "s"} will be discarded.`,
      switching ? "Switch and discard" : "Reload and discard",
    );
    if (!ok) {
      if (switching) {
        st.set({ settings: { ...useStore.getState().settings, macrosDir: loadedDir ?? "" } });
        await persistSettings();
        st.toast("Macros folder change cancelled.", "info", 2500);
      }
      return null;
    }
  }
  let list: Macro[] = [];
  try {
    const dir = await macrosDir();
    loadedDir = cleanDirSetting(useStore.getState().settings.macrosDir);
    await migrateLegacy(dir);
    const entries = (await fs.listDir(dir)).filter((e) => !e.isDir && e.name.toLowerCase().endsWith(EXT));
    const loaded = await Promise.all(
      entries.map(async (e) => {
        try {
          const f = await fs.readText(e.path);
          const data = JSON.parse(f.content) as { steps: MacroStep[]; createdAt?: number };
          if (!Array.isArray(data.steps)) return null;
          return { id: e.path, path: e.path, name: e.name.slice(0, -EXT.length), steps: data.steps, createdAt: data.createdAt ?? e.modifiedMs } as Macro;
        } catch {
          return null;
        }
      }),
    );
    list = loaded.filter((m): m is Macro => !!m).sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    useStore.getState().toast(`Could not read the macros folder: ${String(e)}`, "error");
  }
  useStore.getState().set({ macros: list });
  return list;
}

/** One-time import of the old macros.json store into individual files. */
async function migrateLegacy(dir: string) {
  try {
    const raw = await appData.read("macros.json");
    if (!raw) return;
    const old = JSON.parse(raw) as Macro[];
    for (const m of old) {
      const p = `${dir}\\${safeFileName(m.name)}${EXT}`;
      if (!(await fs.exists(p))) await fs.writeText(p, JSON.stringify({ steps: m.steps, createdAt: m.createdAt }, null, 2));
    }
    await appData.write("macros.json", "");
  } catch {
    /* ignore */
  }
}

/** Keep an edit in memory only (marks the macro unsaved). */
export function stageMacros(list: Macro[]) {
  useStore.getState().set({ macros: list });
}

/**
 * Write one macro to its file (renaming the file if the name changed) and clear its unsaved flag.
 * Asks before overwriting a file that belongs to a different macro; returns null when cancelled.
 */
export async function saveMacro(macro: Macro): Promise<Macro | null> {
  const dir = await macrosDir();
  const target = `${dir}\\${safeFileName(macro.name)}${EXT}`;
  if (macro.path !== target && (await fs.exists(target))) {
    const ok = await askDialog("Overwrite existing macro?", `${displayPath(target)} already exists. Replace it with "${macro.name}"?`, "Overwrite");
    if (!ok) return null;
  }
  if (macro.path && macro.path !== target && (await fs.exists(macro.path))) await fs.remove(macro.path);
  await fs.writeText(target, JSON.stringify({ steps: macro.steps, createdAt: macro.createdAt }, null, 2));
  const saved: Macro = { ...macro, path: target, unsaved: false };
  const st = useStore.getState();
  // Another in-memory item may have pointed at the overwritten file; drop it to avoid duplicates.
  st.set({ macros: st.macros.filter((m) => m.id === macro.id || m.path !== target).map((m) => (m.id === macro.id ? saved : m)) });
  return saved;
}

/** Delete a macro's file (if it has one) and drop it from the list. */
export async function deleteMacro(macro: Macro) {
  if (macro.path && (await fs.exists(macro.path))) await fs.trash(macro.path);
  const st = useStore.getState();
  st.set({ macros: st.macros.filter((m) => m.id !== macro.id), activeMacroId: st.activeMacroId === macro.id ? null : st.activeMacroId });
}
