import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitCommitDetail, GitGraphCommit } from "../lib/gitApi";
import type { Doc } from "../lib/store";

// GraphView rendered in jsdom with the Tauri side replaced: `git_graph` serves one page,
// `git_commit_detail` the details pane.
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ page: [] as unknown[], detail: null as unknown, held: [] as unknown[], status: null as unknown, compare: null as unknown, hits: [] as unknown[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "git_graph") return answers.page;
    if (cmd === "git_graph_indexed") return true;
    if (cmd === "git_commit_detail") return answers.detail;
    if (cmd === "git_stash_files") return answers.held;
    if (cmd === "git_stash_list") return [];
    if (cmd === "git_status") return answers.status;
    if (cmd === "git_stash_op") return "ok";
    if (cmd === "git_diff_files") return typeof answers.compare === "function" ? (answers.compare as (a: unknown) => unknown)(args) : answers.compare;
    if (cmd === "git_graph_search") return answers.hits;
    return undefined;
  },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: async () => undefined }));

const { render, cleanup, flush, fire, byText, act } = await import("./helpers/render");
const { GraphView } = await import("../components/GraphView");
const { useGit } = await import("../lib/git");
const { useStore } = await import("../lib/store");
const { dismissDialog } = await import("../lib/dialogs");

const ROOT = "C:\\work\\proj";
const sha = (n: number) => `${n}`.repeat(40);
const commit = (n: number, extra: Partial<GitGraphCommit> = {}): GitGraphCommit => ({
  sha: sha(n),
  short: `${n}`.repeat(7),
  parents: n < 5 ? [sha(n + 1)] : [],
  author: "Ada",
  email: "ada@example.com",
  time: 1_700_000_000 - n * 3600,
  refs: [],
  summary: `Commit number ${n}`,
  ...extra,
});
const PAGE = [commit(1, { refs: ["HEAD", "refs/heads/main"] }), commit(2, { refs: ["refs/heads/feature"] }), commit(3), commit(4), commit(5)];
const doc = { id: "graph-1", kind: "graph", name: "Graph", graph: { root: ROOT } } as unknown as Doc;

const rows = () => [...document.querySelectorAll<HTMLElement>(".graph-list [role=option]")];
const selectedRow = () => document.querySelector<HTMLElement>(".graph-list [aria-selected=true]");
const list = () => document.querySelector<HTMLElement>(".graph-list")!;

describe("GraphView", () => {
  beforeEach(() => {
    calls.length = 0;
    answers.page = PAGE;
    answers.detail = null;
  });
  afterEach(cleanup);

  it("renders a row per commit of the first page, with its refs", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    const page = calls.find((c) => c.cmd === "git_graph");
    expect(page?.args).toMatchObject({ root: ROOT, all: false, skip: 0 });
    expect(rows().map((r) => r.querySelector(".graph-c-msg .truncate")?.textContent)).toEqual(PAGE.map((c) => c.summary));
    expect(rows()[0].className).toContain("head");
    expect(rows()[1].querySelector(".graph-ref.branch")?.textContent).toContain("feature");
    // A page smaller than the page size: everything is loaded, no "+".
    expect(document.querySelector(".graph-toolbar")?.textContent).toContain("5 commits");
  });

  it("an empty history says so", async () => {
    answers.page = [];
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(document.querySelector(".graph-list .panel-note")?.textContent).toBe("No commits yet.");
  });

  it("arrow keys, Home and End move the selection", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(selectedRow()).toBeNull();
    await fire.keyDown(list(), "ArrowDown");
    expect(selectedRow()?.textContent).toContain("Commit number 1");
    await fire.keyDown(list(), "ArrowDown");
    await fire.keyDown(list(), "ArrowDown");
    expect(selectedRow()?.textContent).toContain("Commit number 3");
    await fire.keyDown(list(), "ArrowUp");
    expect(selectedRow()?.textContent).toContain("Commit number 2");
    await fire.keyDown(list(), "End");
    expect(selectedRow()?.textContent).toContain("Commit number 5");
    await fire.keyDown(list(), "ArrowDown"); // stays on the last one
    expect(selectedRow()?.textContent).toContain("Commit number 5");
    await fire.keyDown(list(), "Home");
    expect(selectedRow()?.textContent).toContain("Commit number 1");
    await fire.keyDown(list(), "ArrowUp"); // stays on the first one
    expect(selectedRow()?.textContent).toContain("Commit number 1");
  });

  it("the details pane loads the selected commit from git_commit_detail", async () => {
    const detail: GitCommitDetail = {
      sha: PAGE[1].sha,
      parents: PAGE[1].parents,
      author: "Ada",
      email: "ada@example.com",
      time: PAGE[1].time,
      committer: "Ada",
      committerEmail: "ada@example.com",
      commitTime: PAGE[1].time,
      message: "Commit number 2\n\nWith a body.",
      stat: "1 file changed, 2 insertions(+)",
      files: [{ path: `${ROOT}\\src\\a.ts`, rel: "src/a.ts", status: "M", origRel: null } as GitCommitDetail["files"][number]],
    };
    answers.detail = detail;
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(document.querySelector(".graph-detail")).toBeNull();
    await fire.click(rows()[1]);
    await flush();
    expect(calls.find((c) => c.cmd === "git_commit_detail")?.args).toEqual({ root: ROOT, sha: PAGE[1].sha });
    expect(document.querySelector(".graph-full-sha")?.textContent).toBe(PAGE[1].sha);
    expect(document.querySelector(".graph-message")?.textContent).toBe(detail.message);
    expect(document.querySelector(".graph-files-head")?.textContent).toBe(detail.stat);
    expect(document.querySelector(".graph-file .scm-name")?.textContent).toBe("a.ts");
    expect(document.querySelector(".graph-meta")?.textContent).toContain(PAGE[2].sha.slice(0, 7)); // its parent
    await fire.click(document.querySelector('.graph-detail [title="Close details"]')!);
    expect(document.querySelector(".graph-detail")).toBeNull();
  });

  it("the right-click menu offers the commit's actions and closes on Escape", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.contextMenu(rows()[1], { clientX: 40, clientY: 50 });
    const menu = document.querySelector<HTMLElement>(".graph-menu[role=menu]");
    expect(menu).not.toBeNull();
    expect(menu!.querySelector(".graph-menu-head")?.textContent).toContain(PAGE[1].short);
    expect(selectedRow()?.textContent).toContain("Commit number 2");
    // Only items this test relies on: others may be added.
    const items = [...menu!.querySelectorAll("[role=menuitem]")].map((b) => b.textContent);
    for (const label of ["Copy Commit Id", "Copy Message", "Switch to feature", "Create Branch Here…", "Create Tag Here…", "Check Out This Commit…", "Revert This Commit…", "Reset HEAD to Here (Hard)…"])
      expect(items).toContain(label);
    expect(byText(menu!, "[role=menuitem].danger", "(Hard)")).toHaveLength(1);
    await fire.keyDown(window, "Escape");
    expect(document.querySelector(".graph-menu")).toBeNull();
  });

  it("Create Tag Here… opens the naming strip for that commit", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.contextMenu(rows()[2]);
    await fire.click(byText(document.body, "[role=menuitem]", "Create Tag Here…")[0]);
    expect(document.querySelector(".graph-menu")).toBeNull();
    const strip = document.querySelector<HTMLElement>(".graph-naming");
    expect(strip?.textContent).toContain(`New tag at ${PAGE[2].short}`);
    expect(strip?.querySelector<HTMLButtonElement>(".btn-primary")?.disabled).toBe(true);
  });
});

// Stash rows (All branches): STASH-010, and the strip of STASH-009.12.
describe("GraphView stash rows", () => {
  const STASH = commit(7, { parents: [sha(2)], refs: ["refs/stash"], summary: "On main: WIP parser", stash: true });
  const WITH_STASH = [PAGE[0], STASH, ...PAGE.slice(1)];
  const status = (extra: object = {}) => ({ root: ROOT, branch: "main", head: "1111111", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], stash: STASH.sha, stashCount: 1, ...extra });
  const conflict = (name: string) => ({ path: `${ROOT}\\${name}`, origPath: null, index: "U", worktree: "U", conflicted: true, untracked: false });
  const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>(".graph-menu [role=menuitem]")];

  beforeEach(() => {
    for (let i = 0; i < 5; i++) dismissDialog();
    calls.length = 0;
    answers.page = WITH_STASH;
    answers.detail = null;
    answers.held = [];
    answers.status = status();
    useStore.setState({ toasts: [], dialog: null });
    useGit.setState({ busy: null, stashPending: null, repos: { [ROOT.toLowerCase()]: status() as never } });
  });
  afterEach(async () => {
    await cleanup();
    useGit.setState({ repos: {} });
  });

  it("draws a stash as one row with a stash label, its title and a hollow dot", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    const row = rows()[1];
    expect(row.className).toContain("stash");
    expect(row.querySelector(".graph-ref.stash")?.textContent).toContain("stash");
    expect(row.querySelector(".graph-c-msg > .truncate")?.textContent).toBe("WIP parser");
    expect(row.querySelector("circle.gn.stash")).not.toBeNull();
    expect(rows()[0].querySelector("circle.gn.stash")).toBeNull();
    expect(row.querySelector(".graph-c-author")?.textContent).toBe("Ada");
    expect(document.querySelector(".graph-toolbar")?.textContent).toContain("6 commits");
  });

  it("its right-click menu has the stash actions and none of the commit actions", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.contextMenu(rows()[1], { clientX: 40, clientY: 50 });
    expect(menuItems().map((b) => b.textContent)).toEqual(["Apply Stash", "Pop Stash", "Drop Stash…", "Copy Message"]);
    expect(document.querySelector(".graph-menu-head")?.textContent).toContain("Stash: WIP parser");
    expect(menuItems().every((b) => !b.disabled)).toBe(true);
    await fire.click(menuItems()[0]);
    await flush(6);
    expect(calls.find((c) => c.cmd === "git_stash_op")?.args).toEqual({ root: ROOT, sha: STASH.sha, op: "apply" });
    // A commit row keeps its own menu.
    await fire.contextMenu(rows()[2]);
    expect(menuItems().map((b) => b.textContent)).toContain("Check Out This Commit…");
    expect(menuItems().map((b) => b.textContent)).not.toContain("Apply Stash");
    await fire.keyDown(window, "Escape");
  });

  it("Drop Stash… asks with Cancel as the default; Apply and Pop are off while an operation is stopped", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.contextMenu(rows()[1]);
    await fire.click(menuItems()[2]);
    await flush(6);
    const d = useStore.getState().dialog!;
    expect(d.title).toBe("Drop this stash?");
    expect(d.actions.map((a) => [a.label, !!a.default])).toEqual([["Drop Stash", false], ["Cancel", true]]);
    await act(async () => d.actions[1].run());
    expect(calls.some((c) => c.cmd === "git_stash_op")).toBe(false);

    await act(async () => useGit.setState({ repos: { [ROOT.toLowerCase()]: status({ operation: "rebase", files: [conflict("a.ts")] }) as never } }));
    await flush();
    await fire.contextMenu(rows()[1]);
    expect(menuItems().map((b) => [b.disabled, b.title])).toEqual([[true, "Finish or abort the rebase first"], [true, "Finish or abort the rebase first"], [false, ""], [false, ""]]);
    await fire.keyDown(window, "Escape");
  });

  it("the details pane shows the stash's message, its base as the parent and the files it holds", async () => {
    answers.detail = { sha: STASH.sha, parents: [sha(2), sha(8), sha(9)], author: "Ada", email: "ada@example.com", time: STASH.time, committer: "Ada", committerEmail: "ada@example.com", commitTime: STASH.time, message: "On main: WIP parser", stat: "1 file changed", files: [] };
    answers.held = [{ path: `${ROOT}\\app.ts`, rel: "app.ts", status: "M", origRel: null }, { path: `${ROOT}\\notes.txt`, rel: "notes.txt", status: "?", origRel: null }];
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.click(rows()[1]);
    await flush();
    expect(calls.find((c) => c.cmd === "git_stash_files")?.args).toEqual({ root: ROOT, sha: STASH.sha });
    expect(document.querySelector(".graph-message")?.textContent).toBe("WIP parser");
    expect(document.querySelector(".graph-files-head")?.textContent).toBe("2 files in this stash");
    expect([...document.querySelectorAll(".graph-file")].map((f) => `${f.querySelector(".scm-letter")?.textContent} ${f.querySelector(".scm-name")?.textContent}`)).toEqual(["M app.ts", "U notes.txt"]);
    const links = [...document.querySelectorAll(".graph-meta .link-btn")].map((b) => b.textContent);
    expect(links).toEqual([sha(2).slice(0, 7)]); // only the commit it was made on
  });

  it("find matches a stash by its title", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    const box = document.querySelector<HTMLInputElement>(".graph-search input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, "parser");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rows().map((r) => r.className.includes("dim"))).toEqual([true, false, true, true, true, true]);
  });

  it("the next page skips by commits, not by rows", async () => {
    const id = (i: number) => `${1000 + i}`.padEnd(40, "0");
    const many = Array.from({ length: 300 }, (_, i) => commit(1, { sha: id(i), parents: [id(i + 1)], summary: `c${i}` }));
    answers.page = [STASH, ...many];
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(document.querySelector(".graph-toolbar")?.textContent).toContain("301+ commits");
    answers.page = [];
    await act(async () => {
      list().scrollTop = 300 * 26;
      list().dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await flush();
    const pages = calls.filter((c) => c.cmd === "git_graph").map((c) => c.args.skip);
    expect(pages).toEqual([0, 300]);
  });

  it("a stash that came back with conflicts gets a warning strip without Abort", async () => {
    useGit.setState({ repos: { [ROOT.toLowerCase()]: status({ files: [conflict("a.ts"), conflict("b.ts")] }) as never } });
    await render(<GraphView doc={doc} visible />);
    await flush();
    const strips = [...document.querySelectorAll<HTMLElement>(".graph-strip")];
    expect(strips).toHaveLength(1);
    expect(strips[0].className).toContain("warn");
    expect(strips[0].textContent).toContain("A stash was applied with conflicts: 2 files have conflicts. Resolve them in Source Control.");
    expect(byText(strips[0], "button", "Abort")).toHaveLength(0);
    // A stopped operation keeps its own strip, with Abort.
    await act(async () => useGit.setState({ repos: { [ROOT.toLowerCase()]: status({ operation: "merge", files: [conflict("a.ts")] }) as never } }));
    await flush();
    const now = [...document.querySelectorAll<HTMLElement>(".graph-strip")];
    expect(now).toHaveLength(1);
    expect(byText(now[0], "button", "Abort")).toHaveLength(1);
  });
});

// Compare commits: the two-commit selection and the commit menu's compare entries (COMMITCMP-001, -004, -005).
describe("GraphView compare selection", () => {
  const status = (extra: object = {}) => ({ root: ROOT, branch: "main", head: "1111111", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], ...extra });
  const STASH = commit(7, { parents: [sha(2)], refs: ["refs/stash"], summary: "On main: WIP parser", stash: true });
  const all = [...PAGE, commit(8), commit(9)];
  const by = (id: string) => all.find((c) => c.sha === id)!;
  /** git's answer for (left, right): the lower commit number is the newer one. */
  const compared = (args: { left: string; right: string | null }) => {
    const [l, r] = [all.findIndex((c) => c.sha === args.left), args.right ? all.findIndex((c) => c.sha === args.right) : 0];
    return { left: by(args.left), right: args.right ? by(args.right) : null, head: args.right ? null : "1111111", files: [{ path: `${ROOT}\\a.ts`, rel: "a.ts", status: "M", origRel: null }], insertions: 1, deletions: 0, ahead: Math.max(0, l - r), behind: Math.max(0, r - l), untracked: 0 };
  };
  const highlighted = () => [...document.querySelectorAll<HTMLElement>(".graph-list [aria-selected=true]")].map((r) => r.querySelector(".graph-c-sha")?.textContent);
  const marked = () => [...document.querySelectorAll<HTMLElement>(".graph-row.compare")].map((r) => r.querySelector(".graph-c-sha")?.textContent);
  const comparison = () => document.querySelector<HTMLElement>(".graph-compare");
  const details = () => document.querySelector<HTMLElement>(".graph-detail:not(.graph-compare)");
  const heading = () => comparison()?.querySelector(".graph-compare-title")?.textContent;
  const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>(".graph-menu [role=menuitem]")].map((b) => b.textContent);
  const ctrl = { ctrlKey: true };
  const diffCalls = () => calls.filter((c) => c.cmd === "git_diff_files").map((c) => c.args);

  beforeEach(() => {
    calls.length = 0;
    answers.page = PAGE;
    answers.detail = null;
    answers.compare = compared;
    answers.hits = [];
    answers.status = status();
    useStore.setState({ toasts: [], dialog: null, graphCompare: null, docs: [] });
    useGit.setState({ busy: null, stashPending: null, repos: { [ROOT.toLowerCase()]: status() as never } });
  });
  afterEach(async () => {
    await cleanup();
    useGit.setState({ repos: {} });
  });

  it("Ctrl+click adds a second commit: both rows highlighted, the second marked, the comparison pane in place of the details", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    // With nothing selected a Ctrl+click is a plain click.
    await fire.click(rows()[2], ctrl);
    await flush();
    expect(highlighted()).toEqual(["3333333"]);
    expect(comparison()).toBeNull();
    expect(details()).not.toBeNull();
    await fire.click(rows()[0], ctrl);
    await flush();
    expect(highlighted()).toEqual(["1111111", "3333333"]);
    expect(marked()).toEqual(["1111111"]);
    expect(details()).toBeNull();
    // The ancestor (the older commit) is on the left; the other click order gives the same heading.
    expect(heading()).toBe("3333333 ↔ 1111111");
    expect(diffCalls()).toEqual([{ root: ROOT, left: sha(3), right: sha(1) }]);
    await fire.click(rows()[0]);
    await fire.click(rows()[2], ctrl);
    await flush();
    expect(heading()).toBe("3333333 ↔ 1111111");
    expect(marked()).toEqual(["3333333"]);
  });

  it("a third Ctrl+click replaces the second commit; Ctrl+click on a selected one takes it out", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.click(rows()[0]);
    await fire.click(rows()[1], ctrl);
    await fire.click(rows()[3], ctrl);
    await flush();
    expect(highlighted()).toEqual(["1111111", "4444444"]);
    expect(marked()).toEqual(["4444444"]);
    expect(heading()).toBe("4444444 ↔ 1111111");
    // The second one out: the first alone, with its ordinary details pane.
    await fire.click(rows()[3], ctrl);
    await flush();
    expect(highlighted()).toEqual(["1111111"]);
    expect(comparison()).toBeNull();
    expect(details()?.querySelector(".graph-full-sha")?.textContent).toBe(sha(1));
    // The first one out: the other stays selected alone.
    await fire.click(rows()[3], ctrl);
    await fire.click(rows()[0], ctrl);
    await flush();
    expect(highlighted()).toEqual(["4444444"]);
    expect(marked()).toEqual([]);
    expect(details()?.querySelector(".graph-full-sha")?.textContent).toBe(sha(4));
  });

  it("a plain click, Escape, an arrow key and the close button end the comparison", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    const pair = async () => {
      await fire.click(rows()[1]);
      await fire.click(rows()[3], ctrl);
      await flush();
      expect(highlighted()).toHaveLength(2);
    };
    await pair();
    await fire.click(rows()[4]);
    expect(highlighted()).toEqual(["5555555"]);
    expect(comparison()).toBeNull();
    await pair();
    await fire.keyDown(list(), "Escape");
    expect(highlighted()).toEqual(["2222222"]);
    expect(comparison()).toBeNull();
    expect(details()).not.toBeNull();
    await pair();
    await fire.keyDown(list(), "ArrowDown");
    expect(highlighted()).toEqual(["3333333"]);
    expect(comparison()).toBeNull();
    await pair();
    await fire.click(comparison()!.querySelector('[title="Close the comparison"]')!);
    expect(highlighted()).toEqual([]);
    expect(comparison()).toBeNull();
    expect(details()).toBeNull();
    // Selecting, replacing and clearing asked nothing and ran nothing but reads.
    expect(useStore.getState().dialog).toBeNull();
    expect(calls.every((c) => ["git_graph", "git_graph_indexed", "git_commit_detail", "git_diff_files", "git_ref_info"].includes(c.cmd))).toBe(true);
  });

  it("the commit menu has the compare group after Check Out; Compare with <id> only for another selected commit", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    // Nothing else selected: no "Compare with <id>".
    await fire.contextMenu(rows()[2]);
    expect(menuItems().filter((t) => t?.startsWith("Compare with"))).toEqual(["Compare with Working Tree", "Compare with Branch…"]);
    const at = menuItems().indexOf("Check Out This Commit…");
    expect(menuItems().slice(at + 1, at + 4)).toEqual(["Compare with Working Tree", "Compare with Branch…", "Cherry-pick onto main…"]);
    // Right-clicking the selected commit itself: still none.
    await fire.contextMenu(rows()[2]);
    expect(menuItems()).not.toContain("Compare with 3333333");
    await fire.keyDown(window, "Escape");
    // Another commit selected: the entry compares the two exactly as Ctrl+click does.
    await fire.contextMenu(rows()[0]);
    expect(menuItems().slice(menuItems().indexOf("Check Out This Commit…") + 1)[0]).toBe("Compare with 3333333");
    await fire.click(byText(document.body, "[role=menuitem]", "Compare with 3333333")[0]);
    await flush();
    expect(document.querySelector(".graph-menu")).toBeNull();
    expect(highlighted()).toEqual(["1111111", "3333333"]);
    expect(marked()).toEqual(["1111111"]);
    expect(diffCalls()).toEqual([{ root: ROOT, left: sha(3), right: sha(1) }]);
  });

  it("Compare with Working Tree: only that commit highlighted, no Swap Sides; a Ctrl+click then compares two commits", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.contextMenu(rows()[2]);
    await fire.click(byText(document.body, "[role=menuitem]", "Compare with Working Tree")[0]);
    await flush();
    expect(diffCalls()).toEqual([{ root: ROOT, left: sha(3), right: null }]);
    expect(highlighted()).toEqual(["3333333"]);
    expect(heading()).toBe("3333333 ↔ Working tree");
    expect(byText(comparison()!, "button", "Swap Sides")).toHaveLength(0);
    await fire.click(rows()[0], ctrl);
    await flush();
    expect(highlighted()).toEqual(["1111111", "3333333"]);
    expect(heading()).toBe("3333333 ↔ 1111111");
    expect(byText(comparison()!, "button", "Swap Sides")).toHaveLength(1);
  });

  it("Compare with Branch… opens the branch picker for that commit", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.contextMenu(rows()[3]);
    await fire.click(byText(document.body, "[role=menuitem]", "Compare with Branch…")[0]);
    await flush();
    expect(useStore.getState().palette).toBe("branch");
    expect(useGit.getState().branchPick).toBe("compare");
    expect(comparison()).toBeNull(); // nothing is compared until a branch is picked
    await act(async () => useStore.setState({ palette: null }));
  });

  it("a stash row cannot be picked: Ctrl+click on it, or with it selected, is a plain click", async () => {
    answers.page = [PAGE[0], STASH, ...PAGE.slice(1)];
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.click(rows()[0]);
    await fire.click(rows()[1], ctrl);
    await flush();
    expect(highlighted()).toEqual(["7777777"]);
    expect(comparison()).toBeNull();
    await fire.click(rows()[2], ctrl);
    await flush();
    expect(highlighted()).toEqual(["2222222"]);
    expect(comparison()).toBeNull();
    // Its menu has no compare entries, also with a commit selected.
    await fire.contextMenu(rows()[1]);
    expect(menuItems().some((t) => t?.startsWith("Compare"))).toBe(false);
    await fire.keyDown(window, "Escape");
    expect(diffCalls()).toEqual([]);
  });

  it("a Search All History result is not Ctrl+clickable", async () => {
    answers.hits = [commit(9)];
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.click(rows()[0]);
    const box = document.querySelector<HTMLInputElement>(".graph-search input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, "zzz");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await fire.keyDown(box, "Enter");
    await flush();
    const hit = document.querySelector<HTMLElement>(".graph-hit")!;
    hit.scrollIntoView = () => {};
    await fire.click(hit, ctrl);
    await flush();
    expect(hit.className).toContain("selected");
    expect(highlighted()).toEqual([]);
    expect(comparison()).toBeNull();
    expect(diffCalls()).toEqual([]);
  });

  it("the pair survives a reload, also when one of its commits is no longer among the loaded rows", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.click(rows()[0]);
    await fire.click(rows()[2], ctrl);
    await flush();
    // The repository moved (a fetch): the graph reloads.
    await act(async () => useGit.setState({ repos: { [ROOT.toLowerCase()]: status({ behind: 2 }) as never } }));
    await flush();
    expect(calls.filter((c) => c.cmd === "git_graph")).toHaveLength(2);
    expect(highlighted()).toEqual(["1111111", "3333333"]);
    expect(heading()).toBe("3333333 ↔ 1111111");
    expect(diffCalls()).toHaveLength(1); // the pane was not read again
    answers.page = [PAGE[0], PAGE[1]];
    await act(async () => useGit.setState({ repos: { [ROOT.toLowerCase()]: status({ behind: 3 }) as never } }));
    await flush();
    // Commit 3 is not loaded any more (as after returning to the tab from further down the
    // history): the comparison stays, that side offers Show in Graph.
    expect(heading()).toBe("3333333 ↔ 1111111");
    expect(highlighted()).toEqual(["1111111"]);
    expect(byText(comparison()!, "button", "Show in Graph")).toHaveLength(1);
    expect(diffCalls()).toHaveLength(1);
  });

  it("a comparison handed over by Compare with Branch… shows at once, also when its commits are not loaded", async () => {
    const result = compared({ left: sha(8), right: sha(9) });
    useStore.setState({ graphCompare: { root: ROOT, first: sha(8), second: sha(9), names: { first: "feature", second: "old-release" }, result: result as never } });
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(useStore.getState().graphCompare).toBeNull();
    // The picked branch is behind the other commit: it is on the left.
    expect(heading()).toBe("9999999 old-release ↔ 8888888 feature");
    expect(diffCalls()).toEqual([]);
    expect(calls.filter((c) => c.cmd === "git_graph")).toHaveLength(1);
    expect(highlighted()).toEqual([]);
    const showIn = byText(comparison()!, "button", "Show in Graph");
    expect(showIn).toHaveLength(2);
    // A reload does not close a comparison whose commits were never among the loaded rows.
    await act(async () => useGit.setState({ repos: { [ROOT.toLowerCase()]: status({ behind: 1 }) as never } }));
    await flush();
    expect(heading()).toBe("9999999 old-release ↔ 8888888 feature");
    // Show in Graph loads back; the comparison stays whatever it finds.
    answers.page = [];
    await fire.click(byText(comparison()!, "button", "Show in Graph")[0]);
    await flush(6);
    expect(comparison()).not.toBeNull();
    // A request for another repository's graph is left alone.
    await act(async () => useStore.setState({ graphCompare: { root: "C:\\other", first: sha(1), second: sha(2), names: {}, result: result as never } }));
    await flush();
    expect(useStore.getState().graphCompare).not.toBeNull();
    useStore.setState({ graphCompare: null });
  });
});
