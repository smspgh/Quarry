import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitFile, GitHistoryCommit, GitHistoryRange, GitStatus } from "../lib/gitApi";

// Unsaved tabs and git operations (specs/git-safety.md), on every route: the action functions of
// git.ts and the commands that call them, with the Tauri side replaced by a fake disk and a log of
// what was invoked. With an unsaved tab in the repository each file-rewriting action must ask
// before git runs; Cancel and a failed save must run nothing; the others must not ask. Then what
// open tabs show afterwards (the real `checkExternalChanges`, `saveDocument`, `revertDocument`).
const h = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
  disk: new Map<string, { content: string; ms: number; readonly?: boolean }>(),
  text: new Map<string, string>(),
  clock: 1000,
  status: null as unknown,
  stashes: [] as unknown[],
  range: null as null | ((from: string | null) => unknown),
  /** What a git command does to the disk / the status, and what it returns or throws. */
  onGit: null as null | ((cmd: string, args: Record<string, unknown>) => unknown),
  onSave: null as null | ((path: string) => void),
}));

/** The commands that can rewrite files in the folder. */
const REWRITES = ["git_checkout", "git_remote", "git_commit_action", "git_continue", "git_abort", "git_discard", "git_resolve_side", "git_merge", "git_rebase", "git_stash_push", "git_stash_op", "git_history_rewrite"];
const GIT_OPS = [...REWRITES, "git_stage", "git_unstage", "git_commit"];

vi.mock("@tauri-apps/api/core", () => {
  const stat = (path: string) => {
    const f = h.disk.get(path.toLowerCase());
    if (!f) throw new Error("The system cannot find the file specified.");
    return { path, name: path.slice(path.lastIndexOf("\\") + 1), size: f.content.length, isDir: false, modifiedMs: f.ms, readonly: !!f.readonly, isLarge: false };
  };
  return {
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
      h.calls.push({ cmd, args });
      const path = String(args.path ?? "");
      switch (cmd) {
        case "fs_stat":
          return stat(path);
        case "fs_exists":
          return h.disk.has(path.toLowerCase());
        case "fs_read_text": {
          const s = stat(path);
          return { path, content: h.disk.get(path.toLowerCase())!.content, encoding: "UTF-8", hasBom: false, eol: "LF", size: s.size, modifiedMs: s.modifiedMs, hadDecodeErrors: false, looksBinary: false };
        }
        case "fs_write_text": {
          if (h.disk.get(path.toLowerCase())?.readonly) throw new Error("Access is denied. (os error 5)");
          h.disk.set(path.toLowerCase(), { content: String(args.content), ms: ++h.clock });
          h.onSave?.(path);
          return stat(path);
        }
        case "big_open":
          return { id: ++h.clock, path, size: 10, lines: 1, indexed: true, dirty: false, encoding: "UTF-8", eol: "LF" };
        case "git_available":
          return "git version 2.53.0";
        case "git_status":
          return h.status;
        case "git_stash_list":
          return h.stashes;
        case "git_stash_files":
          return [];
        case "git_merge_preview":
          return { target: "refs/heads/feature", kind: "branch", sha: "1".repeat(40), short: "18bc71d", summary: "Add the parser", ahead: 2, behind: 3, merges: 0, pushed: 0, pushedOn: null, pushedCommits: [] };
        case "git_force_push_preview":
          return { branch: "main", upstream: "origin/main", lost: 1, commits: [{ sha: "2".repeat(40), short: "2222222", summary: "Old", author: "Ada", time: 1_700_000_000 }] };
        case "git_history_range":
          return h.range!(args.from as string | null);
        case "git_show":
          return null;
        default: {
          const out = h.onGit?.(cmd, args);
          if (out !== undefined) return out;
          if (cmd === "git_commit") return { sha: "abc1234", summary: "msg" };
          if (cmd === "git_stash_op") return "ok";
          if (cmd === "git_resolve_side") return "kept";
          return cmd.startsWith("git_") ? "" : undefined;
        }
      }
    },
  };
});

// A stand-in for the main editor: the text of open tabs only.
vi.mock("../editor/manager", async () => {
  const { Text } = await import("@codemirror/state");
  const base: Record<string, unknown> = {
    textOf: (id: string) => h.text.get(id) ?? "",
    docOf: (id: string) => (h.text.has(id) ? Text.of(h.text.get(id)!.split("\n")) : null),
    replaceAll: (id: string, next: string) => void h.text.set(id, next),
    registerFocus: () => () => {},
    onDocUpdate: () => () => {},
    currentDocId: null,
    view: null,
  };
  return { editor: new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) }) };
});

const { useStore, newDocId } = await import("../lib/store");
const actions = await import("../lib/actions");
const gitLib = await import("../lib/git");
const { useGit } = gitLib;
const { tabsSettled } = await import("../lib/gitTabs");
const { registerGitCommands } = await import("../lib/gitCommands");
const { runCommand } = await import("../lib/commands");
const { singlePlan } = await import("../lib/historyEdit");
const { useDiff } = await import("../lib/diff");
const { discardHunk } = await import("../lib/gitStaging");
type Doc = import("../lib/store").Doc;

registerGitCommands();

const ROOT = "C:\\work\\app";
const KEY = ROOT.toLowerCase();
const P = (rel: string) => `${ROOT}\\${rel}`;
const file = (rel: string, extra: Partial<GitFile> = {}): GitFile => ({ path: P(rel), origPath: null, index: ".", worktree: "M", conflicted: false, untracked: false, ...extra });
const status = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "e5f6a7b", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [{ name: "origin", url: "https://example.com/r.git" }], stash: null, stashCount: 0, headParents: 1, ...extra });
const id = (short: string) => short.padEnd(40, "0");
const hc = (short: string, summary: string, parent: string | null): GitHistoryCommit => ({ sha: id(short), short, summary, message: summary, author: "Ada", email: "ada@example.com", time: 1_700_000_000, parents: parent ? [id(parent)] : [], pushed: false });
// Newest first.
const E = hc("e5f6a7b", "Add tab limit tests", "d4e5f6a");
const D = hc("d4e5f6a", "Fix typo", "c3d4e5f");
const C = hc("c3d4e5f", "Add tab limit", "b2c3d4e");
const B = hc("b2c3d4e", "Rename helper", "a1b2c3d");
const ALL = [E, D, C, B, hc("a1b2c3d", "Initial commit", null)];
const rangeFrom = (from: string | null): GitHistoryRange => {
  const at = from && from !== "HEAD" ? ALL.findIndex((c) => c.sha === from) : 0;
  const commits = ALL.slice(0, at + 1);
  const below = ALL[at + 1];
  return { branch: "main", tip: E.sha, operation: null, onBranch: true, commits, total: commits.length, base: below ? { sha: below.sha, short: below.short, summary: below.summary } : null, pushedOn: null };
};
const STASH = { sha: "c".repeat(40), short: "ccccccc", base: "b".repeat(40), author: "Ada", email: "ada@example.com", time: 1_700_000_000, subject: "On main: wip", untracked: false };

const tick = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
const settle = async () => {
  await tick();
  await tabsSettled();
  await tick(4);
};
const dialog = () => useStore.getState().dialog;
const toasts = () => useStore.getState().toasts.map((t) => t.message);
const ran = (cmds: string[] = GIT_OPS) => h.calls.filter((c) => cmds.includes(c.cmd)).map((c) => c.cmd);
const wrote = () => h.calls.filter((c) => c.cmd === "fs_write_text").map((c) => String(c.args.path));
const docOf = (d: Doc) => useStore.getState().docs.find((x) => x.id === d.id);
const UNSAVED = /^Unsaved changes in /;

/** Put a file on the fake disk. */
const put = (rel: string, content: string, readonly = false) => void h.disk.set(P(rel).toLowerCase(), { content, ms: ++h.clock, readonly });
const putAt = (path: string, content: string) => void h.disk.set(path.toLowerCase(), { content, ms: ++h.clock });

/** Open a text tab of a file on the fake disk (as loaded: clean, with its saved snapshot); `edited` types into it. */
async function open(path: string, opts: { content?: string; edited?: string; readonly?: boolean; kind?: "text" | "big" } = {}): Promise<Doc> {
  const content = opts.content ?? `${path}\n`;
  h.disk.set(path.toLowerCase(), { content, ms: ++h.clock, readonly: opts.readonly });
  const kind = opts.kind ?? "text";
  const doc: Doc = { id: newDocId(), kind, path, name: path.slice(path.lastIndexOf("\\") + 1), dirty: false, encoding: "UTF-8", bom: false, eol: "LF", language: "Plain Text", readonly: false, modifiedMs: 1, ...(kind === "big" ? { bigId: 1, bigInfo: { id: 1, path, size: 10, lines: 1, indexed: true, dirty: false, encoding: "UTF-8", eol: "LF" } as never } : {}) };
  useStore.getState().addDoc(doc, false);
  if (kind === "text") {
    h.text.set(doc.id, "");
    await actions.revertDocument(doc.id, { confirm: false, silent: true }); // reads the file and takes the snapshot
  } else useStore.getState().updateDoc(doc.id, { modifiedMs: h.disk.get(path.toLowerCase())!.ms });
  if (opts.edited !== undefined) {
    if (kind === "text") h.text.set(doc.id, opts.edited);
    useStore.getState().updateDoc(doc.id, { dirty: true, ...(kind === "big" ? { bigInfo: { ...docOf(doc)!.bigInfo!, dirty: true } } : {}) });
  }
  return docOf(doc)!;
}

/**
 * Answer the dialogs an action shows until it finishes: the unsaved-tabs dialog with `unsaved`,
 * every other one with its confirming button (`own`: "confirm", or "cancel"). Returns the titles
 * seen, and what had been run when the unsaved-tabs dialog opened.
 */
async function drive(run: () => unknown, unsaved: string, own: "confirm" | "cancel" = "confirm") {
  const seen: { title: string; message: string; labels: string[]; default?: string }[] = [];
  let ranAtUnsaved: string[] | null = null;
  let done = false;
  void Promise.resolve(run()).finally(() => (done = true));
  for (let i = 0; i < 40; i++) {
    await tick(6);
    const d = dialog();
    if (!d) {
      if (done) break;
      continue;
    }
    seen.push({ title: d.title, message: d.message, labels: d.actions.map((a) => a.label), default: d.actions.find((a) => a.default)?.label });
    let pick = d.actions.find((a) => !a.cancel) ?? d.actions[0];
    if (UNSAVED.test(d.title)) {
      ranAtUnsaved = ran();
      pick = d.actions.find((a) => a.label === unsaved) ?? d.actions.find((a) => a.label === (unsaved === "Save All" ? "Save" : unsaved))!;
    } else if (own === "cancel") pick = d.actions.find((a) => a.cancel)!;
    pick.run();
  }
  await settle();
  return { seen, ranAtUnsaved, unsavedCount: seen.filter((s) => UNSAVED.test(s.title)).length };
}

beforeEach(() => {
  h.calls.length = 0;
  h.disk.clear();
  h.text.clear();
  h.status = status();
  h.stashes = [STASH];
  h.range = rangeFrom;
  h.onGit = null;
  h.onSave = null;
  useDiff.setState({ sessions: {} });
  useStore.setState({ folder: ROOT, docs: [], activeId: null, toasts: [], dialog: null, sidebarVisible: false, pinnedPanels: [] });
  useGit.setState({ available: true, repos: { [KEY]: h.status as GitStatus }, current: KEY, busy: null, rewrotePushed: {}, remoteCheck: {}, stashPending: null, stashForm: false, historyEdit: null });
});

const use = (st: GitStatus) => {
  h.status = st;
  useGit.setState({ repos: { [KEY]: st }, current: KEY });
};

interface Route {
  name: string;
  /** The git command that does the work. */
  git: string;
  status?: () => GitStatus;
  run: () => unknown;
  /** Where the unsaved-tabs dialog comes among the operation's own dialogs. */
  order?: "after-own" | "before-own";
  /** Start of the dialog's first sentence. */
  says: string;
}

const rebasing = () => status({ operation: "rebase", operationStep: [2, 5] });
const changed = () => status({ files: [file("other.ts")] });
const stashed = () => status({ stash: STASH.sha, stashCount: 1 });
const CAN_REWRITE = " can rewrite files in this repository";

/** Every way into a git operation that can rewrite any file of the repository. */
const ASKING: Route[] = [
  { name: "checkout (branch list, status bar, palette)", git: "git_checkout", run: () => gitLib.checkout("feature"), says: `Switching to feature${CAN_REWRITE}` },
  { name: "checkout of a remote branch", git: "git_checkout", run: () => gitLib.checkout("origin/topic"), says: `Switching to topic${CAN_REWRITE}` },
  { name: "command git.checkoutTo (a macro's Switch to Branch)", git: "git_checkout", run: () => runCommand("git.checkoutTo", "feature"), says: `Switching to feature${CAN_REWRITE}` },
  { name: "checkoutRef (graph label menu, Switch to …)", git: "git_checkout", run: () => gitLib.checkoutRef(ROOT, "feature"), says: `Switching to feature${CAN_REWRITE}` },
  { name: "commitAction checkout", git: "git_commit_action", run: () => gitLib.commitAction(ROOT, "checkout", id("18bc71d")), says: `Checking out 18bc71d${CAN_REWRITE}` },
  { name: "commitAction branch-switch", git: "git_commit_action", run: () => gitLib.commitAction(ROOT, "branch-switch", id("18bc71d"), "topic"), says: `Switching to topic${CAN_REWRITE}` },
  { name: "commitAction cherry-pick", git: "git_commit_action", run: () => gitLib.commitAction(ROOT, "cherry-pick", id("18bc71d")), says: `Cherry-picking 18bc71d${CAN_REWRITE}` },
  { name: "commitAction revert", git: "git_commit_action", run: () => gitLib.commitAction(ROOT, "revert", id("18bc71d")), says: `Reverting 18bc71d${CAN_REWRITE}` },
  { name: "remote pull", git: "git_remote", run: () => gitLib.remote(ROOT, "pull"), says: `Pulling${CAN_REWRITE}` },
  { name: "remote pull-merge", git: "git_remote", run: () => gitLib.remote(ROOT, "pull-merge"), says: `Pulling${CAN_REWRITE}` },
  { name: "remote pull-rebase", git: "git_remote", run: () => gitLib.remote(ROOT, "pull-rebase"), says: `Pulling${CAN_REWRITE}` },
  { name: "command git.pull", git: "git_remote", run: () => runCommand("git.pull"), says: `Pulling${CAN_REWRITE}` },
  { name: "continueOperation continue", git: "git_continue", status: rebasing, run: () => gitLib.continueOperation(ROOT, "rebase", "continue"), says: `Continuing the rebase${CAN_REWRITE}` },
  { name: "continueOperation skip", git: "git_continue", status: rebasing, run: () => gitLib.continueOperation(ROOT, "rebase", "skip"), order: "after-own", says: `Continuing the rebase${CAN_REWRITE}` },
  { name: "startMerge", git: "git_merge", run: () => gitLib.startMerge(ROOT, "feature"), order: "before-own", says: `Merging feature into main${CAN_REWRITE}` },
  { name: "command git.mergeRef", git: "git_merge", run: () => runCommand("git.mergeRef", "feature"), order: "before-own", says: `Merging feature into main${CAN_REWRITE}` },
  { name: "startRebase", git: "git_rebase", run: () => gitLib.startRebase(ROOT, "feature"), order: "before-own", says: `Rebasing main onto feature${CAN_REWRITE}` },
  { name: "command git.rebaseOnto", git: "git_rebase", run: () => runCommand("git.rebaseOnto", "feature"), order: "before-own", says: `Rebasing main onto feature${CAN_REWRITE}` },
  { name: "stashChanges", git: "git_stash_push", status: changed, run: () => gitLib.stashChanges(ROOT, "wip", true), says: "A stash takes the files as they are on disk, so the unsaved changes in this open file would not be in it:" },
  { name: "stashAction apply", git: "git_stash_op", run: () => gitLib.stashAction(ROOT, STASH, "apply"), says: `Applying the stash${CAN_REWRITE}` },
  { name: "stashAction pop", git: "git_stash_op", run: () => gitLib.stashAction(ROOT, STASH, "pop"), says: `Applying the stash${CAN_REWRITE}` },
  { name: "stashLatest apply", git: "git_stash_op", status: stashed, run: () => gitLib.stashLatest("apply"), says: `Applying the stash${CAN_REWRITE}` },
  { name: "command git.stashPop", git: "git_stash_op", status: stashed, run: () => runCommand("git.stashPop"), says: `Applying the stash${CAN_REWRITE}` },
  { name: "command git.stashApply", git: "git_stash_op", status: stashed, run: () => runCommand("git.stashApply"), says: `Applying the stash${CAN_REWRITE}` },
  { name: "dropCommit", git: "git_history_rewrite", run: () => gitLib.dropCommit(ROOT, D.sha), order: "before-own", says: `Rewriting commits${CAN_REWRITE}` },
  { name: "squashCommit", git: "git_history_rewrite", run: () => gitLib.squashCommit(ROOT, D.sha, "Both"), order: "before-own", says: `Rewriting commits${CAN_REWRITE}` },
  { name: "rewordCommit of a commit that is not the last", git: "git_history_rewrite", run: () => gitLib.rewordCommit(ROOT, D.sha, "Fix the typo"), order: "before-own", says: `Rewriting commits${CAN_REWRITE}` },
  { name: "runHistoryEdit (the Edit History list's Run)", git: "git_history_rewrite", run: () => gitLib.runHistoryEdit(ROOT, rangeFrom(C.sha), singlePlan("drop", rangeFrom(C.sha).commits)), order: "before-own", says: `Rewriting commits${CAN_REWRITE}` },
];

/** Operations whose own confirmation names the unsaved tabs instead. */
const SENTENCE: (Omit<Route, "says" | "order"> & { title: string; says: string })[] = [
  { name: "discard one file", git: "git_discard", status: () => status({ files: [file("src\\store.ts")] }), run: () => gitLib.discard(ROOT, [file("src\\store.ts")]), title: "Discard changes?", says: "Your changes to store.ts will be lost, including the unsaved edits in its open tab. Open tabs reload the committed text." },
  { name: "discard all", git: "git_discard", run: () => gitLib.discard(ROOT, [file("src\\store.ts"), file("b.ts"), file("c.ts")]), title: "Discard changes?", says: "Your changes to 3 files will be lost. Unsaved edits in 1 open tab are lost too: store.ts. Open tabs reload the committed text." },
  { name: "abortOperation", git: "git_abort", status: () => status({ operation: "merge" }), run: () => gitLib.abortOperation(ROOT, "merge"), title: "Abort the merge?", says: "Unsaved edits in open tabs are lost too where the abort rewrites the file: src\\store.ts." },
  { name: "takeSide", git: "git_resolve_side", status: () => status({ operation: "merge", files: [file("src\\store.ts", { conflicted: true })] }), run: () => gitLib.takeSide(ROOT, file("src\\store.ts", { conflicted: true }), "theirs"), title: "Replace your edits to store.ts?", says: "store.ts has unsaved changes in its tab. Taking the incoming version replaces the file and discards them." },
];

/** Operations that leave the files alone. */
const NEVER: Omit<Route, "says" | "order">[] = [
  { name: "remote fetch", git: "git_remote", run: () => gitLib.remote(ROOT, "fetch") },
  { name: "remote push", git: "git_remote", run: () => gitLib.remote(ROOT, "push") },
  { name: "forcePush", git: "git_remote", status: () => status({ upstream: "origin/main", ahead: 1, behind: 1 }), run: () => gitLib.forcePush(ROOT) },
  { name: "stage", git: "git_stage", run: () => gitLib.stage(ROOT, [P("src\\store.ts")]) },
  { name: "unstage", git: "git_unstage", run: () => gitLib.unstage(ROOT, [P("src\\store.ts")]) },
  { name: "commit", git: "git_commit", status: () => status({ files: [file("b.ts", { index: "M", worktree: "." })] }), run: () => gitLib.commit(ROOT, "msg") },
  { name: "checkout creating a branch from here", git: "git_checkout", run: () => gitLib.checkout("topic", true) },
  { name: "command git.createBranch", git: "git_checkout", run: () => runCommand("git.createBranch", "topic") },
  { name: "commitAction branch", git: "git_commit_action", run: () => gitLib.commitAction(ROOT, "branch", id("18bc71d"), "topic") },
  { name: "commitAction tag", git: "git_commit_action", run: () => gitLib.commitAction(ROOT, "tag", id("18bc71d"), "v1") },
  { name: "commitAction reset-soft", git: "git_commit_action", run: () => gitLib.commitAction(ROOT, "reset-soft", id("18bc71d")) },
  { name: "commitAction reset-mixed", git: "git_commit_action", run: () => gitLib.commitAction(ROOT, "reset-mixed", id("18bc71d")) },
  { name: "commitAction reset-hard (its confirmation is the graph's)", git: "git_commit_action", run: () => gitLib.commitAction(ROOT, "reset-hard", id("18bc71d")) },
  { name: "stashAction drop", git: "git_stash_op", run: () => gitLib.stashAction(ROOT, STASH, "drop") },
  { name: "undoLastCommit", git: "git_history_rewrite", run: () => gitLib.undoLastCommit(ROOT) },
  { name: "rewordCommit of the last commit", git: "git_history_rewrite", run: () => gitLib.rewordCommit(ROOT, E.sha, "Better message") },
];

describe("every operation that can rewrite files asks about unsaved tabs (SAFE-003, SAFE-005)", () => {
  for (const r of ASKING) {
    describe(r.name, () => {
      let doc: Doc;
      beforeEach(async () => {
        if (r.status) use(r.status());
        doc = await open(P("src\\store.ts"), { edited: "mine\n" });
        h.calls.length = 0;
      });

      it("asks before git runs, and Cancel runs nothing", async () => {
        const { seen, ranAtUnsaved, unsavedCount } = await drive(r.run, "Cancel");
        expect(unsavedCount).toBe(1);
        const d = seen.find((s) => UNSAVED.test(s.title))!;
        expect(d.title).toBe("Unsaved changes in store.ts");
        expect(d.message.startsWith(r.says)).toBe(true);
        expect(d.message).toContain("\n\nsrc\\store.ts\n\n");
        expect(d.labels).toEqual(["Save", "Continue Without Saving", "Cancel"]);
        expect(d.default).toBe("Save");
        expect(ranAtUnsaved).toEqual([]);
        expect(ran()).toEqual([]);
        expect(wrote()).toEqual([]);
        expect(docOf(doc)?.dirty).toBe(true);
        expect(h.text.get(doc.id)).toBe("mine\n");
        // Where it comes among the operation's own dialogs.
        if (r.order === "after-own") expect(UNSAVED.test(seen[0].title)).toBe(false);
        else expect(UNSAVED.test(seen[0].title)).toBe(true);
        expect(UNSAVED.test(seen[seen.length - 1].title)).toBe(true); // nothing is asked after Cancel
        expect(toasts().filter((t) => !/^Skip/.test(t))).toEqual([]);
      });

      it("a file that cannot be saved stops it", async () => {
        h.disk.get(P("src\\store.ts").toLowerCase())!.readonly = true;
        const { unsavedCount } = await drive(r.run, "Save All");
        expect(unsavedCount).toBe(1);
        expect(ran()).toEqual([]);
        expect(docOf(doc)?.dirty).toBe(true);
        expect(toasts().some((t) => / store\.ts could not be saved\.$/.test(t))).toBe(true);
      });

      it("Continue Without Saving runs it and writes nothing", async () => {
        const { unsavedCount, seen } = await drive(r.run, "Continue Without Saving");
        expect(unsavedCount).toBe(1);
        expect(ran(REWRITES)).toEqual([r.git]);
        expect(wrote()).toEqual([]);
        expect(docOf(doc)?.dirty).toBe(true);
        expect(h.text.get(doc.id)).toBe("mine\n");
        if (r.order === "before-own") expect(UNSAVED.test(seen[seen.length - 1].title)).toBe(false); // its confirmation followed
      });

      it("does not ask when nothing of the repository is unsaved", async () => {
        useStore.getState().updateDoc(doc.id, { dirty: false });
        h.text.set(doc.id, `${doc.path}\n`);
        await open("C:\\notes\\todo.txt", { edited: "elsewhere\n" }); // in no repository
        h.calls.length = 0;
        const { unsavedCount } = await drive(r.run, "Cancel");
        expect(unsavedCount).toBe(0);
        expect(ran(REWRITES)).toEqual([r.git]);
      });
    });
  }
});

describe("operations that throw work away say so in their own confirmation (SAFE-004)", () => {
  for (const r of SENTENCE) {
    it(`${r.name}: one question, Cancel is the default and runs nothing`, async () => {
      if (r.status) use(r.status());
      const doc = await open(P("src\\store.ts"), { edited: "mine\n" });
      await open(P("clean.ts"));
      h.calls.length = 0;
      const { seen, unsavedCount } = await drive(r.run, "Cancel", "cancel");
      expect(unsavedCount).toBe(0);
      expect(seen.map((s) => s.title)).toEqual([r.title]);
      expect(seen[0].message).toContain(r.says);
      expect(seen[0].default).toBe("Cancel");
      expect(seen[0].labels).not.toContain("Save All");
      expect(seen[0].labels).not.toContain("Save");
      expect(ran()).toEqual([]);
      expect(docOf(doc)?.dirty).toBe(true);
    });

    it(`${r.name}: confirming runs it without a second question, and the tab shows the file`, async () => {
      if (r.status) use(r.status());
      const doc = await open(P("src\\store.ts"), { edited: "mine\n" });
      h.onGit = (cmd) => (cmd === r.git ? void put("src\\store.ts", "from git\n") : undefined);
      h.calls.length = 0;
      const { seen } = await drive(r.run, "Cancel");
      expect(seen.map((s) => s.title)).toEqual([r.title]);
      expect(ran(REWRITES)).toEqual([r.git]);
      expect(h.text.get(doc.id)).toBe("from git\n");
      expect(docOf(doc)?.dirty).toBe(false);
      expect(dialog()).toBeNull();
    });
  }

  it("reads as before when no tab is unsaved", async () => {
    await open(P("src\\store.ts"));
    use(status({ operation: "merge" }));
    const a = await drive(() => gitLib.abortOperation(ROOT, "merge"), "Cancel", "cancel");
    expect(a.seen[0].message).toBe("Everything goes back to how it was before the merge started. Conflict resolutions made so far are discarded.");
    const d = await drive(() => gitLib.discard(ROOT, [file("src\\store.ts")]), "Cancel", "cancel");
    expect(d.seen[0].message).toBe("Your changes to store.ts will be lost. Open tabs reload the committed text.");
    const t = await drive(() => gitLib.takeSide(ROOT, file("src\\store.ts", { conflicted: true }), "ours"), "Cancel", "cancel");
    expect(t.seen).toEqual([]); // nothing to ask: it ran
    expect(ran(REWRITES)).toEqual(["git_resolve_side"]);
  });

  it("discard all leaves the unsaved tab of a file that is not among them alone", async () => {
    const a = await open(P("a.ts"), { edited: "mine a\n" });
    const notes = await open(P("notes.md"), { edited: "my notes\n" });
    h.onGit = () => {
      put("a.ts", "committed a\n");
      put("notes.md", "touched by something else\n");
    };
    const { seen } = await drive(() => gitLib.discard(ROOT, [file("a.ts"), file("b.ts")]), "Cancel");
    expect(seen[0].message).toContain("Unsaved edits in 1 open tab are lost too: a.ts.");
    expect(h.text.get(a.id)).toBe("committed a\n");
    // notes.md was not part of the discard: its edits are asked about, as for any outside change.
    expect(seen.map((s) => s.title)).toEqual(["Discard changes?", "notes.md changed on disk"]);
    expect(h.text.get(notes.id)).not.toBe("my notes\n"); // the generic driver confirmed "Reload from disk"
  });

  it("a hard reset or an abort reloads only the tabs whose file it rewrote", async () => {
    const store = await open(P("src\\store.ts"), { edited: "mine\n" });
    const readme = await open(P("README.md"), { edited: "my readme\n" });
    h.onGit = (cmd) => (cmd === "git_commit_action" ? void put("src\\store.ts", "reset\n") : undefined);
    const { seen } = await drive(() => gitLib.commitAction(ROOT, "reset-hard", id("18bc71d")), "Cancel");
    expect(seen).toEqual([]);
    expect([h.text.get(store.id), docOf(store)?.dirty]).toEqual(["reset\n", false]);
    expect([h.text.get(readme.id), docOf(readme)?.dirty]).toEqual(["my readme\n", true]);
    expect(await gitLib.unsavedTabs(ROOT)).toMatchObject([{ rel: "README.md" }]);
  });

  it("taking a side asks for a large-file tab and a Compare tab's edited side too, and closes the tab of a file that side deleted", async () => {
    const big = await open(P("data\\big.csv"), { kind: "big", edited: "" });
    const f = file("data\\big.csv", { conflicted: true });
    h.onGit = () => {
      h.disk.delete(f.path.toLowerCase());
      return "deleted";
    };
    const { seen } = await drive(() => gitLib.takeSide(ROOT, f, "theirs"), "Cancel");
    expect(seen.map((s) => s.title)).toEqual(["Replace your edits to big.csv?"]);
    expect(seen[0].labels).toEqual(["Replace", "Cancel"]);
    expect(seen[0].default).toBe("Cancel");
    expect(docOf(big)).toBeUndefined(); // closed, no save question
    expect(toasts()).toEqual(["big.csv: deleted (the incoming side had deleted it)."]);
  });
});

describe("operations that leave the files alone do not ask (SAFE-003.10, SAFE-003.11)", () => {
  for (const r of NEVER) {
    it(r.name, async () => {
      if (r.status) use(r.status());
      const doc = await open(P("src\\store.ts"), { edited: "mine\n" });
      h.calls.length = 0;
      const { unsavedCount, seen } = await drive(r.run, "Cancel");
      expect(unsavedCount).toBe(0);
      expect(seen.some((s) => /unsaved|open tabs/i.test(s.message))).toBe(false);
      expect(ran()).toContain(r.git);
      expect(wrote()).toEqual([]);
      expect(docOf(doc)?.dirty).toBe(true);
      expect(h.text.get(doc.id)).toBe("mine\n");
    });
  }

  it("commit keeps its own warning", async () => {
    use(status({ files: [file("b.ts", { index: "M", worktree: "." })] }));
    await open(P("src\\store.ts"), { edited: "mine\n" });
    await open(P("README.md"), { edited: "mine\n" });
    await drive(() => gitLib.commit(ROOT, "msg"), "Cancel");
    expect(toasts()).toContain("2 open files have unsaved changes that are not in this commit.");
  });
});

describe("no route around the question (SAFE-005)", () => {
  const SRC = join(process.cwd(), "src");
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "__tests__" ? [] : sources(join(dir, e.name))) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
  const RAW = /\bgit\.(checkout|remote|commitAction|continueOp|abort|discard|resolveSide|merge|rebase|stashPush|stashOp|historyRewrite)\(/;

  it("only git.ts calls the git commands that rewrite files", () => {
    const callers = sources(SRC)
      .filter((f) => RAW.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, "/"));
    expect(callers).toEqual(["lib/git.ts"]);
  });

  it("in git.ts each of them runs inside the guarded step, or is one the spec says never asks", () => {
    const lines = readFileSync(join(SRC, "lib", "git.ts"), "utf8").split(/\r?\n/);
    const unguarded: string[] = [];
    lines.forEach((line, i) => {
      if (!RAW.test(line)) return;
      const near = lines.slice(Math.max(0, i - 2), i + 6).join("\n");
      // `rewrite` / `withTabs` directly, or through runStart / historyRun / stashRun (which are only called with a Guarded).
      const guarded = /\b(rewrite|withTabs|runStart|historyRun)\(/.test(near) || /^async function stashRun\(/.test(lines.slice(0, i).reverse().find((l) => /^(export )?(async )?function /.test(l)) ?? "");
      const never = /git\.remote\(root, "(check|push-force)"\)/.test(line) || /git\.commitAction\(root, action, sha, name\)\)\) !== undefined;$/.test(line);
      if (!guarded && !never) unguarded.push(`${i + 1}: ${line.trim()}`);
    });
    expect(unguarded).toEqual([]);
    // stashRun itself is reached through withTabs for apply / pop, and unguarded only for a drop.
    const text = lines.join("\n");
    expect(text.match(/stashRun\(/g)?.length).toBe(4); // the definition, drop (settleStash), drop (stashAction), apply / pop
    expect(text).toMatch(/withTabs\(g, \(\) => stashRun\(what === "pop"/);
    expect(text.match(/stashRun\("Dropping stash…"/g)?.length).toBe(2);
  });

  it("the commands, the branch list and the panels reach git only through those actions", () => {
    const direct = sources(SRC)
      .filter((f) => !/[\\/]lib[\\/](git|gitApi)\.ts$/.test(f))
      .filter((f) => /invoke(<[^>]*>)?\(\s*"git_(checkout|remote|commit_action|continue|abort|discard|resolve_side|merge|rebase|stash_push|stash_op|history_rewrite)"/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, "/"));
    expect(direct).toEqual([]);
  });
});

describe("Save All, Continue Without Saving (SAFE-002)", () => {
  it("Save All saves the listed files only, then runs the operation", async () => {
    const store = await open(P("src\\store.ts"), { edited: "mine\n" });
    const readme = await open(P("README.md"), { edited: "my readme\n" });
    const other = await open("C:\\notes\\todo.txt", { edited: "elsewhere\n" });
    const untitled: Doc = { id: newDocId(), kind: "text", path: null, name: "Untitled-1", dirty: true, encoding: "UTF-8", bom: false, eol: "LF", language: "Plain Text", readonly: false, modifiedMs: 0 };
    useStore.getState().addDoc(untitled, false);
    h.calls.length = 0;
    const { seen, ranAtUnsaved } = await drive(() => gitLib.checkout("feature"), "Save All");
    expect(seen.map((s) => s.title)).toEqual(["Unsaved changes in 2 open files"]);
    expect(seen[0].labels[0]).toBe("Save All");
    expect(ranAtUnsaved).toEqual([]);
    expect(wrote()).toEqual([P("src\\store.ts"), P("README.md")]);
    expect(h.disk.get(P("src\\store.ts").toLowerCase())?.content).toBe("mine\n");
    expect([docOf(store)?.dirty, docOf(readme)?.dirty, docOf(other)?.dirty, docOf(untitled)?.dirty]).toEqual([false, false, true, true]);
    expect(ran(REWRITES)).toEqual(["git_checkout"]);
    // The write comes before git.
    const order = h.calls.map((c) => c.cmd).filter((c) => c === "fs_write_text" || c === "git_checkout");
    expect(order).toEqual(["fs_write_text", "fs_write_text", "git_checkout"]);
    expect(dialog()).toBeNull(); // no second unsaved-changes dialog
  });

  it("one file that cannot be saved: the others are saved, git does not run, and a message says so", async () => {
    const store = await open(P("src\\store.ts"), { edited: "mine\n" });
    const readme = await open(P("README.md"), { edited: "my readme\n", readonly: true });
    h.calls.length = 0;
    await drive(() => gitLib.checkout("feature"), "Save All");
    expect([docOf(store)?.dirty, docOf(readme)?.dirty]).toEqual([false, true]);
    expect(ran()).toEqual([]);
    expect(toasts()).toContain("Not switched: README.md could not be saved.");
    expect(toasts().some((t) => t.startsWith("Save failed:"))).toBe(true);
  });

  it("declining to overwrite a file changed on disk counts as not saved", async () => {
    const store = await open(P("src\\store.ts"), { edited: "mine\n" });
    put("src\\store.ts", "changed by another program\n");
    h.calls.length = 0;
    const seen: string[] = [];
    let done = false;
    void gitLib.checkout("feature").finally(() => (done = true));
    for (let i = 0; i < 20 && !done; i++) {
      await tick(6);
      const d = dialog();
      if (!d) continue;
      seen.push(d.title);
      d.actions.find((a) => a.label === (UNSAVED.test(d.title) ? "Save" : "Cancel"))!.run();
    }
    await settle();
    expect(seen).toEqual(["Unsaved changes in store.ts", "store.ts changed on disk"]);
    expect(ran()).toEqual([]);
    expect(docOf(store)?.dirty).toBe(true);
    expect(h.text.get(store.id)).toBe("mine\n");
  });

  it("git refusing after the save loses nothing", async () => {
    const store = await open(P("src\\store.ts"), { edited: "mine\n" });
    h.onGit = () => {
      throw "error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/store.ts";
    };
    await drive(() => gitLib.checkout("feature"), "Save All");
    expect(h.disk.get(P("src\\store.ts").toLowerCase())?.content).toBe("mine\n");
    expect(h.text.get(store.id)).toBe("mine\n");
    expect(toasts().some((t) => t.includes("would be overwritten by checkout"))).toBe(true);
    expect(toasts()).not.toContain("Switched to feature");
  });

  it("Continue Without Saving keeps the text, asks nothing afterwards and warns once", async () => {
    const store = await open(P("src\\store.ts"), { edited: "mine\n" });
    const readme = await open(P("README.md"), { edited: "my readme\n" });
    h.onGit = () => void put("src\\store.ts", "feature text\n"); // README.md is the same on both branches
    h.calls.length = 0;
    const { seen } = await drive(() => gitLib.checkout("feature"), "Continue Without Saving");
    expect(seen.map((s) => s.title)).toEqual(["Unsaved changes in 2 open files"]);
    expect(wrote()).toEqual([]);
    expect([h.text.get(store.id), docOf(store)?.dirty]).toEqual(["mine\n", true]);
    expect([h.text.get(readme.id), docOf(readme)?.dirty]).toEqual(["my readme\n", true]);
    expect(toasts()).toEqual(["Switched to feature", "store.ts changed on disk; its tab keeps your unsaved text. Saving it overwrites the file."]);
    // Not asked later either (window focus), and a save writes the tab's text without a question.
    await actions.checkExternalChanges();
    expect(dialog()).toBeNull();
    expect(await actions.saveDocument(store.id)).toBe(true);
    expect(dialog()).toBeNull();
    expect(h.disk.get(P("src\\store.ts").toLowerCase())?.content).toBe("mine\n");
  });

  it("a kept tab whose file vanished keeps its text and is named among the missing files", async () => {
    const old = await open(P("old.ts"), { edited: "mine\n" });
    h.onGit = () => void h.disk.delete(P("old.ts").toLowerCase());
    await drive(() => gitLib.checkout("feature"), "Continue Without Saving");
    expect([h.text.get(old.id), docOf(old)?.dirty]).toEqual(["mine\n", true]);
    expect(toasts()).toContain("old.ts is not in the folder after switching to feature. Its tab stays open; saving it recreates the file.");
  });

  it("a Compare tab's edited file side counts, and Save writes that side", async () => {
    const { openCompare, diffViews, markSideEdited } = await import("../lib/diff");
    put("src\\api.ts", "api\n");
    const doc = (await openCompare({ kind: "text", label: "api.ts (HEAD)", text: "old\n" }, { kind: "file", path: P("src\\api.ts") }))!;
    diffViews.set(doc.id, { right: { state: { doc: { toString: () => "api edited\n" } } } as never });
    markSideEdited(doc.id, "right");
    h.calls.length = 0;
    const { seen } = await drive(() => gitLib.remote(ROOT, "pull"), "Save All");
    expect(seen[0].title).toBe("Unsaved changes in api.ts");
    expect(seen[0].message).toContain("\n\nsrc\\api.ts\n\n");
    expect(h.disk.get(P("src\\api.ts").toLowerCase())?.content).toBe("api edited\n");
    expect(ran(REWRITES)).toEqual(["git_remote"]);
    expect(docOf(doc)?.dirty).toBe(false);
  });

  it("a large-file tab with an edited line counts; a tab that is only missing its file does not", async () => {
    await open(P("data\\big.csv"), { kind: "big", edited: "" });
    const a = await drive(() => gitLib.checkout("feature"), "Cancel");
    expect(a.seen[0].message).toContain("\n\ndata\\big.csv\n\n");
    useStore.setState({ docs: [], toasts: [] });
    // old.ts is not on this branch: its unedited tab is marked unsaved by the check.
    const old = await open(P("old.ts"));
    h.disk.delete(P("old.ts").toLowerCase());
    await actions.checkExternalChanges();
    expect(docOf(old)?.dirty).toBe(true);
    expect(toasts()).toEqual(["old.ts was deleted or moved on disk. Saving will recreate it."]);
    h.onGit = () => void put("old.ts", `${P("old.ts")}\n`);
    const b = await drive(() => gitLib.checkout("main"), "Cancel");
    expect(b.unsavedCount).toBe(0);
    expect(ran(REWRITES)).toEqual(["git_checkout"]);
    expect(docOf(old)?.dirty).toBe(false); // back, and clean again
    // Typed in since: it counts.
    h.disk.delete(P("old.ts").toLowerCase());
    await actions.checkExternalChanges();
    h.text.set(old.id, "typed\n");
    const c = await drive(() => gitLib.checkout("feature"), "Cancel");
    expect(c.seen[0]?.title).toBe("Unsaved changes in old.ts");
  });
});

describe("merge, rebase and history edits: clean state first (SAFE-003.12, SAFE-003.13)", () => {
  const cases: [string, () => unknown, string][] = [
    ["startMerge", () => gitLib.startMerge(ROOT, "feature"), "git_merge"],
    ["startRebase", () => gitLib.startRebase(ROOT, "feature"), "git_rebase"],
    ["dropCommit", () => gitLib.dropCommit(ROOT, D.sha), "git_history_rewrite"],
    ["runHistoryEdit", () => gitLib.runHistoryEdit(ROOT, rangeFrom(B.sha), singlePlan("drop", rangeFrom(B.sha).commits)), "git_history_rewrite"],
  ];
  for (const [name, run] of cases) {
    it(`${name}: Save leads to "Commit or discard your changes first", and git does not run`, async () => {
      const store = await open(P("src\\store.ts"), { edited: "mine\n" });
      h.onSave = () => void (h.status = status({ files: [file("src\\store.ts")] }));
      h.calls.length = 0;
      const { seen } = await drive(run, "Save All", "cancel");
      expect(seen.map((s) => s.title)).toEqual(["Unsaved changes in store.ts", "Commit or discard your changes first"]);
      expect(seen[1].labels).toEqual(["Show Source Control", "Close"]);
      expect(docOf(store)?.dirty).toBe(false);
      expect(ran()).toEqual([]);
    });

    it(`${name}: uncommitted changes already on disk give one refusal and no question`, async () => {
      await open(P("src\\store.ts"), { edited: "mine\n" });
      use(status({ files: [file("a.ts"), file("b.ts")] }));
      h.calls.length = 0;
      const { seen } = await drive(run, "Save All", "cancel");
      expect(seen.map((s) => s.title)).toEqual(["Commit or discard your changes first"]);
      expect(wrote()).toEqual([]);
      expect(ran()).toEqual([]);
    });
  }
});

describe("open tabs show what is on disk afterwards (SAFE-006, SAFE-007)", () => {
  it("clean tabs reload after a switch, with one notice; unchanged files are left alone", async () => {
    const store = await open(P("src\\store.ts"));
    const readme = await open(P("README.md"));
    const same = await open(P("same.ts"));
    h.onGit = () => {
      put("src\\store.ts", "feature store\n");
      put("README.md", "feature readme\n");
    };
    h.calls.length = 0;
    await drive(() => gitLib.checkout("feature"), "Cancel");
    expect([h.text.get(store.id), h.text.get(readme.id), h.text.get(same.id)]).toEqual(["feature store\n", "feature readme\n", `${P("same.ts")}\n`]);
    expect(toasts()).toEqual(["Switched to feature", "2 open files changed on disk and were reloaded."]);
    expect(h.calls.filter((c) => c.cmd === "fs_read_text").map((c) => c.args.path)).toEqual([P("src\\store.ts"), P("README.md")]);
  });

  it("a file rewritten with the text the tab already shows is not reloaded or reported", async () => {
    const store = await open(P("src\\store.ts"), { content: "same\n" });
    h.onGit = () => void put("src\\store.ts", "same\n");
    await drive(() => gitLib.checkoutRef(ROOT, "feature"), "Cancel");
    expect(h.text.get(store.id)).toBe("same\n");
    expect(toasts().some((t) => t.includes("was reloaded"))).toBe(false);
    expect(useStore.getState().docs.find((d) => d.id === store.id)!.dirty).toBe(false);
  });

  it("one file keeps the familiar notice", async () => {
    await open(P("src\\store.ts"));
    h.onGit = () => void put("src\\store.ts", "feature store\n");
    await drive(() => gitLib.checkoutRef(ROOT, "feature"), "Cancel");
    expect(toasts()).toEqual(["store.ts changed on disk and was reloaded."]);
  });

  const stops: [string, () => unknown, string, (() => GitStatus)?][] = [
    ["a cherry-pick that stops on a conflict", () => gitLib.commitAction(ROOT, "cherry-pick", id("18bc71d")), "git_commit_action"],
    ["a revert that fails", () => gitLib.commitAction(ROOT, "revert", id("18bc71d")), "git_commit_action"],
    ["a pull that stops on a conflict", () => gitLib.remote(ROOT, "pull"), "git_remote"],
    ["a merge that stops on a conflict", () => gitLib.startMerge(ROOT, "feature"), "git_merge"],
    ["a rebase that fails part-way", () => gitLib.startRebase(ROOT, "feature"), "git_rebase"],
    ["a history edit that stops", () => gitLib.dropCommit(ROOT, D.sha), "git_history_rewrite"],
    ["an abort that fails", () => gitLib.abortOperation(ROOT, "merge"), "git_abort", () => status({ operation: "merge" })],
    ["a Continue that stops again", () => gitLib.continueOperation(ROOT, "rebase", "continue"), "git_continue", rebasing],
    ["a stash apply that fails", () => gitLib.stashAction(ROOT, STASH, "apply"), "git_stash_op"],
    ["Stash Changes that fails", () => gitLib.stashChanges(ROOT, "wip", false), "git_stash_push", changed],
  ];
  for (const [name, run, cmd, st] of stops) {
    it(`${name} still reloads the tabs it changed`, async () => {
      if (st) use(st());
      const store = await open(P("src\\store.ts"));
      h.onGit = (c) => {
        if (c !== cmd) return undefined;
        put("src\\store.ts", "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> 18bc71d\n");
        throw "error: could not apply 18bc71d... Add the parser\nCONFLICT (content): Merge conflict in src/store.ts";
      };
      await drive(run, "Cancel");
      expect(ran(REWRITES)).toEqual([cmd]);
      expect(h.text.get(store.id)).toContain("<<<<<<< HEAD");
      // A stash action says what it did itself: no "changed on disk" notice repeats it.
      if (cmd.startsWith("git_stash")) expect(toasts().some((t) => t.includes("was reloaded"))).toBe(false);
      else expect(toasts()).toContain("store.ts changed on disk and was reloaded.");
    });
  }

  it("a stash pop that comes back with conflicts reloads the tab", async () => {
    const store = await open(P("src\\store.ts"));
    h.onGit = (c) => {
      if (c !== "git_stash_op") return undefined;
      put("src\\store.ts", "<<<<<<< Updated upstream\n");
      h.status = status({ files: [file("src\\store.ts", { conflicted: true })] });
      return "conflicts";
    };
    await drive(() => gitLib.stashAction(ROOT, STASH, "pop"), "Cancel");
    expect(h.text.get(store.id)).toBe("<<<<<<< Updated upstream\n");
  });

  it("the check after an operation waits for a question that is still open, and is not lost", async () => {
    const notes = await open("C:\\notes\\notes.txt", { edited: "mine\n" });
    const store = await open(P("src\\store.ts"));
    putAt("C:\\notes\\notes.txt", "changed outside\n");
    void actions.checkExternalChanges(); // window focus: asks about notes.txt
    await tick();
    expect(dialog()?.title).toBe("notes.txt changed on disk");
    h.onGit = () => void put("src\\store.ts", "pulled\n");
    await gitLib.remote(ROOT, "pull");
    await tick();
    expect(toasts()).toContain("Pulled.");
    expect(h.text.get(store.id)).not.toBe("pulled\n"); // queued behind the question
    dialog()!.actions.find((a) => a.label === "Keep my version")!.run();
    await settle();
    expect(h.text.get(store.id)).toBe("pulled\n");
    expect(h.text.get(notes.id)).toBe("mine\n");
    expect(dialog()).toBeNull();
  });

  it("a large-file tab is reopened from disk and counted; one in follow mode is left alone", async () => {
    const big = await open(P("data\\big.csv"), { kind: "big" });
    const log = await open(P("app.log"), { kind: "big" });
    useStore.getState().updateDoc(log.id, { following: true });
    await open(P("src\\store.ts"));
    h.onGit = () => {
      put("data\\big.csv", "new\n");
      put("app.log", "more\n");
      put("src\\store.ts", "feature\n");
    };
    h.calls.length = 0;
    await drive(() => gitLib.checkout("feature"), "Cancel");
    expect(h.calls.filter((c) => c.cmd === "big_open").map((c) => c.args.path)).toEqual([P("data\\big.csv")]);
    expect(docOf(big)?.dirty).toBe(false);
    expect(toasts()).toContain("2 open files changed on disk and were reloaded.");
  });

  it("Compare tabs follow: a file side is read again, a tab side shows the reloaded tab, an edited comparison is left alone", async () => {
    const { openCompare, diffOf, markSideEdited } = await import("../lib/diff");
    put("src\\api.ts", "api\n");
    put("src\\kept.ts", "kept\n");
    const store = await open(P("src\\store.ts"), { content: "store\n" });
    const fileCmp = (await openCompare({ kind: "text", label: "api.ts (HEAD)", text: "old api\n" }, { kind: "file", path: P("src\\api.ts") }))!;
    const tabCmp = (await openCompare({ kind: "text", label: "store.ts (HEAD)", text: "old store\n" }, { kind: "tab", docId: store.id }))!;
    const edited = (await openCompare({ kind: "text", label: "kept.ts (HEAD)", text: "old\n" }, { kind: "file", path: P("src\\kept.ts") }))!;
    markSideEdited(edited.id, "right");
    useStore.setState({ toasts: [] });
    h.onGit = () => {
      put("src\\api.ts", "feature api\n");
      put("src\\store.ts", "feature store\n");
      put("src\\kept.ts", "feature kept\n");
    };
    await drive(() => gitLib.checkout("feature"), "Continue Without Saving");
    expect(diffOf(fileCmp.id).right.text).toBe("feature api\n");
    expect(diffOf(fileCmp.id).left.text).toBe("old api\n");
    expect(diffOf(tabCmp.id).right.text).toBe("feature store\n");
    expect(diffOf(tabCmp.id).left.text).toBe("old store\n");
    expect(diffOf(edited.id).right.text).toBe("kept\n"); // kept unsaved
    expect(diffOf(edited.id).right.dirty).toBe(true);
    // Only the text tab is counted: a comparison follows its file without a notice of its own.
    expect(toasts()).toEqual(["Switched to feature", "store.ts changed on disk and was reloaded.", "kept.ts changed on disk; its tab keeps your unsaved text. Saving it overwrites the file."]);
  });

  it("tabs whose file is gone stay open, marked unsaved, with one warning worded for the operation", async () => {
    const old = await open(P("old.ts"));
    const legacy = await open(P("legacy.ts"));
    h.onGit = () => {
      h.disk.delete(P("old.ts").toLowerCase());
      h.disk.delete(P("legacy.ts").toLowerCase());
    };
    await drive(() => gitLib.checkout("feature"), "Cancel");
    expect([docOf(old)?.dirty, docOf(legacy)?.dirty]).toEqual([true, true]);
    expect(toasts()).toEqual(["Switched to feature", "old.ts and legacy.ts are not in the folder after switching to feature. Their tabs stay open; saving one recreates the file."]);
    // Given once.
    useStore.setState({ toasts: [] });
    await actions.checkExternalChanges();
    expect(toasts()).toEqual([]);
    // Switching back asks nothing and brings them back clean, newer text included.
    h.onGit = () => {
      put("old.ts", "newer\n");
      h.disk.set(P("legacy.ts").toLowerCase(), { content: `${P("legacy.ts")}\n`, ms: 1 });
    };
    const back = await drive(() => gitLib.checkout("main"), "Cancel");
    expect(back.seen).toEqual([]);
    expect([docOf(old)?.dirty, docOf(legacy)?.dirty]).toEqual([false, false]);
    expect(h.text.get(old.id)).toBe("newer\n");
    expect(toasts()).toEqual(["Switched to main", "old.ts changed on disk and was reloaded."]);
  });

  it("a pull that removes a file words the warning for the pull", async () => {
    await open(P("old.ts"));
    h.onGit = () => void h.disk.delete(P("old.ts").toLowerCase());
    await drive(() => gitLib.remote(ROOT, "pull"), "Cancel");
    expect(toasts()).toContain("old.ts is not in the folder after the pull. Its tab stays open; saving it recreates the file.");
  });

  it("an untracked file deleted on purpose closes its tab, edited or not, without a warning", async () => {
    const notes = await open(P("notes.txt"));
    const draft = await open(P("draft.txt"), { edited: "mine\n" });
    const untracked = (rel: string) => file(rel, { index: "?", worktree: "?", untracked: true });
    h.onGit = (_c, args) => void (args.paths as string[]).forEach((p) => h.disk.delete(p.toLowerCase()));
    const a = await drive(() => gitLib.discard(ROOT, [untracked("notes.txt")]), "Cancel");
    expect(a.seen[0].message).toBe("notes.txt is not tracked by git and will be moved to the Recycle Bin.");
    expect(docOf(notes)).toBeUndefined();
    const b = await drive(() => gitLib.discard(ROOT, [untracked("draft.txt")]), "Cancel");
    expect(b.seen.map((s) => s.message)).toEqual(["draft.txt is not tracked by git and will be moved to the Recycle Bin. The unsaved edits in its open tab are lost."]);
    expect(docOf(draft)).toBeUndefined();
    expect(toasts()).toEqual([]);
  });

  it("several files changed outside Quarry give one notice at the window-focus check too", async () => {
    await open(P("a.ts"));
    await open(P("b.ts"));
    await open(P("c.ts"));
    put("a.ts", "1\n");
    put("b.ts", "2\n");
    h.disk.delete(P("c.ts").toLowerCase());
    const [r1, r2] = await Promise.all([actions.checkExternalChanges(), actions.checkExternalChanges()]);
    expect(r1).toBe(r2); // two focus events, one check
    expect(toasts()).toEqual(["2 open files changed on disk and were reloaded.", "c.ts was deleted or moved on disk. Saving will recreate it."]);
  });
});

describe("discarding one change keeps its save-first rule (STAGE-005, SAFE decision)", () => {
  it("a failed save cancels the discard", async () => {
    // Covered in gitStaging.test.tsx against the real DiffView; here: the action is not reachable without a comparison.
    expect(await discardHunk("no-such-tab")).toBe(false);
    expect(ran()).toEqual([]);
  });
});
