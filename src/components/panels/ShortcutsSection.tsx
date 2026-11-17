import { Pencil, RotateCcw, X } from "lucide-react";
import React from "react";
import { askDialog, persistSettings } from "../../lib/actions";
import { bus } from "../../lib/bus";
import { eventToKeys, keyRows, prettyKeys, setKeyCapture } from "../../lib/commands";
import { captureStep, checkKeys, isChanged, keyRowMatches, restoreDefault, withKeys, type KeyOverrides, type KeyRow } from "../../lib/keybindings";
import { useStore } from "../../lib/store";
import { MENU_MNEMONICS } from "../MenuBar";

const HEADING = "Keyboard shortcuts";
const HINT = "Change, remove or restore the keys of any command. The filter above also finds commands by name or keys";

/** The rows the section lists: every command with a place in the palette, plus hidden ones the user's changes touched. */
export function listedRows(rows: KeyRow[], query: string, open: boolean): KeyRow[] {
  const visible = rows.filter((r) => !r.hidden || isChanged(r));
  if (query.trim()) return visible.filter((r) => keyRowMatches(query, r));
  return open ? visible : visible.filter(isChanged);
}

/**
 * Settings › Keyboard shortcuts (specs/settings.md SET-020). Collapsed it lists only the changed
 * shortcuts; "Show all" or the Settings filter lists commands. Changes go to `settings.keybindings`;
 * commands.ts applies them (`setKeyOverrides`).
 */
export function ShortcutsSection({ query }: { query: string }) {
  const overrides = useStore((s) => s.settings.keybindings);
  const update = useStore((s) => s.updateSettings);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [strokes, setStrokes] = React.useState<string[]>([]);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
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

  // View › Keyboard Shortcuts… opens the full list and brings it into view.
  React.useEffect(
    () =>
      bus.on("settings.shortcuts", () => {
        setOpen(true);
        window.setTimeout(() => rootRef.current?.scrollIntoView({ block: "start" }), 0);
      }),
    [],
  );

  const shown = listedRows(rows, query, open);
  const changed = rows.filter(isChanged).length;
  const total = rows.filter((r) => !r.hidden).length;
  const showHeading = `${HEADING} ${HINT}`.toLowerCase().includes(query.trim().toLowerCase());

  const resetAll = async () => {
    const ok = await askDialog("Restore all keyboard shortcuts?", `${changed} changed shortcut${changed === 1 ? "" : "s"} go back to the built-in keys.`, "Restore");
    if (!ok) return;
    stop();
    save({});
  };

  return (
    <div className="settings-section shortcuts-section" ref={rootRef}>
      <div className="section-title">{HEADING}</div>
      {showHeading && (
        <div className="field-row">
          <div className="field-label">
            <span>{changed === 0 ? "No shortcuts changed" : `${changed} shortcut${changed === 1 ? "" : "s"} changed`}</span>
            <small>{HINT}</small>
          </div>
          <div className="field-control">
            <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Show changed only" : `Show all ${total}`}</button>
            <button className="btn" disabled={changed === 0} title={changed === 0 ? "Every shortcut is the built-in one" : "Put every shortcut back to its built-in keys"} onClick={() => changed > 0 && void resetAll()}>Restore all</button>
          </div>
        </div>
      )}
      {shown.map((r) => {
        const name = `${r.category}: ${r.title}`;
        const isEditing = editing === r.id;
        return (
          <div
            key={r.id}
            className={`field-row shortcut-row ${isChanged(r) ? "changed" : ""}`}
            data-command={r.id}
            onBlur={(e) => { if (isEditing && !e.currentTarget.contains(e.relatedTarget as Node | null)) stop(); }}
          >
            <div className="field-label">
              <span>{name}</span>
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
              <div className="field-control">
                <div ref={boxRef} className="shortcut-capture" tabIndex={0} role="textbox" aria-readonly="true" aria-label={`New shortcut for ${name}`}>
                  {strokes.length ? prettyKeys(keys) : "Press keys…"}
                </div>
                <button className="btn primary" disabled={!check?.ok} title={!check ? "Press the new keys first" : check.ok ? undefined : check.error} onClick={assign}>Assign</button>
                <button className="btn" onClick={stop}>Cancel</button>
              </div>
            ) : (
              <div className="field-control">
                {r.keys ? <span className="kbd">{prettyKeys(r.keys)}</span> : <span className="shortcut-none">None</span>}
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
        );
      })}
    </div>
  );
}
