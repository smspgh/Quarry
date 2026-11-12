import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BigDocInfo,
  BigSearchArgs,
  BigSearchResult,
  DirEntry,
  FileMatch,
  FileStat,
  IndexProgress,
  JsonResult,
  LinesChunk,
  ReplaceFileResult, UndoEntry,
  SearchDone,
  SearchQuery,
  TextFile,
} from "./types";

export const fs = {
  stat: (path: string) => invoke<FileStat>("fs_stat", { path }),
  exists: (path: string) => invoke<boolean>("fs_exists", { path }),
  normalize: (path: string) => invoke<string>("fs_normalize", { path }),
  readText: (path: string, encoding?: string) => invoke<TextFile>("fs_read_text", { path, encoding }),
  writeText: (path: string, content: string, options?: { encoding?: string; bom?: boolean }) =>
    invoke<FileStat>("fs_write_text", { path, content, options }),
  listDir: (path: string, showHidden = false) => invoke<DirEntry[]>("fs_list_dir", { path, showHidden }),
  createDir: (path: string) => invoke<void>("fs_create_dir", { path }),
  rename: (from: string, to: string) => invoke<void>("fs_rename", { from, to }),
  remove: (path: string) => invoke<void>("fs_delete", { path }),
  /** Move to the Recycle Bin. */
  trash: (path: string) => invoke<void>("fs_trash", { path }),
  /** Put files on the Windows clipboard; with `cut`, pasting moves them. */
  toClipboard: (paths: string[], cut: boolean) => invoke<void>("files_to_clipboard", { paths, cut }),
  /** Files on the Windows clipboard (empty when it holds something else). */
  fromClipboard: () => invoke<{ paths: string[]; cut: boolean }>("files_from_clipboard"),
  /** Copy (or with `mv`, move) into `dest`; clashes get a new name, nothing is overwritten. */
  paste: (sources: string[], dest: string, mv: boolean) => invoke<{ from: string; to: string | null; error: string | null }[]>("files_paste", { sources, dest, mv }),
  walk: (root: string, max?: number) => invoke<string[]>("fs_walk", { root, max }),
  /** Watch `path` recursively; changes arrive via `onChanged` (debounced ~300 ms). Replaces any previous watcher. */
  watchStart: (path: string) => invoke<void>("watch_start", { path }),
  watchStop: () => invoke<void>("watch_stop"),
  onChanged: (cb: (paths: string[]) => void): Promise<UnlistenFn> => listen<string[]>("fs-changed", (e) => cb(e.payload)),
};

export const appData = {
  read: (name: string) => invoke<string | null>("app_read", { name }),
  write: (name: string, content: string) => invoke<void>("app_write", { name, content }),
  path: () => invoke<string>("app_data_path"),
};

export const json = {
  validate: (text: string, jsonc = false) => invoke<JsonResult>("json_validate", { text, jsonc }),
  format: (text: string, indent: number, useTabs = false) => invoke<JsonResult>("json_format", { text, indent, useTabs }),
  minify: (text: string) => invoke<JsonResult>("json_minify", { text }),
};

/** One node of a large file's JSON tree (`json_tree::TreeNode`). Offsets are bytes into the file. */
export interface BigJsonNode {
  key: string | null;
  index: number;
  kind: "object" | "array" | "string" | "number" | "boolean" | "null";
  preview: string;
  start: number;
  end: number | null;
  count: number | null;
}

export const big = {
  /** JSON: Validate on a large-file tab, reading the file in place (unedited docs only). */
  jsonValidate: (id: number, jsonc: boolean) => invoke<JsonResult>("big_json_validate", { id, jsonc }),
  /** Lazy JSON tree of a large-file tab (read from the file as saved). */
  jsonRoot: (id: number) => invoke<BigJsonNode>("big_json_root", { id }),
  jsonChildren: (id: number, start: number, resume: number | null, firstIndex: number, limit: number) =>
    invoke<{ nodes: BigJsonNode[]; next: number | null }>("big_json_children", { id, start, resume, firstIndex, limit }),
  jsonCount: (id: number, start: number) => invoke<number>("big_json_count", { id, start }),
  lineOfOffset: (id: number, offset: number) => invoke<number>("big_line_of_offset", { id, offset }),
  /** Filter view: keep the lines matching (or with `invert`, not matching) a search; returns how many. */
  filter: (id: number, query: BigSearchArgs, invert: boolean) => invoke<number>("big_filter", { id, query, invert }),
  filterClear: (id: number) => invoke<void>("big_filter_clear", { id }),
  /** `[file line, text]` of filtered lines `start..start + count`. */
  filterLines: (id: number, start: number, count: number) => invoke<{ total: number; lines: [number, string][] }>("big_filter_lines", { id, start, count }),
  /** Follow mode: pick up appended lines ("grew"), or "replaced" when the file was rewritten. */
  follow: (id: number) => invoke<{ appended: "unchanged" | "grew" | "replaced"; info: BigDocInfo; filterTotal: number | null }>("big_follow", { id }),
  open: (path: string) => invoke<BigDocInfo>("big_open", { path }),
  close: (id: number) => invoke<void>("big_close", { id }),
  info: (id: number) => invoke<BigDocInfo>("big_info", { id }),
  lines: (id: number, start: number, count: number) => invoke<LinesChunk>("big_lines", { id, start, count }),
  replaceLine: (id: number, line: number, text: string) => invoke<BigDocInfo>("big_replace_line", { id, line, text }),
  deleteLines: (id: number, from: number, to: number) => invoke<BigDocInfo>("big_delete_lines", { id, from, to }),
  insertLines: (id: number, at: number, text: string) => invoke<BigDocInfo>("big_insert_lines", { id, at, text }),
  undo: (id: number) => invoke<BigDocInfo>("big_undo", { id }),
  redo: (id: number) => invoke<BigDocInfo>("big_redo", { id }),
  search: (id: number, query: BigSearchArgs) => invoke<BigSearchResult>("big_search", { id, query }),
  replaceAll: (id: number, query: BigSearchArgs, replacement: string) =>
    invoke<number>("big_replace_all", { id, query, replacement }),
  save: (id: number, path?: string) => invoke<BigDocInfo>("big_save", { id, path }),
  onProgress: (cb: (p: IndexProgress) => void): Promise<UnlistenFn> =>
    listen<IndexProgress>("bigfile:progress", (e) => cb(e.payload)),
};

export const search = {
  start: (searchId: number, roots: string[], query: SearchQuery) =>
    invoke<void>("search_start", { searchId, roots, query }),
  cancel: (searchId: number) => invoke<void>("search_cancel", { searchId }),
  /** Compile with the Rust engine; resolves to the one-line error or null when valid. */
  validateRegex: (pattern: string, opts: { caseSensitive: boolean; wholeWord: boolean; dotAll: boolean }) =>
    invoke<string | null>("validate_regex", { pattern, ...opts }),
  /** `skip`: matches left out, as [line, col] (1-based line, 0-based UTF-16 column). */
  replaceInFiles: (files: { path: string; skip: [number, number][]; searchedMs?: number }[], query: SearchQuery, replacement: string) =>
    invoke<ReplaceFileResult[]>("replace_in_files", { files, query, replacement }),
  undoReplaceInFiles: (entries: UndoEntry[]) => invoke<ReplaceFileResult[]>("undo_replace_in_files", { entries }),
  onResults: (cb: (p: { searchId: number; matches: FileMatch[] }) => void) =>
    listen<{ searchId: number; matches: FileMatch[] }>("search:results", (e) => cb(e.payload)),
  onDone: (cb: (p: SearchDone) => void) => listen<SearchDone>("search:done", (e) => cb(e.payload)),
  onError: (cb: (p: { searchId: number; error: string }) => void) =>
    listen<{ searchId: number; error: string }>("search:error", (e) => cb(e.payload)),
};

export const sys = {
  startupPaths: () => invoke<string[]>("startup_paths"),
  largeFileThreshold: () => invoke<number>("large_file_threshold"),
  formatExternal: (tool: string, args: string[], text: string, cwd?: string | null) =>
    invoke<{ ok: boolean; output: string; error: string; notFound: boolean }>("format_external", { tool, args, text, cwd: cwd ?? null }),
};

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const appIpc = {
  /** Path of the report left by a crash in the previous run (shown once), or null. */
  takeCrashReport: () => invoke<string | null>("take_crash_report"),
};
