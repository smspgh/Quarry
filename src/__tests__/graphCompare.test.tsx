import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitCommitFile, GitCompare, GitGraphCommit, GitStatus } from "../lib/gitApi";

// The comparison pane of the commit graph (specs/git-compare-commits.md) in jsdom, with the Tauri
// side replaced: `git_diff_files` answers the comparison, `git_show` a file's text at a commit,
// `fs_*` the working folder. Every invoke is recorded, so "nothing but reads" can be asserted.
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const world = vi.hoisted(() => ({
  compare: null as unknown,
  /** `${rev}:${rel}` → text ("\0" marks a binary blob); missing → not at that revision. */
  blobs: {} as Record<string, string>,
  /** path → text of the file in the working folder. */
  disk: {} as Record<string, string>,
}));
const spy = vi.hoisted(() => ({ openPath: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "git_diff_files") return typeof world.compare === "function" ? (world.compare as (a: unknown) => unknown)(args) : world.compare;
    if (cmd === "git_show") {
      const text = world.blobs[`${args.rev}:${args.rel}`];
      return text === undefined ? null : { text, binary: text.includes("\0"), encoding: "UTF-8" };
    }
    if (cmd === "fs_exists") return (args.path as string) in world.disk;
    if (cmd === "fs_stat") return { path: args.path, name: args.path, size: world.disk[args.path as string].length, isDir: false, modifiedMs: 1, readonly: false, isLarge: false };
    if (cmd === "fs_read_text") return { path: args.path, content: world.disk[args.path as string], encoding: "UTF-8", hasBom: false, eol: "LF", size: 1, modifiedMs: 1, hadDecodeErrors: false, looksBinary: false };
    if (cmd === "git_stash_list") return [];
    return undefined;
  },
}));
vi.mock("../lib/actions", async (orig) => ({ ...(await orig<typeof import("../lib/actions")>()), openPath: spy.openPath }));

const { render, cleanup, flush, fire, byText, act } = await import("./helpers/render");
const { GraphCompare } = await import("../components/GraphCompare");
const { WORKTREE } = await import("../lib/gitCompare");
const { compareWithBranch, pickBranch, useGit } = await import("../lib/git");
const { diffOf } = await import("../lib/diff");
const { useStore } = await import("../lib/store");
const { editor } = await import("../editor/manager");

const ROOT = "C:\\work\\proj";
const commit = (short: string, summary: string, refs: string[] = []): GitGraphCommit => ({ sha: short.padEnd(40, "0"), short, parents: [], author: "Ada", email: "ada@example.com", time: 0, refs, summary });
const OLD = commit("a1b2c3d", "Add the store");
const NEW = commit("18bc71d", "Rename util to helpers", ["HEAD", "refs/heads/feature"]);
const file = (status: string, rel: string, origRel: string | null = null): GitCommitFile => ({ path: `${ROOT}\\${rel.replace(/\//g, "\\")}`, rel, status, origRel });
const FILES = [file("M", "src/store.ts"), file("A", "new.ts"), file("D", "old.ts"), file("R", "src/lib/helpers.ts", "src/util.ts")];
const result = (extra: Partial<GitCompare> = {}): GitCompare => ({ left: OLD, right: NEW, head: null, files: FILES, insertions: 25, deletions: 9, ahead: 3, behind: 0, untracked: 0, ...extra });
const status = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "feature", head: "18bc71d", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], ...extra });

const pane = () => document.querySelector<HTMLElement>(".graph-compare")!;
const title = () => pane().querySelector(".graph-compare-title")?.textContent;
const head = () => pane().querySelector(".graph-files-head")?.textContent;
const fileRows = () => [...pane().querySelectorAll<HTMLElement>(".graph-compare-file")];
const rowTexts = () => fileRows().map((r) => `${r.querySelector(".scm-letter")?.textContent} ${r.querySelector(".scm-name")?.textContent}`);
const rowOf = (name: string) => fileRows().find((r) => r.querySelector(".scm-name")?.textContent === name)!;
const diffTabs = () => useStore.getState().docs.filter((d) => d.kind === "diff");
const sides = () => {
  const s = diffOf(diffTabs()[diffTabs().length - 1].id);
  return { left: s.left, right: s.right };
};
const lastToast = () => { const t = useStore.getState().toasts; return t[t.length - 1]?.message; };
const closed = vi.fn();
const shownInGraph = vi.fn();

async function show(second: string = NEW.sha, extra: Partial<Parameters<typeof GraphCompare>[0]> = {}) {
  const props = { root: ROOT, first: OLD.sha, second, height: 260, loaded: () => true, onShowInGraph: shownInGraph, onClose: closed, ...extra };
  const m = await render(<GraphCompare {...props} />);
  await flush();
  return { rerender: (more: Partial<Parameters<typeof GraphCompare>[0]>) => m.rerender(<GraphCompare {...props} {...more} />) };
}

describe("GraphCompare", () => {
  beforeEach(() => {
    calls.length = 0;
    world.compare = result();
    world.blobs = {};
    world.disk = {};
    spy.openPath.mockClear();
    closed.mockClear();
    shownInGraph.mockClear();
    useStore.setState({ docs: [], activeId: null, toasts: [], dialog: null, graphCompare: null });
    useGit.setState({ repos: {}, current: null, busy: null });
  });
  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("lists every differing file with its letter, name then folder, and git's summary (COMMITCMP-002.1, .4)", async () => {
    await show();
    expect(calls.find((c) => c.cmd === "git_diff_files")?.args).toEqual({ root: ROOT, left: OLD.sha, right: NEW.sha });
    expect(title()).toBe("a1b2c3d ↔ 18bc71d");
    expect(rowTexts()).toEqual(["M store.ts", "A new.ts", "D old.ts", "R helpers.ts"]);
    expect(head()).toBe("4 files changed, 25 insertions(+), 9 deletions(-)");
    expect(rowOf("store.ts").querySelector(".scm-dir")?.textContent).toBe("src");
    expect(rowOf("helpers.ts").querySelector(".scm-dir")?.textContent).toBe("src\\lib");
    expect(rowOf("helpers.ts").title).toContain("Renamed (from src/util.ts)");
    // Each side: its id, labels and first message line; the counts line under them.
    const sideTexts = [...pane().querySelectorAll(".graph-compare-side")].map((s) => s.textContent);
    expect(sideTexts[0]).toContain("a1b2c3d");
    expect(sideTexts[0]).toContain("Add the store");
    expect(sideTexts[1]).toContain("feature");
    expect(sideTexts[1]).toContain("Rename util to helpers");
    expect(pane().querySelector(".graph-compare-counts")?.textContent).toBe("18bc71d is 3 commits ahead of a1b2c3d.");
    // A merge commit is compared as a snapshot like any other: no first-parent note.
    expect(pane().textContent).not.toContain("first parent");
  });

  it("puts the older commit on the left whatever the click order (COMMITCMP-002.2)", async () => {
    // The newer commit was selected first: git answers with it on the left.
    world.compare = result({ left: NEW, right: OLD, ahead: 0, behind: 3, files: [file("D", "new.ts")], insertions: 9, deletions: 25 });
    await show(OLD.sha, { first: NEW.sha });
    expect(title()).toBe("a1b2c3d ↔ 18bc71d");
    expect(rowTexts()).toEqual(["A new.ts"]);
    expect(pane().querySelector(".graph-compare-counts")?.textContent).toBe("18bc71d is 3 commits ahead of a1b2c3d.");
  });

  it("two branches: the first selected stays left and both counts are given (COMMITCMP-002.3)", async () => {
    world.compare = result({ ahead: 4, behind: 2 });
    await show();
    expect(title()).toBe("a1b2c3d ↔ 18bc71d");
    expect(pane().querySelector(".graph-compare-counts")?.textContent).toBe("18bc71d has 4 commits that a1b2c3d does not; a1b2c3d has 2 that 18bc71d does not.");
  });

  it("Swap Sides exchanges the sides, the letters, the rename and the summary (COMMITCMP-002.5, 003.2)", async () => {
    world.blobs = { [`${OLD.sha}:src/store.ts`]: "old\n", [`${NEW.sha}:src/store.ts`]: "new\n" };
    await show();
    await fire.click(byText(pane(), "button", "Swap Sides")[0]);
    expect(title()).toBe("18bc71d ↔ a1b2c3d");
    expect(rowTexts()).toEqual(["M store.ts", "D new.ts", "A old.ts", "R util.ts"]);
    expect(rowOf("util.ts").title).toContain("Renamed (from src/lib/helpers.ts)");
    expect(head()).toBe("4 files changed, 9 insertions(+), 25 deletions(-)");
    await fire.click(rowOf("store.ts"));
    await flush();
    expect([sides().left.label, sides().left.text, sides().right.label, sides().right.text]).toEqual(["store.ts @ 18bc71d", "new\n", "store.ts @ a1b2c3d", "old\n"]);
  });

  it("identical commits say so, with an empty list and no notification (COMMITCMP-002.6)", async () => {
    world.compare = result({ files: [], insertions: 0, deletions: 0, ahead: 2 });
    await show();
    expect(head()).toBe("No differences: the files of a1b2c3d and 18bc71d are identical.");
    expect(fileRows()).toHaveLength(0);
    expect(useStore.getState().toasts).toHaveLength(0);
    expect(useStore.getState().dialog).toBeNull();
  });

  it("a very long list is all there but only the rows on screen are drawn (COMMITCMP-002.8)", async () => {
    const many = Array.from({ length: 12400 }, (_, i) => file("M", `src/f${i}.ts`));
    world.compare = result({ files: many, insertions: 12400, deletions: 0 });
    await show();
    expect(head()).toMatch(/^12400 files changed/);
    expect(pane().querySelector<HTMLElement>(".graph-compare-rows")!.style.height).toBe(`${12400 * 24}px`);
    expect(fileRows().length).toBeLessThan(40);
    expect(rowTexts()[0]).toBe("M f0.ts");
    const list = pane().querySelector<HTMLElement>(".graph-compare-list")!;
    await act(async () => {
      list.scrollTop = 12000 * 24;
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(fileRows().length).toBeLessThan(40);
    expect(rowTexts()).toContain("M f12000.ts");
    expect(rowOf("f12000.ts").style.top).toBe(`${12000 * 24}px`);
    expect(rowTexts()).not.toContain("M f0.ts");
  });

  it("shows Loading… until git answers, and drops a late answer for a pair that was changed (COMMITCMP-002.10)", async () => {
    const other = commit("77e0f12", "Third");
    const waiting: Record<string, (c: GitCompare) => void> = {};
    world.compare = (args: { right: string }) => new Promise<GitCompare>((done) => { waiting[args.right] = done; });
    const { rerender } = await show();
    expect(head()).toBe("Loading…");
    expect(title()).toBe("a1b2c3d ↔ 18bc71d");
    await rerender({ second: other.sha });
    await flush();
    // The first pair answers late: it must not show.
    await act(async () => waiting[NEW.sha](result()));
    expect(head()).toBe("Loading…");
    await act(async () => waiting[other.sha](result({ right: other, files: [file("M", "third.ts")], insertions: 1, deletions: 0, ahead: 1 })));
    expect(title()).toBe("a1b2c3d ↔ 77e0f12");
    expect(rowTexts()).toEqual(["M third.ts"]);
  });

  it("git failing shows its message without the hint lines (COMMITCMP-002.11)", async () => {
    world.compare = () => Promise.reject("fatal: bad object 18bc71d\nhint: run git fsck");
    await show();
    expect(head()).toBe("Could not compare: fatal: bad object 18bc71d");
    expect(fileRows()).toHaveLength(0);
    expect(useStore.getState().dialog).toBeNull();
  });

  it("a click opens a read-only Compare tab of the two versions; the next file reuses it (COMMITCMP-003.1, .3, .8)", async () => {
    world.blobs = { [`${OLD.sha}:src/store.ts`]: "one\n", [`${NEW.sha}:src/store.ts`]: "one\ntwo\n", [`${NEW.sha}:new.ts`]: "n\n", [`${OLD.sha}:old.ts`]: "x\n" };
    await show();
    await fire.click(rowOf("store.ts"));
    await flush();
    expect(diffTabs()).toHaveLength(1);
    expect(diffTabs()[0].preview).toBe(true);
    expect(sides().left).toMatchObject({ label: "store.ts @ a1b2c3d", text: "one\n", editable: false, path: null });
    expect(sides().right).toMatchObject({ label: "store.ts @ 18bc71d", text: "one\ntwo\n", editable: false, path: null });
    // Added: an empty left side. Enter opens like a click, in the same (preview) tab.
    await fire.keyDown(rowOf("new.ts"), "Enter");
    await flush();
    expect(diffTabs()).toHaveLength(1);
    expect([sides().left.text, sides().right.label, sides().right.text]).toEqual(["", "new.ts @ 18bc71d", "n\n"]);
    // Deleted: an empty right side.
    await fire.click(rowOf("old.ts"));
    await flush();
    expect(diffTabs()).toHaveLength(1);
    expect([sides().left.label, sides().left.text, sides().right.text]).toEqual(["old.ts @ a1b2c3d", "x\n", ""]);
    // A kept tab (double-click on its tab clears `preview`) stays; the next file gets a second tab.
    useStore.getState().updateDoc(diffTabs()[0].id, { preview: undefined });
    await fire.click(rowOf("store.ts"));
    await flush();
    expect(diffTabs()).toHaveLength(2);
    // The pane itself is unchanged by all this, and only read commands were run.
    expect(title()).toBe("a1b2c3d ↔ 18bc71d");
    expect(new Set(calls.map((c) => c.cmd))).toEqual(new Set(["git_diff_files", "git_show"]));
  });

  it("a renamed file compares the old name on the left with the new one on the right (COMMITCMP-003.6)", async () => {
    world.blobs = { [`${OLD.sha}:src/util.ts`]: "a\nb\n", [`${NEW.sha}:src/lib/helpers.ts`]: "a\nB\n" };
    await show();
    await fire.click(rowOf("helpers.ts"));
    await flush();
    expect([sides().left.label, sides().left.text, sides().right.label, sides().right.text]).toEqual(["util.ts @ a1b2c3d", "a\nb\n", "helpers.ts @ 18bc71d", "a\nB\n"]);
  });

  it("a binary file is listed like any other, opens no tab and says so (COMMITCMP-002.7, 003.7)", async () => {
    world.compare = result({ files: [file("M", "logo.png")] });
    world.blobs = { [`${OLD.sha}:logo.png`]: "\0png", [`${NEW.sha}:logo.png`]: "\0png2" };
    await show();
    expect(rowTexts()).toEqual(["M logo.png"]);
    await fire.click(rowOf("logo.png"));
    await flush();
    expect(diffTabs()).toHaveLength(0);
    expect(lastToast()).toBe("This file is binary.");
  });

  it("double-click opens the file itself, but not a deleted one (COMMITCMP-003.9)", async () => {
    await show();
    await act(async () => { rowOf("store.ts").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(spy.openPath).toHaveBeenCalledWith(`${ROOT}\\src\\store.ts`);
    spy.openPath.mockClear();
    await act(async () => { rowOf("old.ts").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(spy.openPath).not.toHaveBeenCalled();
  });

  it("the close button reports back, and an unloaded side offers Show in Graph (COMMITCMP-001.7, 005.6)", async () => {
    await show(NEW.sha, { loaded: (sha) => sha !== NEW.sha });
    const buttons = byText(pane(), "button", "Show in Graph");
    expect(buttons).toHaveLength(1);
    await fire.click(buttons[0]);
    expect(shownInGraph).toHaveBeenCalledWith(NEW.sha);
    await fire.click(pane().querySelector('[title="Close the comparison"]')!);
    expect(closed).toHaveBeenCalled();
  });

  it("an answer handed in for the pair is shown at once, without asking git (COMMITCMP-005.6)", async () => {
    world.compare = null;
    await show(NEW.sha, { initial: result(), names: { first: "main", second: "feature" }, picked: true });
    expect(calls.some((c) => c.cmd === "git_diff_files")).toBe(false);
    expect(title()).toBe("a1b2c3d main ↔ 18bc71d feature");
    expect(rowTexts()).toHaveLength(4);
  });

  it("a picked branch goes on the left unless it is ahead (COMMITCMP-005.3, .4, .7)", async () => {
    // first = my commit (18bc71d, feature), second = the picked branch main (a1b2c3d); both moved on.
    const mine = result({ left: NEW, right: OLD, ahead: 2, behind: 4, files: [file("M", "a.ts")] });
    await show(OLD.sha, { first: NEW.sha, initial: mine, names: { first: "feature", second: "main" }, picked: true });
    expect(title()).toBe("a1b2c3d main ↔ 18bc71d feature");
    expect(pane().querySelector(".graph-compare-counts")?.textContent).toBe("18bc71d has 4 commits that a1b2c3d does not; a1b2c3d has 2 that 18bc71d does not.");
    await cleanup();
    // The picked branch is ahead of my commit: my commit is on the left.
    const ahead = result({ left: OLD, right: NEW, ahead: 3, behind: 0 });
    await show(NEW.sha, { initial: ahead, names: { first: "main", second: "origin/main" }, picked: true });
    expect(title()).toBe("a1b2c3d main ↔ 18bc71d origin/main");
    await cleanup();
    // The branch I am on.
    const here = commit("a1b2c3d", "Add the store", ["HEAD", "refs/heads/main"]);
    await show(here.sha, { initial: result({ left: here, right: here, files: [], ahead: 0, insertions: 0, deletions: 0 }), names: { first: "main", second: "main" }, picked: true });
    expect(head()).toBe("No differences: main is the commit you are on.");
    expect(byText(pane(), "button", "Swap Sides")).toHaveLength(0);
  });
});

describe("GraphCompare with the working tree (COMMITCMP-004)", () => {
  const WT = result({ right: null, head: "18bc71d", files: [file("M", "app.ts"), file("M", "src/store.ts"), file("D", "old.ts"), file("R", "helpers.ts", "util.ts"), file("U", "merge.ts")], insertions: 5, deletions: 2, ahead: 2, behind: 0, untracked: 3 });
  beforeEach(() => {
    calls.length = 0;
    world.compare = WT;
    world.blobs = { [`${OLD.sha}:app.ts`]: "committed\n", [`${OLD.sha}:src/store.ts`]: "committed\n", [`${OLD.sha}:old.ts`]: "x\n", [`${OLD.sha}:util.ts`]: "u\n" };
    world.disk = { [`${ROOT}\\src\\store.ts`]: "on disk\n", [`${ROOT}\\helpers.ts`]: "u2\n", [`${ROOT}\\merge.ts`]: "<<<<<<<\n", [`${ROOT}\\app.ts`]: "saved\n" };
    spy.openPath.mockClear();
    useStore.setState({ docs: [], activeId: null, toasts: [], dialog: null });
  });
  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("is headed with the working tree, has no Swap Sides and notes the untracked files (.1, .2, .7)", async () => {
    await show(WORKTREE);
    expect(calls.find((c) => c.cmd === "git_diff_files")?.args).toEqual({ root: ROOT, left: OLD.sha, right: null });
    expect(title()).toBe("a1b2c3d ↔ Working tree");
    expect(byText(pane(), "button", "Swap Sides")).toHaveLength(0);
    expect(head()).toBe("5 files changed, 5 insertions(+), 2 deletions(-)3 untracked files are not compared.");
    expect(pane().querySelector(".graph-compare-counts")?.textContent).toBe("Your files are on 18bc71d, 2 commits ahead of a1b2c3d.");
    expect(rowTexts()).toEqual(["M app.ts", "M store.ts", "D old.ts", "R helpers.ts", "! merge.ts"]);
  });

  it("a clean folder on that commit matches it (.9)", async () => {
    world.compare = result({ right: null, head: "a1b2c3d", files: [], insertions: 0, deletions: 0, ahead: 0 });
    await show(WORKTREE);
    expect(head()).toBe("No differences: your files match a1b2c3d.");
  });

  it("a file not open in a tab: the commit's text, read-only, against the file on disk, editable (.3, .6)", async () => {
    await show(WORKTREE);
    await fire.click(rowOf("store.ts"));
    await flush();
    expect(sides().left).toMatchObject({ label: "store.ts @ a1b2c3d", text: "committed\n", editable: false });
    expect(sides().right).toMatchObject({ label: "store.ts", path: `${ROOT}\\src\\store.ts`, text: "on disk\n", editable: true });
    expect(diffTabs()[0].preview).toBe(true);
    // Renamed since the commit: the old name at the commit against the new file on disk.
    await fire.click(rowOf("helpers.ts"));
    await flush();
    expect([sides().left.label, sides().left.text, sides().right.path, sides().right.text]).toEqual(["util.ts @ a1b2c3d", "u\n", `${ROOT}\\helpers.ts`, "u2\n"]);
  });

  it("a file open with unsaved edits: its unsaved text as a read-only snapshot (.4)", async () => {
    useStore.setState({ docs: [{ id: "t1", kind: "text", path: `${ROOT}\\app.ts`, name: "app.ts", dirty: true, encoding: "UTF-8", bom: false, eol: "LF", language: "TypeScript", readonly: false, modifiedMs: 1 } as never] });
    vi.spyOn(editor, "textOf").mockReturnValue("unsaved\n");
    await show(WORKTREE);
    await fire.click(rowOf("app.ts"));
    await flush();
    expect(sides().right).toMatchObject({ label: "app.ts (unsaved)", text: "unsaved\n", editable: false });
    expect(sides().left).toMatchObject({ label: "app.ts @ a1b2c3d", text: "committed\n" });
    // The tab keeps its edits: nothing was written or reloaded.
    expect(useStore.getState().docs.find((d) => d.id === "t1")?.dirty).toBe(true);
  });

  it("a file deleted from the folder: an empty right side (.5)", async () => {
    await show(WORKTREE);
    await fire.click(rowOf("old.ts"));
    await flush();
    expect([sides().left.label, sides().left.text, sides().right.label, sides().right.text]).toEqual(["old.ts @ a1b2c3d", "x\n", "old.ts (deleted)", ""]);
  });

  it("a conflicted file opens itself instead of a Compare tab (.10)", async () => {
    await show(WORKTREE);
    await fire.click(rowOf("merge.ts"));
    await flush();
    expect(spy.openPath).toHaveBeenCalledWith(`${ROOT}\\merge.ts`);
    expect(diffTabs()).toHaveLength(0);
  });

  it("the list follows the working tree: a status change reads it again and keeps the list meanwhile (.8)", async () => {
    const { rerender } = await show(WORKTREE, { tick: 1 });
    expect(rowTexts()).toHaveLength(5);
    world.compare = { ...WT, files: [...WT.files, file("M", "notes.md")] };
    await rerender({ tick: 2 });
    expect(head()).not.toBe("Loading…");
    expect(rowTexts()).toHaveLength(5);
    await act(async () => { await new Promise((r) => setTimeout(r, 320)); });
    await flush();
    expect(calls.filter((c) => c.cmd === "git_diff_files")).toHaveLength(2);
    expect(rowTexts()).toContain("M notes.md");
    // Two commits do not reload on a status change.
    await cleanup();
    calls.length = 0;
    world.compare = result();
    const two = await show(NEW.sha, { tick: 1 });
    await two.rerender({ tick: 2 });
    await act(async () => { await new Promise((r) => setTimeout(r, 320)); });
    expect(calls.filter((c) => c.cmd === "git_diff_files")).toHaveLength(1);
  });

  it("comparing and opening files runs only read commands and asks nothing (.12, COMMITCMP-006.1, .4)", async () => {
    await show(WORKTREE);
    for (const name of ["store.ts", "old.ts", "helpers.ts"]) {
      await fire.click(rowOf(name));
      await flush();
    }
    expect(new Set(calls.map((c) => c.cmd))).toEqual(new Set(["git_diff_files", "git_show", "fs_exists", "fs_stat", "fs_read_text"]));
    expect(useStore.getState().dialog).toBeNull();
    // No button in the pane acts on the repository.
    expect([...pane().querySelectorAll("button")].map((b) => b.textContent || b.title)).toEqual(["Close the comparison"]);
  });
});

describe("Compare with Branch… (COMMITCMP-005)", () => {
  const MAIN = commit("a1b2c3d", "Add the store", ["refs/heads/main"]);
  beforeEach(() => {
    calls.length = 0;
    world.compare = result({ left: NEW, right: MAIN, ahead: 0, behind: 4 });
    useStore.setState({ docs: [], activeId: null, toasts: [], dialog: null, graphCompare: null, palette: null });
    useGit.setState({ repos: { [ROOT.toLowerCase()]: status() }, current: ROOT.toLowerCase(), busy: null, branches: null });
  });
  afterEach(cleanup);

  it("compares the picked branch with the current commit and hands the pair to the repository's graph tab (.1, .11)", async () => {
    expect(await compareWithBranch("main")).toBe(true);
    expect(calls.filter((c) => c.cmd === "git_diff_files").map((c) => c.args)).toEqual([{ root: ROOT, left: "HEAD", right: "main" }]);
    const st = useStore.getState();
    const tab = st.docs.find((d) => d.kind === "graph");
    expect(tab?.graph?.root).toBe(ROOT);
    expect(st.activeId).toBe(tab?.id);
    expect(st.graphCompare).toMatchObject({ root: ROOT, first: NEW.sha, second: MAIN.sha, names: { first: "feature", second: "main" } });
    // Detached: the current commit's side is labelled HEAD. An open graph tab is reused.
    useGit.setState({ repos: { [ROOT.toLowerCase()]: status({ branch: null }) } });
    await compareWithBranch("main");
    expect(useStore.getState().docs.filter((d) => d.kind === "graph")).toHaveLength(1);
    expect(useStore.getState().graphCompare?.names).toEqual({ first: "HEAD", second: "main" });
    // Only reads, no dialog: nothing was checked out or fetched.
    expect(new Set(calls.map((c) => c.cmd))).toEqual(new Set(["git_diff_files"]));
    expect(useStore.getState().dialog).toBeNull();
  });

  it("from a graph commit, that commit is compared instead of the current one (.5)", async () => {
    const from = "7".repeat(40);
    await pickBranch("compare", { root: ROOT, sha: from });
    expect(useStore.getState().palette).toBe("branch");
    expect(useGit.getState().branchPick).toBe("compare");
    await compareWithBranch("main");
    expect(calls.find((c) => c.cmd === "git_diff_files")?.args).toEqual({ root: ROOT, left: from, right: "main" });
    expect(useStore.getState().graphCompare?.names).toEqual({ first: undefined, second: "main" });
    // The next comparison from the menu is with the current commit again.
    await pickBranch("compare");
    await compareWithBranch("main");
    expect(calls.filter((c) => c.cmd === "git_diff_files")[1].args).toEqual({ root: ROOT, left: "HEAD", right: "main" });
  });

  it("a name git refuses opens nothing and shows the error (COMMITCMP-006.6)", async () => {
    world.compare = () => Promise.reject('"--output=x" is not a valid branch name.');
    expect(await compareWithBranch("--output=x")).toBe(false);
    expect(useStore.getState().docs).toHaveLength(0);
    expect(useStore.getState().graphCompare).toBeNull();
    expect(lastToast()).toBe('"--output=x" is not a valid branch name.');
  });

  it("is refused without a repository, and its command is greyed out then (.10)", async () => {
    const { registerGitCommands } = await import("../lib/gitCommands");
    const { getCommand, isEnabled, runCommand } = await import("../lib/commands");
    if (!getCommand("git.compareWithBranch")) registerGitCommands();
    const cmd = getCommand("git.compareWithBranch")!;
    expect(cmd.title).toBe("Compare with Branch…");
    expect(isEnabled(cmd)).toBe(true);
    expect(getCommand("git.compareBranchPick")?.hidden).toBe(true);
    // The picked row's command compares with that branch.
    await runCommand("git.compareBranchPick", "main");
    await flush();
    expect(calls.find((c) => c.cmd === "git_diff_files")?.args).toEqual({ root: ROOT, left: "HEAD", right: "main" });
    calls.length = 0;
    useGit.setState({ repos: {}, current: null });
    expect(isEnabled(cmd)).toBe(false);
    expect(await compareWithBranch("main")).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
