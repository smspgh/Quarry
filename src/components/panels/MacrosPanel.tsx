import { CircleDot, Copy, FastForward, FolderOpen, Pause, Play, RefreshCw, Repeat, Save, Square, Trash2 } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { confirmDelete, persistSettings } from "../../lib/actions";
import { confirmRun, runCommand, setLastMacro } from "../../lib/commands";
import { deleteMacro, displayPath, guarded, loadMacros, macroFileName, macrosDir, pausePlayback, playDetail, playSteps, playToEnd, saveMacro, stageMacros, stopPlayback, TO_END_DETAIL } from "../../lib/macros";
import { useActiveDoc, useStore } from "../../lib/store";
import { ItemList } from "./ItemList";
import { MacroSteps } from "./MacroSteps";

/**
 * Macros panel. Same structure as the Scripts panel:
 *   header (create) → clickable list → selected item: Play + Save/Duplicate/Delete → repeat controls → editor.
 */
export function MacrosPanel() {
  const macros = useStore((s) => s.macros);
  const recording = useStore((s) => s.recording);
  const steps = useStore((s) => s.recordingSteps);
  const toast = useStore((s) => s.toast);
  const selected = useStore((s) => s.activeMacroId);
  const set = useStore((s) => s.set);
  const setSelected = (id: string | null) => set({ activeMacroId: id });
  const [times, setTimes] = useState(1);
  const doc = useActiveDoc();
  const playing = useStore((s) => s.macroPlaying);
  const paused = useStore((s) => s.macroPaused);
  const canPlay = doc?.kind === "text" && !recording && !playing;
  const canRecord = doc?.kind === "text" && !playing;
  const playTitle = recording ? "Stop recording first" : doc?.kind !== "text" ? "Open a text document to play macros" : "Play once (Ctrl+Shift+M)";

  const sel = macros.find((m) => m.id === selected) ?? null;

  const duplicate = (id: string) => {
    const m = macros.find((x) => x.id === id);
    if (!m) return;
    const copy = { ...m, id: `m-${Date.now().toString(36)}`, name: `${m.name} (copy)`, createdAt: Date.now(), steps: m.steps.map((s) => ({ ...s })), unsaved: true };
    const i = macros.findIndex((x) => x.id === id);
    stageMacros([...macros.slice(0, i + 1), copy, ...macros.slice(i + 1)]);
    setSelected(copy.id);
  };

  const play = async (id: string, n = 1) => {
    const m = macros.find((x) => x.id === id);
    if (!m) return;
    setLastMacro(m);
    if (!(await confirmRun("macro", m, playDetail(m.steps.length, n)))) return;
    await guarded(() => playSteps(m.steps, n));
  };
  const playUntilEnd = async () => {
    if (!sel) return;
    setLastMacro(sel);
    if (!(await confirmRun("macro", sel, TO_END_DETAIL))) return;
    const n = await guarded(() => playToEnd(sel.steps));
    if (n !== undefined) toast(`Played ${n} time${n === 1 ? "" : "s"}`, "success");
  };

  const save = async () => {
    if (!sel) return;
    try {
      const saved = await saveMacro(sel);
      if (saved) toast(`Saved ${displayPath(saved.path ?? "")}`, "success", 2000);
    } catch (e) {
      toast(`Could not save macro: ${String(e)}`, "error");
    }
  };
  const remove = async () => {
    if (!sel) return;
    if (!(await confirmDelete(`macro "${sel.name}"`, sel.path ? `This moves ${displayPath(sel.path)} to the Recycle Bin.` : "This macro has not been saved yet; it will be discarded."))) return;
    try {
      await deleteMacro(sel);
      toast(`Deleted "${sel.name}"`, "info", 2000);
    } catch (e) {
      toast(`Could not delete macro: ${String(e)}`, "error");
    }
  };
  const settingsDir = useStore((s) => s.settings.macrosDir);
  const [dir, setDir] = useState("");
  useEffect(() => {
    macrosDir().then(setDir).catch(() => {});
  }, [settingsDir]);
  const chooseFolder = async () => {
    const picked = await openDialog({ directory: true, title: "Macros folder" });
    if (!picked || Array.isArray(picked)) return;
    set({ settings: { ...useStore.getState().settings, macrosDir: picked } });
    await persistSettings();
    await loadMacros("switch");
  };
  const reload = async () => {
    const list = await loadMacros();
    if (list) toast(`Loaded ${list.length} macro${list.length === 1 ? "" : "s"} from ${displayPath(dir)}`, "info", 2000);
  };
  // Pick up external edits when the window regains focus (only when nothing is unsaved, so no prompt appears).
  useEffect(() => {
    const onFocus = () => {
      const st = useStore.getState();
      if (st.recording || st.macroPlaying || st.macros.some((m) => m.unsaved)) return;
      void loadMacros();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const rename = (id: string, name: string) => stageMacros(macros.map((x) => (x.id === id ? { ...x, name, unsaved: true } : x)));

  return (
    <>
      <div className="sidebar-header">
        Macros
        <span className="grow" />
        <button className="icon-btn" title={`Macros folder: ${displayPath(dir) || "…"}\nClick to choose a different folder`} onClick={() => void chooseFolder()}><FolderOpen size={15} /></button>
        <button className="icon-btn" title="Reload macros from the folder" disabled={recording || playing} onClick={() => void reload()}><RefreshCw size={15} /></button>
        <button className={`icon-btn ${recording ? "recording" : ""}`} disabled={!canRecord && !recording} title={recording ? `Stop recording (${steps} steps) — Ctrl+Shift+R` : doc?.kind !== "text" ? "Open a text document to record a macro" : "Record new macro (Ctrl+Shift+R)"} onClick={() => runCommand("macro.toggleRecord")}>
          {recording ? <Square size={15} /> : <CircleDot size={16} />}
        </button>
      </div>
      {recording && (
        <div className="panel-section" style={{ paddingTop: 0 }}>
          <p className="muted" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5 }}>Recording… {steps} step{steps === 1 ? "" : "s"} captured. Press <span className="kbd">Ctrl+Shift+R</span> to stop.</p>
        </div>
      )}
      <div className="panel-section list-section">
        <ItemList
          items={macros.map((m) => {
            const file = macroFileName(m.name);
            return { id: m.id, name: m.name, meta: `${m.steps.length} step${m.steps.length === 1 ? "" : "s"}`, unsaved: m.unsaved, sub: file !== `${m.name}.macro.json` ? file : undefined };
          })}
          selected={selected}
          onSelect={setSelected}
          onRename={rename}
          emptyText={<>No macros yet.<br />Record one with the ● button, then save it to keep it.</>}
        />
      </div>
      {sel && (
        <>
          <div className="panel-section">
            <div className="row">
              {playing ? (
                <>
                  <button className="btn small" title={paused ? "Resume" : "Pause"} onClick={() => pausePlayback(!paused)}>{paused ? <Play size={13} /> : <Pause size={13} />} {paused ? "Resume" : "Pause"}</button>
                  <button className="btn btn-danger small" title="Stop playback (Shift+Esc)" onClick={() => stopPlayback()}><Square size={13} /> Stop</button>
                </>
              ) : (
                <button className="btn btn-primary small" disabled={!canPlay} title={playTitle} onClick={() => void play(sel.id, 1)}><Play size={13} /> Play</button>
              )}
              <span className="grow" />
              <button className={`icon-btn xs ${sel.unsaved ? "attention" : ""}`} title={sel.unsaved ? "Save macro to the macros folder (unsaved changes)" : "Saved"} disabled={!sel.unsaved} onClick={() => void save()}><Save size={13} /></button>
              <button className="icon-btn xs" title="Duplicate" onClick={() => duplicate(sel.id)}><Copy size={13} /></button>
              <button className="icon-btn xs" title="Delete macro file" onClick={() => void remove()}><Trash2 size={13} /></button>
            </div>
            <div className="row">
              <input className="input" type="number" min={1} max={100000} style={{ width: 80, height: 26, fontSize: 12 }} value={times} title="How many times to play" onChange={(e) => setTimes(Math.max(1, Math.min(100000, Number(e.target.value) || 1)))} />
              <button className="btn small" disabled={!canPlay} title="Play the macro this many times in a row" onClick={() => void play(sel.id, times)}><Repeat size={13} /> Play ×{times}</button>
              <button className="btn small" disabled={!canPlay} title="Repeat until the cursor reaches the last line or stops moving down" onClick={() => void playUntilEnd()}><FastForward size={13} /> To end</button>
            </div>
          </div>
          <div className="panel-body" style={{ padding: "0 12px 12px" }}>
            <div className="section-title row">
              <span>Steps <span className="muted" style={{ fontWeight: 400 }}>— edit, reorder or delete</span></span>
              <span className="grow" />
              {recording && useStore.getState().recordTargetId === sel.id ? (
                <button className="btn small btn-danger" title="Stop recording and append the steps (Ctrl+Shift+R)" onClick={() => runCommand("macro.toggleRecord")}><Square size={12} /> Stop ({steps})</button>
              ) : (
                <button className="btn small" disabled={!canRecord || recording} title={doc?.kind !== "text" ? "Open a text document to record" : "Record more steps and append them to this macro"} onClick={() => runCommand("macro.recordInto", sel.id)}><CircleDot size={12} /> Record more</button>
              )}
            </div>
            <MacroSteps macro={sel} onChange={(st) => stageMacros(macros.map((x) => (x.id === sel.id ? { ...x, steps: st, unsaved: true } : x)))} />
          </div>
        </>
      )}
    </>
  );
}
