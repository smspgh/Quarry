import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitCommitDetail, GitGraphCommit } from "../lib/gitApi";
import type { Doc } from "../lib/store";

// GraphView rendered in jsdom with the Tauri side replaced: `git_graph` serves one page,
// `git_commit_detail` the details pane.
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ page: [] as unknown[], detail: null as unknown, held: [] as unknown[], status: null as unknown }));
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
