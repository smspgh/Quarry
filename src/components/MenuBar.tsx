import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dirName } from "../lib/actions";
import { getCommand, isEnabled, prettyKeys, runCommand } from "../lib/commands";
import { activeDoc } from "../lib/store";
import { useStore } from "../lib/store";
import { allLanguageNames } from "../editor/cmSetup";
import { bareTitle } from "../lib/fuzzy";
import { editor } from "../editor/manager";
import { displayRecent } from "./Welcome";

const COMMON_LANGUAGES = ["JavaScript", "TypeScript", "JSX", "TSX", "JSON", "HTML", "CSS", "SCSS", "XML", "Markdown", "YAML", "TOML", "Rust", "Python", "Go", "C", "C++", "C#", "Java", "SQL", "Shell", "PowerShell", "Plain Text"];

function languageMenu(): Item[] {
  const doc = useStore.getState().docs.find((d) => d.id === useStore.getState().activeId);
  const cur = doc?.kind === "text" ? doc.language : "";
  const all = new Set(allLanguageNames);
  const items: Item[] = [{ cmd: "code.detectLanguage" }, { sep: true }];
  for (const l of COMMON_LANGUAGES) {
    if (!all.has(l) && l !== "Plain Text") continue;
    items.push({ label: l === cur ? `• ${l}` : l, disabled: !cur, run: () => void runCommand("code.setLanguage", l) });
  }
  items.push({ sep: true }, { cmd: "code.setLanguage", label: "All languages…" });
  return items;
}

/** Scripts are browsed (run, edited) in the Scripts panel's tree, not listed here. */
function scriptsMenu(): Item[] {
  return [{ cmd: "script.panel", label: "Scripts" }, { cmd: "script.new" }, { sep: true }, { cmd: "script.runActive" }];
}

function macrosMenu(): Item[] {
  const st = useStore.getState();
  const items: Item[] = [{ cmd: "macro.panel", label: "Open Macros" }, { cmd: "macro.toggleRecord" }, { sep: true }, { cmd: "macro.playLast" }, { cmd: "macro.playToEnd" }, { cmd: "macro.pause" }, { cmd: "macro.stop" }, { sep: true }];
  if (st.macros.length === 0) items.push({ label: "No macros yet — record one", run: () => {}, disabled: true });
  const doc = activeDoc(st);
  const canPlay = doc?.kind === "text" && !st.recording && !st.macroPlaying;
  const why = doc?.kind !== "text" ? "open a text document" : st.recording ? "recording" : st.macroPlaying ? "already playing" : undefined;
  for (const m of st.macros) {
    items.push({
      label: m.name,
      sub: `${m.steps.length} steps`,
      submenu: () => [
        { label: "Play", sub: why, disabled: !canPlay, run: () => void runCommand("macro.play", { id: m.id }) },
        { label: "Play Until End of File", disabled: !canPlay, run: () => void runCommand("macro.play", { id: m.id, toEnd: true }) },
        { label: "Edit", run: () => void runCommand("macro.edit", m.id) },
      ],
    });
  }
  return items;
}

const readOnlyDoc = () => !!activeDoc(useStore.getState())?.readonly;

type Item =
  | { cmd: string; label?: string; disabled?: boolean; /** Shortcut shown when the key is not the command's own (Ctrl+X / C / V are CodeMirror's). */ keys?: string }
  | { sep: true }
  | { label: string; sub?: string; submenu: () => Item[] }
  | { label: string; run: () => void; keys?: string; sub?: string; disabled?: boolean };

interface Menu {
  label: string;
  items: () => Item[];
}

function recentFilesMenu(): Item[] {
  const s = useStore.getState();
  if (s.recentFiles.length === 0) return [{ label: "No recent files", run: () => {}, disabled: true }];
  const items: Item[] = displayRecent(s.recentFiles, 12).map((p) => ({ label: p.split(/[\\/]/).pop() ?? p, sub: dirName(p), run: () => void runCommand("file.openRecent", p) }));
  items.push({ sep: true }, { cmd: "file.clearRecent" });
  return items;
}

function recentFoldersMenu(): Item[] {
  const s = useStore.getState();
  if (s.recentFolders.length === 0) return [{ label: "No recent folders", run: () => {}, disabled: true }];
  const items: Item[] = s.recentFolders.slice(0, 10).map((p) => ({ label: p, run: () => void runCommand("file.openRecentFolder", p) }));
  items.push({ sep: true }, { cmd: "file.clearRecentFolders" });
  return items;
}

const MENUS: Menu[] = [
  {
    label: "File",
    items: () => [
      { cmd: "file.new" },
      { cmd: "file.open" },
      { cmd: "file.openFolder" },
      { label: "Open Recent File", submenu: recentFilesMenu },
      { label: "Open Recent Folder", submenu: recentFoldersMenu },
      { cmd: "file.quickOpen" },
      { sep: true },
      { cmd: "file.save" },
      { cmd: "file.saveAs" },
      { cmd: "file.saveAll" },
      { cmd: "file.revert" },
      { cmd: "file.reopenWithEncoding" },
      { sep: true },
      { label: "Compare", submenu: () => [{ cmd: "compare.files" }, { cmd: "compare.activeWith" }, { cmd: "compare.withSaved" }, { cmd: "compare.withClipboard" }, { sep: true }, { cmd: "compare.selectForCompare" }, { cmd: "compare.withSelected" }] },
      { sep: true },
      { cmd: "file.showInQuarryExplorer" },
      { cmd: "file.showInWindowsExplorer" },
      { sep: true },
      { cmd: "file.close" },
      { cmd: "file.closeOthers" },
      { cmd: "file.closeAll" },
      { sep: true },
      { cmd: "app.exit" },
    ],
  },
  {
    label: "Edit",
    items: () => [
      { cmd: "edit.undo" },
      { cmd: "edit.redo" },
      { sep: true },
      { cmd: "edit.cut", keys: "Ctrl+X", disabled: readOnlyDoc() },
      { cmd: "edit.copy", keys: "Ctrl+C" },
      { cmd: "edit.paste", keys: "Ctrl+V", disabled: readOnlyDoc() },
      { sep: true },
      { cmd: "edit.selectAll" },
      { sep: true },
      // Current line (or the lines touched by the selection).
      {
        label: "Line",
        submenu: () => [
          { cmd: "edit.duplicateLine" },
          { cmd: "edit.duplicateLineUp" },
          { cmd: "edit.deleteLine" },
          { sep: true },
          { cmd: "edit.moveLineUp" },
          { cmd: "edit.moveLineDown" },
        ],
      },
      // Bulk operations on the selected lines, or the whole document.
      {
        label: "Lines",
        submenu: () => [
          { cmd: "code.sortAsc" },
          { cmd: "code.sortDesc" },
          { cmd: "code.reverseLines" },
          { sep: true },
          { cmd: "code.dedupe" },
          { cmd: "code.removeBlank", label: "Delete Blank Lines" },
          { cmd: "code.removeEmpty", label: "Delete Empty Lines" },
          { cmd: "code.trimTrailing" },
          { sep: true },
          { cmd: "code.joinLines" },
          { cmd: "edit.numberLines" },
        ],
      },
      // Text transforms on the selection.
      {
        label: "Transform",
        submenu: () => [{ cmd: "edit.upper" }, { cmd: "edit.lower" }, { cmd: "code.titleCase" }, { sep: true }, { cmd: "edit.quoteSelections" }],
      },
      { sep: true },
      { cmd: "edit.indent" },
      { cmd: "edit.outdent" },
    ],
  },
  {
    label: "Code",
    items: () => [
      { cmd: "code.format" },
      { label: "Language", submenu: languageMenu },
      { sep: true },
      { cmd: "edit.toggleComment" },
      { cmd: "code.toggleBlockComment" },
      { sep: true },
      { cmd: "code.fold" },
      { cmd: "code.unfold" },
      { cmd: "code.foldAll" },
      { cmd: "code.unfoldAll" },
      { sep: true },
      { label: "Indentation", submenu: () => [{ cmd: "code.indentToSpaces" }, { cmd: "code.indentToTabs" }] },
    ],
  },
  {
    label: "Selection",
    items: () => [
      { cmd: "selection.addCursorAbove" },
      { cmd: "selection.addCursorBelow" },
      { sep: true },
      { cmd: "selection.toggleColumnMode" },
      { cmd: "selection.blockToCursors" },
      { sep: true },
      { cmd: "edit.selectNextOccurrence" },
      { cmd: "edit.selectAllOccurrences" },
      { cmd: "edit.selectAllMatches" },
    ],
  },
  {
    label: "Find",
    items: () => [
      { cmd: "find.open" },
      { cmd: "find.replace" },
      { cmd: "find.next" },
      { cmd: "find.prev" },
      { sep: true },
      { cmd: "find.inFiles" },
      { cmd: "find.replaceInFiles" },
      { cmd: "find.undoReplaceInFiles" },
      { sep: true },
      { cmd: "goto.line" },
      { cmd: "code.gotoBracket" },
    ],
  },
  {
    label: "View",
    items: () => [
      { cmd: "view.commandPalette" },
      { sep: true },
      {
        label: "Panels",
        submenu: () => [
          { cmd: "view.explorer", label: "Explorer" },
          { cmd: "find.inFiles", label: "Search" },
          { cmd: "view.json", label: "JSON Tools" },
          { cmd: "view.macros", label: "Macros" },
          { cmd: "view.scripts", label: "Scripts" },
          { cmd: "view.settings", label: "Settings" },
        ],
      },
      { cmd: "view.toggleSidebar" },
      { cmd: "view.togglePanel" },
      { sep: true },
      { cmd: "view.splitEditor" },
      { cmd: "view.focusLeftPane" },
      { cmd: "view.focusRightPane" },
      { sep: true },
      { cmd: "view.toggleWrap" },
      { cmd: "view.toggleWhitespace" },
      { cmd: "view.toggleTheme" },
      { cmd: "view.toggleTabFocus" },
      { sep: true },
      { cmd: "view.zoomIn" },
      { cmd: "view.zoomOut" },
      { cmd: "view.zoomReset" },
      { sep: true },
      { cmd: "file.nextTab" },
      { cmd: "file.prevTab" },
    ],
  },
  {
    label: "Git",
    items: () => [
      { cmd: "git.showPanel" },
      { cmd: "git.graph" },
      { cmd: "git.refresh" },
      { sep: true },
      { cmd: "git.compareWithHead" },
      { cmd: "git.fileHistory" },
      { cmd: "git.toggleBlame" },
      { sep: true },
      { cmd: "git.nextChange" },
      { cmd: "git.prevChange" },
      { cmd: "git.peekChange" },
      { cmd: "git.revertChange" },
      { sep: true },
      { label: "Conflicts", submenu: () => [{ cmd: "git.nextConflict" }, { cmd: "git.prevConflict" }, { sep: true }, { cmd: "git.acceptCurrent" }, { cmd: "git.acceptIncoming" }, { cmd: "git.acceptBoth" }, { sep: true }, { cmd: "git.acceptAllCurrent" }, { cmd: "git.acceptAllIncoming" }] },
      { sep: true },
      { cmd: "git.stageFile" },
      { cmd: "git.unstageFile" },
      { sep: true },
      { cmd: "git.switchBranch" },
      { cmd: "git.fetch" },
      { cmd: "git.pull" },
      { cmd: "git.push" },
      { cmd: "git.addRemote" },
    ],
  },
  {
    label: "JSON",
    items: () => [
      { cmd: "json.format", label: "Format / Pretty-print" },
      { cmd: "json.minify", label: "Minify" },
      { cmd: "json.validate", label: "Validate" },
      { sep: true },
      { cmd: "view.json", label: "JSON Tools Panel" },
      { sep: true },
      { cmd: "json.toCsv", label: "Convert JSON → CSV" },
      { cmd: "json.fromCsv", label: "Convert CSV → JSON" },
      { cmd: "json.copyKeys", label: "Copy Top-level Keys" },
      { sep: true },
      { cmd: "json.copyPath", label: "Copy Path at Cursor (dot)" },
      { cmd: "json.copyJsonPath", label: "Copy JSONPath at Cursor" },
      { cmd: "json.copyPointer", label: "Copy JSON Pointer at Cursor" },
      { cmd: "json.copyBracket", label: "Copy Bracket Path at Cursor" },
      { cmd: "json.copyValue", label: "Copy Value at Cursor" },
    ],
  },
  { label: "Scripts", items: scriptsMenu },
  { label: "Macros", items: macrosMenu },
  {
    label: "Tools",
    items: () => [
      // Hidden, not greyed, while the Claude Code integration is off.
      ...(useStore.getState().settings.claudeEnabled
        ? ([{ cmd: "claude.openHere" }, { cmd: "claude.openFolder" }, { cmd: "claude.openTerminal" }, { cmd: "claude.addSelection" }, { cmd: "claude.addFile" }, { sep: true }] as Item[])
        : []),
      { cmd: "view.settings", label: "Settings" },
    ],
  },
  {
    label: "Help",
    items: () => [
      { cmd: "view.commandPalette", label: "All Commands and Shortcuts" },
      { cmd: "help.scriptApi" },
      { sep: true },
      { cmd: "help.checkUpdates", label: "Check for Updates…" },
      { cmd: "help.about", label: "About Quarry" },
    ],
  },
];

interface Resolved {
  label: string;
  keys?: string;
  run?: () => void;
  submenu?: () => Item[];
  sub?: string;
  disabled?: boolean;
}

/** Commands that act on the text buffer but declare no `enabled()` are greyed out without a text document. */
const TEXT_CATEGORY = /^(edit|code|selection)\./;

function resolve(item: Item): Resolved | null {
  if ("sep" in item) return null;
  if ("cmd" in item) {
    const c = getCommand(item.cmd);
    if (!c) return null;
    const title = item.label ?? bareTitle(c.dynamicTitle ? c.dynamicTitle() : c.title);
    const noText = !c.enabled && TEXT_CATEGORY.test(c.id) && activeDoc(useStore.getState())?.kind !== "text";
    return { label: title, keys: item.keys ?? (c.keys ? prettyKeys(c.keys) : undefined), run: () => void runCommand(item.cmd), disabled: item.disabled || noText || !isEnabled(c) };
  }
  if ("submenu" in item) {
    // A submenu whose every entry is disabled is greyed out itself (e.g. Edit › Line with no document).
    const children = item.submenu().map(resolve).filter((r): r is Resolved => !!r);
    const allDisabled = children.length > 0 && children.every((r) => r.disabled);
    return { label: item.label, sub: item.sub, submenu: item.submenu, disabled: allDisabled };
  }
  return { label: item.label, keys: item.keys, run: item.run, sub: item.sub, disabled: item.disabled };
}

const ITEM_SELECTOR = ".menu-item:not(:disabled)";

/**
 * Alt+letter for each top-level menu; the letter is underlined while Alt is held. Unique, and kept
 * clear of the plain Alt+letter shortcuts: Alt+Z (word wrap), Alt+L / Alt+U (CodeMirror select line /
 * redo selection) and the find bar's Alt+C / W / R / P. That is why Code is O, Find is N and Scripts is I.
 */
export const MENU_MNEMONICS: Record<string, string> = {
  File: "f", Edit: "e", Code: "o", Selection: "s", Find: "n", View: "v", Git: "g", JSON: "j", Scripts: "i", Macros: "m", Tools: "t", Help: "h",
};

/** Index of the menu whose mnemonic is `letter` (any case), or null. Pure so it can be unit-tested. */
export function menuForMnemonic(letter: string, labels: string[] = MENUS.map((m) => m.label)): number | null {
  if (letter.length !== 1) return null;
  const l = letter.toLowerCase();
  const i = labels.findIndex((label) => MENU_MNEMONICS[label] === l);
  return i < 0 ? null : i;
}

/** The letter an Alt+key press stands for: from the physical key (`KeyF`), so it works on any layout. */
export function mnemonicKey(e: { key: string; code: string; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return null;
  const m = /^Key([A-Z])$/.exec(e.code);
  if (m) return m[1].toLowerCase();
  return /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : null;
}

/** A menu label split around its mnemonic letter (the first occurrence, any case). */
export function splitMnemonic(label: string, letter: string | undefined): [string, string, string] | null {
  if (!letter) return null;
  const i = label.toLowerCase().indexOf(letter.toLowerCase());
  return i < 0 ? null : [label.slice(0, i), label[i], label.slice(i + 1)];
}

function MenuLabel({ label }: { label: string }) {
  const parts = splitMnemonic(label, MENU_MNEMONICS[label]);
  if (!parts) return <>{label}</>;
  return <>{parts[0]}<span className="mnemonic">{parts[1]}</span>{parts[2]}</>;
}

/** Index of the item to focus after a keyboard move; wraps around. Pure so it can be unit-tested. */
export function nextMenuIndex(current: number, count: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End"): number {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (current < 0) return key === "ArrowDown" ? 0 : count - 1;
  return key === "ArrowDown" ? (current + 1) % count : (current + count - 1) % count;
}

function MenuList({ items, onDone, onClose, depth = 0, autoFocus = false }: { items: Item[]; onDone: () => void; onClose?: () => void; depth?: number; autoFocus?: boolean }) {
  const [sub, setSub] = useState<number | null>(null);
  const [subByKey, setSubByKey] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const ownItems = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>(`:scope > .menu-item-wrap > ${ITEM_SELECTOR}`) ?? [])];

  useEffect(() => {
    if (autoFocus) ownItems()[0]?.focus();
  }, [autoFocus]);

  // Keyboard handling for this level only: events bubble up from the focused item, so the innermost open list sees them first.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const wrap = target.closest(".menu-item-wrap");
    if (!wrap || wrap.parentElement !== ref.current) return; // belongs to a nested submenu
    const list = ownItems();
    const cur = list.indexOf(target as HTMLButtonElement);
    const idx = Number((wrap as HTMLElement).dataset.idx);
    const r = (() => { const it = items[idx]; return it && !("sep" in it) ? resolve(it) : null; })();
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Home":
      case "End":
        list[nextMenuIndex(cur, list.length, e.key)]?.focus();
        break;
      case "ArrowRight":
        if (!r?.submenu) return; // let the menu bar switch menus
        setSub(idx);
        setSubByKey(true);
        break;
      case "ArrowLeft":
        if (depth === 0) return;
        onClose?.();
        break;
      case "Enter":
      case " ":
        if (r?.submenu) {
          setSub(idx);
          setSubByKey(true);
          break;
        }
        return; // native click on the focused button runs it
      case "Tab":
        break; // focus stays inside the menu
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const closeSub = (i: number) => {
    setSub(null);
    setSubByKey(false);
    ref.current?.querySelectorAll<HTMLButtonElement>(`:scope > .menu-item-wrap > .menu-item`)[i]?.focus();
  };

  return (
    <div ref={ref} className={`menu-flyout ${depth > 0 ? "submenu" : ""}`} role="menu" onKeyDown={onKeyDown}>
      {items.map((it, i) => {
        if ("sep" in it) return <div key={i} className="menu-sep" />;
        const r = resolve(it);
        if (!r) return null;
        return (
          <div key={i} className="menu-item-wrap" data-idx={i} onMouseEnter={() => { setSub(r.submenu ? i : null); setSubByKey(false); }}>
            <button
              className={`menu-item ${r.disabled ? "disabled" : ""} ${sub === i ? "open" : ""}`}
              role="menuitem"
              aria-haspopup={r.submenu ? "menu" : undefined}
              aria-expanded={r.submenu ? sub === i : undefined}
              disabled={r.disabled}
              tabIndex={-1}
              onClick={() => {
                if (r.submenu) return;
                onDone();
                r.run?.();
              }}
            >
              <span className="menu-label">{r.label}{r.sub && <span className="menu-sub">{r.sub}</span>}</span>
              {r.keys && <span className="menu-keys">{r.keys}</span>}
              {r.submenu && <ChevronRight size={14} className="menu-arrow" />}
            </button>
            {r.submenu && sub === i && <MenuList items={r.submenu()} onDone={onDone} onClose={() => closeSub(i)} depth={depth + 1} autoFocus={subByKey} />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Classic horizontal menu bar. `inline` renders a compact variant for use inside the title bar;
 * `overlay` is used while the menu bar is hidden: nothing is rendered until Alt / F10 opens it.
 */
export function MenuBar({ inline = false, overlay = false }: { inline?: boolean; overlay?: boolean }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [byKeyboard, setByKeyboard] = useState(false);
  /** Alt is down: the mnemonic letters are underlined (also while a menu is open from the keyboard). */
  const [altHeld, setAltHeld] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Subscribe to the bits that drive enabled/disabled state so an open menu re-renders live.
  useStore((st) => `${st.activeId}|${st.docs.length}|${st.recording}|${st.macroPlaying}|${st.macroPaused}|${st.macros.length}|${st.activeScriptId}`);

  const openWithKeyboard = (i: number | null) => {
    setByKeyboard(true);
    setOpenIdx(i);
  };

  useEffect(() => {
    if (openIdx === null) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenIdx(null);
    };
    const key = (e: KeyboardEvent) => {
      const inFlyout = (e.target as HTMLElement | null)?.closest?.(".menu-flyout");
      const inSubmenu = (e.target as HTMLElement | null)?.closest?.(".menu-flyout.submenu");
      if (e.key === "Escape") {
        setOpenIdx(null);
        editor.focus();
      } else if (e.key === "ArrowRight" && !(inFlyout && (e.target as HTMLElement).getAttribute("aria-haspopup"))) {
        openWithKeyboard(((openIdx ?? -1) + 1) % MENUS.length);
      } else if (e.key === "ArrowLeft" && !inSubmenu) {
        openWithKeyboard(((openIdx ?? 0) + MENUS.length - 1) % MENUS.length);
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") && !inFlyout) {
        // Nothing focused yet (menu opened with the mouse): enter the list.
        const list = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>(`.menu-flyout:not(.submenu) > .menu-item-wrap > ${ITEM_SELECTOR}`) ?? [])];
        list[nextMenuIndex(-1, list.length, e.key)]?.focus();
      } else if (e.key === "Tab" && inFlyout) {
        // Roving focus: Tab never leaves the menu.
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key, true);
    };
  }, [openIdx]);

  // Opening via keyboard focuses the first item; the mouse path leaves focus where it was.
  useEffect(() => {
    if (openIdx === null || !byKeyboard) return;
    const first = rootRef.current?.querySelector<HTMLButtonElement>(`.menu-flyout > .menu-item-wrap > ${ITEM_SELECTOR}`);
    first?.focus();
  }, [openIdx, byKeyboard]);

  // A lone Alt press (no other key while held) or F10 opens the first menu, like classic Win32 apps;
  // Alt+letter opens the menu with that mnemonic (letters are underlined while Alt is held).
  // Not while a modal dialog is open: it owns the keyboard, as in App.tsx's shortcut guard.
  useEffect(() => {
    let altOnly = false;
    const down = (e: KeyboardEvent) => {
      if (useStore.getState().dialog) {
        altOnly = false;
        setAltHeld(false);
        return;
      }
      altOnly = e.key === "Alt" && !e.ctrlKey && !e.shiftKey;
      if (e.key === "Alt") setAltHeld(!e.ctrlKey && !e.shiftKey && !e.metaKey);
      if (e.key === "F10" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        openWithKeyboard(openIdx === null ? 0 : null);
        return;
      }
      // Keys already handled (CodeMirror's Alt+L, …) and a terminal's own Alt keys are left alone.
      const letter = mnemonicKey(e);
      if (letter === null || e.defaultPrevented || (e.target as HTMLElement | null)?.closest?.(".terminal-view")) return;
      const i = menuForMnemonic(letter);
      if (i === null) return;
      e.preventDefault();
      e.stopPropagation();
      openWithKeyboard(i);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltHeld(false);
      if (e.key === "Alt" && altOnly && !useStore.getState().dialog) {
        e.preventDefault();
        openWithKeyboard(openIdx === null ? 0 : null);
      }
      altOnly = false;
    };
    const blur = () => setAltHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [openIdx]);

  if (overlay && openIdx === null) return null;

  return (
    <div ref={rootRef} className={`menubar ${inline ? "inline" : ""} ${overlay ? "overlay-bar" : ""} ${altHeld || (openIdx !== null && byKeyboard) ? "show-mnemonics" : ""}`} role="menubar" aria-label="Application menu">
      {MENUS.map((m, i) => (
        <div key={m.label} className="menu-root">
          <button
            className={`menu-btn ${openIdx === i ? "open" : ""}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openIdx === i}
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              setByKeyboard(false);
              setOpenIdx(openIdx === i ? null : i);
            }}
            onMouseEnter={() => openIdx !== null && openIdx !== i && setOpenIdx(i)}
            aria-keyshortcuts={MENU_MNEMONICS[m.label] ? `Alt+${MENU_MNEMONICS[m.label].toUpperCase()}` : undefined}
          >
            <MenuLabel label={m.label} />
          </button>
          {openIdx === i && <MenuList items={m.items()} onDone={() => { setOpenIdx(null); editor.focus(); }} />}
        </div>
      ))}
    </div>
  );
}
