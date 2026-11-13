import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitCommitDetail, GitGraphCommit } from "../lib/gitApi";
import type { Doc } from "../lib/store";

// GraphView rendered in jsdom with the Tauri side replaced: `git_graph` serves one page,
// `git_commit_detail` the details pane.
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ page: [] as unknown[], detail: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "git_graph") return answers.page;
    if (cmd === "git_graph_indexed") return true;
    if (cmd === "git_commit_detail") return answers.detail;
    return undefined;
  },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: async () => undefined }));

const { render, cleanup, flush, fire, byText } = await import("./helpers/render");
const { GraphView } = await import("../components/GraphView");

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
