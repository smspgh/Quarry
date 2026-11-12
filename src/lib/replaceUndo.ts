import { editor } from "../editor/manager";
import { normalizePath } from "./actions";
import { fs, search as searchIpc } from "./ipc";
import { useStore } from "./store";
import type { ReplaceFileResult, UndoEntry } from "./types";
import { choose } from "./dialogs";

/** The undo record of a Replace in Files: only files that were changed and backed up. */
export function undoEntriesOf(results: ReplaceFileResult[]): UndoEntry[] {
  return results.filter((r) => r.replaced > 0 && !r.error && r.backup && r.digest).map((r) => ({ path: r.path, backup: r.backup!, digest: r.digest! }));
}

/** Show the new disk contents in open, clean documents for `paths` (dirty ones are left for the external-change prompt). */
export async function reloadOpenDocs(paths: string[]) {
  const want = new Set(paths.map(normalizePath));
  for (const d of useStore.getState().docs) {
    if (d.kind !== "text" || !d.path || d.dirty || !want.has(normalizePath(d.path))) continue;
    try {
      const file = await fs.readText(d.path);
      editor.replaceAll(d.id, file.content);
      useStore.getState().updateDoc(d.id, { dirty: false, modifiedMs: file.modifiedMs });
    } catch {
      // Unreadable now: the external-change watcher reports it.
    }
  }
}

/** Restore the files changed by the last Replace in Files, after asking. */
export async function undoReplaceInFiles() {
  const st = useStore.getState();
  const undo = st.replaceUndo;
  if (!undo) {
    st.toast("Nothing to undo: no Replace in Files since Quarry started.", "info");
    return;
  }
  const n = undo.entries.length;
  const ok = await choose(
    "Undo Replace in Files?",
    `Restores ${n} file${n === 1 ? "" : "s"} to their contents before "${undo.summary}". Files edited since then are left alone.`,
    [
      { label: "Restore", kind: "primary", value: true },
      { label: "Cancel", value: false },
    ],
    false,
  );
  if (!ok) return;
  try {
    const res = await searchIpc.undoReplaceInFiles(undo.entries);
    const restored = res.filter((r) => r.replaced > 0);
    const failed = res.filter((r) => r.error);
    await reloadOpenDocs(restored.map((r) => r.path));
    useStore.getState().set({ replaceUndo: null });
    const names = failed.slice(0, 5).map((r) => `${r.path.split(/[\\/]/).pop()}: ${r.error}`).join("\n");
    useStore
      .getState()
      .toast(`Restored ${restored.length} file${restored.length === 1 ? "" : "s"}${failed.length ? `; ${failed.length} not restored\n${names}` : ""}`, failed.length ? "warning" : "success", failed.length ? 8000 : undefined);
  } catch (e) {
    useStore.getState().toast(String(e), "error");
  }
}
