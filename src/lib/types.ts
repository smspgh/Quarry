export type DocKind = "text" | "big" | "claude" | "terminal" | "diff";

/** Encodings offered for saving and for Reopen with Encoding (names encoding_rs knows). */
export const ENCODINGS = ["UTF-8", "UTF-16LE", "UTF-16BE", "windows-1252", "ISO-8859-1", "ISO-8859-2", "windows-1251", "Shift_JIS", "GBK", "EUC-KR"];

export interface FileStat {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
  modifiedMs: number;
  readonly: boolean;
  isLarge: boolean;
}

export interface TextFile {
  path: string;
  content: string;
  encoding: string;
  hasBom: boolean;
  eol: "LF" | "CRLF" | "CR";
  size: number;
  modifiedMs: number;
  hadDecodeErrors: boolean;
  /** NUL bytes found in the file head: probably not text. */
  looksBinary: boolean;
  /** More than one line-ending style was present. */
  mixedEol: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedMs: number;
}

export interface JsonError {
  line: number;
  column: number;
  message: string;
}

export interface JsonResult {
  ok: boolean;
  output: string | null;
  error: JsonError | null;
  /** Minify removed comments or trailing commas. */
  stripped?: boolean;
}

export interface BigDocInfo {
  id: number;
  path: string;
  size: number;
  totalLines: number;
  indexed: boolean;
  dirty: boolean;
  eol: "LF" | "CRLF" | "CR";
  /** "UTF-8", or "UTF-16LE" / "UTF-16BE" (decoded for display, read-only). */
  encoding: string;
}

export interface IndexProgress {
  id: number;
  newlines: number;
  indexedBytes: number;
  totalBytes: number;
  complete: boolean;
}

export interface LinesChunk {
  start: number;
  lines: string[];
  totalLines: number;
  indexed: boolean;
  truncated: boolean;
  /** Indices into `lines` of lines that are not valid UTF-8 (shown with U+FFFD). */
  lossy: number[];
}

export interface BigMatch {
  line: number;
  col: number;
  len: number;
  preview: string;
  previewCol: number;
}

export interface BigSearchResult {
  matches: BigMatch[];
  total: number;
  truncated: boolean;
}

export interface BigSearchArgs {
  pattern: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  dotAll: boolean;
  maxResults?: number;
  /** Replace All only: keep the case of each replaced text. */
  preserveCase?: boolean;
}

export interface SearchQuery {
  pattern: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  multiline: boolean;
  dotAll: boolean;
  include: string[];
  exclude: string[];
  respectGitignore: boolean;
  maxResults: number;
  /** Replace keeps the case of each replaced text (FOO → BAR, Foo → Bar, foo → bar). */
  preserveCase: boolean;
}

export interface FileMatch {
  path: string;
  line: number; // 1-based (ripgrep convention)
  col: number; // 0-based byte column
  len: number;
  preview: string;
  previewCol: number;
  /** The preview starts partway through the line. */
  previewCut?: boolean;
}

export interface SearchDone {
  searchId: number;
  filesSearched: number;
  matches: number;
  truncated: boolean;
  cancelled: boolean;
}

export interface ReplaceFileResult {
  path: string;
  replaced: number;
  error: string | null;
  /** Backup of the original (Replace in Files undo), when the file was changed. */
  backup?: string | null;
  /** Digest of what was written, so undo can skip files edited since. */
  digest?: string | null;
}

export interface UndoEntry {
  path: string;
  backup: string;
  digest: string;
}

export type ThemeMode = "system" | "light" | "dark";

export interface Settings {
  theme: ThemeMode;
  fontFamily: string;
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  highlightActiveLine: boolean;
  bracketMatching: boolean;
  autoCloseBrackets: boolean;
  renderWhitespace: boolean;
  defaultEol: "LF" | "CRLF";
  largeFileThresholdMb: number;
  restoreSession: boolean;
  jsonIndent: number;
  mica: boolean;
  /** Where the classic File / Edit / View menu lives. */
  menuPosition: "top" | "titlebar" | "hidden";
  /** Ask before a script or macro runs from a menu or shortcut. */
  confirmRuns: boolean;
  /** Look for a new Quarry release a few seconds after start (Help > Check for Updates always works). */
  autoUpdateCheck: boolean;
  /** Folder holding user scripts (.js). Empty = <app data>\scripts. */
  scriptsDir: string;
  /** Folder holding macros (.macro.json). Empty = <app data>\macros. */
  macrosDir: string;
  /** Find / replace history entries kept per field; 0 = unlimited. */
  searchHistoryLimit: number;
  /** Most tabs open at once; opening more closes the least recently used unchanged tabs (after asking). */
  maxOpenTabs: number;
  /** Syntax colours in large-file mode (JSON, logs, CSV / TSV, XML, SQL; visible lines only). */
  bigHighlight: boolean;
  /** Claude Code integration (Explorer "Work with Claude Code here", Claude tabs). Off hides all of it. */
  claudeEnabled: boolean;
  /** The `claude` executable; empty = found on PATH or in the usual install folders. */
  claudePath: string;
  /** Model alias or name passed as `--model`; empty = Claude Code's own default. */
  claudeModel: string;
  /** `acceptEdits`: file edits go ahead without asking; `default`: ask before edits too. */
  claudePermissionMode: "acceptEdits" | "default";
  /** Code intelligence: completion, hover, go to definition, problems... from language servers. */
  lspEnabled: boolean;
  /** Language servers switched off (ids from lspServers.ts SERVERS). */
  lspDisabled: string[];
  /** Command lines replacing a server's default (`id` → `"C:\tools\clangd.exe" --background-index`). */
  lspCommands: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace',
  fontSize: 14,
  tabSize: 4,
  insertSpaces: true,
  wordWrap: false,
  lineNumbers: true,
  highlightActiveLine: true,
  bracketMatching: true,
  autoCloseBrackets: true,
  renderWhitespace: false,
  defaultEol: "CRLF",
  largeFileThresholdMb: 32,
  restoreSession: true,
  jsonIndent: 2,
  mica: true,
  menuPosition: "titlebar",
  confirmRuns: true,
  autoUpdateCheck: true,
  scriptsDir: "",
  macrosDir: "",
  searchHistoryLimit: 0,
  maxOpenTabs: 50,
  bigHighlight: true,
  claudeEnabled: true,
  claudePath: "",
  claudeModel: "",
  claudePermissionMode: "acceptEdits",
  lspEnabled: true,
  lspDisabled: [],
  lspCommands: {},
};

export type MacroStep =
  | { type: "key"; key: string; code: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }
  | { type: "input"; text: string }
  | { type: "command"; id: string; args?: unknown };

export interface Macro {
  id: string;
  name: string;
  steps: MacroStep[];
  createdAt: number;
  /** File this macro was loaded from / saved to. */
  path?: string;
  /** In-memory only: differs from what is on disk (new or edited). Cleared by Save. */
  unsaved?: boolean;
}

export interface Script {
  id: string;
  name: string;
  source: string;
  /** File this script was loaded from / saved to. */
  path?: string;
  updatedAt: number;
  /** Optional applicability filter: the script is offered only for matching documents. */
  when?: { languages?: string[]; extensions?: string[] };
  /** In-memory only: differs from what is on disk (new or edited). Cleared by Save. */
  unsaved?: boolean;
}
