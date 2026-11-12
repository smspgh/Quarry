import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { BookOpen, Copy, FastForward, FolderOpen, Loader2, Play, Plus, RefreshCw, Repeat, Save, Square, Trash2 } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { confirmDelete, persistSettings } from "../../lib/actions";
import { useEffect, useRef, useState } from "react";
import { baseExtensions } from "../../editor/cmSetup";
import { bus } from "../../lib/bus";
import { confirmRun } from "../../lib/commands";
import {
  cancelScript,
  deleteScript,
  describeWhen,
  displayPath,
  loadScripts,
  runScript,
  runScriptTimes,
  runScriptToEnd,
  saveScript,
  scriptApplies,
  scriptFileName,
  scriptsDir,
  stageScripts,
  SCRIPT_API,
  useScriptRunState,
} from "../../lib/scripting";
import { useActiveDoc, useStore } from "../../lib/store";
import type { Script } from "../../lib/types";
import { ItemList } from "./ItemList";

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

export function ScriptsPanel() {
  const scripts = useStore((s) => s.scripts);
  const activeId = useStore((s) => s.activeScriptId);
  const set = useStore((s) => s.set);
  const settings = useStore((s) => s.settings);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [times, setTimes] = useState(1);
  const toast = useStore((s) => s.toast);
  const run = useScriptRunState();
  const running = run.running;
  const active = scripts.find((s) => s.id === activeId) ?? null;
  const doc = useActiveDoc();
  const applies = !!active && doc?.kind === "text" && scriptApplies(active, doc);
  const canRun = applies && !running;
  const runTitle = !active ? "Choose a script" : doc?.kind !== "text" ? "Open a text document to run scripts" : running ? "A script is running" : applies ? "Run once (Ctrl+Shift+Enter)" : `This script is for ${describeWhen(active)}`;

  useEffect(() => {
    if (!activeId && scripts.length) set({ activeScriptId: scripts[0].id });
  }, [scripts.length]);

  const sourceListener = () =>
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      const id = useStore.getState().activeScriptId;
      const cur = useStore.getState().scripts.find((s) => s.id === id);
      if (!cur) return;
      const src = u.state.doc.toString();
      if (src === cur.source) return;
      stageScripts(useStore.getState().scripts.map((s) => (s.id === id ? { ...s, source: src, updatedAt: Date.now(), unsaved: true } : s)));
    });
  const makeState = (src: string) => EditorState.create({ doc: src, extensions: [...baseExtensions({ ...settings, fontSize: 12, lineNumbers: true }), javascript(), sourceListener(), EditorView.contentAttributes.of({ "aria-label": "Script source" })] });

  // Mount a small CodeMirror instance for the script source.
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    viewRef.current = new EditorView({ parent: hostRef.current, state: makeState("") });
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  const save = async () => {
    if (!active) return;
    try {
      const saved = await saveScript(active);
      if (saved) toast(`Saved ${displayPath(saved.path ?? "")}`, "success", 2000);
    } catch (e) {
      toast(`Could not save script: ${String(e)}`, "error");
    }
  };
  const [dir, setDir] = useState("");
  useEffect(() => {
    scriptsDir().then(setDir).catch(() => {});
  }, [settings.scriptsDir]);
  const chooseFolder = async () => {
    const picked = await openDialog({ directory: true, title: "Scripts folder" });
    if (!picked || Array.isArray(picked)) return;
    set({ settings: { ...useStore.getState().settings, scriptsDir: picked } });
    await persistSettings();
    await loadScripts("switch");
  };
  const reload = async () => {
    const list = await loadScripts();
    if (list) toast(`Loaded ${list.length} script${list.length === 1 ? "" : "s"} from ${displayPath(dir)}`, "info", 2000);
  };
  // Pick up external edits when the window regains focus (only when nothing is unsaved, so no prompt appears).
  useEffect(() => {
    const onFocus = () => {
      if (useStore.getState().scripts.some((s) => s.unsaved)) return;
      void loadScripts();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const src = active?.source ?? "";
    if (v.state.doc.toString() !== src) v.setState(makeState(src));
  }, [active?.id, active?.source]);

  const create = (from?: Script) => {
    const s: Script = {
      id: `s-${Date.now().toString(36)}`,
      name: from ? `${from.name} (copy)` : `Script ${scripts.length + 1}`,
      source: from?.source ?? `// ${"Transform the current document."}\n// See the API reference (book icon) for doc, selection, util, clipboard.\n\ndoc.mapLines((line, i) => line);\n`,
      updatedAt: Date.now(),
      unsaved: true,
    };
    stageScripts([s, ...scripts]);
    set({ activeScriptId: s.id });
  };

  useEffect(() => bus.on("script.new", () => create()), [scripts]);

  const rename = (id: string, name: string) => stageScripts(scripts.map((s) => (s.id === id ? { ...s, name, unsaved: true } : s)));

  const runOnce = async () => {
    if (!active || !(await confirmRun("script", active))) return;
    await runScript(active.source, undefined, active);
  };
  const runMany = async () => {
    if (!active || !(await confirmRun("script", active, `Runs ${times} time${times === 1 ? "" : "s"} in a row.`))) return;
    const n = await runScriptTimes(active, times);
    toast(`Ran ${n} time${n === 1 ? "" : "s"}`, "success");
  };
  const runToEnd = async () => {
    if (!active || !(await confirmRun("script", active, "Repeats until the script stops changing the document or selection."))) return;
    const n = await runScriptToEnd(active);
    toast(`Ran ${n} time${n === 1 ? "" : "s"}`, "success");
  };
  const remove = async () => {
    if (!active) return;
    if (!(await confirmDelete(`script "${active.name}"`, active.path ? `This moves ${displayPath(active.path)} to the Recycle Bin.` : "This script has not been saved yet; it will be discarded."))) return;
    try {
      await deleteScript(active);
      toast(`Deleted "${active.name}"`, "info", 2000);
    } catch (e) {
      toast(`Could not delete script: ${String(e)}`, "error");
    }
  };

  return (
    <>
      <div className="sidebar-header">
        Scripts
        <span className="grow" />
        <button className="icon-btn" title={`Scripts folder: ${displayPath(dir) || "…"}\nClick to choose a different folder`} onClick={() => void chooseFolder()}><FolderOpen size={15} /></button>
        <button className="icon-btn" title="Reload scripts from the folder" onClick={() => void reload()}><RefreshCw size={15} /></button>
        <button className={`icon-btn ${showHelp ? "on" : ""}`} aria-pressed={!!showHelp} title="API reference" onClick={() => setShowHelp((h) => !h)}><BookOpen size={15} /></button>
        <button className="icon-btn" title="New script" onClick={() => create()}><Plus size={16} /></button>
      </div>
      <div className="panel-section list-section">
        <ItemList
          items={scripts.map((x) => {
            const file = scriptFileName(x.name);
            return { id: x.id, name: x.name, unsaved: x.unsaved, meta: x.when ? describeWhen(x).replace(/ only$/, "") : undefined, sub: file !== `${x.name}.js` ? file : undefined };
          })}
          selected={activeId}
          onSelect={(id) => set({ activeScriptId: id })}
          onRename={rename}
          emptyText={<>No scripts in this folder yet.<br />Create one with the + button, or point the folder icon at your scripts.</>}
        />
      </div>
      {active && (
        <div className="panel-section">
          <div className="row">
            {running ? (
              <>
                <span className="muted row" style={{ fontSize: 11.5 }}><Loader2 size={13} className="spin" /> Running {run.name}…</span>
                <button className="btn btn-danger small" title="Cancel the running script" onClick={() => cancelScript()}><Square size={13} /> Cancel</button>
              </>
            ) : (
              <button className="btn btn-primary small" disabled={!canRun} title={runTitle} onClick={() => void runOnce()}><Play size={13} /> Run</button>
            )}
            <span className="grow" />
            <button className={`icon-btn xs ${active.unsaved ? "attention" : ""}`} title={active.unsaved ? "Save script to the scripts folder (unsaved changes)" : "Saved"} disabled={!active.unsaved} onClick={() => void save()}><Save size={13} /></button>
            <button className="icon-btn xs" title="Duplicate" onClick={() => create(active)}><Copy size={13} /></button>
            <button className="icon-btn xs" title="Delete script file" onClick={() => void remove()}><Trash2 size={13} /></button>
          </div>
          <div className="row">
            <input className="input" type="number" min={1} max={100000} style={{ width: 80, height: 26, fontSize: 12 }} value={times} title="How many times to run" onChange={(e) => setTimes(Math.max(1, Number(e.target.value) || 1))} />
            <button className="btn small" disabled={!canRun} title="Run the script this many times in a row" onClick={() => void runMany()}><Repeat size={13} /> Run ×{times}</button>
            <button className="btn small" disabled={!canRun} title="Repeat until the script stops changing the document or selection" onClick={() => void runToEnd()}><FastForward size={13} /> To end</button>
          </div>
        </div>
      )}
      {showHelp && (
        <div className="script-api selectable">
          {SCRIPT_API.map((g) => (
            <div key={g.name} className="script-api-group">
              <div className="script-api-title">{g.name}</div>
              <dl>
                {g.items.map((it) => (
                  <div key={it.sig} className="script-api-row">
                    <dt className="mono">{it.sig}</dt>
                    <dd>{it.desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
      <div className="script-editor-host" ref={hostRef} style={{ display: active ? undefined : "none" }} />
    </>
  );
}
