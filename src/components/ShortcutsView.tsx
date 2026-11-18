import { Pencil, RotateCcw, Search, X } from "lucide-react";
import React from "react";
import { editor } from "../editor/manager";
import { askDialog, persistSettings } from "../lib/actions";
import { bus } from "../lib/bus";
import { eventToKeys, keyRows, prettyKeys, setKeyCapture } from "../lib/commands";
import { captureStep, checkKeys, isChanged, keyRowMatches, restoreDefault, sortKeyRows, withKeys, type KeyOverrides, type KeyRow, type KeySort } from "../lib/keybindings";
import { takePendingQuery } from "../lib/shortcutsTab";
import type { Doc } from "../lib/store";
import { useStore } from "../lib/store";
import { MatchText } from "./MatchText";
import { MENU_MNEMONICS } from "./MenuBar";
import { Select } from "./Select";

/** Pure helper (testable): the rows the tab lists: every command with a place in the palette, plus
 *  hidden ones the user's changes touched; then the search text and "Changed only". */
export function listedRows(rows: KeyRow[], query: string, changedOnly: boolean): KeyRow[] {
  let out = rows.filter((r) => !r.hidden || isChanged(r));
  if (query.trim()) out = out.filter((r) => keyRowMatches(query, r));
  return changedOnly ? out.filter(isChanged) : out;
}

const SORTS: { value: KeySort; label: string }[] = [
  { value: "category", label: "By category" },
  { value: "name", label: "By name" },
  { value: "keys", label: "By keys" },
];

/**
 * The Keyboard Shortcuts tab (specs/settings.md SET-020): search, sort, "Changed only", and per
 * command Change / Remove / Restore default. Changes go to `settings.keybindings`; commands.ts
 * applies them (`setKeyOverrides`).
 */
export function ShortcutsView({ doc, visible }: { doc: Doc; visible: boolean }) {
  const overrides = useStore((s) => s.settings.keybindings);
  const update = useStore((s) => s.updateSettings);
  const [query, setQuery] = React.useState(takePendingQuery);
  const [sort, setSort] = React.useState<KeySort>("category");
  const [changedOnly, setChangedOnly] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [strokes, setStrokes] = React.useState<string[]>([]);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const filterRef = React.useRef<HTMLInputElement>(null);
  // The registry is updated by a store subscription before React renders, so reading it here is current.
  const rows = keyRows();

  const save = (next: KeyOverrides) => {
    update({ keybindings: next });
    persistSettings();
  };
  const stop = React.useCallback(() => {
    setEditing(null);
    setStrokes([]);
  }, []);

  const keys = strokes.join(" ");
  const check = editing && strokes.length ? checkKeys(keys, editing, rows, MENU_MNEMONICS) : null;
  const assign = () => {
    if (!editing || !check?.ok) return;
    save(withKeys(overrides, rows, editing, keys, check.conflicts.map((c) => c.id)));
    stop();
  };
  // The capture handler is installed once per edit; it reads the latest state through this ref.
  const live = React.useRef({ strokes, assign });
  live.current = { strokes, assign };

  React.useEffect(() => {
    if (!editing) return;
    boxRef.current?.focus();
    setKeyCapture((e) => {
      // Tab keeps moving focus (the box cancels when focus leaves the row), so the keyboard is never trapped.
      if (e.key === "Tab") return;
      e.preventDefault();
      e.stopPropagation();
      const stroke = eventToKeys(e);
      if (!stroke) return;
      const step = captureStep(live.current.strokes, stroke);
      if (step.kind === "cancel") stop();
      else if (step.kind === "accept") live.current.assign();
      else setStrokes(step.strokes);
    });
    return () => setKeyCapture(null);
  }, [editing, stop]);

  // Leaving the tab ends a recording; showing it puts the cursor in the search box.
  React.useEffect(() => {
    if (!visible) stop();
    else filterRef.current?.focus();
  }, [visible, stop]);
  React.useEffect(() => editor.registerFocus(doc.id, () => filterRef.current?.focus()), [doc.id]);
  // Opened again from Settings' filter: show what was typed there.
  React.useEffect(() => bus.on("shortcuts.query", (q) => { setQuery(String(q ?? "")); setChangedOnly(false); }), []);

  const shown = sortKeyRows(listedRows(rows, query, changedOnly), sort);
  const changed = rows.filter(isChanged).length;
  const total = rows.filter((r) => !r.hidden).length;

  const resetAll = async () => {
    const ok = await askDialog("Restore all keyboard shortcuts?", `${changed} changed shortcut${changed === 1 ? "" : "s"} go back to the built-in keys.`, "Restore");
    if (!ok) return;
    stop();
    save({});
  };

  const grouped = sort === "category";
  let lastCategory = "";

  return (
    <div className="shortcuts-view" hidden={!visible}>
      <div className="shortcuts-toolbar">
        <div className="settings-filter shortcuts-filter">
          <Search size={13} className="settings-filter-icon" />
          <input
            ref={filterRef}
            className="input"
            placeholder="Search commands or keys"
            value={query}
            aria-label="Search keyboard shortcuts"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); setQuery(""); } }}
          />
          {query && (
            <button className="icon-btn xs settings-filter-clear" title="Clear search" onClick={() => { setQuery(""); filterRef.current?.focus(); }}>
              <X size={13} />
            </button>
          )}
        </div>
        <Select value={sort} options={SORTS} title="Sort shortcuts" size="sm" onChange={(v) => setSort(v as KeySort)} />
        <button className={`btn small toggle ${changedOnly ? "on" : ""}`} aria-pressed={changedOnly} onClick={() => setChangedOnly(!changedOnly)}>
          Changed only{changed ? ` (${changed})` : ""}
        </button>
        <button className="btn small" disabled={changed === 0} title={changed === 0 ? "Every shortcut is the built-in one" : "Put every shortcut back to its built-in keys"} onClick={() => changed > 0 && void resetAll()}>
          Restore all
        </button>
      </div>
      <div className="shortcuts-list" role="list">
        {shown.length === 0 && (
          <div className="panel-note">{changedOnly && !query ? "No shortcuts changed" : `No commands match “${query}”`}</div>
        )}
        {shown.map((r) => {
          const name = `${r.category}: ${r.title}`;
          const isEditing = editing === r.id;
          const header = grouped && r.category !== lastCategory ? r.category : null;
          lastCategory = r.category;
          return (
            <React.Fragment key={r.id}>
              {header && <div className="shortcut-group">{header}</div>}
              <div
                role="listitem"
                className={`shortcut-row ${isChanged(r) ? "changed" : ""} ${isEditing ? "editing" : ""}`}
                data-command={r.id}
                onBlur={(e) => { if (isEditing && !e.currentTarget.contains(e.relatedTarget as Node | null)) stop(); }}
                onDoubleClick={() => { if (!isEditing) { setStrokes([]); setEditing(r.id); } }}
              >
                <div className="shortcut-name">
                  <span>
                    {!grouped && <span className="shortcut-category"><MatchText text={r.category} query={query} />: </span>}
                    <MatchText text={r.title} query={query} />
                  </span>
                  {isEditing && (
                    <small role="status" className={check && !check.ok ? "shortcut-error" : ""}>
                      {!check
                        ? "Press the new keys. Enter accepts, Escape cancels, Backspace starts over; press a second combination for a two-key shortcut"
                        : !check.ok
                          ? check.error
                          : check.conflicts.length
                            ? `${prettyKeys(keys)} is the shortcut of ${check.conflicts.map((c) => c.title).join(", ")}. Assigning it here takes it away from ${check.conflicts.length === 1 ? "that command" : "those commands"}`
                            : "Press Enter to assign, or a second combination for a two-key shortcut"}
                    </small>
                  )}
                </div>
                {isEditing ? (
                  <div className="shortcut-actions">
                    <div ref={boxRef} className="shortcut-capture" tabIndex={0} role="textbox" aria-readonly="true" aria-label={`New shortcut for ${name}`}>
                      {strokes.length ? prettyKeys(keys) : "Press keys…"}
                    </div>
                    <button className="btn small btn-primary" disabled={!check?.ok} title={!check ? "Press the new keys first" : check.ok ? undefined : check.error} onClick={assign}>Assign</button>
                    <button className="btn small" onClick={stop}>Cancel</button>
                  </div>
                ) : (
                  <div className="shortcut-actions">
                    <span className="shortcut-keys">{r.keys ? <span className="kbd"><MatchText text={prettyKeys(r.keys)} query={query} /></span> : <span className="shortcut-none">None</span>}</span>
                    <button className="icon-btn xs" title="Change shortcut" aria-label={`Change the shortcut of ${name}`} onClick={() => { setStrokes([]); setEditing(r.id); }}>
                      <Pencil size={12} />
                    </button>
                    <button className="icon-btn xs" disabled={!r.keys} title={r.keys ? "Remove shortcut" : "No shortcut to remove"} aria-label={`Remove the shortcut of ${name}`} onClick={() => r.keys && save(withKeys(overrides, rows, r.id, ""))}>
                      <X size={13} />
                    </button>
                    <button
                      className="icon-btn xs"
                      disabled={!isChanged(r)}
                      title={isChanged(r) ? `Restore default (${r.defaultKeys ? prettyKeys(r.defaultKeys) : "none"})` : "Already the default"}
                      aria-label={`Restore the default shortcut of ${name}`}
                      onClick={() => isChanged(r) && save(restoreDefault(overrides, rows, r.id))}
                    >
                      <RotateCcw size={11} />
                    </button>
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div className="shortcuts-foot">
        {shown.length === total && !changedOnly ? `${total} commands` : `${shown.length} of ${total} commands`} · {changed === 0 ? "none changed" : `${changed} changed`} · double-click a row to change it
      </div>
    </div>
  );
}
