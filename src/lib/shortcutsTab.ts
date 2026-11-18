import { bus } from "./bus";
import { newDocId, useStore } from "./store";

/**
 * The Keyboard Shortcuts tab (specs/settings.md SET-020): one per window, not kept in the session.
 * `query` fills its search box (Settings' filter passes what the user typed there).
 */
let pending: string | null = null;

/** The search text a newly mounted ShortcutsView starts with (taken once). */
export function takePendingQuery(): string {
  const q = pending ?? "";
  pending = null;
  return q;
}

export function openShortcuts(query?: string) {
  const st = useStore.getState();
  const open = st.docs.find((d) => d.kind === "shortcuts");
  if (open) {
    st.setActive(open.id);
    if (query !== undefined) bus.emit("shortcuts.query", query);
    return;
  }
  pending = query ?? null;
  st.addDoc(
    { id: newDocId(), kind: "shortcuts", path: null, name: "Keyboard Shortcuts", dirty: false, encoding: "", bom: false, eol: "CRLF", language: "Keyboard Shortcuts", readonly: true, modifiedMs: 0 },
    true,
  );
}
