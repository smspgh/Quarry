import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBranch, GitFile, GitGraphCommit, GitStash, GitStatus } from "../lib/gitApi";
import type { Doc } from "../lib/store";

// No route around the unsaved-tabs question (SAFE-005): the real Source Control panel, Stashes
// section, branch list, status bar and commit graph, with one unsaved tab in the repository and
// the Tauri side replaced. Each button and menu entry must lead to the question (or, for the
// discarding ones, to the sentence in their confirmation) before any file-rewriting git command.
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ status: null as unknown, list: [] as unknown[], page: [] as unknown[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "git_available") return "git version 2.53.0";
    if (cmd === "git_status") return answers.status;
    if (cmd === "git_stash_list") return answers.list;
    if (cmd === "git_log" || cmd === "git_unpushed" || cmd === "git_stash_files") return [];
    if (cmd === "git_graph") return answers.page;
    if (cmd === "git_graph_indexed") return true;
    if (cmd === "git_stash_op") return "ok";
    if (cmd === "fs_stat") return { path: args.path, name: "store.ts", size: 5, isDir: false, modifiedMs: 1, readonly: false, isLarge: false };
    if (cmd === "fs_exists") return true;
    return undefined;
  },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: async () => undefined }));

const { render, cleanup, flush, fire, byText, act } = await import("./helpers/render");
const { GitPanel } = await import("../components/panels/GitPanel");
const { StashesSection } = await import("../components/panels/StashSection");
const { CommandPalette } = await import("../components/CommandPalette");
const { StatusBar } = await import("../components/StatusBar");
const { GraphView } = await import("../components/GraphView");
const { useGit } = await import("../lib/git");
const { useStore } = await import("../lib/store");
const { registerGitCommands } = await import("../lib/gitCommands");
const { tabsSettled } = await import("../lib/gitTabs");

registerGitCommands();
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const ROOT = "C:\\work\\app";
const KEY = ROOT.toLowerCase();
const REWRITES = ["git_checkout", "git_remote", "git_commit_action", "git_continue", "git_abort", "git_discard", "git_resolve_side", "git_merge", "git_rebase", "git_stash_push", "git_stash_op", "git_history_rewrite"];
const file = (rel: string, extra: Partial<GitFile> = {}): GitFile => ({ path: `${ROOT}\\${rel}`, origPath: null, index: ".", worktree: "M", conflicted: false, untracked: false, ...extra });
const status = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "1111111", upstream: "origin/main", upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [{ name: "origin", url: "C:\\remotes\\app.git" }], stash: null, stashCount: 0, headParents: 1, ...extra });
const STASH: GitStash = { sha: "c".repeat(40), short: "ccccccc", base: "b".repeat(40), author: "Ada", email: "ada@example.com", time: Math.floor(Date.now() / 1000) - 7200, subject: "On main: wip", untracked: false };
const unsaved: Doc = { id: "doc-1", kind: "text", path: `${ROOT}\\src\\store.ts`, name: "store.ts", dirty: true, encoding: "UTF-8", bom: false, eol: "LF", language: "TypeScript", readonly: false, modifiedMs: 1 };

const dialog = () => useStore.getState().dialog;
const ran = () => calls.filter((c) => REWRITES.includes(c.cmd)).map((c) => c.cmd);
const press = async (label: string) => {
  await flush(4);
  const a = dialog()?.actions.find((x) => x.label === label);
  if (!a) throw new Error(`no button "${label}" in "${dialog()?.title}"`);
  await act(async () => a.run());
  await flush(4);
};
/** The unsaved-tabs dialog is on screen and git has not run; Cancel, and it still has not. */
const expectAsked = async (says: string) => {
  await flush(6);
  expect(dialog()?.title).toBe("Unsaved changes in store.ts");
  expect(dialog()?.message.startsWith(says)).toBe(true);
  expect(dialog()?.actions.map((a) => a.label)).toEqual(["Save", "Continue Without Saving", "Cancel"]);
  expect(ran()).toEqual([]);
  await press("Cancel");
  expect(dialog()).toBeNull();
  expect(ran()).toEqual([]);
};

function setRepo(st: GitStatus, extra: Partial<ReturnType<typeof useGit.getState>> = {}) {
  answers.status = st;
  useGit.setState({ available: true, repos: { [KEY]: st }, current: KEY, busy: null, rewrotePushed: {}, remoteCheck: { [KEY]: { at: Date.now(), checking: false, error: null } }, history: null, stashPending: null, stashForm: false, ...extra });
}

beforeEach(() => {
  calls.length = 0;
  answers.list = [];
  useStore.setState({ folder: ROOT, docs: [unsaved], activeId: unsaved.id, dialog: null, toasts: [], palette: null, sidebarVisible: false, pinnedPanels: [] });
});
afterEach(async () => {
  for (let i = 0; i < 4 && dialog(); i++) await act(async () => (dialog()!.actions.find((a) => a.cancel) ?? dialog()!.actions[0]).run());
  await flush(4);
  await tabsSettled();
  await cleanup();
});

describe("Source Control panel", () => {
  const button = (title: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.title.startsWith(title))!;
  const labelled = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;

  it("the Pull button and the status line's Pull ask", async () => {
    setRepo(status({ behind: 2 }));
    await render(<GitPanel />);
    await flush();
    await fire.click(button("Pull"));
    await expectAsked("Pulling can rewrite files in this repository");
    const sync = byText(document.querySelector(".scm-sync")!, "button.btn", "Pull")[0];
    expect(sync).toBeTruthy();
    await fire.click(sync);
    await expectAsked("Pulling can rewrite files in this repository");
  });

  it("Fetch and Push do not ask", async () => {
    setRepo(status({ ahead: 1 }));
    await render(<GitPanel />);
    await flush();
    await fire.click(button("Fetch"));
    await flush(6);
    await fire.click(button("Push"));
    await flush(6);
    expect(dialog()).toBeNull();
    expect(calls.filter((c) => c.cmd === "git_remote").map((c) => c.args.op)).toEqual(["fetch", "push"]);
  });

  it("Continue Rebase and Skip ask; Abort names the tab in its own question", async () => {
    setRepo(status({ operation: "rebase", operationStep: [2, 5] }));
    await render(<GitPanel />);
    await flush();
    await fire.click(labelled("Continue Rebase"));
    await expectAsked("Continuing the rebase can rewrite files in this repository");
    await fire.click(labelled("Skip"));
    await flush(4);
    expect(dialog()?.title).toBe("Skip this commit?");
    await press("Skip Commit");
    await expectAsked("Continuing the rebase can rewrite files in this repository");
    await fire.click(labelled("Abort"));
    await flush(4);
    expect(dialog()?.title).toBe("Abort the rebase?");
    expect(dialog()?.message).toContain("Unsaved edits in open tabs are lost too where the abort rewrites the file: src\\store.ts.");
    expect(dialog()?.actions.find((a) => a.default)?.label).toBe("Cancel");
    await press("Cancel");
    expect(ran()).toEqual([]);
  });

  it("Discard changes and Discard all changes name the tab", async () => {
    setRepo(status({ files: [file("src\\store.ts"), file("z.ts")] }));
    await render(<GitPanel />);
    await flush();
    await fire.click(button("Discard changes"));
    await flush(4);
    expect(dialog()?.message).toBe("Your changes to store.ts will be lost, including the unsaved edits in its open tab. Open tabs reload the committed text.");
    await press("Cancel");
    await fire.click(button("Discard all changes"));
    await flush(4);
    expect(dialog()?.message).toBe("Your changes to 2 files will be lost. Unsaved edits in 1 open tab are lost too: store.ts. Open tabs reload the committed text.");
    expect(dialog()?.actions.map((a) => a.label)).toEqual(["Discard", "Cancel"]);
    await press("Cancel");
    expect(ran()).toEqual([]);
  });

  it("the Stashes section's Stash, Apply and Pop ask; Drop does not", async () => {
    const st = status({ files: [file("b.ts")], stash: STASH.sha, stashCount: 1 });
    answers.list = [STASH];
    setRepo(st, { stashes: { [KEY]: [STASH] }, stashForm: true });
    await render(<StashesSection repo={st} />);
    await flush();
    const form = document.querySelector<HTMLElement>(".scm-stash-form")!;
    await fire.click(byText(form, "button", "Stash")[0]);
    await expectAsked("A stash takes the files as they are on disk, so the unsaved changes in this open file would not be in it:");
    expect(useGit.getState().stashForm).toBe(true); // Cancel leaves the form open
    const row = document.querySelector<HTMLElement>(".scm-stash")!;
    for (const label of ["Apply", "Pop"]) {
      await fire.click(byText(row, "button", label)[0]);
      await expectAsked("Applying the stash can rewrite files in this repository");
    }
    await fire.click(byText(row, "button", "Drop")[0]);
    await flush(6);
    expect(dialog()?.title).toBe("Drop this stash?");
    await press("Drop Stash");
    expect(ran()).toEqual(["git_stash_op"]);
  });
});

describe("the branch list and the status bar", () => {
  const branch = (name: string, extra: Partial<GitBranch> = {}): GitBranch => ({ name, remote: false, current: false, upstream: null, sha: "0".repeat(40), time: 0, summary: "", ...extra });
  const input = () => document.querySelector<HTMLInputElement>(".palette input")!;
  const items = () => [...document.querySelectorAll<HTMLElement>(".palette-list .palette-item")];
  const openList = async () => {
    setRepo(status(), { branches: [branch("main", { current: true }), branch("feature")], branchPick: "switch" });
    useStore.setState({ palette: "branch" });
    await render(<CommandPalette />);
    await flush();
  };

  it("picking a branch with Enter or the mouse asks; creating one from here does not", async () => {
    const type = (text: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text);
        input().dispatchEvent(new Event("input", { bubbles: true }));
      });
    await openList();
    await type("feature");
    await fire.keyDown(input(), "Enter");
    await expectAsked("Switching to feature can rewrite files in this repository");
    await cleanup();
    await openList();
    await fire.click(items().find((r) => r.textContent?.includes("feature"))!);
    await expectAsked("Switching to feature can rewrite files in this repository");
    await cleanup();
    await openList();
    await type("topic");
    await fire.click(items().find((r) => r.textContent?.includes('Create branch "topic" from here'))!);
    await flush(6);
    expect(dialog()).toBeNull();
    expect(calls.find((c) => c.cmd === "git_checkout")?.args).toEqual({ root: ROOT, name: "topic", create: true });
  });

  it("the status bar's branch opens that same list", async () => {
    setRepo(status());
    await render(<StatusBar />);
    await flush();
    const item = [...document.querySelectorAll<HTMLButtonElement>("button.status-item")].find((b) => b.textContent?.includes("main"))!;
    await fire.click(item);
    await flush();
    expect(useStore.getState().palette).toBe("branch");
    expect(useGit.getState().branchPick).toBe("switch");
    expect(ran()).toEqual([]);
  });
});

describe("the commit graph", () => {
  const sha = (n: number) => `${n}`.repeat(40);
  const commit = (n: number, extra: Partial<GitGraphCommit> = {}): GitGraphCommit => ({ sha: sha(n), short: `${n}`.repeat(7), parents: n < 5 ? [sha(n + 1)] : [], author: "Ada", email: "ada@example.com", time: 1_700_000_000 - n * 3600, refs: [], summary: `Commit number ${n}`, ...extra });
  const doc = { id: "graph-1", kind: "graph", name: "Graph", graph: { root: ROOT } } as unknown as Doc;
  const rows = () => [...document.querySelectorAll<HTMLElement>(".graph-list [role=option]")];
  const entry = (text: string) => [...document.querySelectorAll<HTMLButtonElement>(".graph-menu [role=menuitem]")].find((b) => b.textContent?.includes(text))!;
  const show = async (st: GitStatus = status({ upstream: null })) => {
    answers.page = [commit(1, { refs: ["HEAD", "refs/heads/main"] }), commit(2, { refs: ["refs/heads/feature"] }), commit(3), commit(4), commit(5)];
    setRepo(st);
    await render(<GraphView doc={doc} visible />);
    await flush();
  };
  const menu = async (row: number, text: string) => {
    await fire.contextMenu(rows()[row], { clientX: 40, clientY: 50 });
    expect(entry(text)).toBeTruthy();
    await fire.click(entry(text));
    await flush(4);
  };

  it("cherry-pick, revert and check-out ask after their own confirmation; Switch to asks at once", async () => {
    await show();
    await menu(2, "Revert This Commit");
    expect(dialog()?.title).toBe("Revert this commit?");
    await press("Revert");
    await expectAsked("Reverting 3333333 can rewrite files in this repository");
    await menu(2, "Check Out This Commit");
    await press("Check Out");
    await expectAsked("Checking out 3333333 can rewrite files in this repository");
    await menu(1, "Switch to feature");
    await expectAsked("Switching to feature can rewrite files in this repository");
  });

  it("Reset … (Hard)… carries the sentence in its own confirmation, and nothing follows it", async () => {
    await show();
    await menu(2, "(Hard)");
    expect(dialog()?.title).toBe("Reset (hard) and discard changes?");
    expect(dialog()?.message).toContain("Unsaved edits in open tabs are lost too where the reset rewrites the file: src\\store.ts.");
    expect(dialog()?.actions.find((a) => a.default)?.label).toBe("Cancel");
    expect(ran()).toEqual([]);
    await press("Reset and Discard");
    await flush(6);
    expect(dialog()).toBeNull();
    expect(ran()).toEqual(["git_commit_action"]);
  });

  it("the stopped-operation strip's Abort names the tab", async () => {
    await show(status({ upstream: null, operation: "merge", files: [file("a.ts", { conflicted: true })] }));
    const abort = [...document.querySelectorAll<HTMLButtonElement>("button.btn")].find((b) => b.textContent?.trim() === "Abort")!;
    await fire.click(abort);
    await flush(4);
    expect(dialog()?.title).toBe("Abort the merge?");
    expect(dialog()?.message).toContain("Unsaved edits in open tabs are lost too where the abort rewrites the file: src\\store.ts.");
    await press("Cancel");
    expect(ran()).toEqual([]);
  });
});
