import { create } from "zustand";
import type { BigDocInfo, BigMatch, FileMatch, IndexProgress, Macro, SearchQuery, Settings, UndoEntry } from "./types";
import { DEFAULT_SETTINGS } from "./types";

export type SidebarPanel = "explorer" | "search" | "git" | "json" | "macros" | "scripts" | "settings";
export const PANELS: readonly SidebarPanel[] = ["search", "explorer", "git", "json", "scripts", "macros", "settings"];
export type BottomTab = "console" | "problems";
export type PaletteMode = "commands" | "files" | "goto" | "language" | "encoding" | "branch" | null;

export interface Doc {
  id: string;
  kind: "text" | "big" | "claude" | "terminal" | "diff" | "graph";
  path: string | null;
  name: string;
  dirty: boolean;
  encoding: string;
  bom: boolean;
  eol: "LF" | "CRLF" | "CR";
  language: string;
  readonly: boolean;
  modifiedMs: number;
  /** Size on disk in bytes (from the last stat/write); undefined for untitled docs. */
  size?: number;
  // large-file docs
  bigId?: number;
  bigInfo?: BigDocInfo;
  indexProgress?: IndexProgress;
  /** Opened by a single click in the Explorer: replaced by the next file opened that way, unless
   *  it was edited (then it is kept) or kept with a double-click on its tab or row. */
  preview?: boolean;
  /** Some bytes didn't decode in `encoding` (shown as U+FFFD): saving over the file would lose them. */
  decodeErrors?: boolean;
  /** Large file in follow mode (picking up appended lines itself; the external-change check skips it). */
  following?: boolean;
  /** Claude Code tab: the folder it works in and its session (resumed after a restart). */
  claude?: { cwd: string; sessionId?: string };
  /** Terminal tab running the `claude` command line in this folder (not kept in the session). */
  terminal?: { cwd: string; resume?: string; command?: string };
  /** Commit graph tab of this repository (not kept in the session). */
  graph?: { root: string };
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error" | "warning";
  message: string;
  timeout?: number;
}

export interface ConsoleLine {
  id: number;
  kind: "log" | "error" | "info" | "success";
  text: string;
  ts: number;
}

export interface CursorInfo {
  line: number;
  col: number;
  selections: number;
  selectedChars: number;
}

/** Find-bar state of a large-file view (kept across tab switches). */
export interface BigFindState {
  open: boolean;
  replace: boolean;
  query: string;
  replacement: string;
  regex: boolean;
  cs: boolean;
  word: boolean;
  dotAll: boolean;
  /** Replace All: Preserve Case. */
  keepCase?: boolean;
  results: BigMatch[];
  total: number;
  truncated: boolean;
  current: number;
  /** True once a search ran for the current query (shows "No results"). */
  searched: boolean;
}

/** Per-document view state of BigFileView, keyed by doc id, so remounting restores scroll/cursor. */
export interface BigViewState {
  topLine: number;
  /** 1-based cursor line (what the Go-to palette and status bar show). */
  cursorLine: number;
  /** 1-based selection anchor line, or null when nothing is selected. */
  anchorLine: number | null;
  find: BigFindState | null;
}

export interface SearchResultsFile {
  path: string;
  matches: FileMatch[];
}

export interface SearchState {
  query: SearchQuery;
  replacement: string;
  /** "doc" = the active document (the default), "open" = all open tabs, "folder" = the open folder,
   *  "custom" = folders the user picked. */
  scope: "doc" | "folder" | "open" | "custom";
  customRoots: string[];
  /** Files and folders last clicked / selected in the Explorer: what the "folder" scope searches
   *  (see `explorerRoots`; empty = the whole open folder). */
  treeTargets: { path: string; isDir: boolean }[];
  /** The current results came from document text in memory (not from disk), so Replace All edits the documents. */
  inMemory: boolean;
  running: boolean;
  searchId: number;
  files: SearchResultsFile[];
  totalMatches: number;
  filesSearched: number;
  truncated: boolean;
  error: string | null;
  collapsed: Set<string>;
  showReplace: boolean;
  /** Set when the last search was cancelled before finishing (`SearchDone.cancelled`). */
  cancelled: boolean;
  /** Files of the last folder search with a line that reached the per-line listing cap (`SearchDone.cappedPaths`). */
  cappedPaths: string[];
  /** Per-file errors from the last Replace in Files, shown inline in the results list. */
  fileErrors: Record<string, string>;
  /** `path:line:col` of the result row that is selected / was last opened. */
  activeKey: string | null;
  /** Matches the user left out of Replace All, per file, as `line:col` (see `replaceMatches`). */
  excluded: Record<string, string[]>;
  /** How many results were left out (single matches and whole files). */
  leftOut: number;
  /** The Filters section (include / exclude, .gitignore, dot-all, limit) is expanded. */
  showFilters: boolean;
}

export interface FindBarState {
  open: boolean;
  replace: boolean;
  query: string;
  replaceText: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Replace keeps the case of each replaced text (FOO → BAR, Foo → Bar, foo → bar). */
  preserveCase: boolean;
  /** Find in Selection (Alt+L): matches are limited to the ranges kept in the document's `findScopeField`. */
  inSelection: boolean;
  count: { current: number; total: number } | null;
}

export const DEFAULT_SEARCH_QUERY: SearchQuery = {
  pattern: "",
  isRegex: false,
  caseSensitive: false,
  wholeWord: false,
  multiline: false,
  dotAll: false,
  include: [],
  exclude: [],
  respectGitignore: true,
  maxResults: 20000,
  preserveCase: false,
};

/** Split editor: the focused pane shows `activeId`, the other one `otherId`. The right pane only
 *  shows text documents (other tabs open in the left one). `ratio` is the left pane's share of the width. */
export interface SplitState {
  otherId: string | null;
  focused: 0 | 1;
  ratio: number;
}

interface AppState {
  docs: Doc[];
  activeId: string | null;
  split: SplitState | null;
  folder: string | null;
  recentFiles: string[];
  recentFolders: string[];
  settings: Settings;
  settingsLoaded: boolean;
  /** Each setting's value before its last change, for Settings' "Use previous" button. */
  prevSettings: Partial<Settings>;

  sidebarVisible: boolean;
  sidebarPanel: SidebarPanel;
  sidebarWidth: number;
  /** Panels the user pinned, in docking order: they stay open beside the editor (see lib/panels.ts). */
  pinnedPanels: SidebarPanel[];
  /** Pinned panels collapsed by the brand icon / Ctrl+B. */
  pinnedHidden: boolean;
  /** Find in Files has results on screen, so the Search panel docks like a pinned one (lib/panels.ts). */
  searchDocked: boolean;
  /** Width of each panel; panels without one use `sidebarWidth`. Settings is reset to 35% on every open. */
  panelWidths: Partial<Record<SidebarPanel, number>>;
  bottomVisible: boolean;
  bottomTab: BottomTab;
  bottomHeight: number;
  palette: PaletteMode;
  findBar: FindBarState;
  columnMode: boolean;
  /** Ctrl+M: Tab / Shift+Tab move focus out of the editor instead of indenting. */
  tabMovesFocus: boolean;
  /** What the last Replace in Files changed on disk, for Find > Undo Replace in Files. */
  replaceUndo: { entries: UndoEntry[]; summary: string } | null;
  cursor: CursorInfo;
  bigViewState: Record<string, BigViewState>;
  jsonPathText: string;

  recording: boolean;
  recordingSteps: number;
  /** Macro id that a recording appends to (null = recording creates a new macro). */
  recordTargetId: string | null;
  macroPlaying: boolean;
  macroPaused: boolean;
  macros: Macro[];
  /** Path of the current script: the one last selected or run (Run Current Script). */
  activeScriptId: string | null;
  /** Expanded folders of the Scripts panel's tree. */
  scriptsExpanded: Set<string>;
  activeMacroId: string | null;

  search: SearchState;
  toasts: Toast[];
  consoleLines: ConsoleLine[];
  explorerExpanded: Set<string>;
  fileListCache: string[] | null;
  dialog: { title: string; message: string; actions: DialogAction[] } | null;

  // actions
  set: (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
  addDoc: (doc: Doc, activate?: boolean) => void;
  updateDoc: (id: string, patch: Partial<Doc>) => void;
  removeDoc: (id: string) => void;
  setActive: (id: string | null) => void;
  /** Give the keyboard to a pane of the split editor (its document becomes the active one). */
  focusPane: (pane: 0 | 1) => void;
  toast: (message: string, kind?: Toast["kind"], timeout?: number) => void;
  dismissToast: (id: number) => void;
  log: (text: string, kind?: ConsoleLine["kind"]) => void;
  clearConsole: () => void;
  setSearch: (patch: Partial<SearchState>) => void;
  setFindBar: (patch: Partial<FindBarState>) => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

const PREV_SETTINGS_KEY = "quarry.prevSettings";

function loadPrevSettings(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(PREV_SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Settings>) : {};
  } catch {
    return {};
  }
}

let toastSeq = 1;
let consoleSeq = 1;

export const useStore = create<AppState>((set, get) => ({
  docs: [],
  activeId: null,
  split: null,
  folder: null,
  recentFiles: [],
  recentFolders: [],
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  prevSettings: loadPrevSettings(),

  sidebarVisible: true,
  sidebarPanel: "explorer",
  sidebarWidth: 300,
  pinnedPanels: [],
  pinnedHidden: false,
  searchDocked: false,
  panelWidths: {},
  bottomVisible: false,
  bottomTab: "console",
  bottomHeight: 220,
  palette: null,
  findBar: {
    open: false,
    replace: false,
    preserveCase: false,
    inSelection: false,
    query: "",
    replaceText: "",
    regex: false,
    caseSensitive: false,
    wholeWord: false,
    count: null,
  },
  columnMode: false,
  tabMovesFocus: false,
  replaceUndo: null,
  cursor: { line: 1, col: 1, selections: 1, selectedChars: 0 },
  bigViewState: {},
  jsonPathText: "",

  recording: false,
  recordingSteps: 0,
  recordTargetId: null,
  macroPlaying: false,
  macroPaused: false,
  macros: [],
  activeScriptId: null,
  scriptsExpanded: new Set(),
  activeMacroId: null,

  search: {
    query: DEFAULT_SEARCH_QUERY,
    replacement: "",
    scope: "doc",
    customRoots: [],
    treeTargets: [],
    inMemory: false,
    running: false,
    searchId: 0,
    files: [],
    totalMatches: 0,
    filesSearched: 0,
    truncated: false,
    error: null,
    collapsed: new Set(),
    showReplace: false,
    cancelled: false,
    cappedPaths: [],
    fileErrors: {},
    activeKey: null,
    excluded: {},
    leftOut: 0,
    showFilters: false,
  },
  toasts: [],
  consoleLines: [],
  explorerExpanded: new Set(),
  fileListCache: null,
  dialog: null,

  set: (patch) => set(typeof patch === "function" ? patch : () => patch),
  addDoc: (doc, activate = true) =>
    set((s) => ({ docs: [...s.docs, doc], ...(activate ? activePatch(s, doc.id, doc.kind) : {}) })),
  updateDoc: (id, patch) =>
    set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
  removeDoc: (id) =>
    set((s) => {
      const idx = s.docs.findIndex((d) => d.id === id);
      const docs = s.docs.filter((d) => d.id !== id);
      const { [id]: _dropped, ...bigViewState } = s.bigViewState;
      // Closing what the other pane shows closes the split.
      const split = s.split && (s.split.otherId === id || docs.length === 0) ? null : s.split;
      if (s.activeId !== id) return { docs, split, bigViewState };
      if (split?.focused === 1) {
        // The right pane only shows text: the nearest text tab replaces it, else the split closes.
        const after = docs.slice(idx).find((d) => d.kind === "text") ?? docs.slice(0, idx).reverse().find((d) => d.kind === "text");
        return after ? { docs, bigViewState, split, activeId: after.id } : { docs, bigViewState, split: null, activeId: split.otherId };
      }
      const next = docs[Math.min(idx, docs.length - 1)];
      return { docs, bigViewState, split, activeId: next ? next.id : null };
    }),
  setActive: (id) => set((s) => activePatch(s, id)),
  focusPane: (pane) =>
    set((s) => {
      const sp = s.split;
      if (!sp || sp.focused === pane) return {};
      return { activeId: sp.otherId, split: { ...sp, focused: pane, otherId: s.activeId } };
    }),
  toast: (message, kind = "info", timeout) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, message, timeout }] }));
    const ms = timeout ?? (kind === "error" ? 8000 : 3500);
    if (ms > 0) setTimeout(() => get().dismissToast(id), ms);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  log: (text, kind = "log") =>
    set((s) => ({
      consoleLines: [...s.consoleLines.slice(-1999), { id: consoleSeq++, kind, text, ts: Date.now() }],
    })),
  clearConsole: () => set({ consoleLines: [] }),
  setSearch: (patch) => set((s) => ({ search: { ...s.search, ...patch } })),
  setFindBar: (patch) => set((s) => ({ findBar: { ...s.findBar, ...patch } })),
  updateSettings: (patch) =>
    set((s) => {
      const prev: Partial<Settings> = { ...s.prevSettings };
      for (const k of Object.keys(patch) as (keyof Settings)[]) {
        if (patch[k] !== s.settings[k]) (prev as Record<string, unknown>)[k] = s.settings[k];
      }
      try {
        localStorage.setItem(PREV_SETTINGS_KEY, JSON.stringify(prev));
      } catch {
        /* per-machine convenience only */
      }
      return { settings: { ...s.settings, ...patch }, prevSettings: prev };
    }),
}));

/** `default` runs on Enter, `cancel` on Escape (see Dialog in Toasts.tsx for the fallbacks). */
export interface DialogAction {
  label: string;
  kind?: "primary" | "danger";
  run: () => void;
  default?: boolean;
  cancel?: boolean;
}

/** The store change that makes `id` the active document. With the editor split, picking the
 *  document the other pane shows moves the focus there, and a tab that isn't text (only the left
 *  pane shows those) opens in the left pane, the right one keeping its document. */
function activePatch(s: AppState, id: string | null, kind = s.docs.find((d) => d.id === id)?.kind): Partial<AppState> {
  const sp = s.split;
  if (!sp || id === null || id === s.activeId) return { activeId: id };
  if (id === sp.otherId) return { activeId: id, split: { ...sp, focused: sp.focused === 0 ? 1 : 0, otherId: s.activeId } };
  if (sp.focused === 1 && kind !== "text") return { activeId: id, split: { ...sp, focused: 0, otherId: s.activeId } };
  return { activeId: id };
}

/** The document a pane shows (pane 0 = left; without a split only pane 0 exists). */
export function paneDocId(s: Pick<AppState, "activeId" | "split">, pane: 0 | 1): string | null {
  if (!s.split) return pane === 0 ? s.activeId : null;
  return pane === s.split.focused ? s.activeId : s.split.otherId;
}

export const activeDoc = (s: AppState): Doc | undefined => s.docs.find((d) => d.id === s.activeId);

export function useActiveDoc(): Doc | undefined {
  return useStore(activeDoc);
}

let docSeq = 1;
export function newDocId(): string {
  return `doc-${Date.now().toString(36)}-${docSeq++}`;
}
