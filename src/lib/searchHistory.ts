/**
 * Find / replace history, shared by the find bar and Find in Files. Newest first, one entry per
 * distinct text: repeating a search moves it to the top with a new time and adds one to its count. Kept in
 * <app data>\search-history.json. Nothing is read until the history is first needed (a search runs
 * or a history list opens), and writes are batched.
 */
import { appData } from "./ipc";
import { useStore } from "./store";

export type HistoryKind = "find" | "replace";

export interface HistoryEntry {
  text: string;
  /** When it was last used, ms since the epoch. */
  at: number;
  /** How many times it has been used. */
  count: number;
}

type HistoryData = Record<HistoryKind, HistoryEntry[]>;

const FILE = "search-history.json";
/** Longer texts are not remembered: they bloat the file and are rarely re-run by hand. */
export const MAX_ENTRY_CHARS = 10_000;
const SAVE_DELAY = 1000;

let data: HistoryData = { find: [], replace: [] };
let loading: Promise<void> | null = null;
let saveTimer: number | undefined;
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version++;
  for (const l of listeners) l();
}

/** Pure helper (testable): use `text` now. It moves to the front with its count raised by one (a new
 *  text starts at 1), and the list is trimmed to `limit` (0 = unlimited). */
export function addEntry(list: HistoryEntry[], text: string, at: number, limit: number): HistoryEntry[] {
  const old = list.find((e) => e.text === text);
  const next = [{ text, at, count: (old?.count ?? 0) + 1 }, ...(old ? list.filter((e) => e !== old) : list)];
  return limit > 0 && next.length > limit ? next.slice(0, limit) : next;
}

/** Pure helper (testable): keep only well-formed entries from a parsed file. */
export function sanitizeEntries(v: unknown): HistoryEntry[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const { text, at, count } = e as Partial<HistoryEntry>;
    if (typeof text !== "string" || !text || text.length > MAX_ENTRY_CHARS || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, at: typeof at === "number" && Number.isFinite(at) ? at : 0, count: typeof count === "number" && count >= 1 ? Math.floor(count) : 1 });
  }
  return out;
}

const limit = () => useStore.getState().settings.searchHistoryLimit;

/** Load the history file once; later calls return the same promise. */
export function ensureHistoryLoaded(): Promise<void> {
  loading ??= (async () => {
    try {
      const raw = await appData.read(FILE);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<HistoryKind, unknown>>;
        const n = limit();
        const trim = (l: HistoryEntry[]) => (n > 0 ? l.slice(0, n) : l);
        // Entries recorded before the file finished loading stay in front.
        data = {
          find: trim([...data.find, ...sanitizeEntries(parsed.find).filter((e) => !data.find.some((d) => d.text === e.text))]),
          replace: trim([...data.replace, ...sanitizeEntries(parsed.replace).filter((e) => !data.replace.some((d) => d.text === e.text))]),
        };
      }
    } catch {
      /* unreadable history: start empty, the next save rewrites it */
    }
    changed();
  })();
  return loading;
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void ensureHistoryLoaded().then(() => appData.write(FILE, JSON.stringify(data)).catch(() => {}));
  }, SAVE_DELAY);
}

/** Remember a find or replace text (empty and very long texts are ignored). */
export function recordHistory(kind: HistoryKind, text: string) {
  if (!text || text.length > MAX_ENTRY_CHARS) return;
  data = { ...data, [kind]: addEntry(data[kind], text, Date.now(), limit()) };
  changed();
  void ensureHistoryLoaded();
  scheduleSave();
}

export function removeHistoryEntry(kind: HistoryKind, text: string) {
  data = { ...data, [kind]: data[kind].filter((e) => e.text !== text) };
  changed();
  scheduleSave();
}

export function clearHistory(kind?: HistoryKind) {
  data = kind ? { ...data, [kind]: [] } : { find: [], replace: [] };
  changed();
  scheduleSave();
}

/** Apply a lowered limit to what is already stored. */
export function applyHistoryLimit() {
  const n = limit();
  if (n <= 0 || (data.find.length <= n && data.replace.length <= n)) return;
  data = { find: data.find.slice(0, n), replace: data.replace.slice(0, n) };
  changed();
  scheduleSave();
}

export const historyOf = (kind: HistoryKind): HistoryEntry[] => data[kind];
export const historyCount = () => data.find.length + data.replace.length;

export function subscribeHistory(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const historyVersion = () => version;
