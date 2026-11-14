import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitGraphCommit, GitStatus } from "../lib/gitApi";
import type { Doc } from "../lib/store";

// GraphView's merge / rebase entries (specs/git-merge-rebase.md, MERGE-001 and MERGE-002): the
// commit menu's two entries and the right-click menu of a branch / tag label. The Tauri side is
// replaced; `git_status` and `git_merge_preview` answer so that choosing an entry reaches its dialog.
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ page: [] as unknown[], status: undefined as unknown, preview: undefined as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "git_graph") return answers.page;
    if (cmd === "git_graph_indexed") return true;
    if (cmd === "git_status") return answers.status;
    if (cmd === "git_merge_preview") return answers.preview;
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
const commit = (n: number, refs: string[] = []): GitGraphCommit => ({ sha: sha(n), short: `${n}`.repeat(7), parents: n < 5 ? [sha(n + 1)] : [], author: "Ada", email: "ada@example.com", time: 1_700_000_000 - n * 3600, refs, summary: `Commit number ${n}` });
const PAGE = [commit(1, ["HEAD", "refs/heads/main"]), commit(2, ["refs/heads/feature"]), commit(3), commit(4, ["refs/heads/topic", "refs/remotes/origin/topic", "refs/tags/v1.2.0"]), commit(5)];
const doc = { id: "graph-1", kind: "graph", name: "Graph", graph: { root: ROOT } } as unknown as Doc;
const repo = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "1111111", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], ...extra });

const rows = () => [...document.querySelectorAll<HTMLElement>(".graph-list [role=option]")];
const selectedRow = () => document.querySelector<HTMLElement>(".graph-list [aria-selected=true]");
const menus = () => [...document.querySelectorAll<HTMLElement>(".graph-menu[role=menu]")];
const head = () => menus()[0].querySelector(".graph-menu-head")?.textContent;
const entries = () => [...menus()[0].querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
const labels = () => entries().map((b) => b.textContent);
// The label menu also carries the housekeeping entries (BRANCH-001, graphView.test.tsx): these are its merge / rebase ones.
const starts = () => entries().filter((b) => /^(Merge|Rebase) /.test(b.textContent ?? ""));
const startLabels = () => starts().map((b) => b.textContent);
const entry = (text: string) => {
  const b = entries().find((x) => x.textContent === text);
  if (!b) throw new Error(`no entry "${text}" in ${labels().join(" | ")}`);
  return b;
};
const badge = (within: ParentNode, name: string) => {
  const b = [...within.querySelectorAll<HTMLElement>(".graph-ref")].find((x) => x.textContent?.trim() === name);
  if (!b) throw new Error(`no label ${name}`);
  return b;
};
const show = async (status: GitStatus = repo()) => {
  answers.status = status;
  useGit.setState({ repos: { [KEY]: status }, busy: null });
  await render(<GraphView doc={doc} visible />);
  await flush();
};

describe("GraphView: merge and rebase", () => {
  beforeEach(() => {
    calls.length = 0;
    answers.page = PAGE;
    answers.preview = { target: "refs/heads/feature", kind: "branch", sha: sha(2), short: "2222222", summary: "Commit number 2", ahead: 2, behind: 3, merges: 0, pushed: 0, pushedOn: null, pushedCommits: [] };
    useStore.setState({ dialog: null, toasts: [] });
  });
  afterEach(async () => {
    useStore.getState().dialog?.actions.find((a) => a.cancel)?.run();
    await cleanup();
    useGit.setState({ repos: {}, busy: null });
  });

  it("the commit menu names the branch a commit stands for, below Cherry-pick and Revert", async () => {
    await show();
    await fire.contextMenu(rows()[1]);
    expect(labels()).toContain("Merge feature into main…");
    expect(labels()).toContain("Rebase main onto feature…");
    expect(labels().indexOf("Merge feature into main…")).toBe(labels().indexOf("Revert This Commit…") + 1);
    expect(labels().indexOf("Rebase main onto feature…")).toBeLessThan(labels().indexOf("Reset main to Here (Soft)…"));
    // No branch label, or several: the commit by its id.
    await fire.contextMenu(rows()[2]);
    expect(labels()).toContain("Merge 3333333 into main…");
    expect(labels()).toContain("Rebase main onto This…");
    await fire.contextMenu(rows()[3]);
    expect(labels()).toContain("Merge 4444444 into main…");
    expect(labels()).toContain("Rebase main onto This…");
  });

  it("the entries of the commit you are on are greyed out and say why", async () => {
    await show();
    await fire.contextMenu(rows()[0]);
    for (const text of ["Merge 1111111 into main…", "Rebase main onto This…"]) {
      expect(entry(text).disabled).toBe(true);
      expect(entry(text).title).toBe("This is the commit you are on");
    }
  });

  it("a detached HEAD can merge but not rebase", async () => {
    answers.page = [commit(1, ["HEAD"]), ...PAGE.slice(1)];
    await show(repo({ branch: null }));
    await fire.contextMenu(rows()[2]);
    expect(entry("Merge 3333333 into Here…").disabled).toBe(false);
    expect(entry("Rebase onto This…").disabled).toBe(true);
    expect(entry("Rebase onto This…").title).toBe("Switch to a branch first: a rebase moves a branch");
  });

  it("a stopped operation or a running git action greys both entries out", async () => {
    await show(repo({ operation: "cherry-pick" }));
    await fire.contextMenu(rows()[1]);
    for (const text of ["Merge feature into main…", "Rebase main onto feature…"]) {
      expect(entry(text).disabled).toBe(true);
      expect(entry(text).title).toBe("Finish or abort the cherry-pick first");
    }
    await fire.keyDown(window, "Escape");
    await act(async () => useGit.setState({ repos: { [KEY]: repo() }, busy: "Pulling…" }));
    await fire.contextMenu(rows()[1]);
    expect(entry("Merge feature into main…").disabled).toBe(true);
    expect(entry("Rebase main onto feature…").disabled).toBe(true);
  });

  it("choosing the merge entry asks first and runs nothing", async () => {
    await show();
    await fire.contextMenu(rows()[1]);
    await fire.click(entry("Merge feature into main…"));
    await flush();
    expect(menus()).toHaveLength(0);
    expect(calls.find((c) => c.cmd === "git_merge_preview")?.args).toEqual({ root: ROOT, target: "refs/heads/feature" });
    const dialog = useStore.getState().dialog;
    expect(dialog?.title).toBe("Merge feature into main?");
    expect(dialog?.actions.find((a) => a.default)?.label).toBe("Cancel");
    expect(calls.some((c) => c.cmd === "git_merge" || c.cmd === "git_rebase")).toBe(false);
  });

  it("a right-click on a branch label opens that branch's menu, not the commit's", async () => {
    await show();
    await fire.contextMenu(badge(rows()[1], "feature"), { clientX: 30, clientY: 40 });
    expect(selectedRow()?.textContent).toContain("Commit number 2");
    expect(menus()).toHaveLength(1);
    expect(head()).toBe("Branch feature");
    expect(startLabels()).toEqual(["Merge feature into main…", "Rebase main onto feature…"]);
    // Escape closes it, and so does a click elsewhere; nothing was started.
    await fire.keyDown(window, "Escape");
    expect(menus()).toHaveLength(0);
    await fire.contextMenu(badge(rows()[1], "feature"));
    expect(menus()).toHaveLength(1);
    await fire.mouseDown(window);
    expect(menus()).toHaveLength(0);
    expect(calls.some((c) => c.cmd === "git_merge_preview")).toBe(false);
  });

  it("remote branch and tag labels have their own headings, and act on the label by name", async () => {
    await show();
    await fire.contextMenu(badge(rows()[3], "origin/topic"));
    expect(head()).toBe("Remote branch origin/topic");
    expect(startLabels()).toEqual(["Merge origin/topic into main…", "Rebase main onto origin/topic…"]);
    await fire.contextMenu(badge(rows()[3], "v1.2.0"));
    expect(menus()).toHaveLength(1);
    expect(head()).toBe("Tag v1.2.0");
    expect(startLabels()).toEqual(["Merge v1.2.0 into main…", "Rebase main onto v1.2.0…"]);
    await fire.click(entry("Rebase main onto v1.2.0…"));
    await flush();
    expect(calls.find((c) => c.cmd === "git_merge_preview")?.args).toEqual({ root: ROOT, target: "refs/tags/v1.2.0" });
  });

  it("the label of the branch you are on has a menu with both entries greyed out", async () => {
    await show();
    await fire.contextMenu(badge(rows()[0], "main"));
    expect(head()).toBe("Branch main");
    expect(starts()).toHaveLength(2);
    for (const b of starts()) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe("This is the branch you are on");
    }
  });

  it("the label menu has the commit menu's disabled states", async () => {
    await show(repo({ operation: "rebase", branch: null }));
    await fire.contextMenu(badge(rows()[1], "feature"));
    expect(starts()).toHaveLength(2);
    for (const b of starts()) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe("Finish or abort the rebase first");
    }
  });

  it("the detached HEAD label has no menu of its own: the commit's opens", async () => {
    answers.page = [commit(1, ["HEAD"]), ...PAGE.slice(1)];
    await show(repo({ branch: null }));
    await fire.contextMenu(badge(rows()[0], "HEAD"));
    expect(menus()).toHaveLength(1);
    expect(labels()).toContain("Copy Commit Id");
    expect(head()).toContain("1111111");
  });

  it("labels in the details pane open the same menu", async () => {
    await show();
    await fire.click(rows()[1]);
    await flush();
    await fire.contextMenu(badge(document.querySelector(".graph-detail")!, "feature"));
    expect(menus()).toHaveLength(1);
    expect(head()).toBe("Branch feature");
    expect(startLabels()).toEqual(["Merge feature into main…", "Rebase main onto feature…"]);
  });
});
