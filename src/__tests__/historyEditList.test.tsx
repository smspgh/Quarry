import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHistoryCommit, GitHistoryRange, GitStatus } from "../lib/gitApi";

// The Edit History list (specs/git-history-edit.md, HISTORY-007 to HISTORY-009): rows, actions by
// mouse and keyboard, message boxes, problems, Run and Cancel. The Tauri side is replaced.
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ status: undefined as unknown, range: undefined as unknown, rewrite: "" as string | Error }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "git_available") return "git version 2.53.0";
    if (cmd === "git_status") return answers.status;
    if (cmd === "git_history_range") return answers.range;
    if (cmd === "git_stash_list") return [];
    if (cmd === "git_history_rewrite") {
      if (answers.rewrite instanceof Error) throw answers.rewrite.message;
      return answers.rewrite;
    }
    return undefined;
  },
}));

const { render, cleanup, flush, fire, act } = await import("./helpers/render");
const { HistoryEditList } = await import("../components/HistoryEditList");
const { useGit } = await import("../lib/git");
const { useStore } = await import("../lib/store");

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const id = (name: string) => name.padEnd(40, "0");
const hc = (short: string, summary: string, parent: string | null, extra: Partial<GitHistoryCommit> = {}): GitHistoryCommit => ({ sha: id(short), short, summary, message: summary, author: "Ada", email: "ada@example.com", time: 1_700_000_000, parents: parent ? [id(parent)] : [], pushed: false, ...extra });
const E = hc("e5f6a7b", "Add tab limit tests", "d4e5f6a");
const D = hc("d4e5f6a", "Fix typo", "c3d4e5f");
const C = hc("c3d4e5f", "Add tab limit", "b2c3d4e");
const range = (commits = [E, D, C], extra: Partial<GitHistoryRange> = {}): GitHistoryRange => ({ branch: "main", tip: E.sha, operation: null, onBranch: true, commits, total: commits.length, base: { sha: id("b2c3d4e"), short: "b2c3d4e", summary: "Rename helper" }, pushedOn: null, ...extra });
const status = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "e5f6a7b", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], headParents: 1, ...extra });

const list = () => document.querySelector<HTMLElement>(".he-list")!;
const rows = () => [...document.querySelectorAll<HTMLElement>(".he-row")];
const shorts = () => rows().map((r) => r.querySelector(".he-sha")!.textContent);
const actionOf = (i: number) => rows()[i].querySelector(".select-label")!.textContent;
const button = (label: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>(".he-foot button")].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  return b;
};
const boxes = () => [...document.querySelectorAll<HTMLTextAreaElement>("textarea.he-box")];
const key = (k: string, init: KeyboardEventInit = {}) => fire.keyDown(list(), k, init);
const type = async (el: HTMLTextAreaElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const dialog = () => useStore.getState().dialog;
const press = async (label: string) => {
  await flush();
  const a = dialog()?.actions.find((x) => x.label === label);
  if (!a) throw new Error(`no button "${label}" in ${dialog()?.title}`);
  await act(async () => a.run());
  await flush(16);
};
const show = async (r: GitHistoryRange = range()) => {
  answers.range = r;
  useGit.setState({ repos: { [KEY]: status() }, current: KEY, busy: null, historyEdit: { root: ROOT, range: r, seq: 1 } });
  await render(<HistoryEditList root={ROOT} range={r} visible />);
  await flush();
};

describe("Edit History list", () => {
  beforeEach(() => {
    calls.length = 0;
    answers.status = status();
    answers.rewrite = "";
    useStore.setState({ dialog: null, toasts: [], folder: ROOT, docs: [], activeId: null });
  });
  afterEach(async () => {
    dialog()?.actions.find((a) => a.cancel)?.run();
    await cleanup();
    useGit.setState({ repos: {}, busy: null, historyEdit: null });
  });

  it("opens with every commit Pick, newest first, and nothing to run", async () => {
    await show();
    expect(document.querySelector(".he-title")?.textContent).toBe("Edit history of main: 3 commits since b2c3d4e");
    expect(shorts()).toEqual(["e5f6a7b", "d4e5f6a", "c3d4e5f"]);
    expect([0, 1, 2].map(actionOf)).toEqual(["Pick", "Pick", "Pick"]);
    for (const r of rows()) {
      expect(r.querySelector(".he-handle")).not.toBeNull();
      expect(r.querySelector(".he-author")?.textContent).toBe("Ada");
      expect(r.querySelector(".he-date")?.textContent).not.toBe("");
    }
    expect(rows()[0].querySelector(".he-msg")?.textContent).toBe("Add tab limit tests");
    expect(document.querySelector(".he-below")?.textContent).toBe("b2c3d4e Rename helper and earlier commits are not changed");
    expect(button("Run").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(false);
    expect(document.activeElement).toBe(list());
    // Nothing was asked of git by opening it.
    expect(calls.filter((c) => c.cmd === "git_history_rewrite")).toEqual([]);
  });

  it("marks pushed rows and warns above them", async () => {
    await show(range([E, D, { ...C, pushed: true }], { pushedOn: "origin/main" }));
    const badge = rows()[2].querySelector<HTMLElement>(".he-badge.pushed");
    expect(badge?.textContent).toBe("pushed");
    expect(badge?.title).toBe("Already on origin/main");
    expect(rows()[0].querySelector(".he-badge.pushed")).toBeNull();
    expect(document.querySelector(".he-warning")?.textContent).toBe("1 of these commits is already pushed. Changing it or anything below a change rewrites pushed history.");
  });

  it("the whole history says so under the rows", async () => {
    await show(range([E, D, C], { base: null }));
    expect(document.querySelector(".he-below")?.textContent).toBe("This is the whole history of main");
  });

  it("the action picker offers the five actions; the bottom row cannot fold", async () => {
    await show();
    await fire.click(rows()[1].querySelector(".select-btn")!);
    const opts = () => [...document.querySelectorAll<HTMLButtonElement>(".select-option")];
    expect(opts().map((o) => o.querySelector(".select-text")?.textContent)).toEqual(["Pick", "Reword", "Squash", "Fixup", "Drop"]);
    expect(opts()[2].title).toBe("Fold into the commit below and join the messages");
    expect(opts()[3].title).toBe("Fold into the commit below and discard this message");
    await fire.click(opts()[4]);
    expect(actionOf(1)).toBe("Drop");
    expect(rows()[1].classList.contains("drop")).toBe(true);
    expect(button("Run").disabled).toBe(false);
    await fire.click(rows()[2].querySelector(".select-btn")!);
    for (const i of [2, 3]) {
      expect(opts()[i].getAttribute("aria-disabled")).toBe("true");
      expect(opts()[i].title).toBe("There is no commit below to fold into");
    }
    await fire.click(opts()[2]);
    expect(actionOf(2)).toBe("Pick");
  });

  it("keys select, mark and move rows while the list has the focus", async () => {
    await show();
    expect(rows()[0].getAttribute("aria-selected")).toBe("true");
    await key("ArrowDown");
    expect(rows()[1].getAttribute("aria-selected")).toBe("true");
    await key("d");
    expect(actionOf(1)).toBe("Drop");
    await key("p");
    expect(actionOf(1)).toBe("Pick");
    await key("f");
    expect(actionOf(1)).toBe("Fixup");
    await key("s");
    expect(actionOf(1)).toBe("Squash");
    await key("p");
    await key("ArrowUp");
    // Alt+Down moves the selected row and keeps it selected; the ends do nothing.
    await key("ArrowUp", { altKey: true });
    expect(shorts()).toEqual(["e5f6a7b", "d4e5f6a", "c3d4e5f"]);
    await key("ArrowDown", { altKey: true });
    expect(shorts()).toEqual(["d4e5f6a", "e5f6a7b", "c3d4e5f"]);
    expect(rows()[1].getAttribute("aria-selected")).toBe("true");
    expect(button("Run").disabled).toBe(false);
    await key("ArrowUp", { altKey: true });
    expect(shorts()).toEqual(["e5f6a7b", "d4e5f6a", "c3d4e5f"]);
    expect(button("Run").disabled).toBe(true);
    await key("ArrowDown", { altKey: true });
    await key("ArrowDown", { altKey: true });
    await key("ArrowDown", { altKey: true });
    expect(shorts()).toEqual(["d4e5f6a", "c3d4e5f", "e5f6a7b"]);
    // Squash / Fixup on the bottom row: not offered, the key does nothing.
    await key("s");
    expect(actionOf(2)).toBe("Pick");
    // Modified letters are not the list's.
    await key("d", { ctrlKey: true });
    expect(actionOf(2)).toBe("Pick");
  });

  it("the keys act only with the focus on the list itself", async () => {
    await show();
    await key("ArrowDown");
    // Typed somewhere else in the window (another tab, a panel's message box): nothing changes here.
    const other = document.createElement("textarea");
    document.body.appendChild(other);
    other.focus();
    for (const k of ["d", "s"]) await fire.keyDown(other, k);
    await fire.keyDown(other, "ArrowDown", { altKey: true });
    await fire.keyDown(window, "d");
    expect([0, 1, 2].map(actionOf)).toEqual(["Pick", "Pick", "Pick"]);
    expect(shorts()).toEqual(["e5f6a7b", "d4e5f6a", "c3d4e5f"]);
    // The list marks its container for the global shortcut handler, which leaves its keys alone.
    expect(list().hasAttribute("data-history-keys")).toBe(true);
    // In a message box of the list, letters are text.
    list().focus();
    await key("r");
    const box = boxes()[0];
    expect(document.activeElement).toBe(box);
    await fire.keyDown(box, "d");
    await fire.keyDown(box, "ArrowDown", { altKey: true });
    expect(actionOf(1)).toBe("Reword");
    expect(shorts()).toEqual(["e5f6a7b", "d4e5f6a", "c3d4e5f"]);
  });

  it("reword opens a message box; the row shows the new message once it is left", async () => {
    await show(range([E, { ...D, message: "Fix typo\n\nIn the tab limit dialog." }, C]));
    await key("ArrowDown");
    await key("r");
    expect(actionOf(1)).toBe("Reword");
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0].value).toBe("Fix typo\n\nIn the tab limit dialog.");
    // Left as it was: still nothing to run.
    expect(button("Run").disabled).toBe(true);
    await type(boxes()[0], "Fix a typo in the tab limit dialog");
    await fire.keyDown(boxes()[0], "Enter", { ctrlKey: true });
    await flush();
    expect(document.activeElement).toBe(list());
    expect(boxes()).toHaveLength(0);
    expect(rows()[1].querySelector(".he-msg")?.textContent).toBe("Fix a typo in the tab limit dialog");
    const mark = rows()[1].querySelector<HTMLElement>(".he-badge.reworded");
    expect(mark?.textContent).toBe("reworded");
    expect(mark?.title).toBe("Was: Fix typo\n\nIn the tab limit dialog.");
    expect(button("Run").disabled).toBe(false);
    // Enter on the row opens the box again; emptied, the row is marked and Run is off.
    await key("Enter");
    await type(boxes()[0], "  ");
    expect(rows()[1].querySelector(".he-problem")?.textContent).toBe("A commit needs a message");
    expect(button("Run").disabled).toBe(true);
  });

  it("squash shows the joined message on the row below; fixup does not", async () => {
    await show();
    await key("ArrowDown");
    await key("s");
    expect(rows()[1].classList.contains("fold")).toBe(true);
    expect(rows()[1].querySelector(".he-arrow")?.textContent).toBe("c3d4e5f");
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0].value).toBe("Add tab limit\n\nFix typo");
    expect(boxes()[0].getAttribute("aria-label")).toBe("Message for c3d4e5f and the commits squashed into it");
    // The list keeps the focus: the box is there to edit, not forced on me.
    expect(document.activeElement).toBe(list());
    await key("ArrowUp");
    await key("s");
    expect(boxes()[0].value).toBe("Add tab limit\n\nFix typo\n\nAdd tab limit tests");
    await type(boxes()[0], "");
    expect(rows()[2].querySelector(".he-problem")?.textContent).toBe("A commit needs a message");
    expect(button("Run").disabled).toBe(true);
    await key("f");
    await key("ArrowDown");
    await key("f");
    expect(boxes()).toHaveLength(0);
    expect(rows()[1].querySelector(".he-arrow")?.textContent).toBe("c3d4e5f");
    expect(rows()[2].querySelector(".he-msg")?.textContent).toBe("Add tab limit");
    expect(button("Run").disabled).toBe(false);
  });

  it("a fold with nothing below, and dropping everything, cannot run", async () => {
    await show();
    await key("ArrowDown");
    await key("s");
    await key("ArrowDown");
    await key("d");
    expect(rows()[1].querySelector(".he-problem")?.textContent).toBe("Nothing below to fold into: choose Pick or move it up");
    expect(button("Run").disabled).toBe(true);
    // A squash above a dropped row reaches past it.
    await key("p");
    await key("ArrowUp");
    await key("d");
    await key("ArrowUp");
    await key("s");
    expect(rows()[0].querySelector(".he-arrow")?.textContent).toBe("c3d4e5f");
    expect(button("Run").disabled).toBe(false);
    // Everything dropped.
    for (const _ of [0, 1, 2]) {
      await key("d");
      await key("ArrowDown");
    }
    expect(document.querySelector(".he-note")?.textContent).toBe("To remove all of these commits, use Reset main to Here on b2c3d4e");
    expect(button("Run").disabled).toBe(true);
  });

  it("Reset List puts every row back", async () => {
    await show();
    expect(button("Reset List").disabled).toBe(true);
    await key("d");
    await key("ArrowDown", { altKey: true });
    await fire.click(button("Reset List"));
    expect(shorts()).toEqual(["e5f6a7b", "d4e5f6a", "c3d4e5f"]);
    expect([0, 1, 2].map(actionOf)).toEqual(["Pick", "Pick", "Pick"]);
    expect(button("Run").disabled).toBe(true);
  });

  it("Cancel closes an untouched list at once and asks before discarding a plan", async () => {
    await show();
    await key("d");
    await key("Escape");
    await flush();
    expect(dialog()?.title).toBe("Discard this plan?");
    expect(dialog()?.actions.map((a) => a.label)).toEqual(["Discard", "Keep Editing"]);
    expect(dialog()?.actions.find((a) => a.default && a.cancel)?.label).toBe("Keep Editing");
    await press("Keep Editing");
    expect(useGit.getState().historyEdit).not.toBeNull();
    expect(actionOf(0)).toBe("Drop");
    await fire.click(button("Cancel"));
    await press("Discard");
    expect(useGit.getState().historyEdit).toBeNull();
    expect(calls.some((c) => c.cmd === "git_history_rewrite")).toBe(false);
    // Untouched: no question.
    await cleanup();
    await show();
    await fire.click(button("Cancel"));
    await flush();
    expect(dialog()).toBeNull();
    expect(useGit.getState().historyEdit).toBeNull();
  });

  it("Run shows the plan, runs it on confirmation and closes the list", async () => {
    await show();
    await key("ArrowDown");
    await key("f");
    await key("Enter", { ctrlKey: true });
    await flush(6);
    expect(dialog()?.title).toBe("Rewrite 3 commits on main?");
    expect(dialog()?.message).toContain("c3d4e5f  Add tab limit (takes in the commits folded into it)\nd4e5f6a  Fix typo (folded into c3d4e5f, its message discarded)\ne5f6a7b  Add tab limit tests (new id)");
    expect(dialog()?.actions.find((a) => a.default && a.cancel)?.label).toBe("Cancel");
    expect(calls.some((c) => c.cmd === "git_history_rewrite")).toBe(false);
    await press("Rewrite 3 Commits");
    const run = calls.find((c) => c.cmd === "git_history_rewrite");
    expect(run?.args).toEqual({ root: ROOT, action: "plan", expectedTip: E.sha, base: id("b2c3d4e"), steps: [{ sha: C.sha, action: "pick", message: null }, { sha: D.sha, action: "fixup", message: null }, { sha: E.sha, action: "pick", message: null }], message: null });
    expect(useGit.getState().historyEdit).toBeNull();
    expect(useStore.getState().toasts.map((t) => t.message)).toContain("Rewrote 3 commits on main. It was at e5f6a7b.");
  });

  it("cancelling the confirmation, a refusal and a failure keep the list and its choices", async () => {
    await show();
    await key("d");
    await fire.click(button("Run"));
    await press("Cancel");
    expect(useGit.getState().historyEdit).not.toBeNull();
    expect(actionOf(0)).toBe("Drop");
    // Uncommitted changes appeared: the shared refusal, and the list stays.
    answers.status = status({ files: [{ path: `${ROOT}\\a.txt`, origPath: null, index: ".", worktree: "M", conflicted: false, untracked: false }] });
    await fire.click(button("Run"));
    await flush(6);
    expect(dialog()?.title).toBe("Commit or discard your changes first");
    await press("Close");
    expect(actionOf(0)).toBe("Drop");
    // Git refuses to start.
    answers.status = status();
    answers.rewrite = new Error("error: could not start\nhint: something");
    await fire.click(button("Run"));
    await press("Rewrite 1 Commit");
    expect(useGit.getState().historyEdit).not.toBeNull();
    expect(actionOf(0)).toBe("Drop");
    expect(useStore.getState().toasts.map((t) => t.message)).toContain("error: could not start");
  });

  it("a run that stops on a conflict closes the list", async () => {
    await show();
    await key("ArrowDown");
    await key("d");
    answers.rewrite = new Error("CONFLICT (content): Merge conflict in a.txt");
    await fire.click(button("Run"));
    await flush(6);
    answers.status = status({ operation: "rebase", operationStep: [1, 1] });
    await press("Rewrite 2 Commits");
    expect(useGit.getState().historyEdit).toBeNull();
    expect(useStore.getState().toasts.some((t) => t.message.startsWith("Stopped on a conflict."))).toBe(true);
  });

  it("the branch changed while the list was open: nothing runs and the list reloads", async () => {
    await show();
    await key("d");
    const later = hc("f6a7b8c", "Later", "e5f6a7b");
    answers.range = range([later, E, D, C], { tip: later.sha });
    await fire.click(button("Run"));
    await flush(8);
    expect(useStore.getState().toasts.map((t) => t.message)).toContain("main has changed since this list was opened. Nothing was rewritten.");
    expect(calls.some((c) => c.cmd === "git_history_rewrite")).toBe(false);
    // Reopened from the same commit (a new opening: every row Pick again).
    expect(useGit.getState().historyEdit).toMatchObject({ seq: 2, range: { commits: [{ short: "f6a7b8c" }, { short: "e5f6a7b" }, { short: "d4e5f6a" }, { short: "c3d4e5f" }] } });
  });

  it("Run is off while another git action is running", async () => {
    await show();
    await key("d");
    expect(button("Run").disabled).toBe(false);
    await act(async () => useGit.setState({ busy: "Pulling…" }));
    expect(button("Run").disabled).toBe(true);
    expect(button("Run").title).toBe("Another git action is running");
  });
});
