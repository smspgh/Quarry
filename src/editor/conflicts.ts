/**
 * Git conflicts in the editor: each `<<<<<<<` … `>>>>>>>` block gets its two sides tinted and a bar
 * above it with Accept Current / Accept Incoming / Accept Both. Parsing is in lib/conflicts.ts.
 */
import { RangeSetBuilder, StateField, type EditorState, type Extension, type Text, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
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
  constructor(readonly current: string, readonly incoming: string, readonly n: number, readonly total: number) {
    super();
  }
  eq(o: BarWidget) {
    return o.current === this.current && o.incoming === this.incoming && o.n === this.n && o.total === this.total;
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
    return bar;
  }
  ignoreEvent() {
    return true;
  }
}

function build(doc: Text, blocks: ConflictBlock[]): DecorationSet {
  if (!blocks.length) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  blocks.forEach((k, i) => {
    const at = (line: number) => doc.line(line + 1).from;
    b.add(at(k.start), at(k.start), Decoration.widget({ widget: new BarWidget(k.currentLabel, k.incomingLabel, i + 1, blocks.length), block: true, side: -1 }));
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

const conflictField = StateField.define<Conflicts>({
  create(state) {
    const blocks = scan(state.doc);
    return { blocks, deco: build(state.doc, blocks) };
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    if (!value.blocks.length && !mayAddConflict(tr)) return value;
    const blocks = scan(tr.state.doc);
    return { blocks, deco: build(tr.state.doc, blocks) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export function conflictsOf(state: EditorState): readonly ConflictBlock[] {
  return state.field(conflictField, false)?.blocks ?? [];
}

/** Replace one block with the chosen side(s), as one undo step. */
export function accept(view: EditorView, block: ConflictBlock, choice: ConflictChoice) {
  const doc = view.state.doc;
  const lines: string[] = [];
  for (let l = block.start; l <= block.end; l++) lines.push(doc.line(l + 1).text);
  const shift = (n: number | null) => (n === null ? null : n - block.start);
  const local: ConflictBlock = { ...block, start: 0, base: shift(block.base), mid: block.mid - block.start, end: block.end - block.start };
  const kept = resolvedLines(lines, local, choice);
  const from = doc.line(block.start + 1).from;
  let to = doc.line(block.end + 1).to;
  // Nothing kept (one side was empty): the block's line break goes too.
  if (!kept.length && to < doc.length) to += 1;
  view.dispatch({ changes: { from, to, insert: kept.join("\n") }, selection: { anchor: from }, userEvent: "input.conflict", scrollIntoView: true });
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
  const doc = view.state.doc;
  const changes = blocks.map((block) => {
    const lines: string[] = [];
    for (let l = block.start; l <= block.end; l++) lines.push(doc.line(l + 1).text);
    const shift = (n: number | null) => (n === null ? null : n - block.start);
    const kept = resolvedLines(lines, { ...block, start: 0, base: shift(block.base), mid: block.mid - block.start, end: block.end - block.start }, choice);
    const from = doc.line(block.start + 1).from;
    let to = doc.line(block.end + 1).to;
    if (!kept.length && to < doc.length) to += 1;
    return { from, to, insert: kept.join("\n") };
  });
  view.dispatch({ changes, userEvent: "input.conflict", scrollIntoView: true });
  return blocks.length;
}

/** Move the cursor to the next / previous conflict (wrapping). False when there is none. */
export function gotoConflict(view: EditorView, dir: 1 | -1): boolean {
  const blocks = conflictsOf(view.state);
  if (!blocks.length) return false;
  const line = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  const next = dir === 1 ? (blocks.find((b) => b.start > line) ?? blocks[0]) : ([...blocks].reverse().find((b) => b.start < line && b.end < line) ?? blocks[blocks.length - 1]);
  const pos = view.state.doc.line(next.start + 1).from;
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  view.focus();
  return true;
}

let onCleared: ((view: EditorView) => void) | null = null;
/** Called when an edit removes the last conflict of a document (set once, by the git layer). */
export function onConflictsCleared(fn: (view: EditorView) => void) {
  onCleared = fn;
}

export function conflictExtensions(): Extension {
  return [
    conflictField,
    EditorView.updateListener.of((u) => {
      if (u.docChanged && conflictsOf(u.startState).length > 0 && conflictsOf(u.state).length === 0) onCleared?.(u.view);
    }),
  ];
}
