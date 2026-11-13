import { Check, CircleDot, Columns3, GitBranch, HardDrive, Pause, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { allLanguageNames } from "../editor/cmSetup";
import { editor } from "../editor/manager";
import { formatBytes } from "../lib/actions";
import { bus } from "../lib/bus";
import { runCommand } from "../lib/commands";
import { currentRepo, pickBranch, repoOf, useGit } from "../lib/git";
import { statusBarBranch } from "../lib/gitStatus";
import { useActiveDoc, useStore } from "../lib/store";
import { ENCODINGS } from "../lib/types";
import { ScriptStatusItem } from "./panels/ScriptsPanel";
import { LspStatusItem } from "./LspStatus";


/** Where to put a popup of `width` so it sits above the status-bar segment and stays inside the window. */
export function placePopup(anchor: { left: number; right: number; top: number }, width: number, viewportWidth: number, margin = 8): { left: number; bottom: number } {
  let left = anchor.right - width;
  if (left + width > viewportWidth - margin) left = viewportWidth - margin - width;
  if (left < margin) left = margin;
  return { left, bottom: window.innerHeight - anchor.top + 4 };
}

/** A status-bar segment with a list. `openOn`: a bus event that opens it (the palette's "Change …" commands). */
function Picker({ label, title, options, value, onPick, openOn }: { label: string; title: string; options: string[]; value: string; onPick: (v: string) => void; openOn?: string }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocusState] = useState(0);
  const focusRef = useRef(0);
  const setFocus = (f: number | ((i: number) => number)) => {
    focusRef.current = typeof f === "function" ? f(focusRef.current) : f;
    setFocusState(focusRef.current);
  };
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const WIDTH = 220;

  const show = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos(placePopup(r, WIDTH, window.innerWidth));
    setFocus(Math.max(0, options.indexOf(value)));
    setOpen(true);
  };
  const pick = (v: string) => {
    setOpen(false);
    onPick(v);
    editor.focus();
  };
  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => (openOn ? bus.on(openOn, () => showRef.current()) : undefined), [openOn]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowDown") setFocus((i) => (i + 1) % options.length);
      else if (e.key === "ArrowUp") setFocus((i) => (i + options.length - 1) % options.length);
      else if (e.key === "Home") setFocus(0);
      else if (e.key === "End") setFocus(options.length - 1);
      else if (e.key === "Enter") pick(options[focusRef.current]);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, options]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  }, [open, focus]);

  return (
    <>
      <button ref={btnRef} className={`status-item clickable ${open ? "open" : ""}`} title={title} aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? setOpen(false) : show())}>
        {label}
      </button>
      {open && (
        <div className="status-popup" role="listbox" style={{ left: pos.left, bottom: pos.bottom, width: WIDTH }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="palette-list" ref={listRef}>
            {options.map((o, i) => (
              <button key={o} role="option" aria-selected={o === value} className={`palette-item ${i === focus ? "active" : ""} ${o === value ? "current" : ""}`} onMouseEnter={() => setFocus(i)} onClick={() => pick(o)}>
                <span className="title">{o}</span>
                {o === value && <Check size={13} className="check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Branch of the active file's repository (or the open folder's): click to switch branches. */
function GitStatusItem() {
  const path = useStore((s) => s.docs.find((d) => d.id === s.activeId)?.path ?? null);
  const g = useGit();
  const repo = repoOf(path) ?? currentRepo(g);
  if (!repo) return null;
  const { text, title } = statusBarBranch(repo, g.busy);
  return (
    <button
      className="status-item clickable"
      title={title}
      onClick={() => {
        useGit.setState({ current: repo.root.toLowerCase() });
        void pickBranch();
      }}
    >
      <GitBranch size={12} /> {text}
    </button>
  );
}

export function StatusBar() {
  const doc = useActiveDoc();
  const cursor = useStore((s) => s.cursor);
  const columnMode = useStore((s) => s.columnMode);
  const recording = useStore((s) => s.recording);
  const playing = useStore((s) => s.macroPlaying);
  const paused = useStore((s) => s.macroPaused);
  const recordingSteps = useStore((s) => s.recordingSteps);
  const tabSize = useStore((s) => s.settings.tabSize);
  const insertSpaces = useStore((s) => s.settings.insertSpaces);
  const tabMovesFocus = useStore((s) => s.tabMovesFocus);

  return (
    <footer className="statusbar">
      {playing && (
        <span className="status-item rec" title={paused ? "Macro paused" : "Macro playing"}>
          <button className="status-inline-btn" title={paused ? "Resume (menu Macros)" : "Pause"} onClick={() => runCommand("macro.pause")}>{paused ? <Play size={11} /> : <Pause size={11} />}</button>
          <button className="status-inline-btn" title="Stop macro (Shift+Esc)" onClick={() => runCommand("macro.stop")}><Square size={11} /></button>
          {paused ? "PAUSED" : "PLAYING"}
        </span>
      )}
      <GitStatusItem />
      <ScriptStatusItem />
      {recording && (
        <span className="status-item rec" title="Recording macro — Ctrl+Shift+R to stop">
          <CircleDot size={12} /> REC {recordingSteps}
        </span>
      )}
      {doc?.kind === "big" && doc.bigInfo && (
        <span className="status-item" title="Disk-backed large file mode">
          <HardDrive size={12} /> {formatBytes(doc.bigInfo.size)} · {doc.bigInfo.totalLines.toLocaleString()} lines
          {!doc.bigInfo.indexed && doc.indexProgress && ` · indexing ${Math.round((doc.indexProgress.indexedBytes / Math.max(1, doc.indexProgress.totalBytes)) * 100)}%`}
        </span>
      )}
      {doc?.readonly && <span className="status-item">Read-only</span>}
      {tabMovesFocus && (
        <button className="status-item clickable accent" title="Tab moves focus instead of indenting. Click or press Ctrl+M to turn off" onClick={() => runCommand("view.toggleTabFocus")}>
          Tab moves focus
        </button>
      )}
      <span className="grow" />
      {doc?.kind === "text" && (
        <>
          <LspStatusItem doc={doc} />
          <button className="status-item clickable" title="Go to Line (Ctrl+G)" onClick={() => runCommand("goto.line")}>
            Ln {cursor.line}, Col {cursor.col}
            {cursor.selectedChars > 0 && ` (${cursor.selectedChars} selected${cursor.selections > 1 ? `, ${cursor.selections} ranges` : ""})`}
            {cursor.selectedChars === 0 && cursor.selections > 1 && ` (${cursor.selections} cursors)`}
          </button>
          <button className={`status-item clickable ${columnMode ? "accent" : ""}`} title="Toggle Column Mode (Alt+Shift+C)" onClick={() => runCommand("selection.toggleColumnMode")}>
            <Columns3 size={12} /> {columnMode ? "COLUMN" : "Column"}
          </button>
          <Picker
            label={`${insertSpaces ? "Spaces" : "Tab Size"}: ${tabSize}`}
            title="Indentation"
            options={["2", "4", "8"]}
            value={String(tabSize)}
            onPick={(v) => void runCommand("view.setTabSize", Number(v))}
            openOn="status.tabSize"
          />
          <Picker
            label={doc.encoding + (doc.bom ? " BOM" : "")}
            title="File encoding (used on save)"
            options={ENCODINGS}
            value={doc.encoding}
            onPick={(v) => void runCommand("file.setEncoding", v)}
            openOn="status.encoding"
          />
          <Picker label={doc.eol} title="Line endings" options={["CRLF", "LF"]} value={doc.eol} onPick={(v) => void runCommand("file.setEol", v)} openOn="status.eol" />
          <Picker
            label={doc.language}
            title="Language mode"
            options={allLanguageNames}
            value={doc.language}
            onPick={(v) => void runCommand("code.setLanguage", v)}
          />
        </>
      )}
      {doc?.kind === "big" && (
        <>
          <button className="status-item clickable" title="Go to Line (Ctrl+G)" onClick={() => runCommand("goto.line")}>
            Ln {cursor.line}, Col {cursor.col}
            {cursor.selections > 1 && ` (${cursor.selections} lines selected)`}
          </button>
          <span className="status-item" title={doc.encoding === "UTF-8" ? "Large files are read and written as UTF-8" : `${doc.encoding} large files are shown decoded and read-only`}>{doc.encoding}</span>
          <span className="status-item">{doc.eol}</span>
        </>
      )}
    </footer>
  );
}
