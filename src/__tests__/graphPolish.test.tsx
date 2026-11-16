import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitFile, GitGraphCommit } from "../lib/gitApi";
import type { Doc } from "../lib/store";

// Graph polish (GRAPH-015..018): GraphView in jsdom with the Tauri side replaced. `answers.page`
// is what `git_graph` returns (a function gets the call's arguments).
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ page: [] as unknown, head: null as string | null, hits: [] as unknown[], status: null as unknown }));
const opened = vi.hoisted(() => [] as { path: string; staged: boolean }[]);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "git_graph") return typeof answers.page === "function" ? (answers.page as (a: unknown) => unknown)(args) : answers.page;
    if (cmd === "git_head_sha") return answers.head;
    if (cmd === "git_graph_indexed") return true;
    if (cmd === "git_commit_detail") return null;
    if (cmd === "git_stash_list") return [];
    if (cmd === "git_status") return answers.status;
    if (cmd === "git_graph_search") return answers.hits;
    return undefined;
  },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: async () => undefined }));
// A click on a changed file is Source Control's own action: only that it is asked for is checked here.
vi.mock("../lib/git", async (original) => ({
  ...(await original<typeof import("../lib/git")>()),
  openChange: async (f: GitFile, staged: boolean) => void opened.push({ path: f.path, staged }),
}));

const { render, cleanup, flush, fire, byText, act } = await import("./helpers/render");
const { GraphView } = await import("../components/GraphView");
const { useGit } = await import("../lib/git");
const { useStore } = await import("../lib/store");
const { isPanelShown } = await import("../lib/panels");
(await import("../lib/gitCompare")).setRowClickDelay(0); // file rows compare at once here

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
const PAGE = [commit(1, { refs: ["HEAD", "refs/heads/main"] }), commit(2), commit(3), commit(4), commit(5)];
const id = (i: number) => `${10000 + i}`.padEnd(40, "0");
/** A straight history of `n` commits. */
const chain = (n: number) => Array.from({ length: n }, (_, i) => commit(1, { sha: id(i), short: `c${i}`, parents: i < n - 1 ? [id(i + 1)] : [], summary: `c${i}` }));
const doc = { id: "graph-1", kind: "graph", name: "Graph", graph: { root: ROOT } } as unknown as Doc;
const file = (name: string, extra: Partial<GitFile> = {}): GitFile => ({ path: `${ROOT}\\${name}`, origPath: null, index: ".", worktree: "M", conflicted: false, untracked: false, ...extra });
const status = (extra: object = {}) => ({ root: ROOT, branch: "main", head: "1111111", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], ...extra });
const setRepo = (extra: object = {}) => act(async () => useGit.setState({ repos: { [ROOT.toLowerCase()]: status(extra) as never } }));

const rows = () => [...document.querySelectorAll<HTMLElement>(".graph-list [role=option]")];
const selectedRow = () => document.querySelector<HTMLElement>(".graph-list [aria-selected=true]");
const list = () => document.querySelector<HTMLElement>(".graph-list")!;
const toolbar = () => document.querySelector<HTMLElement>(".graph-toolbar")!;
const pane = () => document.querySelector<HTMLElement>(".graph-uncommitted");
const graphCalls = () => calls.filter((c) => c.cmd === "git_graph").map((c) => c.args);
const dashed = (row: HTMLElement) => row.querySelectorAll(".graph-lanes .dashed").length;
const type = (text: string) => act(async () => {
  const box = document.querySelector<HTMLInputElement>(".graph-search input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
});
const searchAll = async (text: string) => {
  await type(text);
  await fire.keyDown(document.querySelector(".graph-search input")!, "Enter", { ctrlKey: true });
  await flush();
};
const mouse = (el: Element | Window, kind: string, init: MouseEventInit = {}) => act(async () => { el.dispatchEvent(new MouseEvent(kind, { bubbles: true, cancelable: true, ...init })); });
const sized = (el: Element, props: Record<string, number>) => {
  for (const [k, v] of Object.entries(props)) Object.defineProperty(el, k, { configurable: true, value: v });
};

beforeEach(() => {
  calls.length = 0;
  opened.length = 0;
  answers.page = PAGE;
  answers.head = null;
  answers.hits = [];
  answers.status = status();
  useStore.setState({ toasts: [], dialog: null, graphCompare: null });
  useGit.setState({ busy: null, stashPending: null, repos: { [ROOT.toLowerCase()]: status() as never } });
});
afterEach(async () => {
  await cleanup();
  useGit.setState({ repos: {} });
});

describe("GraphView uncommitted-changes row (GRAPH-015)", () => {
  const FOUR = [file("a.ts"), file("b.ts"), file("c.ts"), file("d.ts")];
  const MIXED = [file("store.ts", { index: "M", worktree: "." }), file("app.css"), file("notes.txt", { index: "?", worktree: "?", untracked: true })];

  it("is the first row: hollow dot, dashed line to the current commit, empty columns, no strip", async () => {
    await setRepo({ files: FOUR });
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(rows()).toHaveLength(6);
    const row = rows()[0];
    expect(row.querySelector(".graph-c-msg .truncate")?.textContent).toBe("Uncommitted changes (4)");
    expect(row.className).toContain("uncommitted");
    expect(row.querySelector("circle.gn.uncommitted")).not.toBeNull();
    expect(row.querySelector("line.dashed")).not.toBeNull();
    // The line ends at the current commit, right below; nothing further down is dashed.
    expect(rows().map(dashed)).toEqual([1, 1, 0, 0, 0, 0]);
    expect([".graph-c-author", ".graph-c-date", ".graph-c-sha"].map((s) => row.querySelector(s)?.textContent)).toEqual(["", "", ""]);
    expect(document.querySelector(".graph-strip")).toBeNull();
    // Not a commit: the count leaves it out, and its parent came from the page (no extra git call).
    expect(toolbar().textContent).toContain("5 commits");
    expect(calls.some((c) => c.cmd === "git_head_sha")).toBe(false);
  });

  it("is not there when nothing is changed", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(rows()).toHaveLength(5);
    expect(rows()[0].textContent).toContain("Commit number 1");
    expect(document.querySelector(".graph-row.uncommitted")).toBeNull();
  });

  it("runs its line down the first lane to a current commit further down, asking git for its id when it is not on the page", async () => {
    // origin/main is 2 commits ahead: the commit I am on is the third row, with no HEAD label on this page.
    answers.page = [commit(1), commit(2), commit(3), commit(4), commit(5)];
    answers.head = sha(3);
    await setRepo({ files: [file("a.ts")], head: "3333333" });
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(calls.filter((c) => c.cmd === "git_head_sha")).toHaveLength(1);
    expect(rows()[0].textContent).toContain("Uncommitted changes (1)");
    // Rows 1 and 2 (the incoming commits) sit in the second lane, beside the dashed line.
    const cx = rows().map((r) => r.querySelector("circle")?.getAttribute("cx"));
    expect(cx).toEqual(["6", "18", "18", "6", "6", "6"]);
    expect(rows().map(dashed)).toEqual([1, 1, 1, 1, 0, 0]);
  });

  it("the line runs to the end of the loaded rows while the current commit is not loaded", async () => {
    answers.page = [commit(1), commit(2), commit(3), commit(4), commit(5)];
    answers.head = "f".repeat(40);
    await setRepo({ files: [file("a.ts")], head: "fffffff" });
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(rows().map(dashed)).toEqual([1, 1, 1, 1, 1, 1]);
    // Every commit keeps clear of the first lane.
    expect(rows().slice(1).map((r) => r.querySelector("circle")?.getAttribute("cx"))).toEqual(["18", "18", "18", "18", "18"]);
  });

  it("selecting it lists the changed files in Source Control's groups, with Based on instead of commit details", async () => {
    await setRepo({ files: MIXED });
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(pane()).toBeNull();
    await fire.click(rows()[0]);
    await flush();
    expect(selectedRow()?.textContent).toContain("Uncommitted changes (3)");
    expect(pane()?.querySelector(".graph-uncommitted-title")?.textContent).toBe("Uncommitted changes on main");
    const group = (name: string) => [...(pane()!.querySelector(`[aria-label="${name}"]`)?.querySelectorAll(".graph-file") ?? [])].map((r) => `${r.querySelector(".scm-name")?.textContent} ${r.querySelector(".scm-letter")?.textContent}`);
    expect(group("Staged Changes")).toEqual(["store.ts M"]);
    expect(group("Changes")).toEqual(["app.css M", "notes.txt U"]);
    expect(pane()!.querySelector('[aria-label="Merge Changes"]')).toBeNull();
    expect(pane()!.querySelector(".graph-meta")?.textContent).toBe("Based on1111111");
    // No message, author, parent or copy-id button; and nothing was asked from git about a commit.
    expect(document.querySelector(".graph-full-sha")).toBeNull();
    expect(document.querySelector(".graph-message")).toBeNull();
    expect(document.querySelector('[title="Copy the commit id"]')).toBeNull();
    expect(calls.some((c) => c.cmd === "git_commit_detail")).toBe(false);
    expect(byText(pane()!, "button", "Open Source Control")).toHaveLength(isPanelShown(useStore.getState(), "git") ? 0 : 1);

    // A click opens what Source Control opens for the file: staged or not.
    await fire.click(byText(pane()!, ".graph-file", "app.css")[0]);
    await fire.click(byText(pane()!, ".graph-file", "store.ts")[0]);
    await fire.click(byText(pane()!, ".graph-file", "notes.txt")[0]);
    expect(opened).toEqual([{ path: `${ROOT}\\app.css`, staged: false }, { path: `${ROOT}\\store.ts`, staged: true }, { path: `${ROOT}\\notes.txt`, staged: false }]);

    // Based on: the commit the changes sit on.
    await fire.click(byText(pane()!, "button", "1111111")[0]);
    await flush();
    expect(selectedRow()?.textContent).toContain("Commit number 1");
    expect(pane()).toBeNull();
  });

  it("a right-click selects it and opens no menu", async () => {
    await setRepo({ files: FOUR });
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.contextMenu(rows()[0], { clientX: 30, clientY: 40 });
    await flush();
    expect(selectedRow()?.textContent).toContain("Uncommitted changes");
    expect(document.querySelector("[role=menu]")).toBeNull();
    expect(pane()).not.toBeNull();
  });

  it("cannot be picked for a comparison: Ctrl+click on it, or with it selected, is a plain click", async () => {
    await setRepo({ files: FOUR });
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.click(rows()[2]);
    await fire.click(rows()[0], { ctrlKey: true });
    await flush();
    expect(document.querySelectorAll(".graph-list [aria-selected=true]")).toHaveLength(1);
    expect(selectedRow()?.textContent).toContain("Uncommitted changes");
    expect(document.querySelector(".graph-compare")).toBeNull();
    expect(pane()).not.toBeNull();
    await fire.click(rows()[3], { ctrlKey: true });
    await flush();
    expect(document.querySelectorAll(".graph-list [aria-selected=true]")).toHaveLength(1);
    expect(selectedRow()?.textContent).toContain("Commit number 3");
    expect(document.querySelector(".graph-compare")).toBeNull();
    expect(calls.some((c) => c.cmd === "git_diff_files")).toBe(false);
    // Nor is it offered as "Compare with …" in a commit's menu.
    await fire.click(rows()[0]);
    await fire.contextMenu(rows()[2], { clientX: 30, clientY: 40 });
    const items = [...document.querySelectorAll(".graph-menu [role=menuitem]")].map((b) => b.textContent);
    expect(items).toContain("Compare with Working Tree");
    expect(items.filter((t) => t?.startsWith("Compare with ") && !/Working Tree|Branch/.test(t))).toEqual([]);
  });

  it("Up from the first commit and Home reach it; Down leaves it", async () => {
    await setRepo({ files: FOUR });
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.click(rows()[1]);
    await fire.keyDown(list(), "ArrowUp");
    expect(selectedRow()?.textContent).toContain("Uncommitted changes (4)");
    expect(pane()).not.toBeNull();
    await fire.keyDown(list(), "ArrowDown");
    expect(selectedRow()?.textContent).toContain("Commit number 1");
    await fire.keyDown(list(), "End");
    await fire.keyDown(list(), "Home");
    expect(selectedRow()?.textContent).toContain("Uncommitted changes (4)");
  });

  it("find and the counts leave it out, and Enter never steps onto it", async () => {
    await setRepo({ files: FOUR });
    await render(<GraphView doc={doc} visible />);
    await flush();
    await type("uncommitted");
    expect(toolbar().textContent).toContain("0 in 5 loaded");
    expect(toolbar().textContent).toContain("5 commits");
    expect(rows().map((r) => r.className.includes("dim"))).toEqual([true, true, true, true, true, true]);
    await type("commit number");
    expect(toolbar().textContent).toContain("5 in 5 loaded");
    expect(rows()[0].className).toContain("dim");
    const box = document.querySelector(".graph-search input")!;
    const seen: string[] = [];
    for (let i = 0; i < 7; i++) {
      await fire.keyDown(box, "Enter");
      seen.push(selectedRow()?.querySelector(".graph-c-msg .truncate")?.textContent ?? "");
    }
    expect(seen).toEqual(["Commit number 1", "Commit number 2", "Commit number 3", "Commit number 4", "Commit number 5", "Commit number 1", "Commit number 2"]);
  });

  it("follows the working folder without reading the history again; it goes when the changes go", async () => {
    await setRepo({ files: FOUR.slice(0, 3) });
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.click(rows()[3]);
    await setRepo({ files: FOUR });
    await flush();
    expect(rows()[0].textContent).toContain("Uncommitted changes (4)");
    expect(selectedRow()?.textContent).toContain("Commit number 3");
    expect(graphCalls()).toHaveLength(1);

    // Everything is discarded while the row is selected: it disappears with its pane.
    await fire.click(rows()[0]);
    expect(pane()).not.toBeNull();
    await setRepo({ files: [] });
    await flush();
    expect(rows()).toHaveLength(5);
    expect(rows()[0].textContent).toContain("Commit number 1");
    expect(rows().map(dashed)).toEqual([0, 0, 0, 0, 0]);
    expect(pane()).toBeNull();
    expect(selectedRow()).toBeNull();
    expect(graphCalls()).toHaveLength(1);

    // New work: the row is back, on the current commit.
    await setRepo({ files: [file("z.ts")] });
    await flush();
    expect(rows()).toHaveLength(6);
    expect(rows()[0].textContent).toContain("Uncommitted changes (1)");
    expect(rows().map(dashed)).toEqual([1, 1, 0, 0, 0, 0]);
    expect(graphCalls()).toHaveLength(1);
  });

  it("stands alone above \"No commits yet.\" in a repository without commits", async () => {
    answers.page = [];
    const fresh = ["a", "b", "c", "d", "e"].map((n) => file(`${n}.txt`, { index: "?", worktree: "?", untracked: true }));
    await setRepo({ files: fresh, head: null });
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("Uncommitted changes (5)");
    expect(dashed(rows()[0])).toBe(0);
    expect(rows()[0].querySelectorAll(".graph-lanes line, .graph-lanes path")).toHaveLength(0);
    const note = document.querySelector(".graph-list .panel-note")!;
    expect(note.textContent).toBe("No commits yet.");
    expect(rows()[0].compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toolbar().textContent).toContain("0 commits");
    await fire.click(rows()[0]);
    expect(pane()?.querySelector(".graph-meta")?.textContent).toContain("nothing yet");
  });

  it("shows beside the stopped-operation strip, with the conflicted file under Merge Changes", async () => {
    await setRepo({ operation: "cherry-pick", files: [file("clash.ts", { index: "U", worktree: "U", conflicted: true }), file("a.ts"), file("b.ts")] });
    await render(<GraphView doc={doc} visible />);
    await flush();
    const strips = [...document.querySelectorAll<HTMLElement>(".graph-strip")];
    expect(strips).toHaveLength(1);
    expect(strips[0].textContent).toContain("The cherry-pick stopped part-way: 1 file has conflicts");
    expect(byText(strips[0], "button", "Abort")).toHaveLength(1);
    expect(rows()[0].textContent).toContain("Uncommitted changes (3)");
    await fire.click(rows()[0]);
    const merge = pane()!.querySelector('[aria-label="Merge Changes"]')!;
    expect(merge.querySelector(".scm-name")?.textContent).toBe("clash.ts");
    expect(merge.querySelector(".scm-letter")?.textContent).toBe("!");
    await fire.click(merge.querySelector(".graph-file")!);
    expect(opened).toEqual([{ path: `${ROOT}\\clash.ts`, staged: false }]);
  });

  it("says \"not on a branch\" with a detached HEAD", async () => {
    answers.page = [commit(1, { refs: ["HEAD"] }), ...PAGE.slice(1)];
    await setRepo({ branch: null, files: [file("a.ts"), file("b.ts")] });
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.click(rows()[0]);
    expect(pane()?.querySelector(".graph-uncommitted-title")?.textContent).toBe("Uncommitted changes (not on a branch)");
    expect(rows().map(dashed)).toEqual([1, 1, 0, 0, 0, 0]);
  });
});

describe("GraphView results divider (GRAPH-016)", () => {
  const hits = () => document.querySelector<HTMLElement>(".graph-hits")!;
  const divider = () => document.querySelector<HTMLElement>(".graph-hits-resizer");
  /** Drag the divider from y = 300 through each of `ys`. */
  const drag = async (...ys: number[]) => {
    await mouse(divider()!, "mousedown", { clientY: 300 });
    for (const y of ys) await mouse(window, "mousemove", { clientY: y });
    await mouse(window, "mouseup");
  };
  const open = async (count: number, text = "tokenizer") => {
    answers.hits = chain(count);
    await searchAll(text);
    for (const h of document.querySelectorAll<HTMLElement>(".graph-hit")) h.scrollIntoView = () => {};
  };
  /** 60 results in a list 220 px tall; the commit list below has 480 px. */
  const measured = () => {
    sized(hits(), { offsetHeight: 220, scrollHeight: 1470 });
    sized(list(), { clientHeight: 480 });
  };

  it("has no divider without results", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(divider()).toBeNull();
    await open(0);
    expect(hits()).not.toBeNull();
    expect(divider()).toBeNull();
    await open(60);
    expect(divider()).not.toBeNull();
    await fire.click(document.querySelector('[title="Close the results"]')!);
    expect(divider()).toBeNull();
  });

  it("dragging sets the height between its limits", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await open(60);
    measured();
    expect(hits().style.maxHeight).toBe("");
    await drag(450);
    expect(hits().style.maxHeight).toBe("370px"); // 220 + 150
    measured();
    await drag(-2000);
    expect(hits().style.maxHeight).toBe("80px"); // heading and one result
    measured();
    await drag(5000);
    expect(hits().style.maxHeight).toBe("544px"); // 220 + 480 - 156: the commit list keeps 6 rows
  });

  it("a dragged height stays when a result is picked, through Show Fewer / Show More and for the next search", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await open(60);
    measured();
    await drag(450);
    await fire.click(document.querySelector(".graph-hit")!);
    await flush();
    expect(hits().className).not.toContain("compact");
    expect(hits().style.maxHeight).toBe("370px");
    await fire.click(byText(hits(), "button", "Show Fewer")[0]);
    expect(hits().className).toContain("compact");
    expect(hits().style.maxHeight).toBe("");
    await fire.click(byText(hits(), "button", "Show More")[0]);
    expect(hits().style.maxHeight).toBe("370px");
    // Closed, then another search in the same tab: the height is kept.
    await fire.click(document.querySelector('[title="Close the results"]')!);
    await open(40, "parser");
    expect(hits().style.maxHeight).toBe("370px");
    // Double-click: back to the default height, which shrinks again when a result is picked.
    await mouse(divider()!, "dblclick");
    expect(hits().style.maxHeight).toBe("");
    await fire.click(document.querySelector(".graph-hit")!);
    await flush();
    expect(hits().className).toContain("compact");
  });

  it("before any drag a picked result shrinks the list as before", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await open(60);
    await fire.click(document.querySelector(".graph-hit")!);
    await flush();
    expect(hits().className).toContain("compact");
    await fire.click(byText(hits(), "button", "Show More")[0]);
    expect(hits().className).not.toContain("compact");
    expect(hits().style.maxHeight).toBe("");
  });

  it("a list that shows all its results does not grow, and that drag is not remembered", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await open(2);
    sized(hits(), { offsetHeight: 78, scrollHeight: 78 });
    sized(list(), { clientHeight: 480 });
    await drag(500, 900);
    expect(hits().style.maxHeight).toBe("");
    await drag(100);
    expect(hits().style.maxHeight).toBe("");
  });
});

describe("GraphView lane scrolling (GRAPH-017)", () => {
  // 20 branch tips, each on its own older commit: 20 lanes at once.
  const tip = (i: number) => commit(1, { sha: id(i), short: `t${i}`, parents: [id(100 + i)], summary: `tip ${i}`, refs: i === 0 ? ["HEAD", "refs/heads/main"] : [] });
  const WIDE = [...Array.from({ length: 20 }, (_, i) => tip(i)), ...Array.from({ length: 20 }, (_, i) => commit(1, { sha: id(100 + i), short: `p${i}`, parents: [], summary: `root ${i}` }))];
  const scroll = () => list().style.getPropertyValue("--lane-scroll");
  const bar = () => document.querySelector<HTMLElement>(".graph-lane-scroll");
  const fades = () => ["lanes-left", "lanes-right"].filter((c) => list().classList.contains(c));
  const wheel = (init: WheelEventInit) => act(async () => { rows()[1].querySelector(".graph-lane-cell svg")!.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init })); });
  // jsdom lays nothing out: give the list a height, so all 40 rows are drawn (only rows on screen are in the DOM).
  const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!;
  beforeEach(() => Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get: () => 2000 }));
  afterEach(() => Object.defineProperty(Element.prototype, "clientHeight", clientHeight));

  it("every lane has its own place; the column stays 16 lanes wide with a scroll bar and a faded right edge", async () => {
    answers.page = WIDE;
    await render(<GraphView doc={doc} visible />);
    await flush();
    const cx = rows().slice(0, 20).map((r) => Number(r.querySelector("circle")?.getAttribute("cx")));
    expect(cx).toEqual(Array.from({ length: 20 }, (_, i) => i * 12 + 6));
    // The column shows 16 lanes (198 px); the lines are drawn at the full 20 lanes inside it.
    expect(rows()[0].querySelector<HTMLElement>(".graph-lane-cell")?.style.width).toBe("198px");
    expect(rows()[0].querySelector("svg.graph-lanes")?.getAttribute("width")).toBe("246");
    expect(document.querySelector<HTMLElement>(".graph-head")?.style.paddingLeft).toBe("206px");
    expect(bar()?.style.width).toBe("198px");
    expect((bar()?.firstElementChild as HTMLElement).style.width).toBe("246px");
    expect(scroll()).toBe("0px");
    expect(fades()).toEqual(["lanes-right"]);
  });

  it("Shift+wheel over the lanes and the scroll bar move every row's lanes together", async () => {
    answers.page = WIDE;
    await render(<GraphView doc={doc} visible />);
    await flush();
    await wheel({ deltaY: 100 }); // no Shift: the list's own scrolling
    expect(scroll()).toBe("0px");
    await wheel({ deltaY: 100, shiftKey: true });
    expect(scroll()).toBe("30px");
    expect(fades()).toEqual(["lanes-left", "lanes-right"]);
    await wheel({ deltaX: 100, shiftKey: true });
    await wheel({ deltaX: 100, shiftKey: true });
    expect(scroll()).toBe("48px"); // 20 - 16 lanes: the end
    expect(fades()).toEqual(["lanes-left"]);
    await wheel({ deltaY: -400, shiftKey: true });
    expect(scroll()).toBe("0px");
    // The scroll bar under the heading.
    await act(async () => {
      bar()!.scrollLeft = 24;
      bar()!.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(scroll()).toBe("24px");
    // A Shift+wheel over the text columns is not a lane scroll.
    await act(async () => { rows()[1].querySelector(".graph-c-msg")!.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100, shiftKey: true })); });
    expect(scroll()).toBe("24px");
  });

  it("selecting a commit brings its dot into view; switching scope starts at lane 1 again", async () => {
    answers.page = WIDE;
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.click(rows()[19]); // lane 20
    expect(scroll()).toBe("48px");
    await fire.click(rows()[10]); // lane 11: already in view
    expect(scroll()).toBe("48px");
    await fire.click(rows()[0]);
    expect(scroll()).toBe("0px");
    await fire.keyDown(list(), "End"); // the last row, in lane 20
    expect(scroll()).toBe("48px");
    // A reload keeps the place.
    await setRepo({ behind: 1 });
    await flush();
    expect(graphCalls()).toHaveLength(2);
    expect(scroll()).toBe("48px");
    await fire.click(byText(toolbar(), "button", "All branches")[0]);
    await flush();
    expect(scroll()).toBe("0px");
  });

  it("a graph of 16 lanes or fewer has no scroll bar, no faded edge, and Shift+wheel does nothing", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(bar()).toBeNull();
    expect(fades()).toEqual([]);
    expect(rows()[0].querySelector<HTMLElement>(".graph-lane-cell")?.style.width).toBe("18px");
    await wheel({ deltaY: 100, shiftKey: true });
    expect(scroll()).toBe("0px");
  });
});

describe("GraphView date order (GRAPH-018)", () => {
  const button = () => byText(toolbar(), "button", "Date order")[0] as HTMLButtonElement;
  const toasts = () => useStore.getState().toasts.map((t) => t.message);
  const summaries = () => rows().map((r) => r.querySelector(".graph-c-msg .truncate")?.textContent);
  // What git answers per order: by date, commit 3 (a merged branch's) moves up.
  const BY_DATE = [PAGE[0], { ...PAGE[2], parents: [sha(4)] }, { ...PAGE[1], parents: [sha(4)] }, PAGE[3], PAGE[4]];
  const ordered = (args: { order: string | null }) => (args.order === "date" ? BY_DATE : PAGE);

  it("is off by default; the first page asks for 301 commits in branch order", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(graphCalls()).toEqual([{ root: ROOT, all: false, skip: 0, limit: 301, order: null }]);
    expect(button().disabled).toBe(false);
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });

  it("turning it on reloads in date order and keeps the selected commit; a reload keeps it on; off goes back", async () => {
    answers.page = ordered;
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.click(rows()[2]);
    expect(selectedRow()?.textContent).toContain("Commit number 3");
    await fire.click(button());
    await flush();
    expect(graphCalls().map((a) => a.order)).toEqual([null, "date"]);
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(summaries()).toEqual(["Commit number 1", "Commit number 3", "Commit number 2", "Commit number 4", "Commit number 5"]);
    expect(selectedRow()?.textContent).toContain("Commit number 3");
    expect(document.querySelector(".graph-detail")).not.toBeNull();
    // The repository moved: still date order.
    await setRepo({ ahead: 1 });
    await flush();
    expect(graphCalls().map((a) => a.order)).toEqual([null, "date", "date"]);
    await fire.click(button());
    await flush();
    expect(graphCalls().map((a) => a.order)).toEqual([null, "date", "date", null]);
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(summaries()[1]).toBe("Commit number 2");
    expect(toasts()).toEqual([]);
  });

  it("works for any size of history: a large one pages in date order", async () => {
    answers.page = chain(301);
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(toolbar().textContent).toContain("300+ commits");
    expect(button().disabled).toBe(false);
    await fire.click(button());
    await flush();
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(graphCalls().map((a) => a.order)).toEqual([null, "date"]);
    // Scrolling to the end asks for the next page, still in date order.
    await act(async () => {
      list().scrollTop = 300 * 26;
      list().dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await flush();
    expect(graphCalls().slice(2).map((a) => [a.skip, a.order])).toEqual([[300, "date"]]);
    expect(toasts()).toEqual([]);
  });

  it("stays on when switching to a larger scope or when the history grows", async () => {
    await render(<GraphView doc={doc} visible />);
    await flush();
    await fire.click(button());
    await flush();
    answers.page = (args: { all: boolean }) => (args.all ? chain(301) : PAGE);
    await fire.click(byText(toolbar(), "button", "All branches")[0]);
    await flush(6);
    expect(graphCalls().slice(2).map((a) => [a.all, a.order])).toEqual([[true, "date"]]);
    expect(button().getAttribute("aria-pressed")).toBe("true");
    answers.page = chain(303);
    await setRepo({ behind: 5 });
    await flush(6);
    expect(graphCalls().slice(-1)[0]).toMatchObject({ order: "date" });
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(toasts()).toEqual([]);
  });

  it("is disabled until the first page has arrived", async () => {
    let arrive: (page: unknown) => void = () => {};
    answers.page = () => new Promise((r) => { arrive = r; });
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(button().disabled).toBe(true);
    expect(button().title).toBe("Available once the commits are counted");
    await act(async () => arrive(PAGE));
    await flush();
    expect(button().disabled).toBe(false);
  });

  it("works with the uncommitted-changes row: it stays first and is not counted", async () => {
    answers.page = chain(300);
    await setRepo({ files: [file("a.ts")] });
    await render(<GraphView doc={doc} visible />);
    await flush();
    expect(toolbar().textContent).toContain("300 commits");
    expect(rows()[0].textContent).toContain("Uncommitted changes (1)");
    expect(button().disabled).toBe(false);
    await fire.click(button());
    await flush();
    expect(rows()[0].textContent).toContain("Uncommitted changes (1)");
    expect(button().getAttribute("aria-pressed")).toBe("true");
  });
});
