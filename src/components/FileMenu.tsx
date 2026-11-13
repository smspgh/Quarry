import { ClipboardPaste, Copy, FileDiff, FileText, FolderOpen, FolderTree, GitBranch, Scissors, Trash2 } from "lucide-react";
import { runCommand } from "../lib/commands";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { showInExplorerPanel, showInWindowsExplorer } from "../lib/actions";
import { baseName, copyLines, filesToClipboard, pasteInto, trashPaths } from "../lib/fileOps";
import { fs } from "../lib/ipc";
import { compareCandidate, compareWithSelected, openCompare, selectForCompare } from "../lib/diff";

export interface FileMenuProps {
  x: number;
  y: number;
  /** The files / folders the menu acts on (a multi-selection, or the row right-clicked). Empty:
   *  right-click on blank space, where only Paste applies. */
  paths: string[];
  isDir: (path: string) => boolean;
  /** Where Paste puts things. */
  pasteDir: string | null;
  onClose: () => void;
  /** Items at the top (Find in…, Rename). */
  lead?: React.ReactNode;
  /** Show "Show in Quarry Explorer" (not wanted in the Explorer itself). */
  showInQuarry?: boolean;
  /** Show the Ctrl+C / Ctrl+X / Ctrl+V / Del hints (only where those keys do this). */
  keyHints?: boolean;
  onPasted?: (paths: string[]) => void;
  onDeleted?: (paths: string[]) => void;
}

/** Right-click menu for files and folders: Cut / Copy / Paste / Delete, Copy Path / Name, Show in… */
export function FileMenu({ x, y, paths, isDir, pasteDir, onClose, lead, showInQuarry = true, keyHints = false, onPasted, onDeleted }: FileMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [canPaste, setCanPaste] = useState(0);

  useEffect(() => {
    fs.fromClipboard().then((c) => setCanPaste(c.paths.length)).catch(() => setCanPaste(0));
  }, []);

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y, canPaste]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onClose);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onClose);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const run = (fn: () => unknown) => () => {
    onClose();
    void fn();
  };
  const n = paths.length;
  const one = n === 1;
  const kbd = (k: string) => (keyHints ? <span className="kbd">{k}</span> : null);
  const nameLabel = one && isDir(paths[0]) ? "Copy Name" : one ? "Copy File Name" : "Copy Names";
  const files = paths.filter((p) => !isDir(p));
  const candidate = compareCandidate();
  const candName = candidate ? candidate.split(/[\\/]/).pop() : "";

  return createPortal(
    <div ref={ref} className="palette ctx-menu file-menu" role="menu" style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.stopPropagation()}>
      {lead}
      {n > 0 && (
        <>
          <button className="palette-item" role="menuitem" onClick={run(() => filesToClipboard(paths, true))}><Scissors size={13} /><span className="title">{one ? "Cut" : `Cut ${n} items`}</span>{kbd("Ctrl+X")}</button>
          <button className="palette-item" role="menuitem" onClick={run(() => filesToClipboard(paths, false))}><Copy size={13} /><span className="title">{one ? "Copy" : `Copy ${n} items`}</span>{kbd("Ctrl+C")}</button>
        </>
      )}
      {pasteDir && (
        <button className="palette-item" role="menuitem" disabled={!canPaste} title={canPaste ? `Paste into ${pasteDir}` : "Nothing to paste. Copy or cut files first."} onClick={run(async () => onPasted?.(await pasteInto(pasteDir)))}>
          <ClipboardPaste size={13} /><span className="title">{canPaste > 1 ? `Paste ${canPaste} items` : "Paste"}</span>{kbd("Ctrl+V")}
        </button>
      )}
      {files.length === n && (n === 1 || n === 2) && (
        <>
          {n === 2 && <button className="palette-item" role="menuitem" onClick={run(() => openCompare({ kind: "file", path: files[0] }, { kind: "file", path: files[1] }))}><FileDiff size={13} /><span className="title">Compare Selected</span></button>}
          {n === 1 && candidate && candidate.toLowerCase() !== files[0].toLowerCase() && (
            <button className="palette-item" role="menuitem" title={candidate} onClick={run(() => compareWithSelected(files[0]))}><FileDiff size={13} /><span className="title">Compare with “{candName}”</span></button>
          )}
          {n === 1 && <button className="palette-item" role="menuitem" onClick={run(() => selectForCompare(files[0]))}><FileDiff size={13} /><span className="title">Select for Compare</span></button>}
          <div className="menu-sep" />
        </>
      )}
      {n > 0 && (
        <>
          <button className="palette-item" role="menuitem" onClick={run(async () => onDeleted?.(await trashPaths(paths, isDir)))}><Trash2 size={13} /><span className="title">{one ? "Delete" : `Delete ${n} items`}</span>{kbd("Del")}</button>
          <div className="menu-sep" />
          <button className="palette-item" role="menuitem" onClick={run(() => copyLines(paths, one ? "Path" : "Paths"))}><Copy size={13} /><span className="title">{one ? "Copy Path" : "Copy Paths"}</span></button>
          <button className="palette-item" role="menuitem" onClick={run(() => copyLines(paths.map(baseName), one ? "Name" : "Names"))}><FileText size={13} /><span className="title">{nameLabel}</span></button>
        </>
      )}
      {one && (
        <>
          <div className="menu-sep" />
          {showInQuarry && <button className="palette-item" role="menuitem" onClick={run(() => showInExplorerPanel(paths[0]))}><FolderTree size={13} /><span className="title">Show in Quarry Explorer</span></button>}
          <button className="palette-item" role="menuitem" onClick={run(() => showInWindowsExplorer(paths[0]))}><FolderOpen size={13} /><span className="title">Show in Windows Explorer</span></button>
          {isDir(paths[0]) && (
            <button className="palette-item" role="menuitem" title="Show this folder's git repository in the Source Control panel" onClick={run(() => runCommand("git.setContext", { path: paths[0] }))}>
              <GitBranch size={13} /><span className="title">Set as Source Control Context</span>
            </button>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
