/**
 * Highlights the matches of a Find in Files search in a document opened from its results, with
 * the same classes the find bar (Ctrl+F) uses, so both look identical: every match gets
 * `cm-searchMatch`, and the one that is selected also gets `cm-searchMatch-selected`.
 * Only the visible part of the document is scanned (MatchDecorator), so large files stay fast.
 */
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, MatchDecorator, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";

/** Set (or with null, clear) the pattern to highlight. It must have the global flag. */
export const setResultQuery = StateEffect.define<RegExp | null>();

export const resultQuery = StateField.define<RegExp | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setResultQuery)) value = e.value;
    return value;
  },
});

const match = Decoration.mark({ class: "cm-searchMatch" });
const selected = Decoration.mark({ class: "cm-searchMatch cm-searchMatch-selected" });

function decorator(re: RegExp) {
  return new MatchDecorator({
    regexp: re,
    decorate: (add, from, to, _m, view) => {
      if (from === to) return;
      const sel = view.state.selection.main;
      add(from, to, sel.from === from && sel.to === to ? selected : match);
    },
  });
}

const plugin = ViewPlugin.fromClass(
  class {
    re: RegExp | null;
    deco: MatchDecorator | null;
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.re = view.state.field(resultQuery);
      this.deco = this.re ? decorator(this.re) : null;
      this.decorations = this.deco ? this.deco.createDeco(view) : Decoration.none;
    }
    update(u: ViewUpdate) {
      const re = u.state.field(resultQuery);
      if (re !== this.re) {
        this.re = re;
        this.deco = re ? decorator(re) : null;
        this.decorations = this.deco ? this.deco.createDeco(u.view) : Decoration.none;
      } else if (this.deco) {
        // The selected match follows the selection, so rebuild (visible range only) when it moves.
        this.decorations = u.selectionSet ? this.deco.createDeco(u.view) : this.deco.updateDeco(u, this.decorations);
      }
    }
  },
  { decorations: (p) => p.decorations },
);

export function resultHighlight(): Extension {
  return [resultQuery, plugin];
}
