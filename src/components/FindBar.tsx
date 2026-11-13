import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, SearchQuery, setSearchQuery } from "@codemirror/search";
import { ALargeSmall, ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronRight, Regex, Replace, ReplaceAll, WholeWord, X } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { replaceAllSpec, replaceNextSpec } from "../editor/findReplace";
import { editor } from "../editor/manager";
import { recordHistory } from "../lib/searchHistory";
import { useStore } from "../lib/store";
import { ClearButton, HistoryMenu, openHistoryFromKey } from "./HistoryMenu";

/** Escape a literal string for use inside a RegExp source. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

export function buildQuery(f: { query: string; replaceText: string; regex: boolean; caseSensitive: boolean; wholeWord: boolean }): SearchQuery {
  // Literal multi-line searches are expressed as an escaped regex so "\n" in the box matches newlines.
  const multiline = !f.regex && f.query.includes("\n");
  return new SearchQuery({
    search: multiline ? escapeRegex(f.query) : f.query,
    replace: f.replaceText,
    regexp: f.regex || multiline,
    caseSensitive: f.caseSensitive,
    wholeWord: f.wholeWord,
    literal: !f.regex && !multiline,
  });
}

export function FindBar() {
  const fb = useStore((s) => s.findBar);
  const setFindBar = useStore((s) => s.setFindBar);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const findWrapRef = useRef<HTMLDivElement>(null);
  const replaceWrapRef = useRef<HTMLDivElement>(null);

  // Seed with current selection when opened, and open the (hidden) CM search panel for highlighting.
  useEffect(() => {
    const view = editor.view;
    if (!fb.open || !view) return;
    const sel = view.state.selection.main;
    if (!sel.empty && sel.to - sel.from < 500) {
      const text = view.state.sliceDoc(sel.from, sel.to);
      if (!text.includes("\n")) setFindBar({ query: text });
    }
    // The find bar's own highlighting replaces any left by Find in Files.
    editor.clearResultHighlights();
    openSearchPanel(view);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => {
      if (editor.view) closeSearchPanel(editor.view);
    };
  }, [fb.open]);

  useEffect(() => {
    if (fb.open && fb.replace) setTimeout(() => replaceRef.current?.focus(), 0);
  }, [fb.replace]);

  // Push the query into CodeMirror and recompute the match count.
  useEffect(() => {
    const view = editor.view;
    if (!fb.open || !view) return;
    const q = buildQuery(fb);
    const prev = getSearchQuery(view.state);
    if (!prev.eq(q)) view.dispatch({ effects: setSearchQuery.of(q) });
    let total = 0;
    let current = 0;
    if (q.valid && fb.query) {
      // While typing, land on the first match at/after the cursor (wrapping) so the count reads "1 of N".
      const from = view.state.selection.main.from;
      let first = q.getCursor(view.state, from).next();
      if (first.done) first = q.getCursor(view.state, 0).next();
      if (!first.done && (first.value.from !== view.state.selection.main.from || first.value.to !== view.state.selection.main.to)) {
        view.dispatch({ selection: { anchor: first.value.from, head: first.value.to }, effects: EditorView.scrollIntoView(first.value.from, { y: "center" }) });
      }
      const cursor = q.getCursor(view.state);
      const head = view.state.selection.main.from;
      const selTo = view.state.selection.main.to;
      for (;;) {
        const r = cursor.next();
        if (r.done) break;
        total++;
        if (r.value.from === head && r.value.to === selTo) current = total;
        if (total >= 100_000) break;
      }
    }
    setFindBar({ count: fb.query ? { current, total } : null });
  }, [fb.open, fb.query, fb.regex, fb.caseSensitive, fb.wholeWord, fb.replaceText]);

  // Keep the current-match index updated when the selection moves.
  useEffect(() => {
    if (!fb.open) return;
    return editor.onDocUpdate((_id, u) => {
      if (!u.selectionSet && !u.docChanged) return;
      const view = editor.view;
      if (!view || !fb.query) return;
      const q = getSearchQuery(view.state);
      if (!q.valid) return;
      const cursor = q.getCursor(view.state);
      const head = view.state.selection.main.from;
      const selTo = view.state.selection.main.to;
      let total = 0;
      let current = 0;
      for (;;) {
        const r = cursor.next();
        if (r.done) break;
        total++;
        if (r.value.from === head && r.value.to === selTo) current = total;
        if (total >= 100_000) break;
      }
      setFindBar({ count: { current, total } });
    });
  }, [fb.open, fb.query]);

  if (!fb.open) return null;

  /** `replacing`: the action uses the replace text, so it goes into the replace history too. */
  const run = (fn: (v: NonNullable<typeof editor.view>) => boolean, replacing = false) => {
    const view = editor.view;
    if (!view) return;
    recordHistory("find", fb.query);
    if (replacing) recordHistory("replace", fb.replaceText);
    fn(view);
    // Keep focus in the find box so Enter keeps cycling.
  };
  const close = () => {
    setFindBar({ open: false });
    editor.focus();
  };
  const invalid = !!fb.query && !buildQuery(fb).valid;
  const toast = useStore.getState().toast;
  /** Replace: CodeMirror's, or ours when Preserve Case is on (CodeMirror has no hook for it). */
  const doReplaceNext = () =>
    run((view) => {
      if (!fb.preserveCase) return replaceNext(view);
      if (view.state.readOnly) return false;
      const spec = replaceNextSpec(view.state, getSearchQuery(view.state));
      if (spec) view.dispatch(spec);
      return !!spec;
    }, true);
  const doReplaceAll = () =>
    run((view) => {
      const q = getSearchQuery(view.state);
      let n = 0;
      let ok = false;
      if (fb.preserveCase) {
        const r = view.state.readOnly ? null : replaceAllSpec(view.state, q);
        if (r) view.dispatch(r.spec);
        n = r?.count ?? 0;
        ok = !!r;
      } else {
        if (q.valid && fb.query) {
          const c = q.getCursor(view.state);
          while (!c.next().done && n < 100_000) n++;
        }
        ok = replaceAll(view);
      }
      toast(n === 0 ? "No occurrences to replace." : `Replaced ${n >= 100_000 ? "100k+" : n} occurrence${n === 1 ? "" : "s"}.`, n === 0 ? "info" : "success", 2500);
      return ok;
    }, true);
  // Alt+C / Alt+W / Alt+R / Alt+P toggle the options while focus is anywhere in the bar.
  const onBarKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "c") (e.preventDefault(), setFindBar({ caseSensitive: !fb.caseSensitive }));
      else if (k === "w") (e.preventDefault(), setFindBar({ wholeWord: !fb.wholeWord }));
      else if (k === "r") (e.preventDefault(), setFindBar({ regex: !fb.regex }));
      else if (k === "p") (e.preventDefault(), setFindBar({ preserveCase: !fb.preserveCase }));
    }
  };
  const onFindKey = (e: React.KeyboardEvent) => {
    if (openHistoryFromKey(e, "find")) return;
    // Alt+Enter never gets here: App.tsx's capture-phase handler runs `edit.selectAllMatches` first.
    if (e.key === "Enter" && !e.altKey) {
      e.preventDefault();
      if (e.ctrlKey) {
        // Ctrl+Enter inserts a newline for multi-line searches.
        const el = inputRef.current!;
        const { selectionStart, selectionEnd } = el;
        const next = fb.query.slice(0, selectionStart) + "\n" + fb.query.slice(selectionEnd);
        setFindBar({ query: next });
        requestAnimationFrame(() => el.setSelectionRange(selectionStart + 1, selectionStart + 1));
        return;
      }
      run(e.shiftKey ? findPrevious : findNext);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const onReplaceKey = (e: React.KeyboardEvent) => {
    if (openHistoryFromKey(e, "replace")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.ctrlKey && e.altKey) doReplaceAll();
      else doReplaceNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const multiline = fb.query.includes("\n");

  return (
    <div className="findbar" onKeyDown={onBarKey}>
      <div className="findbar-row">
        <button className="icon-btn toggle-col" title={fb.replace ? "Hide replace" : "Show replace (Ctrl+H)"} onClick={() => setFindBar({ replace: !fb.replace })}>
          {fb.replace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div ref={findWrapRef} className="input-wrap with-actions-5 grow">
          <textarea
            ref={inputRef}
            className={`input mono ${invalid ? "invalid" : ""}`}
            rows={multiline ? Math.min(5, fb.query.split("\n").length) : 1}
            style={{ resize: "none", paddingTop: multiline ? 5 : 6, height: multiline ? "auto" : 30, lineHeight: "18px" }}
            placeholder="Find (Ctrl+Enter: newline)"
            value={fb.query}
            onChange={(e) => setFindBar({ query: e.target.value })}
            onKeyDown={onFindKey}
            spellCheck={false}
          />
          <div className="input-actions">
            <ClearButton value={fb.query} label="Clear find" onClear={() => { setFindBar({ query: "" }); inputRef.current?.focus(); }} />
            <HistoryMenu kind="find" anchor={findWrapRef} onPick={(t) => setFindBar({ query: t })} />
            <button className={`icon-btn xs ${fb.caseSensitive ? "on" : ""}`} aria-pressed={!!fb.caseSensitive} title="Match Case (Alt+C)" onMouseDown={(e) => e.preventDefault()} onClick={() => setFindBar({ caseSensitive: !fb.caseSensitive })}>
              <CaseSensitive size={15} />
            </button>
            <button className={`icon-btn xs ${fb.wholeWord ? "on" : ""}`} aria-pressed={!!fb.wholeWord} title="Match Whole Word (Alt+W)" onMouseDown={(e) => e.preventDefault()} onClick={() => setFindBar({ wholeWord: !fb.wholeWord })}>
              <WholeWord size={15} />
            </button>
            <button className={`icon-btn xs ${fb.regex ? "on" : ""}`} aria-pressed={!!fb.regex} title="Use Regular Expression (Alt+R)" onMouseDown={(e) => e.preventDefault()} onClick={() => setFindBar({ regex: !fb.regex })}>
              <Regex size={14} />
            </button>
          </div>
        </div>
        <span className={`count ${fb.count && fb.count.total === 0 ? "none" : ""}`} aria-live="polite">
          {invalid ? "Invalid regex" : fb.count ? (fb.count.total === 0 ? "No results" : `${fb.count.current || "?"} of ${fb.count.total >= 100_000 ? "100k+" : fb.count.total}`) : ""}
        </span>
        <button className="icon-btn" title="Previous Match (Shift+Enter)" disabled={!fb.query} onClick={() => run(findPrevious)}>
          <ArrowUp size={15} />
        </button>
        <button className="icon-btn" title="Next Match (Enter)" disabled={!fb.query} onClick={() => run(findNext)}>
          <ArrowDown size={15} />
        </button>
        <button className="icon-btn" title="Close (Escape)" onClick={close}>
          <X size={15} />
        </button>
      </div>
      {fb.replace && (
        <div className="findbar-row">
          <span className="toggle-col" />
          <div ref={replaceWrapRef} className="input-wrap with-actions-3 grow">
            <input ref={replaceRef} className="input mono" placeholder={fb.regex ? "Replace ($1, $&)" : "Replace"} value={fb.replaceText} onChange={(e) => setFindBar({ replaceText: e.target.value })} onKeyDown={onReplaceKey} spellCheck={false} />
            <div className="input-actions">
              <ClearButton value={fb.replaceText} label="Clear replace" onClear={() => { setFindBar({ replaceText: "" }); replaceRef.current?.focus(); }} />
              <HistoryMenu kind="replace" anchor={replaceWrapRef} onPick={(t) => setFindBar({ replaceText: t })} />
              <button className={`icon-btn xs ${fb.preserveCase ? "on" : ""}`} aria-pressed={fb.preserveCase} title={"Preserve Case (Alt+P)\nFOO → BAR, Foo → Bar, foo → bar"} onMouseDown={(e) => e.preventDefault()} onClick={() => setFindBar({ preserveCase: !fb.preserveCase })}>
                <ALargeSmall size={15} />
              </button>
            </div>
          </div>
          <span className="count" />
          <button className="icon-btn" title="Replace (Enter)" disabled={!fb.query} onClick={doReplaceNext}>
            <Replace size={15} />
          </button>
          <button className="icon-btn" title="Replace All (Ctrl+Alt+Enter)" disabled={!fb.query} onClick={doReplaceAll}>
            <ReplaceAll size={15} />
          </button>
          <span style={{ width: 26 }} />
        </div>
      )}
    </div>
  );
}
