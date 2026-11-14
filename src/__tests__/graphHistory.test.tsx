import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitGraphCommit, GitHistoryCommit, GitHistoryRange, GitStatus } from "../lib/gitApi";
import type { Doc } from "../lib/store";

// GraphView's Edit History pieces (specs/git-history-edit.md): the commit menu's group (HISTORY-001),
// the Reword / Squash message strip (HISTORY-003, HISTORY-005) and the list in place of the rows
// (HISTORY-007). The Tauri side is replaced.
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ page: [] as unknown[], status: undefined as unknown, range: (_from: string | null): unknown => undefined }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "git_available") return "git version 2.53.0";
    if (cmd === "git_graph") return answers.page;
    if (cmd === "git_graph_indexed") return true;
    if (cmd === "git_status") return answers.status;
    if (cmd === "git_stash_list") return [];
    if (cmd === "git_history_range") return answers.range(args.from as string | null);
    if (cmd === "git_history_rewrite") return "";
    return undefined;
  },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: async () => undefined }));

const { render, cleanup, flush, fire, act } = await import("./helpers/render");
const { GraphView } = await import("../components/GraphView");
const { useGit } = await import("../lib/git");
const { useStore } = await import("../lib/store");

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const sha = (n: number) => `${n}`.repeat(40);
const commit = (n: number, parents: number[], refs: string[] = [], summary = `Commit number ${n}`): GitGraphCommit => ({ sha: sha(n), short: `${n}`.repeat(7), parents: parents.map(sha), author: "Ada", email: "ada@example.com", time: 1_700_000_000 - n * 3600, refs, summary });
// main: 1 (tip) -> 2 -> 3 -> 4 -> 5 (first commit); 9 is only on "feature".
const PAGE = [commit(9, [3], ["refs/heads/feature"]), commit(1, [2], ["HEAD", "refs/heads/main"]), commit(2, [3]), commit(3, [4]), commit(4, [5]), commit(5, [])];
const doc = { id: "graph-1", kind: "graph", name: "Graph", graph: { root: ROOT } } as unknown as Doc;
const repo = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "1111111", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], headParents: 1, ...extra });
const hc = (n: number, extra: Partial<GitHistoryCommit> = {}): GitHistoryCommit => ({ sha: sha(n), short: `${n}`.repeat(7), summary: `Commit number ${n}`, message: `Commit number ${n}`, author: "Ada", email: "ada@example.com", time: 1_700_000_000, parents: n < 5 ? [sha(n + 1)] : [], pushed: false, ...extra });
/** The range from commit `n` up to the tip (commit 1). */
const rangeFrom = (n: number, extra: Partial<GitHistoryRange> = {}): GitHistoryRange => {
  const commits = Array.from({ length: n }, (_, i) => hc(i + 1));
  return { branch: "main", tip: sha(1), operation: null, onBranch: true, commits, total: n, base: n < 5 ? { sha: sha(n + 1), short: `${n + 1}`.repeat(7), summary: `Commit number ${n + 1}` } : null, pushedOn: null, ...extra };
};

const GROUP = ["Reword Message…", "Squash into Parent…", "Drop Commit…", "Edit History from Here…"];
const rows = () => [...document.querySelectorAll<HTMLElement>(".graph-list [role=option]")];
const row = (n: number) => rows().find((r) => r.textContent?.includes(`Commit number ${n}`))!;
const entries = () => [...document.querySelectorAll<HTMLButtonElement>(".graph-menu[role=menu] [role=menuitem]")];
const labels = () => entries().map((b) => b.textContent);
const entry = (text: string) => {
  const b = entries().find((x) => x.textContent === text);
  if (!b) throw new Error(`no entry "${text}" in ${labels().join(" | ")}`);
  return b;
};
const strip = () => document.querySelector<HTMLElement>(".graph-message-strip");
const box = () => strip()!.querySelector("textarea")!;
const stripButton = () => [...strip()!.querySelectorAll("button")].find((b) => b.textContent === "Reword" || b.textContent === "Squash")!;
const dialog = () => useStore.getState().dialog;
const type = async (el: HTMLTextAreaElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const show = async (status: GitStatus = repo()) => {
  answers.status = status;
  useGit.setState({ repos: { [KEY]: status }, current: KEY, busy: null, historyEdit: null });
  const m = await render(<GraphView doc={doc} visible />);
  await flush();
  return m;
};
const choose = async (n: number, text: string) => {
  await fire.contextMenu(row(n));
  await fire.click(entry(text));
  await flush(8);
};

describe("GraphView: edit history", () => {
  beforeEach(() => {
    calls.length = 0;
    answers.page = PAGE;
    answers.range = (from) => rangeFrom(from === "HEAD" ? 1 : Number(String(from)[0]));
    useStore.setState({ dialog: null, toasts: [], folder: ROOT });
  });
  afterEach(async () => {
    dialog()?.actions.find((a) => a.cancel)?.run();
    await cleanup();
    useGit.setState({ repos: {}, busy: null, historyEdit: null });
  });

  it("the group comes after the Reset entries; Drop is styled as dangerous; all enabled", async () => {
    await show();
    await fire.contextMenu(row(2));
    const at = labels().indexOf("Reset main to Here (Hard)…");
    expect(labels().slice(at + 1, at + 5)).toEqual(GROUP);
    expect(entry("Drop Commit…").classList.contains("danger")).toBe(true);
    for (const text of GROUP) expect(entry(text).disabled).toBe(false);
    expect(labels()).not.toContain("Undo Last Commit…");
  });

  it("Undo Last Commit only shows on the tip, first in the group", async () => {
    await show();
    await fire.contextMenu(row(1));
    const at = labels().indexOf("Reset main to Here (Hard)…");
    expect(labels().slice(at + 1, at + 6)).toEqual(["Undo Last Commit…", ...GROUP]);
    expect(entry("Undo Last Commit…").disabled).toBe(false);
  });

  it("a commit of another branch: the entries are disabled and say why; the rest is unaffected", async () => {
    await show();
    await fire.contextMenu(row(9));
    for (const text of GROUP) {
      expect(entry(text).disabled).toBe(true);
      expect(entry(text).title).toBe("Only commits on main can be edited. Switch to the commit's branch first.");
    }
    expect(entry("Cherry-pick onto main…").disabled).toBe(false);
    expect(entry("Revert This Commit…").disabled).toBe(false);
    expect(entry("Reset main to Here (Soft)…").disabled).toBe(false);
  });

  it("a detached HEAD, a stopped operation and a running action grey the whole group out", async () => {
    answers.page = [PAGE[0], commit(1, [2], ["HEAD"]), ...PAGE.slice(2)];
    await show(repo({ branch: null }));
    await fire.contextMenu(row(1));
    for (const text of ["Undo Last Commit…", ...GROUP]) {
      expect(entry(text).disabled).toBe(true);
      expect(entry(text).title).toBe("You are not on a branch. Switch to a branch to edit its history.");
    }
    await fire.keyDown(window, "Escape");
    answers.page = PAGE;
    await act(async () => useGit.setState({ repos: { [KEY]: repo({ operation: "rebase" }) } }));
    await flush();
    await fire.contextMenu(row(2));
    for (const text of GROUP) {
      expect(entry(text).disabled).toBe(true);
      expect(entry(text).title).toBe("Finish or abort the rebase first");
    }
    await fire.keyDown(window, "Escape");
    await act(async () => useGit.setState({ repos: { [KEY]: repo() }, busy: "Pulling…" }));
    await flush();
    await fire.contextMenu(row(2));
    for (const text of GROUP) expect(entry(text).disabled).toBe(true);
  });

  it("a merge commit, a commit below a merge, and a commit whose parent is a merge", async () => {
    // 1 -> 2 -> 7 (merge of 3 and 8) -> 3 -> 4 -> 5; 8 is the merged side.
    answers.page = [commit(1, [2], ["HEAD", "refs/heads/main"]), commit(2, [7]), commit(7, [3, 8], [], "Merge branch 'feature'"), commit(8, [4], [], "Side work"), commit(3, [4]), commit(4, [5]), commit(5, [])];
    await show();
    await fire.contextMenu(rows().find((r) => r.textContent?.includes("Merge branch"))!);
    for (const text of GROUP) {
      expect(entry(text).disabled).toBe(true);
      expect(entry(text).title).toBe("A merge commit can't be edited here. Use Revert This Commit… to undo it.");
    }
    await fire.contextMenu(row(3));
    for (const text of GROUP) {
      expect(entry(text).disabled).toBe(true);
      expect(entry(text).title).toBe("The merge commit 7777777 comes after this commit. Quarry does not rewrite across a merge.");
    }
    // After the merge: editable, except squashing into the merge.
    await fire.contextMenu(row(2));
    expect(entry("Squash into Parent…").disabled).toBe(true);
    expect(entry("Squash into Parent…").title).toBe("The parent is a merge commit: nothing can be squashed into it.");
    for (const text of ["Reword Message…", "Drop Commit…", "Edit History from Here…"]) expect(entry(text).disabled).toBe(false);
    await fire.contextMenu(row(1));
    for (const text of GROUP) expect(entry(text).disabled).toBe(false);
  });

  it("the first commit can be reworded and listed; the only commit cannot be undone", async () => {
    await show();
    await fire.contextMenu(row(5));
    expect(entry("Reword Message…").disabled).toBe(false);
    expect(entry("Edit History from Here…").disabled).toBe(false);
    expect(entry("Squash into Parent…").title).toBe("This is the first commit: it has no parent.");
    expect(entry("Drop Commit…").title).toBe("The first commit can't be dropped.");
    expect(entry("Squash into Parent…").disabled && entry("Drop Commit…").disabled).toBe(true);
    await cleanup();
    answers.page = [commit(5, [], ["HEAD", "refs/heads/main"])];
    await show(repo({ headParents: 0 }));
    await fire.contextMenu(row(5));
    expect(entry("Undo Last Commit…").disabled).toBe(true);
    expect(entry("Undo Last Commit…").title).toBe("This is the first commit: there is nothing to go back to.");
  });

  it("Reword opens a message strip; nothing changes until it is submitted and confirmed", async () => {
    answers.range = () => ({ ...rangeFrom(2), commits: [hc(1), hc(2, { message: "Commit number 2\n\nWith a body." })] });
    await show();
    await choose(2, "Reword Message…");
    expect(strip()?.textContent).toContain("New message for 2222222:");
    expect(box().value).toBe("Commit number 2\n\nWith a body.");
    expect(document.activeElement).toBe(box());
    expect([box().selectionStart, box().selectionEnd]).toEqual([0, box().value.length]);
    expect(stripButton().disabled).toBe(true);
    expect(calls.some((c) => c.cmd === "git_history_rewrite")).toBe(false);
    // Emptied or unchanged: still disabled.
    await type(box(), "");
    expect(stripButton().disabled).toBe(true);
    await type(box(), "Second commit, said better");
    expect(stripButton().disabled).toBe(false);
    // Enter alone belongs to the box; Ctrl+Enter submits.
    await fire.keyDown(box(), "Enter");
    expect(dialog()).toBeNull();
    await fire.keyDown(box(), "Enter", { ctrlKey: true });
    await flush(8);
    expect(dialog()?.title).toBe("Reword this commit?");
    expect(dialog()?.message).toContain("2 commits on main get new ids:");
    // Cancel: git is not run and the strip keeps the text.
    await act(async () => dialog()!.actions.find((a) => a.label === "Cancel")!.run());
    await flush(8);
    expect(calls.some((c) => c.cmd === "git_history_rewrite")).toBe(false);
    expect(box().value).toBe("Second commit, said better");
    // Confirmed: it runs and the strip closes.
    await fire.click(stripButton());
    await flush(8);
    await act(async () => dialog()!.actions.find((a) => a.label === "Reword")!.run());
    await flush(16);
    const run = calls.find((c) => c.cmd === "git_history_rewrite");
    expect(run?.args).toMatchObject({ action: "plan", expectedTip: sha(1), base: sha(3), steps: [{ sha: sha(2), action: "pick", message: "Second commit, said better" }, { sha: sha(1), action: "pick", message: null }] });
    expect(strip()).toBeNull();
  });

  it("Escape closes the strip and nothing is changed", async () => {
    await show();
    await choose(1, "Reword Message…");
    expect(strip()).not.toBeNull();
    await fire.keyDown(box(), "Escape");
    expect(strip()).toBeNull();
    expect(calls.some((c) => c.cmd === "git_history_rewrite")).toBe(false);
  });

  it("Squash into Parent starts with both messages and is enabled", async () => {
    await show();
    await choose(2, "Squash into Parent…");
    expect(strip()?.textContent).toContain("Message for 3333333 + 2222222:");
    expect(box().value).toBe("Commit number 3\n\nCommit number 2");
    expect(stripButton().textContent).toBe("Squash");
    expect(stripButton().disabled).toBe(false);
    await type(box(), "Commit number 3");
    await fire.click(stripButton());
    await flush(8);
    expect(dialog()?.title).toBe("Squash into the parent?");
    await act(async () => dialog()!.actions.find((a) => a.label === "Squash")!.run());
    await flush(16);
    expect(calls.find((c) => c.cmd === "git_history_rewrite")?.args).toMatchObject({ base: sha(4), steps: [{ sha: sha(3), action: "pick", message: "Commit number 3" }, { sha: sha(2), action: "fixup", message: null }, { sha: sha(1), action: "pick", message: null }] });
    expect(strip()).toBeNull();
  });

  it("Drop and Undo ask straight away, with Cancel the default", async () => {
    await show();
    await choose(2, "Drop Commit…");
    expect(dialog()?.title).toBe("Drop this commit?");
    expect(dialog()?.actions.find((a) => a.default)?.label).toBe("Cancel");
    await act(async () => dialog()!.actions.find((a) => a.cancel)!.run());
    await choose(1, "Undo Last Commit…");
    expect(dialog()?.title).toBe("Undo the last commit?");
    expect(dialog()?.actions.find((a) => a.default)?.label).toBe("Cancel");
    await act(async () => dialog()!.actions.find((a) => a.cancel)!.run());
    await flush();
    expect(calls.some((c) => c.cmd === "git_history_rewrite")).toBe(false);
  });

  it("uncommitted changes: the strip does not open, the shared refusal does", async () => {
    await show(repo({ files: [{ path: `${ROOT}\\a.txt`, origPath: null, index: ".", worktree: "M", conflicted: false, untracked: false }] }));
    for (const text of ["Reword Message…", "Squash into Parent…", "Drop Commit…", "Edit History from Here…"]) {
      await choose(2, text);
      expect(dialog()?.title).toBe("Commit or discard your changes first");
      await act(async () => dialog()!.actions.find((a) => a.label === "Close")!.run());
      await flush();
      expect(strip()).toBeNull();
      expect(useGit.getState().historyEdit).toBeNull();
    }
    // The tip's message can be reworded all the same.
    await choose(1, "Reword Message…");
    expect(dialog()).toBeNull();
    expect(strip()).not.toBeNull();
  });

  it("Edit History from Here replaces the rows with the list until it is closed", async () => {
    const m = await show();
    await choose(3, "Edit History from Here…");
    const view = document.querySelector(".graph-view")!;
    expect(view.classList.contains("editing-history")).toBe(true);
    expect(document.querySelector(".he-title")?.textContent).toBe("Edit history of main: 3 commits since 4444444");
    expect([...document.querySelectorAll(".he-row .he-sha")].map((e) => e.textContent)).toEqual(["1111111", "2222222", "3333333"]);
    expect(calls.some((c) => c.cmd === "git_history_rewrite")).toBe(false);
    // Hidden and shown again (another tab and back): still there, with its choices.
    await fire.keyDown(document.querySelector(".he-list")!, "d");
    await m.rerender(<GraphView doc={doc} visible={false} />);
    await m.rerender(<GraphView doc={doc} visible />);
    await flush();
    expect(document.querySelector(".he-row .select-label")?.textContent).toBe("Drop");
    // A stopped operation closes it: the rows are back under the stopped-operation strip.
    await act(async () => useGit.setState({ repos: { [KEY]: repo({ operation: "rebase", operationStep: [2, 4] }) } }));
    await flush();
    expect(useGit.getState().historyEdit).toBeNull();
    expect(view.classList.contains("editing-history")).toBe(false);
    expect(document.querySelector(".history-edit")).toBeNull();
  });

  it("the keyboard goes back to the strip or the list when a dialog or menu closes", async () => {
    // Overlays return the focus with editor.focus(); the commit rows are hidden under the list, so
    // focusing them would leave Escape, Ctrl+Enter and the letter keys dead after a cancelled dialog.
    const { editor } = await import("../editor/manager");
    await show();
    useStore.setState({ activeId: doc.id });
    await choose(2, "Reword Message…");
    box().blur();
    editor.focus();
    expect(document.activeElement).toBe(box());
    await fire.keyDown(box(), "Escape");
    editor.focus();
    expect(document.activeElement).toBe(document.querySelector(".graph-list"));
    await choose(3, "Edit History from Here…");
    useStore.setState({ activeId: doc.id });
    (document.activeElement as HTMLElement | null)?.blur();
    editor.focus();
    expect(document.activeElement).toBe(document.querySelector(".he-list"));
    useStore.setState({ activeId: null });
  });

  it("closing the graph tab drops the list; nothing was changed", async () => {
    const m = await show();
    await choose(3, "Edit History from Here…");
    expect(useGit.getState().historyEdit).not.toBeNull();
    await m.unmount();
    expect(useGit.getState().historyEdit).toBeNull();
    expect(calls.some((c) => c.cmd === "git_history_rewrite")).toBe(false);
  });
});
