/** Split editor commands (two panes, one tab strip): see `SplitState` in store.ts and editor/manager.ts. */
import { editor, type PaneIndex } from "../editor/manager";
import { useStore } from "./store";

const s = () => useStore.getState();

function focusSoon() {
  requestAnimationFrame(() => editor.focus());
}

/** Ctrl+\: split the editor (the right pane shows the same document) or close the split. */
export function toggleSplit(): boolean {
  const st = s();
  if (st.split) {
    st.set({ split: null });
  } else {
    const doc = st.docs.find((d) => d.id === st.activeId);
    if (doc?.kind !== "text") return false;
    st.set({ split: { otherId: doc.id, focused: 1, ratio: 0.5 } });
  }
  focusSoon();
  return true;
}

/** Show a text document in the pane that isn't focused (splitting the editor if needed), and focus it. */
export function openToSide(docId: string): boolean {
  const st = s();
  const doc = st.docs.find((d) => d.id === docId);
  if (doc?.kind !== "text") return false;
  const sp = st.split;
  if (!sp) {
    if (!st.activeId) st.setActive(docId);
    else st.set({ activeId: docId, split: { otherId: st.activeId, focused: 1, ratio: 0.5 } });
  } else {
    st.set({ activeId: docId, split: { ...sp, focused: sp.focused === 0 ? 1 : 0, otherId: st.activeId } });
  }
  focusSoon();
  return true;
}

/** Ctrl+1 / Ctrl+2: move the keyboard to a pane. */
export function focusPane(pane: PaneIndex): boolean {
  const st = s();
  if (!st.split) return false;
  st.focusPane(pane);
  focusSoon();
  return true;
}
