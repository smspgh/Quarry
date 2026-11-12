import { FastForward, Loader2, Pencil, Play, Repeat, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { openPath } from "../../lib/actions";
import { runScriptPath, type ScriptRunHow } from "../../lib/commands";
import {
  cancelScript,
  describeWhen,
  isScriptPath,
  newScriptFileName,
  readScript,
  scriptApplies,
  scriptNameOf,
  scriptsDir,
  NEW_SCRIPT_SOURCE,
  useScriptRunState,
} from "../../lib/scripting";
import { editor } from "../../editor/manager";
import { isPanelShown } from "../../lib/panels";
import { useActiveDoc, useStore } from "../../lib/store";
import type { DirEntry, Script } from "../../lib/types";
import { FileTree, type TreeVariant } from "./ExplorerPanel";

/** Status-bar item shown while a script runs (imported by StatusBar). */
export function ScriptStatusItem() {
  const run = useScriptRunState();
  if (!run.running) return null;
  return (
    <span className="status-item rec" title={`Running script "${run.name}"`}>
      <Loader2 size={12} className="spin" /> SCRIPT
      <button className="status-inline-btn" title="Cancel script" onClick={() => cancelScript()}><Square size={11} /></button>
    </span>
  );
}

/** Open a script (or any file of the scripts folder) in a tab of its own and go to it. */
function editScript(path: string) {
  void openPath(path).then((d) => {
    if (d?.preview) useStore.getState().updateDoc(d.id, { preview: false });
    requestAnimationFrame(() => editor.focus());
  });
}

/**
 * The scripts folder as a tree (the Explorer's, over the scripts root), with a run bar under it.
 * A click only selects a script (so the document it should run on stays in front); double-click,
 * Enter or Edit opens it in a tab.
 */
export function ScriptsPanel() {
  const dirSetting = useStore((s) => s.settings.scriptsDir);
  const current = useStore((s) => s.activeScriptId);
  const shown = useStore((s) => isPanelShown(s, "scripts"));
  const set = useStore((s) => s.set);
  const doc = useActiveDoc();
  const run = useScriptRunState();
  const [root, setRoot] = useState<string | null>(null);
  const [times, setTimes] = useState(1);
  /** The current script as last read (for its `@languages` / `@extensions` filter). */
  const [info, setInfo] = useState<Script | null>(null);

  useEffect(() => {
    let live = true;
    scriptsDir().then((d) => {
      if (!live) return;
      setRoot(d);
      const st = useStore.getState();
      if (!st.scriptsExpanded.has(d)) st.set({ scriptsExpanded: new Set([...st.scriptsExpanded, d]) });
    }).catch(() => {});
    return () => { live = false; };
  }, [dirSetting]);

  useEffect(() => {
    if (!current || !shown) {
      if (!current) setInfo(null);
      return;
    }
    let live = true;
    readScript(current).then((sc) => live && setInfo(sc), () => live && setInfo(null));
    return () => { live = false; };
  }, [current, shown, doc?.id]);

  const isText = doc?.kind === "text";
  const known = info && current && info.id === current ? info : null;
  const applies = !known || scriptApplies(known, doc);
  const self = !!current && !!doc?.path && doc.path.toLowerCase() === current.toLowerCase();
  const why = (path: string) =>
    !isText ? "Open a text document to run scripts"
    : run.running ? "A script is running"
    : doc?.path?.toLowerCase() === path.toLowerCase() ? "This tab is the script itself: go to the document it should change"
    : known && known.id === path && !applies ? `This script is for ${describeWhen(known)}`
    : "";

  const start = (path: string, how: ScriptRunHow = "once") => void runScriptPath(path, how);

  const variant = useMemo<TreeVariant | null>(() => {
    if (!root) return null;
    return {
      root,
      panel: "scripts",
      title: "Scripts",
      labels: { newFile: "New Script", newFolder: "New Script Folder", filePlaceholder: "script name", folderPlaceholder: "script folder name" },
      newFile: (name) => ({ name: newScriptFileName(name), content: NEW_SCRIPT_SOURCE }),
      newFileEvent: "script.new",
      onSelect: (e: DirEntry) => { if (isScriptPath(e.path)) set({ activeScriptId: e.path }); },
      onActivate: (e: DirEntry) => editScript(e.path),
      menuLead: (e: DirEntry, close: () => void) => {
        if (e.isDir) return null;
        const script = isScriptPath(e.path);
        const blocked = why(e.path);
        return (
          <>
            {script && (
              <button className="palette-item" disabled={!!blocked} title={blocked || `Run on ${doc?.name ?? "the current document"}`} onClick={() => { close(); start(e.path); }}>
                <Play size={13} /><span className="title">Run</span>
              </button>
            )}
            <button className="palette-item" title="Open in a tab" onClick={() => { close(); editScript(e.path); }}>
              <Pencil size={13} /><span className="title">Edit</span><span className="kbd">Enter</span>
            </button>
            <div className="menu-sep" />
          </>
        );
      },
    };
    // `why` and `start` only read the values listed here.
  }, [root, isText, run.running, doc?.path, doc?.name, known, applies]);

  const blocked = current ? why(current) : "Select a script";

  return (
    <>
      {variant ? <FileTree variant={variant} /> : <div className="sidebar-header">Scripts</div>}
      <div className="panel-section script-run-bar">
        <div className="muted truncate" title={current ?? undefined}>
          {run.running ? <span className="row"><Loader2 size={13} className="spin" /> Running {run.name}…</span>
            : current ? <>{scriptNameOf(current)}{known?.when ? ` · ${describeWhen(known)}` : ""}{isText && !self ? ` → ${doc?.name}` : ""}</>
            : "Select a script to run it. Double-click to edit."}
        </div>
        <div className="row">
          {run.running
            ? <button className="btn btn-danger small" title="Cancel the running script" onClick={() => cancelScript()}><Square size={13} /> Cancel</button>
            : <button className="btn btn-primary small" disabled={!!blocked} title={blocked || "Run once (Ctrl+Shift+Enter)"} onClick={() => current && start(current)}><Play size={13} /> Run</button>}
          <button className="btn small" disabled={!current} title={current ? "Open the script in a tab" : "Select a script"} onClick={() => current && editScript(current)}><Pencil size={13} /> Edit</button>
          <span className="grow" />
          <input className="input script-times" type="number" min={1} max={100000} value={times} title="How many times to run" aria-label="How many times to run" onChange={(e) => setTimes(Math.max(1, Math.min(100000, Number(e.target.value) || 1)))} />
          <button className="btn small" disabled={!!blocked} title={blocked || "Run the script this many times in a row"} onClick={() => current && start(current, { times })}><Repeat size={13} /> ×{times}</button>
          <button className="btn small" disabled={!!blocked} title={blocked || "Repeat until the script stops changing the document or selection"} onClick={() => current && start(current, "toEnd")}><FastForward size={13} /> To end</button>
        </div>
      </div>
    </>
  );
}
