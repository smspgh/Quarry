import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  applySuggestion,
  blockText,
  CONFLICT_CHANGED_ASKING,
  CONFLICT_CHANGED_SINCE,
  conflictExtensions,
  conflictsOf,
  dropSuggestion,
  redrawConflicts,
  resolveChange,
  setConflictHooks,
  setSuggestion,
  suggestionChange,
  suggestionFor,
  suggestionsOf,
  type Suggestion,
} from "../editor/conflicts";
import { conflictExcerpt, parseConflicts } from "../lib/conflicts";

// Claude's suggestion for a conflict (specs/git-claude.md, GITAI-007 / 008): what is sent for one
// block, the panel under it, and applying the proposal as one undoable edit.

describe("what is sent for one conflict", () => {
  const filler = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}`);

  it("both sides and 30 lines above and below, nothing else", () => {
    const lines = [...filler(1, 119), "<<<<<<< HEAD", ...filler(121, 129), "=======", ...filler(131, 139), ">>>>>>> feature", ...filler(141, 300)];
    const b = parseConflicts(lines)[0];
    const x = conflictExcerpt(lines, b)!;
    expect([x.fromLine, x.toLine]).toEqual([120, 140]);
    expect(x.before).toEqual(filler(90, 119));
    expect(x.after).toEqual(filler(141, 170));
    expect(x.current).toEqual(filler(121, 129));
    expect(x.incoming).toEqual(filler(131, 139));
    expect(x.base).toBeNull();
  });

  it("near the ends of the file there is less context, and a diff3 base is included", () => {
    const lines = ["top", "<<<<<<< HEAD", "mine", "||||||| base", "was", "=======", "theirs", ">>>>>>> feature", "end"];
    const x = conflictExcerpt(lines, parseConflicts(lines)[0])!;
    expect(x.before).toEqual(["top"]);
    expect(x.after).toEqual(["end"]);
    expect(x.current).toEqual(["mine"]);
    expect(x.base).toEqual(["was"]);
    expect(x.incoming).toEqual(["theirs"]);
  });

  it("over 60,000 characters it is not sent", () => {
    const lines = ["<<<<<<< HEAD", "x".repeat(40_000), "=======", "y".repeat(19_990), ">>>>>>> b"];
    const b = parseConflicts(lines)[0];
    expect(conflictExcerpt(lines, b)).not.toBeNull();
    expect(conflictExcerpt([...lines, "z".repeat(100)], b)).toBeNull();
    expect(conflictExcerpt(lines, b, 30, 1000)).toBeNull();
  });
});

const text = ["top", "<<<<<<< HEAD", "main one", "=======", "theirs one", ">>>>>>> feature", "middle", "<<<<<<< HEAD", "second mine", "=======", "second theirs", ">>>>>>> other", "end"].join("\n");
const make = (doc = text) => EditorState.create({ doc, extensions: [history(), conflictExtensions()] });
const sug = (state: EditorState, n: number, extra: Partial<Suggestion> = {}): Suggestion => {
  const b = conflictsOf(state)[n];
  return { pos: state.doc.line(b.start + 1).from, status: "done", startedAt: 1, asked: blockText(state.doc, b), explanation: "Current renamed it, Incoming changed it.", resolution: "merged one", note: "", error: "", changed: false, ...extra };
};
const withSug = (n = 0, extra: Partial<Suggestion> = {}) => {
  const s = make();
  return s.update({ effects: setSuggestion.of(sug(s, n, extra)) }).state;
};

describe("suggestion state", () => {
  it("one suggestion per conflict, attached to its conflict", () => {
    let s = withSug(0);
    expect(suggestionsOf(s)).toHaveLength(1);
    expect(suggestionFor(s, conflictsOf(s)[0])?.resolution).toBe("merged one");
    expect(suggestionFor(s, conflictsOf(s)[1])).toBeUndefined();
    // A second conflict gets its own without removing the first; asking again replaces.
    s = s.update({ effects: setSuggestion.of(sug(s, 1, { resolution: "merged two" })) }).state;
    expect(suggestionsOf(s).map((x) => x.resolution).sort()).toEqual(["merged one", "merged two"]);
    s = s.update({ effects: setSuggestion.of(sug(s, 0, { resolution: "again" })) }).state;
    expect(suggestionsOf(s)).toHaveLength(2);
    expect(suggestionFor(s, conflictsOf(s)[0])?.resolution).toBe("again");
    s = s.update({ effects: dropSuggestion.of(suggestionFor(s, conflictsOf(s)[0])!.pos) }).state;
    expect(suggestionsOf(s)).toHaveLength(1);
    expect(suggestionsOf(s.update({ effects: dropSuggestion.of(null) }).state)).toHaveLength(0);
  });

  it("edits elsewhere leave it usable and attached; an edit inside marks it changed", () => {
    let s = withSug(1);
    s = s.update({ changes: { from: 0, insert: "new first line\n" } }).state;
    const b = conflictsOf(s)[1];
    expect(suggestionFor(s, b)).toMatchObject({ changed: false, resolution: "merged one" });
    // Inside the conflict.
    const inside = s.doc.line(b.start + 2).from;
    const edited = s.update({ changes: { from: inside, insert: "X" } }).state;
    expect(suggestionFor(edited, conflictsOf(edited)[1])).toMatchObject({ changed: true });
    // Put back as it was: usable again.
    const back = edited.update({ changes: { from: inside, to: inside + 1 } }).state;
    expect(suggestionFor(back, conflictsOf(back)[1])).toMatchObject({ changed: false });
  });

  it("an edit inside while Claude is still reading makes it stale, for good", () => {
    let s = withSug(0, { status: "working", resolution: null, explanation: "" });
    const inside = s.doc.line(3).from;
    s = s.update({ changes: { from: inside, insert: "X" } }).state;
    expect(suggestionsOf(s)[0].status).toBe("stale");
    s = s.update({ changes: { from: inside, to: inside + 1 } }).state;
    expect(suggestionsOf(s)[0].status).toBe("stale");
  });

  it("resolving the conflict any way closes its panel", () => {
    const s = withSug(0);
    const accepted = s.update({ changes: resolveChange(s.doc, conflictsOf(s)[0], "current") }).state;
    expect(suggestionsOf(accepted)).toHaveLength(0);
    expect(conflictsOf(accepted)).toHaveLength(1);
  });

  it("the change replaces the whole block, markers and base section included", () => {
    const s = make();
    const c = suggestionChange(s.doc, conflictsOf(s)[0], "merged one\nand two\n");
    expect(s.update({ changes: c }).state.doc.toString().split("\n").slice(0, 4)).toEqual(["top", "merged one", "and two", "middle"]);
    // Nothing proposed in its place: no blank line is left.
    const none = suggestionChange(s.doc, conflictsOf(s)[0], "");
    expect(s.update({ changes: none }).state.doc.toString().split("\n").slice(0, 2)).toEqual(["top", "middle"]);
    const d3 = make(["a", "<<<<<<< HEAD", "mine", "||||||| base", "was", "=======", "theirs", ">>>>>>> b", "z"].join("\n"));
    expect(d3.update({ changes: suggestionChange(d3.doc, conflictsOf(d3)[0], "both") }).state.doc.toString()).toBe("a\nboth\nz");
  });
});

describe("the panel in the editor", () => {
  let view: EditorView;
  const explained: number[] = [];
  let stopped = 0;
  let cleared = 0;

  beforeEach(() => {
    explained.length = 0;
    stopped = 0;
    cleared = 0;
    setConflictHooks({ note: () => "", compare: undefined, cleared: () => void cleared++, explain: (_v, _b, n) => void explained.push(n), explainBlocked: () => null, stopExplain: () => void stopped++ });
    view = new EditorView({ state: make(), parent: document.body });
  });
  afterEach(() => {
    view.destroy();
    setConflictHooks({ explain: null, note: () => "", cleared: undefined });
  });

  const put = (n: number, extra: Partial<Suggestion> = {}) => view.dispatch({ effects: setSuggestion.of(sug(view.state, n, extra)) });
  const panels = () => [...view.dom.querySelectorAll<HTMLElement>(".cm-conflict-suggestion")];
  const buttons = (p: HTMLElement) => [...p.querySelectorAll<HTMLButtonElement>("button")];
  const labels = (p: HTMLElement) => buttons(p).map((b) => b.textContent);
  const click = (p: HTMLElement, label: string) => buttons(p).find((b) => b.textContent === label)!.click();
  const bars = () => [...view.dom.querySelectorAll<HTMLElement>(".cm-conflict-bar")];

  it("every bar has Explain after its other buttons, with the tooltip that says what is sent", () => {
    const b = bars()[1];
    expect([...b.querySelectorAll("button")].map((x) => x.textContent)).toEqual(["Accept Current", "Accept Incoming", "Accept Both", "Explain"]);
    const explain = b.querySelector<HTMLButtonElement>("button.explain")!;
    expect(explain.title).toBe("Ask Claude to explain this conflict and suggest a resolution. The conflict and the lines around it are sent to Claude.");
    explain.click();
    expect(explained).toEqual([2]);
  });

  it("Explain is disabled while another request runs, and gone while Claude Code is off", () => {
    setConflictHooks({ explainBlocked: () => "Claude is busy with another git request. Stop it in the status bar." });
    view.dispatch({ effects: redrawConflicts.of(null) });
    const off = bars()[0].querySelector<HTMLButtonElement>("button.explain")!;
    expect(off.disabled).toBe(true);
    expect(off.title).toBe("Claude is busy with another git request. Stop it in the status bar.");
    setConflictHooks({ explain: null });
    view.dispatch({ effects: redrawConflicts.of(null) });
    expect(view.dom.querySelector("button.explain")).toBeNull();
    expect([...bars()[0].querySelectorAll("button")].map((x) => x.textContent)).toEqual(["Accept Current", "Accept Incoming", "Accept Both"]);
    // Back on: the button returns without the document changing.
    setConflictHooks({ explain: () => {}, explainBlocked: () => null });
    view.dispatch({ effects: redrawConflicts.of(null) });
    expect(view.dom.querySelectorAll("button.explain")).toHaveLength(2);
  });

  it("while Claude reads: the working line and Stop", () => {
    put(0, { status: "working", startedAt: Date.now() - 3200, resolution: null, explanation: "" });
    const p = panels()[0];
    expect(p.textContent).toContain("Claude is reading this conflict… 3s");
    expect(labels(p)).toEqual(["Stop"]);
    click(p, "Stop");
    expect(stopped).toBe(1);
    expect(panels()).toHaveLength(0);
  });

  it("the answer: headed with the two sides, explanation, proposal, Apply Suggestion and Discard", () => {
    put(0);
    const p = panels()[0];
    expect(p.querySelector(".cm-conflict-suggestion-sides")?.textContent).toBe("Current (HEAD) · Incoming (feature)");
    expect(p.querySelector(".cm-conflict-note")).toBeNull();
    expect(p.querySelector(".cm-conflict-suggestion-text")?.textContent).toBe("Current renamed it, Incoming changed it.");
    expect(p.querySelector(".cm-conflict-suggestion-label")?.textContent).toBe("Suggested resolution");
    expect(p.querySelector(".cm-conflict-suggestion-code")?.textContent).toBe("merged one");
    expect(labels(p)).toEqual(["Apply Suggestion", "Discard"]);
    // Nothing happens by itself: the file is as it was.
    expect(view.state.doc.toString()).toBe(text);
    click(p, "Discard");
    expect(panels()).toHaveLength(0);
    expect(view.state.doc.toString()).toBe(text);
  });

  it("shows the rebase note, and drops it when the operation ends", () => {
    setConflictHooks({ note: () => "Rebasing: Current is the branch you are rebasing onto, Incoming is your own commit." });
    put(0);
    expect(panels()[0].querySelector(".cm-conflict-note")?.textContent).toBe("Rebasing: Current is the branch you are rebasing onto, Incoming is your own commit.");
    setConflictHooks({ note: () => "" });
    view.dispatch({ effects: redrawConflicts.of(null) });
    expect(panels()[0].querySelector(".cm-conflict-note")).toBeNull();
    expect(bars()[0].querySelector(".cm-conflict-note")).toBeNull();
  });

  it("Apply Suggestion replaces the block as one undo step and saves nothing", () => {
    put(0);
    click(panels()[0], "Apply Suggestion");
    expect(view.state.doc.toString().split("\n").slice(0, 3)).toEqual(["top", "merged one", "middle"]);
    expect(panels()).toHaveLength(0);
    expect(bars()[0].querySelector(".cm-conflict-count")?.textContent).toBe("Conflict 1 of 1");
    expect(cleared).toBe(0);
    undo(view);
    expect(view.state.doc.toString()).toBe(text);
    expect(conflictsOf(view.state)).toHaveLength(2);
  });

  it("applying the last one tells the git layer the file has no conflicts left", () => {
    put(0);
    click(panels()[0], "Apply Suggestion");
    put(0, { resolution: "merged two" });
    expect(applySuggestion(view, conflictsOf(view.state)[0])).toBe(true);
    expect(conflictsOf(view.state)).toHaveLength(0);
    expect(cleared).toBe(1);
    expect(view.state.doc.toString()).toBe("top\nmerged one\nmiddle\nmerged two\nend");
  });

  it("a conflict edited after the answer cannot be applied", () => {
    put(0);
    view.dispatch({ changes: { from: view.state.doc.line(3).from, insert: "X" } });
    const p = panels()[0];
    expect(p.textContent).toContain(CONFLICT_CHANGED_SINCE);
    expect(buttons(p).find((b) => b.textContent === "Apply Suggestion")!.disabled).toBe(true);
    expect(applySuggestion(view, conflictsOf(view.state)[0])).toBe(false);
    expect(view.state.doc.toString()).toContain("Xmain one");
  });

  it("edited while Claude was reading: the request is stopped and the panel says so", () => {
    put(0, { status: "working", resolution: null, explanation: "" });
    view.dispatch({ changes: { from: view.state.doc.line(3).from, insert: "X" } });
    expect(stopped).toBe(1);
    expect(panels()[0].textContent).toContain(CONFLICT_CHANGED_ASKING);
    expect(labels(panels()[0])).toEqual(["Close"]);
  });

  it("no resolution, a rejected one, and an error", () => {
    put(0, { resolution: null });
    expect(labels(panels()[0])).toEqual(["Close"]);
    put(0, { resolution: null, note: "Claude's proposal still contained conflict markers, so it is not offered." });
    expect(panels()[0].textContent).toContain("Claude's proposal still contained conflict markers, so it is not offered.");
    expect(labels(panels()[0])).toEqual(["Close"]);
    put(0, { status: "error", error: "Claude Code stopped (exit code 1).", resolution: null });
    expect(panels()[0].querySelector(".cm-conflict-suggestion-error")?.textContent).toBe("Claude Code stopped (exit code 1).");
    expect(labels(panels()[0])).toEqual(["Try Again", "Close"]);
    click(panels()[0], "Try Again");
    expect(explained).toEqual([1]);
  });

  it("the Accept buttons still work and close the panel", () => {
    put(0);
    [...bars()[0].querySelectorAll("button")].find((b) => b.textContent === "Accept Incoming")!.click();
    expect(view.state.doc.toString().split("\n").slice(0, 3)).toEqual(["top", "theirs one", "middle"]);
    expect(panels()).toHaveLength(0);
  });

  it("Escape with the cursor in that conflict discards; elsewhere it does nothing", () => {
    put(0);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(7).from) });
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(panels()).toHaveLength(1);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(3).from) });
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(panels()).toHaveLength(0);
    expect(view.state.doc.toString()).toBe(text);
  });
});
