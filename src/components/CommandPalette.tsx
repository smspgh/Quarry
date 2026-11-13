import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useRef, useState } from "react";
import { allLanguageNames } from "../editor/cmSetup";
import { editor } from "../editor/manager";
import { useGit } from "../lib/git";
import { openPath } from "../lib/actions";
import { bus } from "../lib/bus";
import { allCommands, prettyKeys, runCommand, type Command } from "../lib/commands";
import { bareTitle, fuzzy, fuzzyCommand, fuzzyPath, shiftIndices } from "../lib/fuzzy";
import { fs } from "../lib/ipc";
import { activeDoc, useStore } from "../lib/store";
import { ENCODINGS } from "../lib/types";

const RECENT_KEY = "quarry.recentCommands";
const RECENT_MAX = 20;

function loadRecentCommands(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushRecentCommand(id: string) {
  try {
    const next = [id, ...loadRecentCommands().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable: recents are a convenience only */
  }
}

/** Drop the palette just below the title bar / menu bar instead of over the menu names. */
function paletteTop(): number {
  let bottom = 0;
  for (const el of document.querySelectorAll(".tabbar, .titlebar, .menubar")) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  return Math.max(bottom + 8, 24);
}

/** A value to pick (language, encoding) shown as a command row; the current one is labelled. Match
 *  indices are into the value, so they move past the label. */
function pickItem(id: string, value: string, current: boolean, idx: number[]) {
  const category = current ? "current" : "";
  return { key: value, cmd: { id, title: value, category, run: () => {} } as Command, arg: value, idx: category ? idx.map((i) => i + category.length + 2) : idx };
}

function Highlight({ text, idx }: { text: string; idx: number[] }) {
  if (idx.length === 0) return <>{text}</>;
  const set = new Set(idx);
  const out: React.ReactNode[] = [];
  let run = "";
  let bold = false;
  for (let i = 0; i < text.length; i++) {
    const b = set.has(i);
    if (b !== bold && run) {
      out.push(bold ? <b key={i}>{run}</b> : run);
      run = "";
    }
    bold = b;
    run += text[i];
  }
  if (run) out.push(bold ? <b key="end">{run}</b> : run);
  return <>{out}</>;
}

type Item = { key: string; idx: number[]; cmd?: Command; arg?: string; file?: string; abs?: boolean; recent?: boolean };

/** Parse "line[:col]" / "line,col". Returns null when there is no leading number. */
function parseGoto(q: string): { line: number; col: number } | null {
  const m = /^\s*(\d+)(?:\s*[:,]\s*(\d+))?/.exec(q);
  if (!m) return null;
  return { line: Number(m[1]), col: m[2] ? Number(m[2]) : 1 };
}

export function CommandPalette() {
  const mode = useStore((s) => s.palette);
  const set = useStore((s) => s.set);
  const folder = useStore((s) => s.folder);
  const fileListCache = useStore((s) => s.fileListCache);
  const branches = useGit((s) => s.branches);
  const cursorLine = useStore((s) => s.cursor.line);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Go to Line: where the editor was when the palette opened, restored on Escape.
  const gotoOrigin = useRef<{ anchor: number; head: number; scrollTop: number } | null>(null);

  useEffect(() => {
    setQuery("");
    setActive(0);
    if (mode) setTimeout(() => inputRef.current?.focus(), 0);
    if (mode === "files" && folder && !fileListCache) {
      // The list is relative to `folder`: drop it if another folder was opened meanwhile.
      const walked = folder;
      const keep = (list: string[]) => {
        if (useStore.getState().folder === walked) set({ fileListCache: list });
      };
      fs.walk(folder).then(keep).catch(() => keep([]));
    }
    if (mode === "goto" && editor.view) {
      const v = editor.view;
      gotoOrigin.current = { anchor: v.state.selection.main.anchor, head: v.state.selection.main.head, scrollTop: v.scrollDOM.scrollTop };
    } else {
      gotoOrigin.current = null;
    }
  }, [mode]);

  // Go to Line: total lines and live preview while typing (text docs only; big docs have no view).
  const doc = activeDoc(useStore.getState());
  const totalLines = mode === "goto" ? (doc?.kind === "text" && editor.view ? editor.view.state.doc.lines : doc?.kind === "big" ? (doc.bigInfo?.totalLines ?? 0) : 0) : 0;
  const gotoParsed = mode === "goto" ? parseGoto(query) : null;
  // While a large file is still being indexed its line count is only a lower bound: a later line is
  // not out of range, the view jumps there once indexing reaches it.
  const totalKnown = !(doc?.kind === "big" && !doc.bigInfo?.indexed);
  const gotoOutOfRange = !!gotoParsed && totalLines > 0 && (gotoParsed.line < 1 || (totalKnown && gotoParsed.line > totalLines));
  useEffect(() => {
    if (mode !== "goto" || !gotoParsed || doc?.kind !== "text") return;
    const view = editor.view;
    if (!view) return;
    const ln = Math.max(1, Math.min(view.state.doc.lines, gotoParsed.line));
    const l = view.state.doc.line(ln);
    const pos = Math.min(l.to, l.from + Math.max(0, gotoParsed.col - 1));
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  }, [mode, query]);

  const items = useMemo<Item[]>(() => {
    if (mode === "commands") {
      const cmds = allCommands();
      if (!query) {
        const recent = loadRecentCommands();
        const byId = new Map(cmds.map((c) => [c.id, c]));
        const recentItems: Item[] = [];
        for (const id of recent) {
          const c = byId.get(id);
          if (c) recentItems.push({ key: `recent:${c.id}`, cmd: c, idx: [], recent: true });
        }
        const seen = new Set(recent);
        const rest: Item[] = cmds
          .filter((c) => !seen.has(c.id))
          .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
          .map((c) => ({ key: c.id, cmd: c, idx: [] }));
        return [...recentItems, ...rest];
      }
      return cmds
        .map((c) => ({ c, m: fuzzyCommand(query, c.category, c.title) }))
        .filter((x) => x.m)
        .sort((a, b) => b.m!.score - a.m!.score || bareTitle(a.c.title).localeCompare(bareTitle(b.c.title)))
        .map((x) => ({ key: x.c.id, cmd: x.c, idx: x.m!.idx }));
    }
    if (mode === "language") {
      const cur = activeDoc(useStore.getState());
      const curLang = cur?.kind === "text" ? cur.language : "";
      return allLanguageNames
        .map((n) => ({ n, m: fuzzy(query, n) }))
        .filter((x) => x.m)
        .sort((a, b) => b.m!.score - a.m!.score || a.n.localeCompare(b.n))
        .map((x) => pickItem("code.setLanguage", x.n, x.n === curLang, x.m!.idx));
    }
    if (mode === "encoding") {
      const cur = activeDoc(useStore.getState());
      return ENCODINGS.map((n) => ({ n, m: fuzzy(query, n) }))
        .filter((x) => x.m)
        .map((x) => pickItem("file.reopenWithEncoding", x.n, x.n === cur?.encoding, x.m!.idx));
    }
    if (mode === "files") {
      const st = useStore.getState();
      const recents = st.recentFiles;
      if (!folder || !query) {
        // No folder (or empty query): open documents + recent files, fuzzy-filtered by the query.
        const pool: string[] = [];
        const seen = new Set<string>();
        for (const d of st.docs) if (d.path && !seen.has(d.path)) (seen.add(d.path), pool.push(d.path));
        for (const p of recents) if (!seen.has(p)) (seen.add(p), pool.push(p));
        const out: (Item & { score: number })[] = [];
        for (const p of pool) {
          const m = fuzzyPath(query, p);
          if (m) out.push({ key: p, file: p, abs: true, idx: m.idx, score: m.score });
        }
        if (query) out.sort((a, b) => b.score - a.score);
        return out.slice(0, 50);
      }
      const list = fileListCache ?? [];
      const scored: (Item & { score: number })[] = [];
      for (const f of list) {
        const m = fuzzyPath(query, f);
        if (m) scored.push({ key: f, file: f, abs: false, idx: m.idx, score: m.score });
        if (scored.length > 5000) break;
      }
      scored.sort((a, b) => b.score - a.score || a.file!.length - b.file!.length);
      return scored.slice(0, 100);
    }
    if (mode === "branch") {
      const list = branches ?? [];
      const out: Item[] = [];
      const name = query.trim().replace(/\s+/g, "-");
      if (name && !list.some((b) => b.name === name)) {
        out.push({ key: "create", cmd: { id: "git.createBranch", title: `Create branch "${name}" from here`, category: "", run: () => {} } as Command, arg: name, idx: [] });
      }
      for (const b of list) {
        const m = fuzzy(query, b.name);
        if (!m) continue;
        const category = b.current ? "current" : b.remote ? "remote" : "";
        out.push({ key: b.name, cmd: { id: "git.checkoutTo", title: b.name, category, run: () => {} } as Command, arg: b.name, idx: category ? m.idx.map((i) => i + category.length + 2) : m.idx });
      }
      return out;
    }
    return [];
  }, [mode, query, fileListCache, folder, branches]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // The global Escape shortcut (capture phase) runs before the input sees the key; it asks us to
  // cancel. Declared before the early return so the hook order is stable.
  const cancelRef = useRef<() => void>(() => {});
  useEffect(() => bus.on("palette.cancel", () => cancelRef.current()), []);

  if (!mode) return null;

  const close = () => {
    set({ palette: null });
    editor.focus();
  };

  const cancel = () => {
    // Go to Line preview moved the editor: put it back.
    const o = gotoOrigin.current;
    const view = editor.view;
    if (mode === "goto" && o && view) {
      const len = view.state.doc.length;
      view.dispatch({ selection: { anchor: Math.min(o.anchor, len), head: Math.min(o.head, len) } });
      // CodeMirror's post-dispatch measure pass would undo a synchronous scrollTop write.
      requestAnimationFrame(() => { view.scrollDOM.scrollTop = o.scrollTop; });
    }
    close();
  };
  cancelRef.current = cancel;

  const pick = (i: number) => {
    const it = items[i];
    if (mode === "goto") {
      const d = activeDoc(useStore.getState());
      const p = parseGoto(query);
      if (!p) {
        cancel();
        return;
      }
      close();
      if (d?.kind === "big") import("../lib/bus").then(({ bus }) => bus.emit("big.goto", { line: p.line }));
      else editor.goTo(p.line, p.col);
      if (totalLines > 0 && (p.line < 1 || (totalKnown && p.line > totalLines))) useStore.getState().toast(`Line ${p.line} is out of range; jumped to line ${Math.max(1, Math.min(totalLines, p.line))}.`, "info", 2500);
      return;
    }
    if (!it) return;
    close();
    if (it.cmd) {
      if (mode === "commands") pushRecentCommand(it.cmd.id);
      void runCommand(it.cmd.id, it.arg);
    } else if (it.file) {
      const path = it.abs ? it.file : `${folder}\\${it.file.replace(/\//g, "\\")}`;
      void openPath(path);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 10));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 10));
    }
  };

  const placeholder =
    mode === "commands"
      ? "Type a command…"
      : mode === "language"
        ? "Select language mode…"
        : mode === "encoding"
          ? "Reopen with encoding…"
        : mode === "branch"
          ? "Switch to a branch, or type a name to create one…"
        : mode === "files"
          ? folder
            ? "Search files in folder by name…"
            : "Search open and recent files…"
          : totalLines > 0
            ? `Go to line[:column]  (1–${totalLines}${totalKnown ? "" : "+, still indexing"})`
            : "Go to line[:column]";

  const gotoHint = () => {
    if (gotoOutOfRange) return `Line ${gotoParsed!.line} is out of range (1–${totalLines}). Enter jumps to the nearest line.`;
    if (gotoParsed) return `Press Enter to jump to line ${gotoParsed.line}${gotoParsed.col > 1 ? `, column ${gotoParsed.col}` : ""}.${doc?.kind === "text" ? " Escape restores the previous position." : ""}`;
    if (query.trim()) return "Type a line number, optionally followed by :column.";
    return `Current: line ${cursorLine}${totalLines > 0 ? ` of ${totalLines}` : ""}. Type a line number and press Enter.`;
  };

  let lastWasRecent = false;
  return (
    <div className="overlay" style={{ paddingTop: paletteTop() }} onMouseDown={cancel}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className={`input ${gotoOutOfRange ? "invalid" : ""}`}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => {
            // Focus never leaves the input while the palette is open (Tab cycles the list).
            if (useStore.getState().palette) setTimeout(() => inputRef.current?.focus(), 0);
          }}
          spellCheck={false}
        />
        {mode === "goto" ? (
          <div className={`palette-empty ${gotoOutOfRange ? "palette-error" : ""}`}>{gotoHint()}</div>
        ) : (
          <div className="palette-list" ref={listRef}>
            {items.length === 0 && <div className="palette-empty">{mode === "files" && folder && !fileListCache ? "Indexing folder…" : mode === "branch" && !branches ? "Loading branches…" : "No matches"}</div>}
            {items.map((it, i) => {
              const showRecentLabel = !!it.recent && i === 0;
              const showAllLabel = !it.recent && lastWasRecent;
              lastWasRecent = !!it.recent;
              const label = showRecentLabel ? "recently used" : showAllLabel ? "all commands" : null;
              return (
                <div key={it.key} className={`palette-item ${i === active ? "active" : ""} ${label ? "has-label" : ""}`} data-label={label ?? undefined} onMouseEnter={() => setActive(i)} onClick={() => pick(i)}>
                  {it.cmd ? (
                    <>
                      <span className="title">
                        {it.cmd.category && <span className="cat"><Highlight text={`${it.cmd.category}: `} idx={it.idx.filter((n) => n < it.cmd!.category.length)} /></span>}
                        <Highlight text={bareTitle(it.cmd.title)} idx={it.cmd.category ? shiftIndices(it.idx, it.cmd.category.length + 2) : it.idx} />
                      </span>
                      {it.cmd.keys && <span className="kbd">{prettyKeys(it.cmd.keys)}</span>}
                    </>
                  ) : (
                    (() => {
                      const file = it.file!;
                      const cut = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1;
                      return (
                        <>
                          <span className="title">
                            <Highlight text={file.slice(cut)} idx={shiftIndices(it.idx, cut)} />
                          </span>
                          <span className="sub">
                            <Highlight text={file} idx={it.idx} />
                          </span>
                        </>
                      );
                    })()
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
