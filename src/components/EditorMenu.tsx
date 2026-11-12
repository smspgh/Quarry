import { ChevronsDownUp, ChevronsUpDown, ClipboardPaste, Copy, FoldVertical, Scissors, TextSelect, UnfoldVertical } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { runCommand } from "../lib/commands";
import type { FoldTarget } from "../editor/lineMenu";
import { editor } from "../editor/manager";

export interface EditorMenuProps {
  x: number;
  y: number;
  target: FoldTarget;
  readOnly: boolean;
  onClose: () => void;
}

/**
 * The editor's right-click menu on a line that starts a foldable region or holds a fold: Collapse /
 * Expand that region, Collapse All / Expand All, and the usual clipboard items (elsewhere the
 * editor keeps the browser's own menu). Opened by CodeEditor.
 */
export function EditorMenu({ x, y, target, readOnly, onClose }: EditorMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        editor.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        // Arrow keys move between the items.
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    window.addEventListener("mousedown", onClose);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onClose);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const run = (id: string, args?: unknown) => () => {
    onClose();
    void runCommand(id, args);
  };
  const line = { line: target.line };

  return createPortal(
    <div ref={ref} className="palette ctx-menu editor-menu" role="menu" aria-label="Editor" style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {target.folded ? (
        <button className="palette-item" role="menuitem" onClick={run("code.unfoldLine", line)}><UnfoldVertical size={13} /><span className="title">Expand</span></button>
      ) : (
        <button className="palette-item" role="menuitem" onClick={run("code.foldLine", line)}><FoldVertical size={13} /><span className="title">Collapse</span></button>
      )}
      <button className="palette-item" role="menuitem" title="This region and everything inside it" onClick={run("code.foldTree", line)}><ChevronsDownUp size={13} /><span className="title">Collapse All</span></button>
      <button className="palette-item" role="menuitem" title="This region and everything inside it" onClick={run("code.unfoldTree", line)}><ChevronsUpDown size={13} /><span className="title">Expand All</span></button>
      <div className="menu-sep" />
      <button className="palette-item" role="menuitem" disabled={readOnly} onClick={run("edit.cut")}><Scissors size={13} /><span className="title">Cut</span><span className="kbd">Ctrl+X</span></button>
      <button className="palette-item" role="menuitem" onClick={run("edit.copy")}><Copy size={13} /><span className="title">Copy</span><span className="kbd">Ctrl+C</span></button>
      <button className="palette-item" role="menuitem" disabled={readOnly} onClick={run("edit.paste")}><ClipboardPaste size={13} /><span className="title">Paste</span><span className="kbd">Ctrl+V</span></button>
      <div className="menu-sep" />
      <button className="palette-item" role="menuitem" onClick={run("edit.selectAll")}><TextSelect size={13} /><span className="title">Select All</span><span className="kbd">Ctrl+A</span></button>
    </div>,
    document.body,
  );
}
