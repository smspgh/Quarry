import { ArrowDown, ArrowUp, Check, Keyboard, Pencil, Plus, Trash2, Type, X } from "lucide-react";
import { useState } from "react";
import { getCommand, prettyKeys } from "../../lib/commands";
import { describeStep } from "../../lib/macros";
import type { Macro, MacroStep } from "../../lib/types";

const IGNORED = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock", "ScrollLock", "Dead", "Process"]);

/** Editable list of a macro's steps: edit text, re-capture keys, reorder, delete, insert. */
export function MacroSteps({ macro, onChange }: { macro: Macro; onChange: (steps: MacroStep[]) => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const steps = macro.steps;

  const update = (next: MacroStep[]) => onChange(next);
  const replace = (i: number, step: MacroStep) => update(steps.map((s, k) => (k === i ? step : s)));
  const remove = (i: number) => update(steps.filter((_, k) => k !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  /** Display label: key steps use the same formatting as menu shortcuts, commands show their title. */
  const label = (s: MacroStep) => (s.type === "key" ? prettyKeys(describeStep(s)) : s.type === "command" ? `Command: ${getCommand(s.id)?.title ?? s.id}` : describeStep(s));
  const insert = (step: MacroStep, at = steps.length) => update([...steps.slice(0, at), step, ...steps.slice(at)]);

  const startEdit = (i: number) => {
    const s = steps[i];
    setEditing(i);
    setDraft(s.type === "input" ? s.text : "");
  };
  const commitText = (i: number) => {
    replace(i, { type: "input", text: draft });
    setEditing(null);
  };
  const captureKey = (i: number, e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setEditing(null);
      return;
    }
    if (IGNORED.has(e.key)) return;
    replace(i, { type: "key", key: e.key, code: e.nativeEvent.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
    setEditing(null);
  };

  return (
    <div className="macro-steps">
      {steps.length === 0 && <div className="muted" style={{ fontSize: 11.5 }}>No steps. Add a text or key step below.</div>}
      {steps.map((s, i) => (
        <div key={i} className={`macro-step ${editing === i ? "editing" : ""}`}>
          <span className="macro-step-n">{i + 1}.</span>
          {editing === i && s.type === "input" ? (
            <input
              autoFocus
              className="input mono"
              style={{ height: 24, fontSize: 11.5, flex: 1 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitText(i);
                if (e.key === "Escape") setEditing(null);
              }}
            />
          ) : editing === i && s.type === "key" ? (
            <input autoFocus className="input mono" style={{ height: 24, fontSize: 11.5, flex: 1 }} value="" placeholder="Press the new key combination… (Esc cancels)" onChange={() => {}} onKeyDown={(e) => captureKey(i, e)} />
          ) : (
            <span className="macro-step-text mono truncate" title={label(s)}>{label(s)}</span>
          )}
          {editing === i ? (
            <>
              {s.type === "input" && <button className="icon-btn xs" title="Apply" onClick={() => commitText(i)}><Check size={12} /></button>}
              <button className="icon-btn xs" title="Cancel" onClick={() => setEditing(null)}><X size={12} /></button>
            </>
          ) : (
            <>
              {s.type !== "command" && <button className="icon-btn xs" title={s.type === "input" ? "Edit text" : "Re-capture key"} onClick={() => startEdit(i)}><Pencil size={12} /></button>}
              <button className="icon-btn xs" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={12} /></button>
              <button className="icon-btn xs" title="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} /></button>
              <button className="icon-btn xs" title="Delete step" onClick={() => remove(i)}><Trash2 size={12} /></button>
            </>
          )}
        </div>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn small" title="Append a typed-text step" onClick={() => { insert({ type: "input", text: "" }); setEditing(steps.length); setDraft(""); }}><Plus size={12} /><Type size={12} /> Text</button>
        <button className="btn small" title="Append a key-press step" onClick={() => { insert({ type: "key", key: "Enter", code: "Enter", ctrl: false, shift: false, alt: false, meta: false }); setEditing(steps.length); }}><Plus size={12} /><Keyboard size={12} /> Key</button>
      </div>
    </div>
  );
}
