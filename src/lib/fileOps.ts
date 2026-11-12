/**
 * File and folder actions shared by the Explorer and the Find in Files results: copy path / name,
 * Cut / Copy / Paste through the Windows file clipboard (so they work with File Explorer too), and
 * Delete to the Recycle Bin. Every action takes a list, so a multi-selection works the same way.
 */
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { confirmDelete, dirName, isInside, samePath } from "./actions";
import { bus } from "./bus";
import { fs } from "./ipc";
import { useStore } from "./store";

export const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

const toast = (...a: Parameters<ReturnType<typeof useStore.getState>["toast"]>) => useStore.getState().toast(...a);
const items = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

/** Copy Path / Copy File Name: one per line. */
export async function copyLines(lines: string[], what: string) {
  try {
    await writeText(lines.join("\r\n"));
    toast(`${what} copied`, "success", 1200);
  } catch (e) {
    toast(String(e), "error");
  }
}

/** Copy / Cut: the files go on the Windows clipboard; Cut makes the next Paste move them. */
export async function filesToClipboard(paths: string[], cut: boolean) {
  if (!paths.length) return;
  try {
    await fs.toClipboard(paths, cut);
    toast(`${cut ? "Cut" : "Copied"} ${paths.length === 1 ? baseName(paths[0]) : items(paths.length)}. Paste with Ctrl+V here or in File Explorer.`, "success", 2500);
  } catch (e) {
    toast(String(e), "error");
  }
}

/** Open tabs follow a file or folder that moved from `from` to `to`. */
export function retargetDocs(from: string, to: string) {
  const st = useStore.getState();
  for (const d of st.docs) {
    if (!d.path) continue;
    if (samePath(d.path, from)) st.updateDoc(d.id, { path: to, name: baseName(to) });
    else if (isInside(d.path, from)) st.updateDoc(d.id, { path: to + d.path.slice(from.length) });
  }
}

/** Paste what is on the clipboard into `dest`. Returns the new paths. */
export async function pasteInto(dest: string): Promise<string[]> {
  try {
    const clip = await fs.fromClipboard();
    if (!clip.paths.length) {
      toast("Nothing to paste. Copy or cut files first.", "info", 2000);
      return [];
    }
    const res = await fs.paste(clip.paths, dest, clip.cut);
    const done = res.filter((r) => r.to);
    if (clip.cut) for (const r of done) retargetDocs(r.from, r.to!);
    const failed = res.filter((r) => r.error);
    useStore.getState().set({ fileListCache: null });
    bus.emit("explorer.reload", [dest, ...(clip.cut ? clip.paths.map(dirName) : [])]);
    if (failed.length) toast(`${failed.length === 1 ? baseName(failed[0].from) : items(failed.length)} not pasted: ${failed[0].error}`, "error", 6000);
    else if (done.length) toast(`${clip.cut ? "Moved" : "Pasted"} ${items(done.length)} into ${baseName(dest)}`, "success", 2000);
    return done.map((r) => r.to!);
  } catch (e) {
    toast(String(e), "error");
    return [];
  }
}

/** Delete to the Recycle Bin after one confirmation. Returns what was deleted. */
export async function trashPaths(paths: string[], isDir: (p: string) => boolean): Promise<string[]> {
  if (!paths.length) return [];
  const one = paths.length === 1;
  const what = one ? (isDir(paths[0]) ? `folder "${baseName(paths[0])}"` : `"${baseName(paths[0])}"`) : items(paths.length);
  const detail = one && !isDir(paths[0]) ? undefined : one ? "The folder and everything inside it are moved to the Recycle Bin." : "They are moved to the Recycle Bin, folders with everything inside them.";
  if (!(await confirmDelete(what, detail))) return [];
  const deleted: string[] = [];
  for (const p of paths) {
    try {
      await fs.trash(p);
      deleted.push(p);
    } catch (e) {
      toast(`${baseName(p)}: ${e}`, "error");
    }
  }
  useStore.getState().set({ fileListCache: null });
  bus.emit("explorer.reload", deleted.map(dirName));
  return deleted;
}
