/**
 * The open-tab limit (Settings › Tabs › Maximum open tabs). Opening more files than the limit
 * allows closes the least recently used tabs that have no unsaved changes and nothing running
 * (a terminal's program, a Claude task), after asking.
 */
import { useStore, type Doc } from "./store";
import { choose } from "./dialogs";
import { claudeBusy } from "./claude";
import { terminalPty } from "./terminal";

/** When each tab was last shown (or opened); tabs never shown count as oldest. */
const lastUsed = new Map<string, number>();
let clock = 0;

export function markUsed(docId: string) {
  lastUsed.set(docId, ++clock);
}

useStore.subscribe((s, prev) => {
  if (s.activeId && s.activeId !== prev.activeId) markUsed(s.activeId);
  if (s.docs !== prev.docs) {
    for (const id of lastUsed.keys()) if (!s.docs.some((d) => d.id === id)) lastUsed.delete(id);
    // A preview tab that gets edited is kept from then on.
    for (const d of s.docs) if (d.preview && d.dirty) s.updateDoc(d.id, { preview: false });
  }
});

export interface RoomPlan {
  /** Tabs to close, least recently used first. */
  close: string[];
  /** How many of the files asked for can be opened. */
  fit: number;
}

/**
 * Pure helper (testable): to open `adding` more tabs with at most `max` open, which tabs to close
 * (only tabs without unsaved changes and not in `keep`, least recently used first) and how many
 * of the new files fit at all.
 */
export function planRoom(docs: { id: string; dirty: boolean; used: number }[], max: number, adding: number, keep: ReadonlySet<string> = new Set()): RoomPlan {
  const open = docs.length;
  if (adding <= 0) return { close: [], fit: 0 };
  if (open + adding <= max) return { close: [], fit: adding };
  const closable = docs.filter((d) => !d.dirty && !keep.has(d.id)).sort((a, b) => a.used - b.used);
  const fit = Math.max(0, Math.min(adding, max - open + closable.length));
  const closeCount = Math.max(0, Math.min(closable.length, open + fit - max));
  return { close: closable.slice(0, closeCount).map((d) => d.id), fit };
}

function ask(title: string, message: string, actions: { label: string; kind?: "primary" | "danger"; value: boolean }[]): Promise<boolean> {
  return choose(title, message, actions.map((a, i) => ({ ...a, default: i === 0, cancel: !a.value })), false);
}

/** Closing the tab would stop something: a terminal's program or a Claude task. */
const inUse = (d: Doc) => (d.kind === "terminal" && terminalPty(d.id) !== null) || (d.kind === "claude" && claudeBusy(d.id));

const tabs = (n: number) => `${n} tab${n === 1 ? "" : "s"}`;

/**
 * Make room for `names.length` new tabs. Returns how many may be opened (0 when the user
 * cancels or nothing can be closed); the tabs to close are already closed by `closeDoc`. Tabs in
 * `keep` (files that are part of the same request) are never closed.
 */
export async function makeRoom(names: string[], closeDoc: (id: string) => Promise<boolean>, keep: ReadonlySet<string> = new Set()): Promise<number> {
  const st = useStore.getState();
  const max = st.settings.maxOpenTabs;
  const plan = planRoom(st.docs.map((d: Doc) => ({ id: d.id, dirty: d.dirty || inUse(d), used: lastUsed.get(d.id) ?? 0 })), max, names.length, keep);
  if (plan.close.length === 0 && plan.fit === names.length) return plan.fit;
  const what = names.length === 1 ? `"${names[0]}"` : `${names.length} files`;
  if (plan.fit === 0) {
    await ask(
      `You have ${tabs(st.docs.length)} open, your limit`,
      `Your limit is ${tabs(max)}, and every open tab has unsaved changes or a program running, so Quarry can't close one to open ${what}.\n\nSave or close a tab first, or raise the limit in Settings › Tabs and panels.`,
      [{ label: "OK", value: false }],
    );
    return 0;
  }
  const closing = plan.close.map((id) => st.docs.find((d) => d.id === id)!.name);
  const list = closing.slice(0, 8).map((n) => `• ${n}`).join("\n") + (closing.length > 8 ? `\n… and ${closing.length - 8} more` : "");
  const partly = plan.fit < names.length ? `\n\nEven so, only ${plan.fit} of the ${names.length} files fit within the limit; the first ${plan.fit} will open.` : "";
  const ok = await ask(
    `Close ${tabs(closing.length)} to stay within your limit?`,
    `Your limit is ${tabs(max)}. To open ${what}, Quarry will close the least recently used ${closing.length === 1 ? "tab" : "tabs"} without unsaved changes:\n${list}${partly}\n\nChoose Cancel to close tabs yourself instead.`,
    [
      { label: `Close ${closing.length === 1 ? "It" : "Them"} and Open`, kind: "primary", value: true },
      { label: "Cancel", value: false },
    ],
  );
  if (!ok) return 0;
  for (const id of plan.close) await closeDoc(id);
  return plan.fit;
}
