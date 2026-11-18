/**
 * Pure rules for user-chosen keyboard shortcuts (Settings › Keyboard shortcuts, specs/settings.md SET-020).
 * Keys are always in the normalized form of `normalizeKeys` in commands.ts ("Ctrl+Shift+K", "Ctrl+K M");
 * the registry itself lives in commands.ts (`setKeyOverrides`, `keyRows`).
 */

/** `settings.keybindings`: command id → its keys; "" means the command has no shortcut. Commands not named keep their default. */
export type KeyOverrides = Record<string, string>;

export interface KeyRow {
  id: string;
  title: string;
  category: string;
  /** The keys in effect, "" for none. */
  keys: string;
  /** The built-in keys, "" for none. */
  defaultKeys: string;
  hidden?: boolean;
}

export const isChanged = (r: KeyRow) => r.keys !== r.defaultKeys;

/** Keys the text boxes and the editor need for the clipboard, and the menu bar's own key. */
const RESERVED: Record<string, string> = {
  "Ctrl+C": "Ctrl+C is kept for Copy.",
  "Ctrl+X": "Ctrl+X is kept for Cut.",
  "Ctrl+V": "Ctrl+V is kept for Paste.",
  F10: "F10 opens the menu bar.",
};

const strokesOf = (keys: string) => keys.split(" ").filter(Boolean);

/** Why this first stroke cannot start a shortcut, or null. `mnemonics` is MenuBar's menu label → letter. */
export function strokeProblem(stroke: string, mnemonics: Record<string, string>): string | null {
  if (RESERVED[stroke]) return RESERVED[stroke];
  const parts = stroke.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const fn = /^F\d{1,2}$/.test(key);
  if (!fn && !mods.includes("Ctrl") && !mods.includes("Alt")) return "A shortcut needs Ctrl or Alt, or a function key.";
  if (mods.length === 1 && mods[0] === "Alt" && /^[A-Z]$/.test(key)) {
    const menu = Object.keys(mnemonics).find((label) => mnemonics[label].toUpperCase() === key);
    if (menu) return `${stroke} opens the ${menu} menu.`;
  }
  return null;
}

export type KeyCheck = { ok: false; error: string } | { ok: true; conflicts: KeyRow[] };

/**
 * May command `id` get `keys`? `conflicts` are the other commands that have exactly these keys now
 * (assigning takes the keys away from them). A single stroke may not be the start of a two-key
 * shortcut and the other way round, because the first stroke would never reach the single one.
 */
export function checkKeys(keys: string, id: string, rows: KeyRow[], mnemonics: Record<string, string>): KeyCheck {
  const strokes = strokesOf(keys);
  if (strokes.length === 0 || strokes.length > 2) return { ok: false, error: "Press one key combination, or two for a two-key shortcut." };
  const problem = strokeProblem(strokes[0], mnemonics);
  if (problem) return { ok: false, error: problem };
  const others = rows.filter((r) => r.id !== id && r.keys);
  if (strokes.length === 1) {
    const chord = others.find((r) => strokesOf(r.keys).length === 2 && strokesOf(r.keys)[0] === keys);
    if (chord) return { ok: false, error: `${keys} starts two-key shortcuts such as ${chord.keys} (${chord.title}).` };
  } else {
    const single = others.find((r) => r.keys === strokes[0]);
    if (single) return { ok: false, error: `${strokes[0]} is the shortcut of ${single.title}, so a two-key shortcut cannot start with it.` };
  }
  return { ok: true, conflicts: others.filter((r) => r.keys === keys) };
}

/** Overrides after giving `id` these keys ("" = none) and taking them away from `takeFrom`. Entries equal to the default are dropped. */
export function withKeys(overrides: KeyOverrides, rows: KeyRow[], id: string, keys: string, takeFrom: string[] = []): KeyOverrides {
  const next: KeyOverrides = { ...overrides };
  const put = (cmd: string, k: string) => {
    const dflt = rows.find((r) => r.id === cmd)?.defaultKeys ?? "";
    if (k === dflt) delete next[cmd];
    else next[cmd] = k;
  };
  for (const t of takeFrom) put(t, "");
  put(id, keys);
  return next;
}

/**
 * Overrides after putting `id` back to its built-in keys. A command the user gave those keys in
 * the meantime loses them; commands that share them by default keep them.
 */
export function restoreDefault(overrides: KeyOverrides, rows: KeyRow[], id: string): KeyOverrides {
  const dflt = rows.find((r) => r.id === id)?.defaultKeys ?? "";
  const takers = dflt ? rows.filter((r) => r.id !== id && r.keys === dflt && isChanged(r)).map((r) => r.id) : [];
  return withKeys(overrides, rows, id, dflt, takers);
}

/**
 * One key press while a shortcut is being recorded. Escape cancels, Enter accepts what was pressed
 * so far, Backspace starts over; anything else is the first or second stroke (a third starts over).
 */
export function captureStep(strokes: string[], stroke: string): { kind: "cancel" } | { kind: "accept" } | { kind: "strokes"; strokes: string[] } {
  if (stroke === "Escape") return { kind: "cancel" };
  if (stroke === "Enter" && strokes.length > 0) return { kind: "accept" };
  if (stroke === "Backspace") return { kind: "strokes", strokes: [] };
  return { kind: "strokes", strokes: strokes.length >= 2 ? [stroke] : [...strokes, stroke] };
}

/** Does the row match the Settings filter (command name, category or keys)? */
export function keyRowMatches(query: string, r: KeyRow): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${r.category}: ${r.title} ${r.keys}`.toLowerCase().includes(q) || r.keys.toLowerCase().replace(/\+/g, " ").includes(q);
}

export type KeySort = "category" | "name" | "keys";

/** The Keyboard Shortcuts tab's order: by category then title, by title, or by keys (commands without keys last). */
export function sortKeyRows(rows: readonly KeyRow[], by: KeySort): KeyRow[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
  const out = [...rows];
  if (by === "name") out.sort((a, b) => cmp(a.title, b.title) || cmp(a.category, b.category));
  else if (by === "keys") out.sort((a, b) => (!a.keys ? 1 : 0) - (!b.keys ? 1 : 0) || cmp(a.keys, b.keys) || cmp(a.title, b.title));
  else out.sort((a, b) => cmp(a.category, b.category) || cmp(a.title, b.title));
  return out;
}

/** Settings read from disk: keep string values only (at most two strokes); the registry normalizes them. */
export function sanitizeKeybindings(v: unknown): KeyOverrides {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: KeyOverrides = {};
  for (const [id, keys] of Object.entries(v as Record<string, unknown>)) {
    if (typeof keys !== "string") continue;
    const k = keys.trim();
    if (k.split(/\s+/).filter(Boolean).length <= 2) out[id] = k;
  }
  return out;
}

/**
 * Single-stroke built-in keys the user moved or removed and that nothing uses now. The editor has
 * its own bindings for many of them (Ctrl+/, Alt+Up, …), so App.tsx swallows these inside an editor.
 */
export function vacatedKeys(rows: KeyRow[]): Set<string> {
  const used = new Set<string>();
  for (const r of rows) if (r.keys) used.add(strokesOf(r.keys)[0]);
  const out = new Set<string>();
  for (const r of rows) if (isChanged(r) && r.defaultKeys && strokesOf(r.defaultKeys).length === 1 && !used.has(r.defaultKeys)) out.add(r.defaultKeys);
  return out;
}
