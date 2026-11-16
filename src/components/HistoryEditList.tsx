import { CornerLeftDown, GripVertical, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { relativeTime } from "../editor/git";
import { choose } from "../lib/dialogs";
import { closeHistoryEdit, openHistoryEdit, runHistoryEdit, useGit } from "../lib/git";
import type { GitHistoryRange } from "../lib/gitApi";
import { allDropped, boxMessage, finalMessage, foldedInto, hasGroupBox, initialPlan, listWords, moveRow, NO_FOLD, planChanged, planProblems, ROW_ACTIONS, setAction, setMessage, squashTarget, type PlanRow, type RowAction } from "../lib/historyEdit";
import { Select } from "./Select";

/**
 * The Edit History list (specs/git-history-edit.md, HISTORY-007 to HISTORY-009): the commits from
 * a chosen one up to the tip, newest first, each with an action, to reorder and mark before
 * anything is rewritten. It takes the place of the graph's rows until Run or Cancel. Its keys (P,
 * R, S, F, D, arrows, Alt+arrows, Ctrl+Enter, Escape) are handled here and only while the list
 * element itself has the focus: not in its message boxes, not anywhere else in the app.
 */
export function HistoryEditList({ root, range, visible }: { root: string; range: GitHistoryRange; visible: boolean }) {
  const busy = useGit((s) => s.busy);
  const original = range.commits;
  const [rows, setRows] = useState<PlanRow[]>(() => initialPlan(original));
  const [sel, setSel] = useState(0);
  /** The row (commit id) whose reword box is open. */
  const [editing, setEditing] = useState<string | null>(null);
  /** While a row is dragged: its index and the index it would land on. */
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [running, setRunning] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (visible) listRef.current?.focus();
  }, [visible]);

  const words = useMemo(() => listWords(range), [range]);
  const problems = planProblems(rows);
  const changed = planChanged(rows, original);
  const everything = allDropped(rows);
  const touched = changed || rows.some((r) => r.action !== "pick" || r.reword !== null || r.joined !== null);
  const canRun = changed && problems.size === 0 && !everything && !busy && !running;
  const branch = range.branch ?? "the branch";

  const focusList = () => listRef.current?.focus();
  const act = (i: number, action: RowAction) => {
    const next = setAction(rowsRef.current, i, action);
    if (next === rowsRef.current) return;
    setRows(next);
    setEditing(action === "reword" && !hasGroupBox(next, i) ? next[i].commit.sha : null);
  };
  const move = (from: number, to: number) => {
    const next = moveRow(rowsRef.current, from, to);
    if (next === rowsRef.current) return;
    setRows(next);
    setSel(to);
  };
  const reveal = (i: number) => listRef.current?.querySelectorAll<HTMLElement>(".he-row")[i]?.scrollIntoView?.({ block: "nearest" });

  const cancel = async () => {
    if (touched) {
      const discard = await choose("Discard this plan?", "Nothing has been rewritten. The choices you made in the list are forgotten.", [
        { label: "Discard", kind: "danger", value: true },
        { label: "Keep Editing", cancel: true, default: true, value: false },
      ], false);
      if (!discard) {
        focusList();
        return;
      }
    }
    closeHistoryEdit(root);
  };
  const run = async () => {
    if (!canRun) return;
    setRunning(true);
    const result = await runHistoryEdit(root, range, rowsRef.current);
    setRunning(false);
    if (result === "done" || result === "stopped") closeHistoryEdit(root);
    // The branch changed while the list was open: start again from the same commit, every row Pick.
    else if (result === "moved" && !(await openHistoryEdit(root, original[original.length - 1].sha))) closeHistoryEdit(root);
  };

  /** The list's own keys: only with the focus on the list itself (a message box or the action picker has its own). */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    const letter = plain && !e.shiftKey ? ROW_ACTIONS.find((a) => a.key === e.key.toLowerCase()) : undefined;
    if (e.key === "Escape") void cancel();
    else if (e.key === "Enter" && e.ctrlKey) void run();
    else if (e.key === "Enter" && plain && rows[sel]?.action === "reword" && !hasGroupBox(rows, sel)) setEditing(rows[sel].commit.sha);
    else if (e.altKey && !e.ctrlKey && e.key === "ArrowDown") move(sel, sel + 1);
    else if (e.altKey && !e.ctrlKey && e.key === "ArrowUp") move(sel, sel - 1);
    else if (plain && e.key === "ArrowDown") { setSel(Math.min(rows.length - 1, sel + 1)); reveal(Math.min(rows.length - 1, sel + 1)); }
    else if (plain && e.key === "ArrowUp") { setSel(Math.max(0, sel - 1)); reveal(Math.max(0, sel - 1)); }
    else if (plain && e.key === "Home") setSel(0);
    else if (plain && e.key === "End") setSel(rows.length - 1);
    else if (letter) act(sel, letter.value);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  /** Drag a row by its handle: a line shows where it lands; the list scrolls near its edges. */
  const startDrag = (e: React.PointerEvent, from: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setSel(from);
    const list = listRef.current;
    if (!list) return;
    let to = from;
    const at = (y: number) => {
      const els = [...list.querySelectorAll<HTMLElement>(".he-item")];
      let i = els.findIndex((el) => y < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2);
      if (i < 0) i = els.length;
      // Dropping below itself: the row leaves its place first.
      return Math.max(0, Math.min(els.length - 1, i > from ? i - 1 : i));
    };
    // Near an edge the list keeps scrolling while the pointer rests there (every 40 ms), not only
    // while it moves; the landing line follows.
    let lastY = e.clientY;
    const edgeStep = () => {
      const r = list.getBoundingClientRect();
      return lastY < r.top + 24 ? -12 : lastY > r.bottom - 24 ? 12 : 0;
    };
    const tick = window.setInterval(() => {
      const step = edgeStep();
      if (!step) return;
      const before = list.scrollTop;
      list.scrollTop += step;
      if (list.scrollTop === before) return;
      to = at(lastY);
      setDrag({ from, to });
    }, 40);
    const onMove = (ev: PointerEvent) => {
      lastY = ev.clientY;
      to = at(ev.clientY);
      setDrag({ from, to });
    };
    const onUp = () => {
      window.clearInterval(tick);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      move(from, to);
      focusList();
    };
    setDrag({ from, to });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const options = (i: number) => ROW_ACTIONS.map((a) => ({ value: a.value, label: a.label, hint: a.hint, disabled: (a.value === "squash" || a.value === "fixup") && i === rows.length - 1 ? NO_FOLD : undefined }));

  return (
    <div className="history-edit" aria-label="Edit history">
      <div className="he-head">
        <span className="he-title">{words.head}</span>
        <span className="muted he-keys" title="With the list focused: Up / Down select a row, Alt+Up / Alt+Down move it, P R S F D set its action, Ctrl+Enter runs, Escape cancels">P pick · R reword · S squash · F fixup · D drop · Alt+↑↓ move</span>
      </div>
      {words.warning && (
        <div className="graph-strip warn he-warning" role="status">
          <TriangleAlert size={14} />
          <span className="grow">{words.warning}</span>
        </div>
      )}
      <div ref={listRef} className="he-list" role="listbox" aria-label="Commits to edit, newest first" tabIndex={0} data-history-keys onKeyDown={onKeyDown}>
        {rows.map((r, i) => {
          const c = r.commit;
          const fold = r.action === "squash" || r.action === "fixup";
          const target = fold ? squashTarget(rows, i) : -1;
          const problem = problems.get(i);
          const message = finalMessage(rows, i);
          const group = hasGroupBox(rows, i);
          const box = group || (r.action === "reword" && editing === c.sha);
          const reworded = !group && message !== null;
          const landing = drag && drag.from !== drag.to && drag.to === i ? (drag.to > drag.from ? "drop-after" : "drop-before") : "";
          return (
            <div key={c.sha} className={`he-item ${landing}`}>
              <div
                role="option"
                aria-selected={i === sel}
                className={`he-row ${i === sel ? "selected" : ""} ${r.action} ${fold ? "fold" : ""} ${drag?.from === i ? "dragging" : ""}`}
                onMouseDown={() => setSel(i)}
              >
                <span className="he-handle" title="Drag to reorder (or Alt+Up / Alt+Down)" onPointerDown={(e) => startDrag(e, i)}><GripVertical size={14} /></span>
                <Select className="he-action" size="sm" value={r.action} options={options(i)} onChange={(v) => { act(i, v as RowAction); if (v !== "reword") setTimeout(focusList, 0); }} title={ROW_ACTIONS.find((a) => a.value === r.action)?.hint} />
                {fold && <span className="he-arrow" title={target >= 0 ? `Folds into ${rows[target].commit.short} ${rows[target].commit.summary}` : undefined}><CornerLeftDown size={13} />{target >= 0 && <span className="mono">{rows[target].commit.short}</span>}</span>}
                <span className="mono he-sha" title={c.sha}>{c.short}</span>
                <span
                  className="he-msg truncate"
                  title={reworded ? `Was: ${c.message}` : c.message}
                  onDoubleClick={() => r.action === "reword" && !group && setEditing(c.sha)}
                >
                  {reworded ? message!.split("\n")[0] : c.summary}
                </span>
                {reworded && <span className="he-badge reworded" title={`Was: ${c.message}`}>reworded</span>}
                {foldedInto(rows, i).length > 0 && <span className="he-badge" title="Commits above are folded into this one">+{foldedInto(rows, i).length}</span>}
                {c.pushed && <span className="he-badge pushed" title={`Already on ${range.pushedOn ?? "a remote branch"}`}>pushed</span>}
                {problem && <span className="he-problem" role="alert">{problem}</span>}
                <span className="he-author truncate" title={`${c.author} <${c.email}>`}>{c.author}</span>
                <span className="he-date truncate" title={new Date(c.time * 1000).toLocaleString()}>{relativeTime(c.time)}</span>
              </div>
              {box && (
                <textarea
                  className="input he-box"
                  aria-label={group ? `Message for ${c.short} and the commits squashed into it` : `New message for ${c.short}`}
                  spellCheck={false}
                  rows={Math.min(8, Math.max(2, boxMessage(rows, i).split("\n").length))}
                  value={boxMessage(rows, i)}
                  autoFocus={!group}
                  // The caret goes after the message (a click still puts it where it lands).
                  onFocus={(e) => {
                    const n = e.currentTarget.value.length;
                    e.currentTarget.setSelectionRange(n, n);
                  }}
                  onChange={(e) => setRows(setMessage(rowsRef.current, i, e.target.value))}
                  onBlur={() => !group && setEditing((cur) => (cur === c.sha ? null : cur))}
                  onKeyDown={(e) => {
                    // Everything typed here is text; Ctrl+Enter and Escape leave the box.
                    if ((e.key === "Enter" && e.ctrlKey) || e.key === "Escape") {
                      e.preventDefault();
                      focusList();
                    }
                    e.stopPropagation();
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="he-foot">
        <span className="he-below truncate">{words.foot}</span>
        {everything && <span className="he-note" role="status">To remove all of these commits, use Reset {branch} to Here on {range.base?.short ?? "an earlier commit"}</span>}
        <span className="grow" />
        <button className="btn small" disabled={!touched || running} title="Every row back to Pick, in the original order, with its original message" onClick={() => { setRows(initialPlan(original)); setEditing(null); focusList(); }}>Reset List</button>
        <button className="btn small" disabled={running} title="Close the list; nothing is rewritten (Escape)" onClick={() => void cancel()}>Cancel</button>
        <button className="btn small btn-primary" disabled={!canRun} title={canRun ? "Show what will be rewritten, then run it (Ctrl+Enter)" : busy ? "Another git action is running" : problems.size ? "Fix the marked rows first" : everything ? "Dropping every commit is a reset, not a history edit" : "Nothing is changed yet"} onClick={() => void run()}>Run</button>
      </div>
    </div>
  );
}
