/**
 * Git conflicts in the editor: each `<<<<<<<` … `>>>>>>>` block gets its two sides tinted and a bar
 * above it with Accept Current / Accept Incoming / Accept Both. Parsing is in lib/conflicts.ts.
 */
import { Prec, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension, type Text, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from "@codemirror/view";
import { parseConflicts, resolvedLines, sideLabel, type ConflictBlock, type ConflictChoice } from "../lib/conflicts";

/** Larger documents are not scanned (a conflicted file that size is not edited by hand anyway). */
const MAX_SCAN = 4_000_000;
const MARK = "<<<<<<<";

interface Conflicts {
  blocks: ConflictBlock[];
  deco: DecorationSet;
}

function scan(doc: Text): ConflictBlock[] {
  if (doc.length > MAX_SCAN) return [];
  const lines: string[] = [];
  let any = false;
  for (const line of doc.iterLines()) {
    if (!any && line.startsWith(MARK)) any = true;
    lines.push(line);
  }
  return any ? parseConflicts(lines) : [];
}

const lineDeco = (cls: string) => Decoration.line({ class: cls });
const D = {
  startMark: lineDeco("cm-conflict-mark cm-conflict-current"),
  current: lineDeco("cm-conflict-current"),
  baseMark: lineDeco("cm-conflict-mark cm-conflict-base"),
  base: lineDeco("cm-conflict-base"),
  midMark: lineDeco("cm-conflict-mark"),
  incoming: lineDeco("cm-conflict-incoming"),
  endMark: lineDeco("cm-conflict-mark cm-conflict-incoming"),
};

class BarWidget extends WidgetType {
  /** `explain`: null = no Explain button (Claude Code is off); "" = shown; else shown disabled, with this as its tooltip. */
  constructor(readonly current: string, readonly incoming: string, readonly n: number, readonly total: number, readonly note: string, readonly explain: string | null = null) {
    super();
  }
  eq(o: BarWidget) {
    return o.current === this.current && o.incoming === this.incoming && o.n === this.n && o.total === this.total && o.note === this.note && o.explain === this.explain;
  }
  toDOM(view: EditorView) {
    const bar = document.createElement("div");
    bar.className = "cm-conflict-bar";
    const act = (label: string, title: string, choice: ConflictChoice, cls: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `cm-conflict-btn ${cls}`;
      b.textContent = label;
      b.title = title;
      // The editor keeps focus and the selection.
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => {
        const line = view.state.doc.lineAt(view.posAtDOM(bar)).number - 1;
        const block = conflictsOf(view.state).find((x) => x.start === line);
        if (block) accept(view, block, choice);
      };
      bar.appendChild(b);
    };
    const count = document.createElement("span");
    count.className = "cm-conflict-count";
    count.textContent = `Conflict ${this.n} of ${this.total}`;
    bar.appendChild(count);
    act("Accept Current", `Keep ${sideLabel("current", this.current)}: what your branch has`, "current", "current");
    act("Accept Incoming", `Keep ${sideLabel("incoming", this.incoming)}: what is being brought in`, "incoming", "incoming");
    act("Accept Both", "Keep both, current first", "both", "both");
    if (hooks.compare) {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "cm-conflict-btn";
      c.textContent = "Compare";
      c.title = "Open the two sides of this conflict next to each other";
      c.onmousedown = (e) => e.preventDefault();
      c.onclick = () => {
        const line = view.state.doc.lineAt(view.posAtDOM(bar)).number - 1;
        const block = conflictsOf(view.state).find((x) => x.start === line);
        if (block) hooks.compare?.(view, block, this.n);
      };
      bar.appendChild(c);
    }
    // Claude git helpers: Explain, after Compare, only while Claude Code is switched on.
    if (this.explain !== null && hooks.explain) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "cm-conflict-btn explain";
      x.textContent = "Explain";
      x.title = this.explain || EXPLAIN_TITLE;
      x.disabled = !!this.explain;
      x.onmousedown = (e) => e.preventDefault();
      x.onclick = () => {
        const line = view.state.doc.lineAt(view.posAtDOM(bar)).number - 1;
        const block = conflictsOf(view.state).find((b) => b.start === line);
        if (block) hooks.explain?.(view, block, this.n);
      };
      bar.appendChild(x);
    }
    if (this.note) {
      const note = document.createElement("span");
      note.className = "cm-conflict-note";
      note.textContent = this.note;
      bar.appendChild(note);
    }
    return bar;
  }
  ignoreEvent() {
    return true;
  }
}

function build(doc: Text, blocks: ConflictBlock[]): DecorationSet {
  if (!blocks.length) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  const note = hooks.note?.() ?? "";
  const explain = hooks.explain ? (hooks.explainBlocked?.() ?? "") : null;
  blocks.forEach((k, i) => {
    const at = (line: number) => doc.line(line + 1).from;
    b.add(at(k.start), at(k.start), Decoration.widget({ widget: new BarWidget(k.currentLabel, k.incomingLabel, i + 1, blocks.length, note, explain), block: true, side: -1 }));
    b.add(at(k.start), at(k.start), D.startMark);
    for (let l = k.start + 1; l < (k.base ?? k.mid); l++) b.add(at(l), at(l), D.current);
    if (k.base !== null) {
      b.add(at(k.base), at(k.base), D.baseMark);
      for (let l = k.base + 1; l < k.mid; l++) b.add(at(l), at(l), D.base);
    }
    b.add(at(k.mid), at(k.mid), D.midMark);
    for (let l = k.mid + 1; l < k.end; l++) b.add(at(l), at(l), D.incoming);
    b.add(at(k.end), at(k.end), D.endMark);
  });
  return b.finish();
}

/** Typing in a document without conflicts costs nothing: it is only rescanned when a marker is inserted. */
function mayAddConflict(tr: Transaction): boolean {
  let found = false;
  tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
    if (!found && inserted.length >= MARK.length && (inserted.length > 20_000 || inserted.toString().includes(MARK))) found = true;
  });
  return found;
}

/** Redraw the conflict bars and suggestion panels of a document (what the hooks answer has changed). */
export const redrawConflicts = StateEffect.define<null>();

const conflictField = StateField.define<Conflicts>({
  create(state) {
    const blocks = scan(state.doc);
    return { blocks, deco: build(state.doc, blocks) };
  },
  update(value, tr) {
    // The bars' own content changed (the sides note, the Explain button): redraw them as they are.
    if (!tr.docChanged) return value.blocks.length && tr.effects.some((e) => e.is(redrawConflicts)) ? { blocks: value.blocks, deco: build(tr.state.doc, value.blocks) } : value;
    if (!value.blocks.length && !mayAddConflict(tr)) return value;
    const blocks = scan(tr.state.doc);
    return { blocks, deco: build(tr.state.doc, blocks) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export function conflictsOf(state: EditorState): readonly ConflictBlock[] {
  return state.field(conflictField, false)?.blocks ?? [];
}

/** The change that replaces one block with the chosen side(s). */
export function resolveChange(doc: Text, block: ConflictBlock, choice: ConflictChoice): { from: number; to: number; insert: string } {
  const lines: string[] = [];
  for (let l = block.start; l <= block.end; l++) lines.push(doc.line(l + 1).text);
  const shift = (n: number | null) => (n === null ? null : n - block.start);
  const local: ConflictBlock = { ...block, start: 0, base: shift(block.base), mid: block.mid - block.start, end: block.end - block.start };
  const kept = resolvedLines(lines, local, choice);
  const from = doc.line(block.start + 1).from;
  let to = doc.line(block.end + 1).to;
  // Nothing kept (one side was empty): the block's line break goes too.
  if (!kept.length && to < doc.length) to += 1;
  return { from, to, insert: kept.join("\n") };
}

/** Replace one block with the chosen side(s), as one undo step. */
export function accept(view: EditorView, block: ConflictBlock, choice: ConflictChoice) {
  const change = resolveChange(view.state.doc, block, choice);
  view.dispatch({ changes: change, selection: { anchor: change.from }, userEvent: "input.conflict", scrollIntoView: true });
}

/** The block the cursor is in, else the next one below it, else the first. */
export function conflictAtCursor(state: EditorState): ConflictBlock | null {
  const blocks = conflictsOf(state);
  if (!blocks.length) return null;
  const line = state.doc.lineAt(state.selection.main.head).number - 1;
  return blocks.find((b) => line >= b.start && line <= b.end) ?? blocks.find((b) => b.start > line) ?? blocks[0];
}

/** Resolve every block in the document one way, as one undo step. Returns how many there were. */
export function acceptAll(view: EditorView, choice: ConflictChoice): number {
  const blocks = [...conflictsOf(view.state)];
  if (!blocks.length) return 0;
  const changes = blocks.map((block) => resolveChange(view.state.doc, block, choice));
  view.dispatch({ changes, userEvent: "input.conflict", scrollIntoView: true });
  return blocks.length;
}

/** The next / previous conflict from the cursor (wrapping); null when there is none. */
export function nextConflict(state: EditorState, dir: 1 | -1): ConflictBlock | null {
  const blocks = conflictsOf(state);
  if (!blocks.length) return null;
  const line = state.doc.lineAt(state.selection.main.head).number - 1;
  return dir === 1 ? (blocks.find((b) => b.start > line) ?? blocks[0]) : ([...blocks].reverse().find((b) => b.start < line && b.end < line) ?? blocks[blocks.length - 1]);
}

/** Move the cursor to the next / previous conflict (wrapping). False when there is none. */
export function gotoConflict(view: EditorView, dir: 1 | -1): boolean {
  const next = nextConflict(view.state, dir);
  if (!next) return false;
  const pos = view.state.doc.line(next.start + 1).from;
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  view.focus();
  return true;
}

export interface ConflictHooks {
  /** An edit removed the last conflict of a document. */
  cleared?: (view: EditorView) => void;
  /** The bar's Compare button: show the two sides of block `n` side by side. */
  compare?: (view: EditorView, block: ConflictBlock, n: number) => void;
  /** A hint shown in each bar (which side is which during a rebase); "" for none. */
  note?: () => string;
  /** The bar's Explain button (Claude git helpers); unset or null = no button. */
  explain?: ((view: EditorView, block: ConflictBlock, n: number) => void) | null;
  /** Why Explain cannot run now (another Claude request is running), else null. */
  explainBlocked?: () => string | null;
  /** The request behind a suggestion panel is no longer wanted (Stop, or the conflict was edited). */
  stopExplain?: () => void;
}
const hooks: ConflictHooks = {};
/** Wired once by the git layer, which knows the repository and can open tabs. */
export function setConflictHooks(h: ConflictHooks) {
  Object.assign(hooks, h);
}

export function conflictExtensions(): Extension {
  return [
    conflictField,
    suggestionField,
    EditorView.updateListener.of((u) => {
      if (u.docChanged && conflictsOf(u.startState).length > 0 && conflictsOf(u.state).length === 0) hooks.cleared?.(u.view);
      // A conflict edited (or resolved) while Claude was still reading it: that request is not wanted any more.
      if (u.docChanged && suggestionsOf(u.startState).some((s) => s.status === "working") && !suggestionsOf(u.state).some((s) => s.status === "working")) hooks.stopExplain?.();
    }),
    Prec.high(keymap.of([{ key: "Escape", run: discardAtCursor }])),
  ];
}

// ---------- Claude's suggestion for one conflict (specs/git-claude.md, GITAI-007 / 008) ----------

const EXPLAIN_TITLE = "Ask Claude to explain this conflict and suggest a resolution. The conflict and the lines around it are sent to Claude.";
export const CONFLICT_CHANGED_ASKING = "The conflict changed. Click Explain to ask again.";
export const CONFLICT_CHANGED_SINCE = "The conflict changed since this was written.";

/** The panel under a conflict: Claude at work, its explanation and proposal, or why there is none. */
export interface Suggestion {
  /** Start of the conflict's `<<<<<<<` line; follows the conflict through edits. */
  pos: number;
  /** "stale": the conflict was edited while Claude was reading it. */
  status: "working" | "done" | "error" | "stale";
  /** When the request started (the working line counts up from it). */
  startedAt: number;
  /** The conflict's text when Claude was asked. */
  asked: string;
  explanation: string;
  /** The lines proposed in place of the whole block; null = none offered. */
  resolution: string | null;
  /** Why a proposal is not offered, or "". */
  note: string;
  error: string;
  /** The conflict's text is no longer what Claude saw: the proposal cannot be applied. */
  changed: boolean;
}

/** Put a suggestion on the conflict starting at `pos` (replacing the one it has). */
export const setSuggestion = StateEffect.define<Suggestion>({ map: (s, m) => ({ ...s, pos: m.mapPos(s.pos, 1) }) });
/** Remove the suggestion at a position, or every one (null). */
export const dropSuggestion = StateEffect.define<number | null>({ map: (p, m) => (p === null ? null : m.mapPos(p, 1)) });

/** The text of a block, markers included. */
export function blockText(doc: Text, b: ConflictBlock): string {
  return doc.sliceString(doc.line(b.start + 1).from, doc.line(b.end + 1).to);
}

const blockAt = (state: EditorState, pos: number): ConflictBlock | undefined => conflictsOf(state).find((b) => state.doc.line(b.start + 1).from === pos);

class PanelWidget extends WidgetType {
  constructor(readonly s: Suggestion, readonly current: string, readonly incoming: string, readonly note: string) {
    super();
  }
  eq(o: PanelWidget) {
    const a = this.s;
    const b = o.s;
    return a.status === b.status && a.startedAt === b.startedAt && a.explanation === b.explanation && a.resolution === b.resolution && a.note === b.note && a.error === b.error && a.changed === b.changed && o.current === this.current && o.incoming === this.incoming && o.note === this.note;
  }
  toDOM(view: EditorView) {
    const s = this.s;
    const el = (tag: string, cls: string, text = "") => {
      const e = document.createElement(tag);
      e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    const panel = el("div", `cm-conflict-suggestion ${s.status}`);
    // The conflict this panel belongs to, looked up when a button is used (edits move it).
    const here = () => {
      const line = view.state.doc.lineAt(view.posAtDOM(panel)).number - 1;
      return conflictsOf(view.state).find((b) => b.end === line);
    };
    const posOf = (b: ConflictBlock) => view.state.doc.line(b.start + 1).from;
    const button = (label: string, title: string, run: (b: ConflictBlock) => void, cls = "") => {
      const b = el("button", `cm-conflict-btn ${cls}`, label) as HTMLButtonElement;
      b.type = "button";
      b.title = title;
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => {
        const block = here();
        if (block) run(block);
      };
      return b;
    };
    const close = (label: string) => button(label, "Close this panel; the conflict stays as it is", (b) => view.dispatch({ effects: dropSuggestion.of(posOf(b)) }));

    const head = el("div", "cm-conflict-suggestion-head");
    head.appendChild(el("span", "cm-conflict-suggestion-sides", `${sideLabel("current", this.current)} · ${sideLabel("incoming", this.incoming)}`));
    if (this.note) head.appendChild(el("span", "cm-conflict-note", this.note));
    panel.appendChild(head);
    const actions = el("div", "cm-conflict-suggestion-actions");

    if (s.status === "working") {
      const line = el("div", "cm-conflict-suggestion-working");
      const text = el("span", "");
      const tick = () => {
        text.textContent = `Claude is reading this conflict… ${Math.max(0, Math.floor((Date.now() - s.startedAt) / 1000))}s`;
      };
      tick();
      (panel as HTMLElement & { timer?: number }).timer = window.setInterval(tick, 1000);
      line.appendChild(text);
      line.appendChild(
        button("Stop", "Stop this request; nothing is changed", (b) => {
          hooks.stopExplain?.();
          view.dispatch({ effects: dropSuggestion.of(posOf(b)) });
        }),
      );
      panel.appendChild(line);
      return panel;
    }
    if (s.status === "stale") {
      panel.appendChild(el("div", "cm-conflict-suggestion-note", CONFLICT_CHANGED_ASKING));
      actions.appendChild(close("Close"));
    } else if (s.status === "error") {
      panel.appendChild(el("div", "cm-conflict-suggestion-error", s.error));
      actions.appendChild(button("Try Again", "Ask Claude about this conflict again", (b) => hooks.explain?.(view, b, conflictsOf(view.state).indexOf(b) + 1)));
      actions.appendChild(close("Close"));
    } else {
      panel.appendChild(el("div", "cm-conflict-suggestion-text", s.explanation));
      if (s.resolution !== null) {
        panel.appendChild(el("div", "cm-conflict-suggestion-label", "Suggested resolution"));
        const pre = el("pre", "cm-conflict-suggestion-code");
        // An empty proposal means: remove both sides.
        pre.textContent = s.resolution === "" ? "(remove these lines)" : s.resolution;
        panel.appendChild(pre);
        if (s.changed) panel.appendChild(el("div", "cm-conflict-suggestion-note", CONFLICT_CHANGED_SINCE));
        const apply = button("Apply Suggestion", "Replace the whole conflict with these lines. One undo step; nothing is saved or staged.", (b) => void applySuggestion(view, b), "apply");
        apply.disabled = s.changed;
        actions.appendChild(apply);
        actions.appendChild(close("Discard"));
      } else {
        if (s.note) panel.appendChild(el("div", "cm-conflict-suggestion-note", s.note));
        actions.appendChild(close("Close"));
      }
    }
    panel.appendChild(actions);
    return panel;
  }
  destroy(dom: HTMLElement) {
    const t = (dom as HTMLElement & { timer?: number }).timer;
    if (t !== undefined) window.clearInterval(t);
  }
  ignoreEvent() {
    return true;
  }
}

interface Suggestions {
  list: Suggestion[];
  deco: DecorationSet;
}

function buildPanels(state: EditorState, list: Suggestion[]): DecorationSet {
  if (!list.length) return Decoration.none;
  const note = hooks.note?.() ?? "";
  const b = new RangeSetBuilder<Decoration>();
  for (const s of [...list].sort((x, y) => x.pos - y.pos)) {
    const block = blockAt(state, s.pos);
    if (!block) continue;
    const at = state.doc.line(block.end + 1).to;
    b.add(at, at, Decoration.widget({ widget: new PanelWidget(s, block.currentLabel, block.incomingLabel, note), block: true, side: 1 }));
  }
  return b.finish();
}

// Declared after conflictField in `conflictExtensions`, so the blocks it reads are already current.
const suggestionField = StateField.define<Suggestions>({
  create: () => ({ list: [], deco: Decoration.none }),
  update(value, tr) {
    let list = value.list;
    let touched = false;
    if (tr.docChanged && list.length) {
      touched = true;
      list = list
        .map((s) => ({ ...s, pos: tr.changes.mapPos(s.pos, 1) }))
        // A suggestion goes with its conflict: resolved any way, its panel closes.
        .filter((s) => blockAt(tr.state, s.pos))
        .map((s) => {
          const changed = blockText(tr.state.doc, blockAt(tr.state, s.pos)!) !== s.asked;
          // Edited while Claude was reading: the answer would be about text that is gone.
          if (s.status === "working") return changed ? { ...s, status: "stale" as const, changed } : s;
          return s.changed === changed ? s : { ...s, changed };
        });
    }
    for (const e of tr.effects) {
      if (e.is(setSuggestion)) {
        touched = true;
        list = [...list.filter((s) => s.pos !== e.value.pos), e.value];
      } else if (e.is(dropSuggestion)) {
        touched = true;
        list = e.value === null ? [] : list.filter((s) => s.pos !== e.value);
      } else if (e.is(redrawConflicts)) touched = true;
    }
    return touched ? { list, deco: buildPanels(tr.state, list) } : value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export function suggestionsOf(state: EditorState): readonly Suggestion[] {
  return state.field(suggestionField, false)?.list ?? [];
}

/** The suggestion of a conflict, if it has one. */
export function suggestionFor(state: EditorState, block: ConflictBlock): Suggestion | undefined {
  const pos = state.doc.line(block.start + 1).from;
  return suggestionsOf(state).find((s) => s.pos === pos);
}

/** The change that puts a suggested resolution in place of the whole block, markers (and base section) included. */
export function suggestionChange(doc: Text, block: ConflictBlock, resolution: string): { from: number; to: number; insert: string } {
  const insert = resolution.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const from = doc.line(block.start + 1).from;
  let to = doc.line(block.end + 1).to;
  // Nothing proposed in its place: the block's line break goes too.
  if (!insert && to < doc.length) to += 1;
  return { from, to, insert };
}

/** Apply a conflict's suggestion as one undo step. Nothing is saved or staged. False when it cannot be applied. */
export function applySuggestion(view: EditorView, block: ConflictBlock): boolean {
  const s = suggestionFor(view.state, block);
  if (!s || s.status !== "done" || s.resolution === null || s.changed) return false;
  const change = suggestionChange(view.state.doc, block, s.resolution);
  view.dispatch({ changes: change, selection: { anchor: change.from }, userEvent: "input.conflict", scrollIntoView: true });
  return true;
}

/** Escape with the cursor in a conflict that has a panel: close it (stopping a request still running). */
function discardAtCursor(view: EditorView): boolean {
  if (!suggestionsOf(view.state).length) return false;
  const line = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  const block = conflictsOf(view.state).find((b) => line >= b.start && line <= b.end);
  const s = block && suggestionFor(view.state, block);
  if (!s) return false;
  if (s.status === "working") hooks.stopExplain?.();
  view.dispatch({ effects: dropSuggestion.of(s.pos) });
  return true;
}
