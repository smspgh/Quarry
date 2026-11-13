/**
 * Owns the editor views (one per pane of the split editor) and one EditorState per open text
 * document. Switching tabs swaps states; this keeps memory per document minimal and makes undo
 * history, selection and scroll position survive tab switches. `view` / `currentDocId` are the
 * focused pane's.
 *
 * The same document can show in both panes: the second pane gets a copy of the state, edits are
 * copied between the two (`paneSync`), and only the pane that showed the document first (`owner`)
 * keeps the undo history; Undo / Redo in the other pane run there.
 */
import { Annotation, countColumn, EditorState, Prec, Text, Transaction, type Extension, type StateEffect, type TransactionSpec } from "@codemirror/state";
import { resultHighlight, resultQuery, setResultQuery } from "./resultHighlight";
import { EditorView, keymap, ViewUpdate } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { setDiagnostics } from "@codemirror/lint";
import { paneDocId, useStore } from "../lib/store";
import type { Settings } from "../lib/types";
import { baseExtensions, compartments, detectLanguage, flashRange, languageByName, settingsReconfigure, sniffLanguage } from "./cmSetup";
import { columnModeExtensions, setColumnMode } from "./columnMode";
import { gitExtensions } from "./git";
import { conflictExtensions } from "./conflicts";

export interface RecorderHooks {
  onKeydown?: (e: KeyboardEvent) => void;
  onInput?: (text: string) => void;
}

type DocListener = (docId: string, update: ViewUpdate) => void;
export type PaneIndex = 0 | 1;

interface Pane {
  view: EditorView | null;
  docId: string | null;
}

/** Marks an edit copied from the other pane showing the same document. */
const paneSync = Annotation.define<boolean>();

/** Characters of the line kept visible to the left of a go-to target (search results, Go to Line). */
const GOTO_CONTEXT = 10;

const otherPane = (i: PaneIndex): PaneIndex => (i === 0 ? 1 : 0);

class EditorManager {
  private panes: [Pane, Pane] = [
    { view: null, docId: null },
    { view: null, docId: null },
  ];
  private focusedPane: PaneIndex = 0;
  /** Which pane keeps the undo history of a document shown in both. */
  private owner = new Map<string, PaneIndex>();
  private states = new Map<string, EditorState>();
  private scroll = new Map<string, number>();
  private languages = new Map<string, string>();
  hooks: RecorderHooks = {};
  private docListeners = new Set<DocListener>();
  private cursorRaf = 0;
  private subscribed = false;
  /** Compartment changes for documents whose state is still being created (reconfigureDoc). */
  private pendingEffects = new Map<string, StateEffect<unknown>[]>();

  /** The focused pane's view. */
  get view(): EditorView | null {
    return this.panes[this.focusedPane].view;
  }

  /** A pane's view (null before it mounts). */
  paneView(pane: PaneIndex): EditorView | null {
    return this.panes[pane].view;
  }

  /** The text document in the focused pane (null when it shows another kind of tab). */
  get currentDocId(): string | null {
    return this.panes[this.focusedPane].docId;
  }

  mount(parent: HTMLElement, pane: PaneIndex = 0) {
    const p = this.panes[pane];
    if (p.view) {
      parent.appendChild(p.view.dom);
      return;
    }
    p.view = new EditorView({
      parent,
      state: this.emptyState(),
      dispatchTransactions: (trs, view) => this.dispatchIn(pane, trs, view),
    });
    // Ctrl+M (Tab moves focus) applies to every pane, including one opened after it was turned on.
    if (useStore.getState().tabMovesFocus) p.view.setTabFocusMode(true);
    // Swap the visible EditorStates in the same tick the store's activeId changes, rather than from a
    // React effect: otherwise a dispatch issued between `setActive` and the effect would edit the
    // previous document. CodeEditor's effect still calls syncPanes(), which is idempotent.
    if (!this.subscribed) {
      this.subscribed = true;
      useStore.subscribe((s, prev) => {
        if (s.activeId !== prev.activeId || s.docs !== prev.docs || s.split !== prev.split) this.syncPanes();
      });
    }
    this.syncPanes();
  }

  /** The right pane is going away (the split closed): keep its document's state, drop the view. */
  unmount(pane: PaneIndex) {
    const p = this.panes[pane];
    if (pane === 0 || !p.view) return;
    this.show(pane, null);
    p.view.destroy();
    p.view = null;
    this.focusedPane = 0;
  }

  private emptyState() {
    return EditorState.create({ doc: "", extensions: this.extensions(useStore.getState().settings) });
  }

  /** Show in each pane whatever text document the store says it shows (or none). */
  syncPanes() {
    const s = useStore.getState();
    const textId = (id: string | null) => (id && s.docs.find((d) => d.id === id)?.kind === "text" ? id : null);
    const focused: PaneIndex = s.split?.focused ?? 0;
    const moved = focused !== this.focusedPane;
    this.focusedPane = focused;
    for (const i of [0, 1] as const) {
      if (!this.panes[i].view) continue;
      const want = textId(paneDocId(s, i));
      if (want !== this.panes[i].docId) this.show(i, want);
    }
    if (moved) this.publishCursor();
  }

  private paneOf(view: EditorView): PaneIndex | -1 {
    return this.panes[0].view === view ? 0 : this.panes[1].view === view ? 1 : -1;
  }

  /** Panes showing a document, focused first. */
  private panesOf(docId: string): PaneIndex[] {
    const f = this.focusedPane;
    return [f, otherPane(f)].filter((i) => this.panes[i].docId === docId && this.panes[i].view);
  }

  /** The view showing a document (the focused pane's if both do), or null when it is off screen. */
  viewOf(docId: string | null): EditorView | null {
    if (!docId) return null;
    const i = this.panesOf(docId)[0];
    return i === undefined ? null : this.panes[i].view;
  }

  private viewsOf(docId: string): EditorView[] {
    return this.panesOf(docId).map((i) => this.panes[i].view!);
  }

  /** Put `docId` (or nothing) in pane `i`, keeping the state of what it showed before. */
  private show(i: PaneIndex, docId: string | null) {
    const p = this.panes[i];
    const view = p.view;
    if (!view || p.docId === docId) return;
    const o = this.panes[otherPane(i)];
    const old = p.docId;
    if (old) {
      if (o.docId === old && o.view) {
        // Still on screen in the other pane: hand it the undo history if this pane had it.
        if (this.owner.get(old) === i) {
          const top = o.view.scrollDOM.scrollTop;
          o.view.setState(view.state.update({ selection: o.view.state.selection }).state);
          o.view.scrollDOM.scrollTop = top;
        }
      } else {
        this.states.set(old, view.state);
        this.scroll.set(old, view.scrollDOM.scrollTop);
      }
      this.owner.delete(old);
    }
    p.docId = docId;
    if (!docId) {
      view.setState(this.emptyState());
      return;
    }
    let top: number;
    if (o.docId === docId && o.view) {
      view.setState(o.view.state);
      this.owner.set(docId, otherPane(i));
      top = o.view.scrollDOM.scrollTop;
    } else {
      // Shown before create() finished: show nothing rather than the previous document's text;
      // create() installs the real state when it is ready.
      view.setState(this.states.get(docId) ?? this.emptyState());
      this.states.delete(docId);
      top = this.scroll.get(docId) ?? 0;
    }
    requestAnimationFrame(() => {
      if (p.docId === docId) view.scrollDOM.scrollTop = top;
    });
    // Column mode is a global toggle; re-apply to the swapped-in state.
    view.dispatch({ effects: this.columnModeEffects(useStore.getState().columnMode) });
    if (i === this.focusedPane) this.publishCursor();
  }

  /** Apply a pane's transactions, then copy their edits to the other pane if it shows the same document. */
  private dispatchIn(i: PaneIndex, trs: readonly Transaction[], view: EditorView) {
    view.update(trs);
    const docId = this.panes[i].docId;
    const other = this.panes[otherPane(i)];
    if (!docId || other.docId !== docId || !other.view) return;
    const toOwner = this.owner.get(docId) !== i;
    for (const tr of trs) {
      if (!tr.docChanged || tr.annotation(paneSync)) continue;
      const userEvent = tr.annotation(Transaction.userEvent);
      other.view.dispatch({
        changes: tr.changes,
        annotations: [
          paneSync.of(true),
          // Edits made in the second copy go into the owner's undo history.
          Transaction.addToHistory.of(toOwner && tr.annotation(Transaction.addToHistory) !== false),
          ...(userEvent ? [Transaction.userEvent.of(userEvent)] : []),
        ],
      });
    }
  }

  /** The view whose undo history covers `view`'s document: the other pane's, for a second copy. */
  historyView(view: EditorView): EditorView {
    const i = this.paneOf(view);
    if (i === -1) return view;
    const docId = this.panes[i].docId;
    const o = otherPane(i);
    if (docId && this.panes[o].docId === docId && this.owner.get(docId) === o) return this.panes[o].view ?? view;
    return view;
  }

  private extensions(settings: Settings): Extension[] {
    const viaOwner = (cmd: typeof undo) => (view: EditorView) => cmd(this.historyView(view));
    return baseExtensions(settings, [
      resultHighlight(),
      gitExtensions(),
      conflictExtensions(),
      EditorView.updateListener.of((u) => this.onUpdate(u)),
      // Highest precedence so the macro recorder sees keys before keymaps consume them.
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (e) => {
            this.hooks.onKeydown?.(e);
            return false;
          },
        }),
      ),
      Prec.high(
        keymap.of([
          { key: "Mod-z", run: viaOwner(undo), preventDefault: true },
          { key: "Mod-y", run: viaOwner(redo), preventDefault: true },
          { key: "Mod-Shift-z", run: viaOwner(redo), preventDefault: true },
        ]),
      ),
      EditorView.inputHandler.of((_view, _from, _to, text) => {
        this.hooks.onInput?.(text);
        return false;
      }),
    ]);
  }

  onDocUpdate(fn: DocListener): () => void {
    this.docListeners.add(fn);
    return () => this.docListeners.delete(fn);
  }

  private onUpdate(u: ViewUpdate) {
    const i = this.paneOf(u.view);
    if (i === -1) return;
    const docId = this.panes[i].docId;
    if (!docId) return;
    const store = useStore.getState();
    if (u.focusChanged && u.view.hasFocus && store.split && store.split.focused !== i) store.focusPane(i);
    // A copy of an edit made in the other pane, which already reported it.
    const copied = u.transactions.some((tr) => tr.annotation(paneSync));
    if (u.docChanged && !copied) {
      const doc = store.docs.find((d) => d.id === docId);
      if (doc && !doc.dirty) store.updateDoc(docId, { dirty: true });
    }
    if (i === this.focusedPane && (u.selectionSet || u.docChanged || u.focusChanged)) {
      cancelAnimationFrame(this.cursorRaf);
      this.cursorRaf = requestAnimationFrame(() => this.publishCursor());
    }
    if (copied) return;
    if (u.docChanged) this.maybeSniffAfterInsert(docId, u);
    for (const l of this.docListeners) l(docId, u);
  }

  /**
   * Untitled documents are only sniffed when created (empty). When the first sizeable chunk of
   * text (paste, drop, script output) lands in a still-empty Plain Text untitled doc, sniff again.
   */
  private maybeSniffAfterInsert(docId: string, u: ViewUpdate) {
    if (this.languages.get(docId) !== "Plain Text") return;
    const store = useStore.getState();
    const doc = store.docs.find((d) => d.id === docId);
    if (!doc || doc.kind !== "text" || doc.path || doc.language !== "Plain Text") return;
    if (u.startState.doc.length > 40) return; // only the first real insert, never override later typing
    let inserted = 0;
    u.changes.iterChanges((_a, _b, _c, _d, ins) => (inserted += ins.length));
    if (inserted <= 40) return;
    const name = sniffLanguage(u.state.doc.sliceString(0, 400));
    if (!name || name === "Plain Text") return;
    void this.setLanguage(docId, name).then((l) => useStore.getState().updateDoc(docId, { language: l }));
  }

  publishCursor() {
    const view = this.view;
    if (!view || !this.currentDocId) return;
    const sel = view.state.selection;
    const main = sel.main;
    const line = view.state.doc.lineAt(main.head);
    let chars = 0;
    for (const r of sel.ranges) chars += r.to - r.from;
    useStore.getState().set({
      cursor: { line: line.number, col: main.head - line.from + 1, selections: sel.ranges.length, selectedChars: chars },
    });
  }

  has(docId: string) {
    return this.states.has(docId) || this.panesOf(docId).length > 0;
  }

  async create(docId: string, text: string, filename: string | null, languageName?: string) {
    const settings = useStore.getState().settings;
    let state = EditorState.create({ doc: text, extensions: this.extensions(settings) });
    const pending = this.pendingEffects.get(docId);
    if (pending) {
      this.pendingEffects.delete(docId);
      state = state.update({ effects: pending }).state;
    }
    // If the store already shows this doc (activation is synchronous with setActive), show it now.
    const showing = this.panesOf(docId);
    for (const i of showing) this.panes[i].view!.setState(state);
    if (showing.length > 1) this.owner.set(docId, showing[0]);
    if (!showing.length) this.states.set(docId, state);
    const info = languageName ? languageByName(languageName) : detectLanguage(filename, text.slice(0, 200));
    this.languages.set(docId, info.name);
    const support = await info.load();
    if (support) this.effectsTo(docId, [compartments.language.reconfigure(support)]);
    return info.name;
  }

  async setLanguage(docId: string, languageName: string) {
    const info = languageByName(languageName);
    const support = await info.load();
    this.languages.set(docId, info.name);
    this.effectsTo(docId, [compartments.language.reconfigure(support ?? [])]);
    return info.name;
  }

  /** Apply effects to a document: in every pane showing it, else to its stored state. */
  effectsTo(docId: string, effects: StateEffect<unknown>[]) {
    const views = this.viewsOf(docId);
    for (const v of views) v.dispatch({ effects });
    if (views.length) return;
    const cur = this.states.get(docId);
    if (cur) this.states.set(docId, cur.update({ effects }).state);
  }

  /** Apply a spec built from a document's state, wherever the document lives (each pane builds its own). */
  private specTo(docId: string, make: (state: EditorState) => TransactionSpec | null) {
    const views = this.viewsOf(docId);
    for (const v of views) {
      const spec = make(v.state);
      if (spec) v.dispatch(spec);
    }
    if (views.length) return;
    const cur = this.states.get(docId);
    const spec = cur && make(cur);
    if (cur && spec) this.states.set(docId, cur.update(spec).state);
  }

  languageOf(docId: string) {
    return this.languages.get(docId) ?? "Plain Text";
  }

  dispose(docId: string) {
    this.pendingEffects.delete(docId);
    this.states.delete(docId);
    this.scroll.delete(docId);
    this.languages.delete(docId);
    this.owner.delete(docId);
    for (const p of this.panes) if (p.docId === docId) p.docId = null;
  }

  stateOf(docId: string): EditorState | null {
    return this.viewOf(docId)?.state ?? this.states.get(docId) ?? null;
  }

  /** Last known scroll offset of a document (live for a visible one). */
  scrollTopOf(docId: string): number {
    return this.viewOf(docId)?.scrollDOM.scrollTop ?? this.scroll.get(docId) ?? 0;
  }

  /** Restore cursor + scroll (session restore). Works for background documents too. */
  restoreViewState(docId: string, cursor: number, scrollTop: number) {
    const state = this.stateOf(docId);
    if (!state) return;
    const pos = Math.max(0, Math.min(state.doc.length, cursor));
    const view = this.viewOf(docId);
    if (view) {
      view.dispatch({ selection: { anchor: pos } });
      view.scrollDOM.scrollTop = scrollTop;
    } else {
      this.states.set(docId, state.update({ selection: { anchor: pos } }).state);
      this.scroll.set(docId, scrollTop);
    }
  }

  textOf(docId: string): string {
    return this.stateOf(docId)?.doc.toString() ?? "";
  }

  docOf(docId: string): Text | null {
    return this.stateOf(docId)?.doc ?? null;
  }

  /** Replace whole content of a document (used by format/minify/scripts) with a minimal diff. */
  replaceAll(docId: string, next: string, selectAll = false) {
    const state = this.stateOf(docId);
    if (!state) return;
    const cur = state.doc.toString();
    if (cur === next) return;
    let start = 0;
    const minLen = Math.min(cur.length, next.length);
    while (start < minLen && cur.charCodeAt(start) === next.charCodeAt(start)) start++;
    let endCur = cur.length;
    let endNext = next.length;
    while (endCur > start && endNext > start && cur.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)) {
      endCur--;
      endNext--;
    }
    this.dispatchTo(docId, {
      changes: { from: start, to: endCur, insert: next.slice(start, endNext) },
      selection: selectAll ? { anchor: 0, head: next.length } : undefined,
      userEvent: "input.replaceall",
    });
  }

  applySettings(settings: Settings) {
    const effects = settingsReconfigure(settings);
    for (const p of this.panes) p.view?.dispatch({ effects });
    for (const [id, st] of this.states) this.states.set(id, st.update({ effects }).state);
  }

  private columnModeEffects(on: boolean) {
    return [compartments.columnMode.reconfigure(columnModeExtensions(on)), setColumnMode.of(on)];
  }

  applyColumnMode(on: boolean) {
    for (const p of this.panes) p.view?.dispatch({ effects: this.columnModeEffects(on) });
  }

  setReadOnly(on: boolean, pane: PaneIndex = this.focusedPane) {
    this.panes[pane].view?.dispatch({ effects: compartments.readOnly.reconfigure(EditorState.readOnly.of(on)) });
  }

  /** Apply a transaction spec to a document, on screen or not (language server edits). */
  dispatchTo(docId: string, spec: TransactionSpec) {
    const view = this.viewOf(docId);
    let changed: boolean;
    if (view) {
      const tr = view.state.update(spec);
      view.dispatch(tr);
      changed = tr.docChanged;
    } else {
      const state = this.states.get(docId);
      if (!state) return;
      const tr = state.update(spec);
      this.states.set(docId, tr.state);
      changed = tr.docChanged;
    }
    if (changed) useStore.getState().updateDoc(docId, { dirty: true });
  }

  /** Reconfigure one document's compartments (its language server plugin), on screen or not. A
   *  document still being created gets them when it is ready. */
  reconfigureDoc(docId: string, effects: StateEffect<unknown>[]) {
    if (!this.stateOf(docId)) {
      this.pendingEffects.set(docId, [...(this.pendingEffects.get(docId) ?? []), ...effects]);
      return;
    }
    this.effectsTo(docId, effects);
  }

  /** Language server diagnostics (lib/lsp.ts) for a document, on screen or not. */
  setLspDiagnostics(docId: string, diags: { from: number; to: number; severity: "error" | "warning" | "info" | "hint"; message: string; source?: string }[]) {
    this.specTo(docId, (state) => {
      const len = state.doc.length;
      return setDiagnostics(state, diags.map((d) => ({ from: Math.min(d.from, len), to: Math.min(d.to, len), severity: d.severity, message: d.message, source: d.source })));
    });
  }

  setDiagnostics(docId: string, diags: { from: number; to: number; message: string }[]) {
    this.specTo(docId, (state) => setDiagnostics(state, diags.map((d) => ({ from: d.from, to: d.to, severity: "error" as const, message: d.message }))));
  }

  /** Highlight Find in Files matches in a document (null clears). See resultHighlight.ts. */
  setResultHighlight(docId: string, re: RegExp | null) {
    this.specTo(docId, (state) => (state.field(resultQuery, false) === re ? null : { effects: setResultQuery.of(re) }));
  }

  /** Remove Find in Files highlighting from every document. */
  clearResultHighlights() {
    const ids = new Set([...this.states.keys(), ...this.panes.map((p) => p.docId)]);
    for (const id of ids) if (id && this.stateOf(id)?.field(resultQuery, false)) this.setResultHighlight(id, null);
  }

  /** How to focus tabs that are not text documents (Claude, terminal, large file, Compare). */
  private focusers = new Map<string, () => void>();
  /** A non-text view registers its focus target while it is mounted; returns the unregister function. */
  registerFocus(docId: string, focus: () => void): () => void {
    this.focusers.set(docId, focus);
    return () => {
      if (this.focusers.get(docId) === focus) this.focusers.delete(docId);
    };
  }

  /** Give the keyboard to the active tab: the text editor, or whatever a non-text tab registered.
   *  Overlays (dialogs, menus, palette) call this when they close. */
  focus() {
    const st = useStore.getState();
    const focuser = st.activeId ? this.focusers.get(st.activeId) : undefined;
    if (focuser) focuser();
    else if (st.docs.find((d) => d.id === st.activeId)?.kind !== "text" && st.activeId) return;
    else this.view?.focus();
  }

  /** Until this time, showing a newly activated document leaves keyboard focus where it is (an
   *  Explorer single click opens a file but keeps focus in the tree, as File Explorer does). */
  private keepFocusUntil = 0;
  keepFocusOnNextOpen() {
    this.keepFocusUntil = Date.now() + 1500;
  }
  /** True (once) when the document being shown should not take focus. */
  takeKeepFocus(): boolean {
    const keep = Date.now() < this.keepFocusUntil;
    this.keepFocusUntil = 0;
    return keep;
  }

  goTo(line: number, col = 1, select?: { to: number }) {
    const view = this.view;
    if (!view) return;
    const ln = Math.max(1, Math.min(view.state.doc.lines, line));
    const l = view.state.doc.line(ln);
    const pos = Math.min(l.to, l.from + Math.max(0, col - 1));
    const head = select ? Math.min(view.state.doc.length, pos + select.to) : pos;
    // Horizontal scroll: if the target (plus GOTO_CONTEXT characters before it) is already fully
    // on screen, leave it; otherwise bring it in near the left edge, with GOTO_CONTEXT characters of
    // context before it, so the rest of the line after it is visible too. Near the start of the
    // line, show the line from its beginning. (Wrapped lines never scroll sideways.)
    const left = pos - l.from <= 2 * GOTO_CONTEXT ? l.from : pos - GOTO_CONTEXT;
    const headLine = view.state.doc.lineAt(head);
    const tab = view.state.tabSize;
    const cw = view.defaultCharacterWidth;
    const gutter = (view.dom.querySelector(".cm-gutters") as HTMLElement | null)?.offsetWidth ?? 0;
    const viewLeft = view.scrollDOM.scrollLeft;
    const viewRight = viewLeft + view.scrollDOM.clientWidth - gutter - 2 * cw;
    const xLeft = countColumn(l.text.slice(0, left - l.from), tab) * cw;
    const xRight = headLine.number === l.number ? countColumn(l.text.slice(0, head - l.from), tab) * cw : xLeft;
    const visible = xLeft >= viewLeft && xRight <= viewRight;
    const x = visible ? EditorView.scrollIntoView(pos, { y: "center", x: "nearest" }) : EditorView.scrollIntoView(left, { y: "center", x: "start", xMargin: left === l.from ? 1000 : 0 }); // a big margin at the line start clamps to scrollLeft 0, past the line padding
    view.dispatch({ selection: { anchor: pos, head }, effects: x });
    view.focus();
  }

  private flashTimer = 0;

  /**
   * Select a range and scroll it so its first line sits a few lines below the top of the viewport,
   * then flash the covered lines. Scrolls twice because line heights in large documents are
   * estimated until measured.
   */
  reveal(from: number, to: number, opts: { linesFromTop?: number; focus?: boolean } = {}) {
    const view = this.view;
    if (!view) return;
    const max = view.state.doc.length;
    const a = Math.min(from, max);
    const b = Math.min(to, max);
    const margin = (opts.linesFromTop ?? 3) * view.defaultLineHeight;
    const scroll = () => EditorView.scrollIntoView(a, { y: "start", yMargin: margin });
    view.dispatch({ selection: { anchor: a, head: b }, effects: [scroll(), flashRange.of({ from: a, to: b })] });
    requestAnimationFrame(() => {
      if (this.view !== view) return;
      view.dispatch({ effects: scroll() });
      requestAnimationFrame(() => this.view === view && view.dispatch({ effects: scroll() }));
    });
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => view.dispatch({ effects: flashRange.of(null) }), 1200);
    if (opts.focus !== false) view.focus();
  }

  selectRange(from: number, to: number) {
    const view = this.view;
    if (!view) return;
    const max = view.state.doc.length;
    view.dispatch({ selection: { anchor: Math.min(from, max), head: Math.min(to, max) }, effects: EditorView.scrollIntoView(Math.min(from, max), { y: "center" }) });
    view.focus();
  }
}

export const editor = new EditorManager();
