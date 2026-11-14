import { beforeEach, describe, expect, it, vi } from "vitest";

// Edit History (specs/git-history-edit.md): the pure rules and wording of historyEdit.ts, then the
// actions of git.ts with the Tauri side replaced.
const api = vi.hoisted(() => ({
  available: vi.fn(async () => "git version 2.53.0"),
  status: vi.fn<(path: string) => Promise<unknown>>(),
  show: vi.fn(async () => null),
  stashList: vi.fn(async () => []),
  historyRange: vi.fn<(root: string, from: string | null) => Promise<unknown>>(),
  historyRewrite: vi.fn<(root: string, action: string, tip: string, base?: string | null, steps?: unknown[], message?: string | null) => Promise<string>>(),
  continueOp: vi.fn<(root: string, how: string) => Promise<string>>(),
  abort: vi.fn<(root: string) => Promise<string>>(),
}));
vi.mock("../lib/gitApi", () => ({ git: api }));
vi.mock("../lib/actions", () => ({ checkExternalChanges: vi.fn(async () => ({ reloaded: [], missing: [], kept: [] })), askDialog: vi.fn(async () => true), missingOnly: () => false, answerAhead: () => () => {} }));

import { abortOperation, continueOperation, dropCommit, loadEditCommit, openHistoryEdit, rewordCommit, runHistoryEdit, squashCommit, undoLastCommit, useGit } from "../lib/git";
import type { GitFile, GitHistoryCommit, GitHistoryRange, GitStatus } from "../lib/gitApi";
import { isRewritten } from "../lib/gitMerge";
import { syncLine } from "../lib/gitStatus";
import {
  allDropped, allPushed, boxMessage, commandBlocked, defaultBase, editAllowed, finalMessage, foldedInto, graphEditContext, groupMessage, hasGroupBox, historyConfirm, historyDone, initialPlan, listWords,
  lowestChanged, MAX_PLAN, moveRow, movedText, NEEDS_MESSAGE, NOTHING_BELOW, planChanged, planProblems, planTodo, rangeEditContext, rewriteLineText, rewriteList, setAction, setMessage, singlePlan,
  squashMessage, squashTarget, tooMany, type EditContext, type GraphCommitLike, type PlanRow,
} from "../lib/historyEdit";
import { isPanelShown } from "../lib/panels";
import { useStore } from "../lib/store";

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const id = (name: string) => name.padEnd(40, "0");
/** A commit named by its 7-character short id; parent given by short id too. */
const hc = (short: string, summary: string, parent: string | null, extra: Partial<GitHistoryCommit> = {}): GitHistoryCommit => ({ sha: id(short), short, summary, message: summary, author: "Ada", email: "ada@example.com", time: 1_700_000_000, parents: parent ? [id(parent)] : [], pushed: false, ...extra });
// Newest first: e5f6a7b, d4e5f6a, c3d4e5f on top of b2c3d4e, a1b2c3d.
const E = hc("e5f6a7b", "Add tab limit tests", "d4e5f6a");
const D = hc("d4e5f6a", "Fix typo", "c3d4e5f");
const C = hc("c3d4e5f", "Add tab limit", "b2c3d4e");
const B = hc("b2c3d4e", "Rename helper", "a1b2c3d");
const A = hc("a1b2c3d", "Initial commit", null);
const range = (commits: GitHistoryCommit[], extra: Partial<GitHistoryRange> = {}): GitHistoryRange => {
  const last = commits[commits.length - 1];
  const below = last?.parents.length ? [E, D, C, B, A].find((c) => c.sha === last.parents[0]) : null;
  return { branch: "main", tip: commits[0]?.sha ?? E.sha, operation: null, onBranch: true, commits, total: commits.length, base: below ? { sha: below.sha, short: below.short, summary: below.summary } : null, pushedOn: null, ...extra };
};
const file = (name: string, extra: Partial<GitFile> = {}): GitFile => ({ path: `${ROOT}\\${name}`, origPath: null, index: ".", worktree: "M", conflicted: false, untracked: false, ...extra });
const status = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "e5f6a7b", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], headParents: 1, ...extra });
const ctx = (extra: Partial<EditContext> = {}): EditContext => ({ branch: "main", operation: null, busy: null, onBranch: true, mergeAfter: null, parentMerge: false, ...extra });
const order = (rows: PlanRow[]) => rows.map((r) => r.commit.short[0]).join("");
const actions = (rows: PlanRow[]) => rows.map((r) => r.action);

describe("which history edits a commit allows", () => {
  const ALL = ["reword", "squash", "drop", "list"] as const;
  it("an ordinary commit of the current branch allows all of them", () => {
    for (const a of [...ALL, "undo"] as const) expect(editAllowed(a, D, ctx())).toBeNull();
  });
  it("says why not: another branch, detached, an operation, a running action", () => {
    for (const a of ALL) {
      expect(editAllowed(a, D, ctx({ onBranch: false }))).toBe("Only commits on main can be edited. Switch to the commit's branch first.");
      expect(editAllowed(a, D, ctx({ branch: null }))).toBe("You are not on a branch. Switch to a branch to edit its history.");
      expect(editAllowed(a, D, ctx({ operation: "rebase" }))).toBe("Finish or abort the rebase first");
      expect(editAllowed(a, D, ctx({ operation: "cherry-pick" }))).toBe("Finish or abort the cherry-pick first");
      expect(editAllowed(a, D, ctx({ busy: "Pulling…" }))).toBe("Another git action is running");
    }
    expect(editAllowed("undo", D, ctx({ branch: null }))).toBe("You are not on a branch. Switch to a branch to edit its history.");
  });
  it("a merge commit, or one with a merge after it, cannot be edited", () => {
    const merge = { parents: [id("x"), id("y")] };
    for (const a of ALL) {
      expect(editAllowed(a, merge, ctx())).toBe("A merge commit can't be edited here. Use Revert This Commit… to undo it.");
      expect(editAllowed(a, C, ctx({ mergeAfter: "7c6d5e4" }))).toBe("The merge commit 7c6d5e4 comes after this commit. Quarry does not rewrite across a merge.");
    }
    expect(editAllowed("undo", merge, ctx())).toMatch(/merge commit/);
    expect(editAllowed("squash", D, ctx({ parentMerge: true }))).toBe("The parent is a merge commit: nothing can be squashed into it.");
    expect(editAllowed("drop", D, ctx({ parentMerge: true }))).toBeNull();
  });
  it("the first commit can be reworded and listed, not squashed, dropped or undone", () => {
    expect(editAllowed("reword", A, ctx())).toBeNull();
    expect(editAllowed("list", A, ctx())).toBeNull();
    expect(editAllowed("squash", A, ctx())).toBe("This is the first commit: it has no parent.");
    expect(editAllowed("drop", A, ctx())).toBe("The first commit can't be dropped.");
    expect(editAllowed("undo", A, ctx())).toBe("This is the first commit: there is nothing to go back to.");
  });

  it("reads a commit's place from the graph's loaded rows", () => {
    const g = (short: string, parents: string[], refs: string[] = []): GraphCommitLike => ({ sha: id(short), short, parents: parents.map(id), refs });
    // main: tip -> m (merge of c and f) -> c -> b -> a; f is the merged side branch; o is on another branch.
    const rows = [g("o", ["c"], ["refs/heads/other"]), g("tip", ["m"], ["HEAD", "refs/heads/main"]), g("m", ["c", "f"]), g("f", ["b"]), g("c", ["b"]), g("b", ["a"]), g("a", [])];
    const repo = { branch: "main", operation: null };
    const at = (short: string) => graphEditContext(rows, id(short), repo, null);
    expect(at("tip")).toMatchObject({ onBranch: true, mergeAfter: null, parentMerge: true });
    expect(at("m")).toMatchObject({ onBranch: true, mergeAfter: null });
    expect(at("c")).toMatchObject({ onBranch: true, mergeAfter: "m", parentMerge: false });
    expect(at("f")).toMatchObject({ onBranch: true, mergeAfter: "m" });
    expect(at("a")).toMatchObject({ onBranch: true, mergeAfter: "m" });
    expect(at("o")).toMatchObject({ onBranch: false });
    // A stash row is not a commit of the branch; without HEAD among the rows nothing qualifies.
    expect(graphEditContext([{ ...g("s", ["tip"]), stash: true }, ...rows], id("s"), repo, null).onBranch).toBe(false);
    expect(graphEditContext(rows.slice(2), id("c"), repo, null).onBranch).toBe(false);
    expect(graphEditContext(rows, id("c"), { branch: null, operation: "merge" }, "Busy…")).toMatchObject({ branch: null, operation: "merge", busy: "Busy…" });
  });

  it("reads it again from a fresh range", () => {
    expect(rangeEditContext(range([E, D, C]), null)).toEqual(ctx());
    const merge = hc("7c6d5e4", "Merge branch 'feature'", "d4e5f6a", { parents: [D.sha, id("f")] });
    expect(rangeEditContext(range([E, merge, D, C]), null).mergeAfter).toBe("7c6d5e4");
    // The oldest commit being a merge is the commit's own business, not "after it".
    expect(rangeEditContext(range([E, merge]), null).mergeAfter).toBeNull();
    expect(rangeEditContext(range([E, D]), "Pushing…", merge)).toMatchObject({ busy: "Pushing…", parentMerge: true });
    expect(rangeEditContext(range([], { onBranch: false }), null).onBranch).toBe(false);
  });

  it("greys the two commands out", () => {
    expect(commandBlocked("undo", status(), null)).toBeNull();
    expect(commandBlocked("list", status(), null)).toBeNull();
    expect(commandBlocked("undo", null, null)).toBe("The open folder is not in a git repository");
    expect(commandBlocked("undo", status({ head: null }), null)).toBe("This repository has no commits yet");
    expect(commandBlocked("undo", status({ branch: null }), null)).toMatch(/not on a branch/);
    expect(commandBlocked("undo", status({ headParents: 0 }), null)).toMatch(/first commit/);
    expect(commandBlocked("undo", status({ headParents: 2 }), null)).toMatch(/merge commit/);
    expect(commandBlocked("undo", status({ operation: "rebase" }), null)).toBe("Finish or abort the rebase first");
    expect(commandBlocked("undo", status(), "Pulling…")).toBe("Another git action is running");
    // The list does not mind what the tip is.
    expect(commandBlocked("list", status({ headParents: 0 }), null)).toBeNull();
    expect(commandBlocked("list", status({ operation: "merge" }), null)).toBe("Finish or abort the merge first");
    expect(commandBlocked("list", status({ branch: null }), null)).toMatch(/not on a branch/);
  });
});

describe("the plan of the Edit History list", () => {
  const start = () => initialPlan([E, D, C]);

  it("starts with every row Pick and changes nothing", () => {
    const rows = start();
    expect(actions(rows)).toEqual(["pick", "pick", "pick"]);
    expect(planChanged(rows, [E, D, C])).toBe(false);
    expect(planTodo(rows, [E, D, C], B.sha)).toBeNull();
    expect(planProblems(rows).size).toBe(0);
  });

  it("moves rows, and moving back is no change", () => {
    const moved = moveRow(start(), 0, 1);
    expect(order(moved)).toBe("dec");
    expect(planChanged(moved, [E, D, C])).toBe(true);
    expect(planChanged(moveRow(moved, 1, 0), [E, D, C])).toBe(false);
    // Out of range: nothing happens.
    const rows = start();
    expect(moveRow(rows, 0, -1)).toBe(rows);
    expect(moveRow(rows, 2, 3)).toBe(rows);
    expect(moveRow(rows, 1, 1)).toBe(rows);
  });

  it("a reorder replays from the lowest moved row, in the new order", () => {
    const todo = planTodo(moveRow(start(), 0, 1), [E, D, C], B.sha)!;
    expect(todo.base).toBe(C.sha);
    expect(todo.steps).toEqual([{ sha: E.sha, action: "pick", message: null }, { sha: D.sha, action: "pick", message: null }]);
    expect(todo.lines.map((l) => [l.commit.short, l.what])).toEqual([["e5f6a7b", "moved"], ["d4e5f6a", "moved"]]);
  });

  it("drop strikes a row out; dropping everything is not a plan to run", () => {
    const rows = setAction(start(), 1, "drop");
    expect(planChanged(rows, [E, D, C])).toBe(true);
    const todo = planTodo(rows, [E, D, C], B.sha)!;
    expect(todo.base).toBe(C.sha);
    expect(todo.steps).toEqual([{ sha: D.sha, action: "drop", message: null }, { sha: E.sha, action: "pick", message: null }]);
    expect(todo.lines.map((l) => l.what)).toEqual(["dropped", "kept"]);
    expect(allDropped(rows)).toBe(false);
    expect(allDropped(start().map((r) => ({ ...r, action: "drop" as const })))).toBe(true);
  });

  it("a reword only counts once its message differs", () => {
    let rows = setAction(start(), 1, "reword");
    expect(finalMessage(rows, 1)).toBeNull();
    expect(planChanged(rows, [E, D, C])).toBe(false);
    rows = setMessage(rows, 1, "Fix typo\n"); // trailing white space is not a change
    expect(planChanged(rows, [E, D, C])).toBe(false);
    rows = setMessage(rows, 1, "Fix a typo in the tab limit dialog");
    expect(finalMessage(rows, 1)).toBe("Fix a typo in the tab limit dialog");
    expect(lowestChanged(rows, [E, D, C])).toBe(1);
    const todo = planTodo(rows, [E, D, C], B.sha)!;
    expect(todo.base).toBe(C.sha);
    expect(todo.steps).toEqual([{ sha: D.sha, action: "pick", message: "Fix a typo in the tab limit dialog" }, { sha: E.sha, action: "pick", message: null }]);
    expect(todo.lines.map(rewriteLineText)).toEqual(['d4e5f6a  Fix typo (reworded to "Fix a typo in the tab limit dialog")', "e5f6a7b  Add tab limit tests (new id)"]);
    // Emptied: a problem, and Run stays off.
    expect(planProblems(setMessage(rows, 1, "  ")).get(1)).toBe(NEEDS_MESSAGE);
    // Back to Pick: the typed text no longer applies.
    expect(planChanged(setAction(rows, 1, "pick"), [E, D, C])).toBe(false);
  });

  it("only the top row reworded rewrites one commit", () => {
    const five = [E, D, C, B, A];
    const rows = setMessage(setAction(initialPlan(five), 0, "reword"), 0, "Tests for the tab limit");
    const todo = planTodo(rows, five, null)!;
    expect(todo.base).toBe(D.sha);
    expect(todo.steps).toHaveLength(1);
    expect(historyConfirm("plan", { branch: "main", tip: "e5f6a7b", lines: todo.lines, below: D, pushedOn: null }).title).toBe("Rewrite 1 commit on main?");
  });

  it("squash folds into the nearest kept row below and joins the messages, oldest first", () => {
    let rows = setAction(start(), 1, "squash");
    expect(squashTarget(rows, 1)).toBe(2);
    expect(foldedInto(rows, 2)).toEqual([1]);
    expect(hasGroupBox(rows, 2)).toBe(true);
    expect(groupMessage(rows, 2)).toBe("Add tab limit\n\nFix typo");
    expect(boxMessage(rows, 2)).toBe("Add tab limit\n\nFix typo");
    rows = setAction(rows, 0, "squash");
    expect(squashTarget(rows, 0)).toBe(2);
    expect(groupMessage(rows, 2)).toBe("Add tab limit\n\nFix typo\n\nAdd tab limit tests");
    const todo = planTodo(rows, [E, D, C], B.sha)!;
    expect(todo.base).toBe(B.sha);
    expect(todo.steps).toEqual([
      { sha: C.sha, action: "pick", message: "Add tab limit\n\nFix typo\n\nAdd tab limit tests" },
      { sha: D.sha, action: "fixup", message: null },
      { sha: E.sha, action: "fixup", message: null },
    ]);
    expect(todo.lines.map((l) => [l.what, l.detail])).toEqual([["takes", undefined], ["squashed", "c3d4e5f"], ["squashed", "c3d4e5f"]]);
  });

  it("a typed group message stands until the squashed rows change", () => {
    let rows = setMessage(setAction(start(), 1, "squash"), 2, "Add tab limit");
    expect(finalMessage(rows, 2)).toBe("Add tab limit");
    expect(planTodo(rows, [E, D, C], B.sha)!.lines[0]).toMatchObject({ what: "takes" });
    // Moving an unrelated row keeps it; another row squashed in starts the joined message afresh.
    expect(boxMessage(setAction(rows, 0, "drop"), 2)).toBe("Add tab limit");
    rows = setAction(rows, 0, "squash");
    expect(boxMessage(rows, 2)).toBe("Add tab limit\n\nFix typo\n\nAdd tab limit tests");
    expect(planProblems(setMessage(rows, 2, "")).get(2)).toBe(NEEDS_MESSAGE);
  });

  it("fixup folds in and throws its message away", () => {
    const rows = setAction(start(), 1, "fixup");
    expect(squashTarget(rows, 1)).toBe(2);
    expect(hasGroupBox(rows, 2)).toBe(false);
    expect(finalMessage(rows, 2)).toBeNull();
    const todo = planTodo(rows, [E, D, C], B.sha)!;
    expect(todo.steps).toEqual([{ sha: C.sha, action: "pick", message: null }, { sha: D.sha, action: "fixup", message: null }, { sha: E.sha, action: "pick", message: null }]);
    expect(todo.lines.map(rewriteLineText)).toEqual(["c3d4e5f  Add tab limit (takes in the commits folded into it)", "d4e5f6a  Fix typo (folded into c3d4e5f, its message discarded)", "e5f6a7b  Add tab limit tests (new id)"]);
  });

  it("a reworded row that also takes a fixup keeps the typed message", () => {
    const rows = setMessage(setAction(setAction(start(), 1, "fixup"), 2, "reword"), 2, "Add a limit on open tabs");
    const todo = planTodo(rows, [E, D, C], B.sha)!;
    expect(todo.steps[0]).toEqual({ sha: C.sha, action: "pick", message: "Add a limit on open tabs" });
    expect(todo.lines.map(rewriteLineText)).toEqual(['c3d4e5f  Add tab limit (reworded to "Add a limit on open tabs")', "d4e5f6a  Fix typo (folded into c3d4e5f, its message discarded)", "e5f6a7b  Add tab limit tests (new id)"]);
    // A reworded row that takes a squash: the typed text is the first part of the joined message.
    expect(groupMessage(setAction(rows, 1, "squash"), 2)).toBe("Add a limit on open tabs\n\nFix typo");
  });

  it("the bottom row cannot fold, and a fold with nothing below is a problem", () => {
    const rows = start();
    expect(setAction(rows, 2, "squash")).toBe(rows);
    expect(setAction(rows, 2, "fixup")).toBe(rows);
    // The row below is dropped, or the squash row is moved to the bottom.
    const dropped = setAction(setAction(rows, 1, "squash"), 2, "drop");
    expect(squashTarget(dropped, 1)).toBe(-1);
    expect(planProblems(dropped).get(1)).toBe(NOTHING_BELOW);
    const bottom = moveRow(setAction(rows, 1, "squash"), 1, 2);
    expect(order(bottom)).toBe("ecd");
    expect(planProblems(bottom).get(2)).toBe(NOTHING_BELOW);
    expect(planProblems(moveRow(bottom, 2, 0)).size).toBe(0);
  });

  it("a squash skips dropped rows, and other fold rows", () => {
    const rows = setAction(setAction(start(), 0, "squash"), 1, "drop");
    expect(squashTarget(rows, 0)).toBe(2);
    expect(foldedInto(rows, 2)).toEqual([0]);
    expect(planTodo(rows, [E, D, C], B.sha)!.steps.map((s) => s.action)).toEqual(["pick", "drop", "fixup"]);
    expect(squashTarget(setAction(setAction(start(), 0, "squash"), 1, "fixup"), 0)).toBe(2);
  });

  it("the whole history starts from the first commit", () => {
    const all = [E, D, C, B, A];
    const rows = setMessage(setAction(initialPlan(all), 4, "reword"), 4, "The beginning");
    const todo = planTodo(rows, all, null)!;
    expect(todo.base).toBeNull();
    expect(todo.steps).toHaveLength(5);
    expect(todo.steps[0]).toEqual({ sha: A.sha, action: "pick", message: "The beginning" });
  });

  it("one-commit plans: reword, drop, squash into the parent", () => {
    expect(planTodo(singlePlan("reword", [E, D, C], "Add a limit on open tabs"), [E, D, C], B.sha)!.steps.map((s) => [s.action, s.message])).toEqual([["pick", "Add a limit on open tabs"], ["pick", null], ["pick", null]]);
    const drop = planTodo(singlePlan("drop", [E, D]), [E, D], C.sha)!;
    expect([drop.base, drop.steps]).toEqual([C.sha, [{ sha: D.sha, action: "drop", message: null }, { sha: E.sha, action: "pick", message: null }]]);
    // The tip dropped: one step, nothing replayed.
    expect(planTodo(singlePlan("drop", [E]), [E], D.sha)!.steps).toEqual([{ sha: E.sha, action: "drop", message: null }]);
    const squash = planTodo(singlePlan("squash", [E, D, C], "Add tab limit"), [E, D, C], B.sha)!;
    expect(squash.steps).toEqual([{ sha: C.sha, action: "pick", message: "Add tab limit" }, { sha: D.sha, action: "fixup", message: null }, { sha: E.sha, action: "pick", message: null }]);
    expect(squashMessage("Add tab limit\n", "Fix typo\n")).toBe("Add tab limit\n\nFix typo");
  });

  it("opens over the commits not pushed, stopping at a merge and at the limit", () => {
    expect(defaultBase({ tip: E.sha, commits: [E, D, C] })).toBe(C.sha);
    expect(defaultBase({ tip: E.sha, commits: [] })).toBeNull();
    const merge = { ...D, parents: [C.sha, id("f")] };
    expect(defaultBase({ tip: E.sha, commits: [E, merge, C] })).toBe(E.sha);
    expect(defaultBase({ tip: merge.sha, commits: [merge, C] })).toBeNull();
    // A commit that is not the previous one's parent (a merged-in side branch) ends the run too.
    expect(defaultBase({ tip: E.sha, commits: [E, C] })).toBe(E.sha);
    const many = Array.from({ length: 150 }, (_, i) => hc(`k${i}`, `c${i}`, `k${i + 1}`));
    expect(defaultBase({ tip: many[0].sha, commits: many })).toBe(many[MAX_PLAN - 1].sha);
    expect(defaultBase({ tip: A.sha, commits: [A] })).toBe(A.sha);
  });

  it("words the list's heading, footer and pushed warning", () => {
    expect(listWords(range([E, D, C]))).toEqual({ head: "Edit history of main: 3 commits since b2c3d4e", foot: "b2c3d4e Rename helper and earlier commits are not changed", warning: null });
    expect(listWords(range([E, D, C, B, A]))).toMatchObject({ head: "Edit history of main: 5 commits", foot: "This is the whole history of main" });
    expect(listWords(range([E, D, { ...C, pushed: true }])).warning).toBe("1 of these commits is already pushed. Changing it or anything below a change rewrites pushed history.");
    expect(listWords(range([E, { ...D, pushed: true }, { ...C, pushed: true }])).warning).toMatch(/^2 of these commits are already pushed\. Changing them/);
  });
});

describe("history edit dialogs and notifications", () => {
  const labels = (d: { choices: { label: string }[] }) => d.choices.map((c) => c.label);
  const defaults = (d: { choices: { label: string; default?: boolean; cancel?: boolean }[] }) => d.choices.filter((c) => c.default && c.cancel).map((c) => c.label);
  const lines = (rows: PlanRow[], original: GitHistoryCommit[], base: string | null) => planTodo(rows, original, base)!.lines;

  it("undo says what happens and defaults to Cancel", () => {
    const d = historyConfirm("undo", { branch: "main", tip: "e5f6a7b", commit: E, lines: [], below: D, pushedOn: null });
    expect(d.title).toBe("Undo the last commit?");
    expect(d.text).toBe('e5f6a7b "Add tab limit tests" leaves main. Its changes stay staged and your files are not touched.');
    expect(labels(d)).toEqual(["Undo Commit", "Cancel"]);
    expect(defaults(d)).toEqual(["Cancel"]);
    expect(d.pushed).toBe(false);
  });

  it("rewording the tip changes no other commit; an older one lists every new id", () => {
    const tip = historyConfirm("reword", { branch: "main", tip: "e5f6a7b", commit: E, lines: [{ commit: E, what: "reworded", detail: "Add tab limit tests" }], below: D, pushedOn: null });
    expect(tip.title).toBe("Reword this commit?");
    expect(tip.text).toContain("e5f6a7b gets the new message and a new id. No other commit changes.");
    expect(labels(tip)).toEqual(["Reword", "Cancel"]);
    const older = historyConfirm("reword", { branch: "main", tip: "e5f6a7b", commit: C, lines: lines(singlePlan("reword", [E, D, C], "Add a limit on open tabs"), [E, D, C], B.sha), below: B, pushedOn: null });
    expect(older.text).toContain('3 commits on main get new ids:\n\nc3d4e5f  Add tab limit (reworded to "Add a limit on open tabs")\nd4e5f6a  Fix typo (new id)\ne5f6a7b  Add tab limit tests (new id)');
    expect(older.text).toContain("main is now at e5f6a7b");
    expect(older.text).toContain("b2c3d4e and earlier commits are not changed.");
    expect(defaults(older)).toEqual(["Cancel"]);
  });

  it("drop is a danger dialog that says the changes are gone", () => {
    const d = historyConfirm("drop", { branch: "main", tip: "e5f6a7b", commit: D, lines: lines(singlePlan("drop", [E, D]), [E, D], C.sha), below: C, pushedOn: null });
    expect(d.title).toBe("Drop this commit?");
    expect(d.text).toContain('d4e5f6a "Fix typo" and its changes are removed from main. They are not kept anywhere in your files.');
    expect(d.text).toContain("1 commit on main gets a new id:\n\ne5f6a7b  Add tab limit tests (new id)");
    expect(d.text).toContain("main is now at e5f6a7b");
    expect(d.choices[0]).toMatchObject({ label: "Drop Commit", kind: "danger" });
    expect(defaults(d)).toEqual(["Cancel"]);
    const tip = historyConfirm("drop", { branch: "main", tip: "e5f6a7b", commit: E, lines: lines(singlePlan("drop", [E]), [E], D.sha), below: D, pushedOn: null });
    expect(tip.text).toContain("No other commit changes.");
  });

  it("squash names both commits and lists the new ids", () => {
    const d = historyConfirm("squash", { branch: "main", tip: "e5f6a7b", commit: D, parent: C, lines: lines(singlePlan("squash", [E, D, C], "Add tab limit"), [E, D, C], B.sha), below: B, pushedOn: null });
    expect(d.title).toBe("Squash into the parent?");
    expect(d.text).toContain('d4e5f6a "Fix typo" is folded into c3d4e5f "Add tab limit".');
    expect(d.text).toContain("3 commits on main get new ids:\n\nc3d4e5f  Add tab limit (takes in the commits folded into it)\nd4e5f6a  Fix typo (folded into c3d4e5f)\ne5f6a7b  Add tab limit tests (new id)");
    expect(labels(d)).toEqual(["Squash", "Cancel"]);
  });

  it("a plan spells out every row, oldest first", () => {
    const rows = setMessage(setAction(setAction(initialPlan([E, D, C]), 1, "fixup"), 2, "reword"), 2, "Add a limit on open tabs");
    const d = historyConfirm("plan", { branch: "main", tip: "e5f6a7b", lines: lines(rows, [E, D, C], B.sha), below: B, pushedOn: null });
    expect(d.title).toBe("Rewrite 3 commits on main?");
    expect(d.text).toContain('c3d4e5f  Add tab limit (reworded to "Add a limit on open tabs")\nd4e5f6a  Fix typo (folded into c3d4e5f, its message discarded)\ne5f6a7b  Add tab limit tests (new id)');
    expect(d.text).toContain("main is now at e5f6a7b");
    expect(d.text).toContain("b2c3d4e and earlier commits are not changed.");
    expect(labels(d)).toEqual(["Rewrite 3 Commits", "Cancel"]);
    expect(defaults(d)).toEqual(["Cancel"]);
  });

  it("a long list is shortened, not hidden", () => {
    const many = Array.from({ length: 20 }, (_, i) => hc(`k${i}`.padEnd(7, "0"), `c${i}`, `k${i + 1}`.padEnd(7, "0")));
    const ls = lines(singlePlan("reword", many, "new"), many, null);
    expect(ls).toHaveLength(20);
    const text = rewriteList(ls);
    expect(text.split("\n")).toHaveLength(13);
    expect(text.endsWith("\nand 8 more")).toBe(true);
    expect(historyConfirm("reword", { branch: "main", tip: "k000000", commit: many[19], lines: ls, below: null, pushedOn: null }).text).toContain("20 commits on main get new ids:");
  });

  it("pushed commits get the danger dialog instead, never both", () => {
    const [c, d2] = [{ ...C, pushed: true }, { ...D, pushed: true }];
    const ls = lines(singlePlan("reword", [E, d2, c], "Add a limit on open tabs"), [E, d2, c], B.sha);
    const d = historyConfirm("reword", { branch: "main", tip: "e5f6a7b", commit: c, lines: ls, below: B, pushedOn: "origin/main" });
    expect(d.title).toBe("Rewrite commits that are already pushed?");
    expect(d.text).toContain("2 of the 3 commits are already on origin/main:\n\nc3d4e5f  Add tab limit\nd4e5f6a  Fix typo");
    expect(d.text).toContain("Anyone who has pulled them will have to repair their copy. A normal Push will be refused afterwards and Quarry will then offer Force Push. Revert This Commit… is the safe way to undo a pushed commit.");
    expect(d.text).toContain("3 commits on main get new ids:");
    expect(d.choices[0]).toMatchObject({ label: "Rewrite Pushed Commits", kind: "danger" });
    expect(defaults(d)).toEqual(["Cancel"]);
    expect(d.pushed).toBe(true);
    // Another remote branch is named; without a name it is still a warning.
    expect(historyConfirm("drop", { branch: "main", tip: "e5f6a7b", commit: c, lines: lines(singlePlan("drop", [E, D, c]), [E, D, c], B.sha), below: B, pushedOn: "origin/release" }).text).toContain("1 of the 3 commits is already on origin/release");
    // Squash into a pushed parent names the parent; the plan uses the same dialog.
    const squash = historyConfirm("squash", { branch: "main", tip: "e5f6a7b", commit: D, parent: c, lines: lines(singlePlan("squash", [E, D, c], "x"), [E, D, c], B.sha), below: B, pushedOn: "origin/main" });
    expect(squash.text).toContain("c3d4e5f  Add tab limit\n");
    expect(labels(historyConfirm("plan", { branch: "main", tip: "e5f6a7b", lines: ls, below: B, pushedOn: "origin/main" }))).toEqual(["Rewrite Pushed Commits", "Cancel"]);
    // Undo of a pushed tip.
    const undo = historyConfirm("undo", { branch: "main", tip: "e5f6a7b", commit: E, lines: [], below: D, pushedOn: "origin/main" });
    expect(undo.title).toBe("Rewrite commits that are already pushed?");
    expect(undo.text).toContain("This commit is already on origin/main:\n\ne5f6a7b  Add tab limit tests");
    expect(undo.choices[0]).toMatchObject({ label: "Undo Pushed Commit", kind: "danger" });
    // Only commits below the change are pushed: nothing pushed is rewritten.
    expect(historyConfirm("reword", { branch: "main", tip: "e5f6a7b", commit: E, lines: [{ commit: E, what: "reworded", detail: "x" }], below: D, pushedOn: "origin/main" }).pushed).toBe(false);
  });

  it("says what was done and where the branch was", () => {
    expect(historyDone("undo", { branch: "main", was: "e5f6a7b" })).toBe("Undid the last commit: its changes are staged. main was at e5f6a7b.");
    expect(historyDone("reword", { branch: "main", was: "e5f6a7b" })).toBe("Reworded the commit. main was at e5f6a7b.");
    expect(historyDone("drop", { branch: "main", was: "e5f6a7b", commit: D })).toBe('Dropped "Fix typo". main was at e5f6a7b.');
    expect(historyDone("squash", { branch: "main", was: "e5f6a7b", commit: D, parent: C })).toBe('Squashed "Fix typo" into "Add tab limit". main was at e5f6a7b.');
    expect(historyDone("plan", { branch: "main", was: "e5f6a7b", count: 3 })).toBe("Rewrote 3 commits on main. It was at e5f6a7b.");
    expect(historyDone("plan", { branch: "main", was: "e5f6a7b", count: 2 }, { upstream: "origin/main", on: "origin/main" })).toBe("Rewrote 2 commits on main. It was at e5f6a7b. origin/main still has the old commits: use Force Push… in Source Control to replace them.");
    expect(historyDone("drop", { branch: "main", was: "e5f6a7b", commit: D }, { upstream: null, on: "origin/release" })).toBe('Dropped "Fix typo". main was at e5f6a7b. origin/release still has the old commits.');
    expect(movedText("main", false)).toBe("main has changed since you started. Nothing was rewritten.");
    expect(movedText("main", true)).toBe("main has changed since this list was opened. Nothing was rewritten.");
    expect(tooMany(151)).toBe("That is 151 commits. The list takes at most 100: pick a more recent commit.");
    expect(allPushed("main")).toBe("Every commit on main is already pushed. To rewrite pushed commits, right-click a commit in the graph and choose Edit History from Here…");
  });

  it("after an undo of a pushed commit the status line offers Force Push, not Pull", () => {
    // Only behind the upstream: without the mark it would read "1 commit to pull".
    const st = status({ upstream: "origin/main", behind: 1 });
    expect(isRewritten("main", st)).toBe(true);
    expect(syncLine(3, 0, 1, "origin/main", "main")).toEqual({ kind: "warn", text: "3 uncommitted changes. main was rewritten: origin/main still has the old commit. Force Push replaces it with yours." });
    expect(syncLine(3, 0, 1, "origin/main").text).toBe("3 uncommitted changes, 1 commit to pull from origin/main.");
  });
});

// ---------- the actions (git.ts) ----------

const settle = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const dialog = () => useStore.getState().dialog;
const press = async (label: string) => {
  await settle();
  const a = dialog()?.actions.find((x) => x.label === label);
  if (!a) throw new Error(`no button "${label}" in ${dialog()?.title ?? "no dialog"}: ${dialog()?.actions.map((x) => x.label).join(" | ")}`);
  a.run();
  await settle();
};
const toasts = () => useStore.getState().toasts.map((t) => t.message);
const rewrites = () => api.historyRewrite.mock.calls.map((c) => c.slice(1));

describe("history edit actions", () => {
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockClear();
    api.status.mockResolvedValue(status());
    api.historyRange.mockImplementation(async (_r, from) => (from === "HEAD" ? range([E]) : from === C.sha ? range([E, D, C]) : from === D.sha ? range([E, D]) : from === E.sha ? range([E]) : range([E, D, C])));
    api.historyRewrite.mockResolvedValue("");
    useStore.setState({ dialog: null, toasts: [], docs: [], activeId: null, sidebarVisible: false, folder: ROOT });
    useGit.setState({ repos: { [KEY]: status() }, current: KEY, busy: null, rewrotePushed: {}, historyEdit: null, undone: null });
  });

  it("undo asks, runs against the tip it named, and hands the message back", async () => {
    const done = undoLastCommit(ROOT);
    await settle();
    expect(dialog()?.title).toBe("Undo the last commit?");
    expect(api.historyRewrite).not.toHaveBeenCalled();
    await press("Undo Commit");
    expect(await done).toBe(true);
    expect(rewrites()).toEqual([["undo", E.sha]]);
    expect(useGit.getState().undone).toEqual({ root: ROOT, message: "Add tab limit tests" });
    expect(toasts()).toContain("Undid the last commit: its changes are staged. main was at e5f6a7b.");
    expect(useGit.getState().rewrotePushed[KEY]).toBeUndefined();
  });

  it("undo runs with uncommitted changes, and cancelling changes nothing", async () => {
    api.status.mockResolvedValue(status({ files: [file("a.txt"), file("b.txt", { index: "M", worktree: "." })] }));
    const done = undoLastCommit(ROOT);
    await press("Cancel");
    expect(await done).toBe(false);
    expect(api.historyRewrite).not.toHaveBeenCalled();
    expect(useGit.getState().undone).toBeNull();
  });

  it("undo of a pushed commit warns, then marks the branch for Force Push", async () => {
    api.historyRange.mockResolvedValue(range([{ ...E, pushed: true }], { pushedOn: "origin/main" }));
    const done = undoLastCommit(ROOT);
    await settle();
    expect(dialog()?.title).toBe("Rewrite commits that are already pushed?");
    // Once undone the branch is one commit behind its upstream.
    api.status.mockResolvedValue(status({ head: "d4e5f6a", upstream: "origin/main", behind: 1 }));
    await press("Undo Pushed Commit");
    expect(await done).toBe(true);
    expect(useGit.getState().rewrotePushed[KEY]).toBe("main");
    expect(toasts().some((t) => t.endsWith("origin/main still has the old commits: use Force Push… in Source Control to replace them."))).toBe(true);
  });

  it("refuses without asking: detached, an operation, the first commit, another action running", async () => {
    api.historyRange.mockResolvedValue(range([E], { branch: null }));
    expect(await undoLastCommit(ROOT)).toBe(false);
    expect(toasts().pop()).toBe("You are not on a branch. Switch to a branch to edit its history.");
    api.historyRange.mockResolvedValue(range([E, D], { operation: "cherry-pick" }));
    expect(await dropCommit(ROOT, D.sha)).toBe(false);
    expect(toasts().pop()).toBe("Finish or abort the cherry-pick first.");
    api.historyRange.mockResolvedValue(range([A]));
    expect(await undoLastCommit(ROOT)).toBe(false);
    expect(toasts().pop()).toBe("This is the first commit: there is nothing to go back to.");
    expect(await dropCommit(ROOT, A.sha)).toBe(false);
    expect(toasts().pop()).toBe("The first commit can't be dropped.");
    api.historyRange.mockResolvedValue(range([], { onBranch: false }));
    expect(await rewordCommit(ROOT, id("9a8b7c6"), "x")).toBe(false);
    expect(toasts().pop()).toBe("Only commits on main can be edited. Switch to the commit's branch first.");
    useGit.setState({ busy: "Pulling…" });
    expect(await undoLastCommit(ROOT)).toBe(false);
    expect(toasts().pop()).toBe("Another git action is running.");
    expect(dialog()).toBeNull();
    expect(api.historyRewrite).not.toHaveBeenCalled();
  });

  it("a merge between the commit and the tip refuses every replay", async () => {
    const merge = hc("7c6d5e4", "Merge branch 'feature'", "d4e5f6a", { parents: [D.sha, id("f")] });
    api.historyRange.mockResolvedValue(range([E, merge, D, C]));
    expect(await dropCommit(ROOT, C.sha)).toBe(false);
    expect(toasts().pop()).toBe("The merge commit 7c6d5e4 comes after this commit. Quarry does not rewrite across a merge.");
    expect(await openHistoryEdit(ROOT, C.sha)).toBe(false);
    api.historyRange.mockResolvedValue(range([E, merge]));
    expect(await rewordCommit(ROOT, merge.sha, "x")).toBe(false);
    expect(toasts().pop()).toBe("A merge commit can't be edited here. Use Revert This Commit… to undo it.");
    expect(api.historyRewrite).not.toHaveBeenCalled();
  });

  it("uncommitted changes block a replay with the shared dialog, and nothing runs", async () => {
    api.status.mockResolvedValue(status({ files: [file("a.txt"), file("b.txt"), file("c.txt"), file("new.txt", { untracked: true, index: "?", worktree: "?" })] }));
    for (const start of [() => dropCommit(ROOT, D.sha), () => rewordCommit(ROOT, D.sha, "Fix a typo"), () => squashCommit(ROOT, D.sha, "x"), () => loadEditCommit(ROOT, D.sha, "reword"), () => openHistoryEdit(ROOT, C.sha)]) {
      const done = start();
      await settle();
      expect(dialog()?.title).toBe("Commit or discard your changes first");
      expect(dialog()?.message).toContain("There are 3 uncommitted changes to tracked files. A history edit is only started from a clean state");
      expect(dialog()?.actions.map((a) => a.label)).toEqual(["Show Source Control", "Close"]);
      await press("Close");
      expect(await done).toBeFalsy();
    }
    expect(api.historyRewrite).not.toHaveBeenCalled();
    expect(useGit.getState().historyEdit).toBeNull();
    // Show Source Control opens the panel.
    const done = dropCommit(ROOT, D.sha);
    await press("Show Source Control");
    await done;
    expect(isPanelShown(useStore.getState(), "git")).toBe(true);
  });

  it("rewording the tip amends it, also with uncommitted changes", async () => {
    api.status.mockResolvedValue(status({ files: [file("a.txt")] }));
    const done = rewordCommit(ROOT, E.sha, "Add tab limit tests, properly\n");
    await settle();
    expect(dialog()?.title).toBe("Reword this commit?");
    await press("Reword");
    expect(await done).toBe(true);
    expect(rewrites()).toEqual([["reword", E.sha, null, [], "Add tab limit tests, properly"]]);
    expect(toasts()).toContain("Reworded the commit. main was at e5f6a7b.");
  });

  it("an unchanged or empty message never reaches git; cancelling keeps the strip", async () => {
    expect(await rewordCommit(ROOT, E.sha, "Add tab limit tests")).toBe(false);
    expect(await rewordCommit(ROOT, E.sha, "  ")).toBe(false);
    const done = rewordCommit(ROOT, C.sha, "Add a limit on open tabs");
    await press("Cancel");
    expect(await done).toBe(false);
    expect(api.historyRewrite).not.toHaveBeenCalled();
  });

  it("rewording an older commit replays it and the commits after it", async () => {
    const done = rewordCommit(ROOT, C.sha, "Add a limit on open tabs");
    await settle();
    expect(dialog()?.message).toContain("3 commits on main get new ids:");
    await press("Reword");
    expect(await done).toBe(true);
    expect(rewrites()).toEqual([["plan", E.sha, B.sha, [{ sha: C.sha, action: "pick", message: "Add a limit on open tabs" }, { sha: D.sha, action: "pick", message: null }, { sha: E.sha, action: "pick", message: null }]]]);
  });

  it("drop asks in a danger dialog and replays what comes after", async () => {
    const done = dropCommit(ROOT, D.sha);
    await settle();
    expect(dialog()?.title).toBe("Drop this commit?");
    expect(dialog()?.actions.find((a) => a.label === "Drop Commit")?.kind).toBe("danger");
    await press("Drop Commit");
    expect(await done).toBe(true);
    expect(rewrites()).toEqual([["plan", E.sha, C.sha, [{ sha: D.sha, action: "drop", message: null }, { sha: E.sha, action: "pick", message: null }]]]);
    expect(toasts()).toContain('Dropped "Fix typo". main was at e5f6a7b.');
  });

  it("squash reads the parent's range and folds the commit into it", async () => {
    expect(await loadEditCommit(ROOT, D.sha, "squash")).toMatchObject({ commit: { short: "d4e5f6a" }, parent: { short: "c3d4e5f" } });
    const done = squashCommit(ROOT, D.sha, "Add tab limit");
    await settle();
    expect(dialog()?.title).toBe("Squash into the parent?");
    await press("Squash");
    expect(await done).toBe(true);
    expect(rewrites()).toEqual([["plan", E.sha, B.sha, [{ sha: C.sha, action: "pick", message: "Add tab limit" }, { sha: D.sha, action: "fixup", message: null }, { sha: E.sha, action: "pick", message: null }]]]);
    expect(toasts()).toContain('Squashed "Fix typo" into "Add tab limit". main was at e5f6a7b.');
    // A merge parent: refused before the strip opens.
    const merge = hc("c3d4e5f", "Merge branch 'feature'", "b2c3d4e", { parents: [B.sha, id("f")] });
    api.historyRange.mockImplementation(async (_r, from) => (from === D.sha ? range([E, D]) : range([E, D, merge])));
    expect(await loadEditCommit(ROOT, D.sha, "squash")).toBeNull();
    expect(toasts().pop()).toBe("The parent is a merge commit: nothing can be squashed into it.");
  });

  it("the branch moved while the dialog was open: nothing is rewritten and it says so", async () => {
    api.historyRewrite.mockRejectedValue("quarry-moved: the branch has changed since the question was asked. Nothing was rewritten.");
    const done = dropCommit(ROOT, D.sha);
    await press("Drop Commit");
    expect(await done).toBe(false);
    expect(toasts()).toContain("main has changed since you started. Nothing was rewritten.");
    expect(toasts().some((t) => t.includes("quarry-moved"))).toBe(false);
  });

  it("a stop on a conflict shows Source Control and counts as rewritten only once Continue finishes it", async () => {
    api.historyRange.mockResolvedValue(range([E, { ...D, pushed: true }], { pushedOn: "origin/main" }));
    api.historyRewrite.mockRejectedValue("CONFLICT (content): Merge conflict in src/tabs.ts\nerror: could not apply e5f6a7b... Add tab limit tests\nhint: Resolve all conflicts manually");
    const done = dropCommit(ROOT, D.sha);
    await settle();
    expect(dialog()?.title).toBe("Rewrite commits that are already pushed?");
    api.status.mockResolvedValue(status({ operation: "rebase", operationStep: [1, 1], upstream: "origin/main", behind: 2, ahead: 0 }));
    await press("Rewrite Pushed Commits");
    expect(await done).toBe(false);
    expect(toasts().some((t) => t.startsWith("Stopped on a conflict.") && t.includes("CONFLICT (content)") && !t.includes("hint:"))).toBe(true);
    expect(isPanelShown(useStore.getState(), "git")).toBe(true);
    expect(useGit.getState().rewrotePushed[KEY]).toBeUndefined();
    // Continue finishes the rebase: now the status line offers Force Push.
    api.continueOp.mockResolvedValue("rebase");
    api.status.mockResolvedValue(status({ upstream: "origin/main", behind: 2, ahead: 1 }));
    await continueOperation(ROOT, "rebase", "continue");
    expect(useGit.getState().rewrotePushed[KEY]).toBe("main");
  });

  it("an abort after a stop offers no Force Push", async () => {
    api.historyRange.mockResolvedValue(range([E, { ...D, pushed: true }], { pushedOn: "origin/main" }));
    api.historyRewrite.mockRejectedValue("CONFLICT (content): Merge conflict in a.txt");
    const done = dropCommit(ROOT, D.sha);
    api.status.mockResolvedValue(status({ operation: "rebase", upstream: "origin/main" }));
    await press("Rewrite Pushed Commits");
    await done;
    api.abort.mockResolvedValue("rebase");
    await abortOperation(ROOT, "rebase");
    api.status.mockResolvedValue(status({ upstream: "origin/main", behind: 2, ahead: 1 }));
    api.continueOp.mockResolvedValue("rebase");
    await continueOperation(ROOT, "rebase", "continue");
    expect(useGit.getState().rewrotePushed[KEY]).toBeUndefined();
  });

  it("a failure that is not a conflict shows git's message without its hints", async () => {
    api.historyRewrite.mockRejectedValue("error: cannot rebase: something is wrong\nhint: try again");
    const done = dropCommit(ROOT, D.sha);
    await press("Drop Commit");
    expect(await done).toBe(false);
    expect(toasts()).toContain("error: cannot rebase: something is wrong");
  });

  it("Edit History… opens over the commits not pushed", async () => {
    api.historyRange.mockImplementation(async (_r, from) => (from === null ? range([E, D, C]) : range([E, D, C])));
    expect(await openHistoryEdit(ROOT)).toBe(true);
    expect(api.historyRange.mock.calls.map((c) => c[1])).toEqual([null, C.sha]);
    expect(useGit.getState().historyEdit).toMatchObject({ root: ROOT, range: { commits: [{ short: "e5f6a7b" }, { short: "d4e5f6a" }, { short: "c3d4e5f" }] } });
    expect(useStore.getState().docs.some((d) => d.kind === "graph")).toBe(true);
    expect(api.historyRewrite).not.toHaveBeenCalled();
  });

  it("Edit History… with everything pushed, on a merge tip, or with too many commits opens nothing", async () => {
    api.historyRange.mockResolvedValue(range([], { total: 0, tip: E.sha }));
    expect(await openHistoryEdit(ROOT)).toBe(false);
    expect(toasts().pop()).toBe("Every commit on main is already pushed. To rewrite pushed commits, right-click a commit in the graph and choose Edit History from Here…");
    const merge = hc("7c6d5e4", "Merge", "d4e5f6a", { parents: [D.sha, id("f")] });
    api.historyRange.mockResolvedValue(range([merge, D], { tip: merge.sha }));
    expect(await openHistoryEdit(ROOT)).toBe(false);
    expect(toasts().pop()).toMatch(/^The last commit on main is a merge commit/);
    api.historyRange.mockResolvedValue(range([E, D, C], { total: 151 }));
    expect(await openHistoryEdit(ROOT, C.sha)).toBe(false);
    expect(toasts().pop()).toBe("That is 151 commits. The list takes at most 100: pick a more recent commit.");
    api.status.mockResolvedValue(status({ branch: null }));
    expect(await openHistoryEdit(ROOT)).toBe(false);
    expect(toasts().pop()).toBe("You are not on a branch. Switch to a branch to edit its history.");
    expect(useGit.getState().historyEdit).toBeNull();
  });

  it("running the list goes through the same guards and the plan dialog", async () => {
    const opened = range([E, D, C]);
    const rows = setMessage(setAction(setAction(initialPlan(opened.commits), 1, "fixup"), 2, "reword"), 2, "Add a limit on open tabs");
    const done = runHistoryEdit(ROOT, opened, rows);
    await settle();
    expect(dialog()?.title).toBe("Rewrite 3 commits on main?");
    await press("Rewrite 3 Commits");
    expect(await done).toBe("done");
    expect(rewrites()).toEqual([["plan", E.sha, B.sha, [{ sha: C.sha, action: "pick", message: "Add a limit on open tabs" }, { sha: D.sha, action: "fixup", message: null }, { sha: E.sha, action: "pick", message: null }]]]);
    expect(toasts()).toContain("Rewrote 3 commits on main. It was at e5f6a7b.");
    // Cancelled: the plan is kept by the caller, git is not run.
    api.historyRewrite.mockClear();
    const again = runHistoryEdit(ROOT, opened, rows);
    await press("Cancel");
    expect(await again).toBe("cancelled");
    expect(api.historyRewrite).not.toHaveBeenCalled();
  });

  it("the list's run notices a moved branch, pushed commits read fresh, and new uncommitted changes", async () => {
    const opened = range([E, D, C]);
    const rows = setAction(initialPlan(opened.commits), 1, "drop");
    // A commit was added since the list opened.
    const F = hc("f6a7b8c", "Later", "e5f6a7b");
    api.historyRange.mockResolvedValue(range([F, E, D, C]));
    expect(await runHistoryEdit(ROOT, opened, rows)).toBe("moved");
    expect(toasts().pop()).toBe("main has changed since this list was opened. Nothing was rewritten.");
    // Pushed since the list opened: the danger dialog.
    api.historyRange.mockResolvedValue(range([E, { ...D, pushed: true }, { ...C, pushed: true }], { pushedOn: "origin/main" }));
    const done = runHistoryEdit(ROOT, opened, rows);
    await settle();
    expect(dialog()?.title).toBe("Rewrite commits that are already pushed?");
    await press("Cancel");
    expect(await done).toBe("cancelled");
    // Uncommitted changes appeared.
    api.status.mockResolvedValue(status({ files: [file("a.txt")] }));
    const dirty = runHistoryEdit(ROOT, opened, rows);
    await settle();
    expect(dialog()?.title).toBe("Commit or discard your changes first");
    await press("Close");
    expect(await dirty).toBe("cancelled");
    expect(api.historyRewrite).not.toHaveBeenCalled();
  });
});
