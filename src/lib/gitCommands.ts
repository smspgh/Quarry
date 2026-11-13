/** Git commands (category "Git"); the work is in lib/git.ts, the editor side in editor/git.ts. */
import { editor } from "../editor/manager";
import { changeAtLine, changeRows, changesOf, revertChange, setPeek } from "../editor/git";
import { accept, acceptAll, conflictAtCursor, conflictsOf, gotoConflict } from "../editor/conflicts";
import type { ConflictChoice } from "./conflicts";
import type { EditorView } from "@codemirror/view";
import { register, targetDoc } from "./commands";
import { compareWithHead, currentRepo, checkout, openGraph, resolveConflicts, fileStatus, pickBranch, remote, repoOf, rescanGit, showAddRemote, showHistory, stage, toggleBlame, unstage, useGit } from "./git";
import { nextChangeIndex } from "./gitStatus";
import { showPanel } from "./panels";
import { activeDoc, useStore } from "./store";

const s = () => useStore.getState();

/** The active document's file (or the tab named by `{ docId }`) when it is in a known repository. */
function repoFile(args?: unknown): { path: string; root: string } | null {
  const d = targetDoc(args);
  const repo = repoOf(d?.path);
  return d?.path && repo ? { path: d.path, root: repo.root } : null;
}

const tracked = (args?: unknown) => {
  if (typeof args === "string") return !!repoOf(args) && !fileStatus(args)?.untracked;
  const f = repoFile(args);
  return !!f && !fileStatus(f.path)?.untracked;
};

/** Move to the next / previous change marker in the focused editor. */
function jumpChange(dir: 1 | -1): boolean {
  const view = editor.view;
  if (!view) return false;
  const chunks = changesOf(view.state);
  if (!chunks.length) {
    s().toast("No changes since the last commit in this file.", "info", 1800);
    return true;
  }
  const line = view.state.doc.lineAt(view.state.selection.main.head).number;
  const starts = chunks.map((c) => changeRows(c, view.state.doc)[0]);
  const i = nextChangeIndex(starts, line, dir);
  const pos = view.state.doc.line(starts[i]).from;
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true, effects: setPeek.of(starts[i]) });
  view.focus();
  return true;
}

function changeAtCursor() {
  const view = editor.view;
  if (!view) return null;
  const c = changeAtLine(view.state, view.state.doc.lineAt(view.state.selection.main.head).number);
  return c ? { view, c } : null;
}

/** Run `fn` on the focused editor when its document has conflicts; say so when it has none. */
function withConflicts(fn: (view: EditorView) => void): boolean {
  const view = editor.view;
  if (!view || activeDoc(useStore.getState())?.kind !== "text") return false;
  if (!conflictsOf(view.state).length) {
    useStore.getState().toast("There are no conflicts in this file.", "info", 1800);
    return true;
  }
  fn(view);
  return true;
}

export function registerGitCommands() {
  const hasRepo = () => !!currentRepo();
  const hasConflicts = () => !!editor.view && activeDoc(useStore.getState())?.kind === "text" && conflictsOf(editor.view.state).length > 0;
  const acceptHere = (choice: ConflictChoice) => () => withConflicts((view) => {
    const b = conflictAtCursor(view.state);
    if (b) accept(view, b, choice);
  });
  const acceptEvery = (choice: ConflictChoice) => () => withConflicts((view) => void acceptAll(view, choice));
  register({ id: "git.nextConflict", title: "Next Conflict", category: "Git", keys: "Alt+F6", enabled: hasConflicts, run: () => withConflicts((v) => void gotoConflict(v, 1)) });
  register({ id: "git.prevConflict", title: "Previous Conflict", category: "Git", keys: "Shift+Alt+F6", enabled: hasConflicts, run: () => withConflicts((v) => void gotoConflict(v, -1)) });
  register({ id: "git.acceptCurrent", title: "Accept Current (Conflict at Cursor)", category: "Git", enabled: hasConflicts, run: acceptHere("current") });
  register({ id: "git.acceptIncoming", title: "Accept Incoming (Conflict at Cursor)", category: "Git", enabled: hasConflicts, run: acceptHere("incoming") });
  register({ id: "git.acceptBoth", title: "Accept Both (Conflict at Cursor)", category: "Git", enabled: hasConflicts, run: acceptHere("both") });
  register({ id: "git.acceptAllCurrent", title: "Accept All Current in This File", category: "Git", enabled: hasConflicts, run: acceptEvery("current") });
  register({ id: "git.acceptAllIncoming", title: "Accept All Incoming in This File", category: "Git", enabled: hasConflicts, run: acceptEvery("incoming") });
  register({ id: "git.showPanel", title: "Show Source Control", category: "Git", keys: "Ctrl+Shift+G", run: () => showPanel("git") });
  register({ id: "git.graph", title: "Show Commit Graph", category: "Git", enabled: hasRepo, run: () => openGraph() });
  register({ id: "git.refresh", title: "Refresh Git Status", category: "Git", run: rescanGit });
  register({ id: "git.switchBranch", title: "Switch Branch…", category: "Git", enabled: hasRepo, run: () => void pickBranch() });
  register({ id: "git.checkoutTo", title: "Switch to Branch", category: "Git", hidden: true, run: (name) => void (typeof name === "string" && checkout(name)) });
  register({ id: "git.createBranch", title: "Create Branch", category: "Git", hidden: true, run: (name) => void (typeof name === "string" && checkout(name, true)) });
  register({ id: "git.fetch", title: "Fetch", category: "Git", enabled: hasRepo, run: () => void remote(currentRepo()!.root, "fetch") });
  register({ id: "git.pull", title: "Pull", category: "Git", enabled: hasRepo, run: () => void remote(currentRepo()!.root, "pull") });
  register({ id: "git.push", title: "Push", category: "Git", enabled: hasRepo, run: () => void remote(currentRepo()!.root, "push") });
  register({ id: "git.addRemote", title: "Add Remote…", category: "Git", enabled: hasRepo, run: showAddRemote });
  register({
    id: "git.stageFile",
    title: "Stage Current File",
    category: "Git",
    enabled: () => !!fileStatus(repoFile()?.path),
    run: () => {
      const f = repoFile();
      if (!f) return;
      // A conflicted file goes the careful way: its tab is saved and leftover markers are asked about.
      if (fileStatus(f.path)?.conflicted) void resolveConflicts(f.root, [f.path]);
      else void stage(f.root, [f.path]);
    },
  });
  register({
    id: "git.unstageFile",
    title: "Unstage Current File",
    category: "Git",
    enabled: () => {
      const st = fileStatus(repoFile()?.path);
      return !!st && !st.untracked && st.index !== ".";
    },
    run: () => {
      const f = repoFile();
      if (f) void unstage(f.root, [f.path]);
    },
  });
  // These two take { docId } (a tab's right-click menu); git.fileHistory also takes a path.
  register({ id: "git.compareWithHead", title: "Compare with Last Commit (HEAD)", category: "Git", enabled: tracked, run: (a) => { const f = repoFile(a); if (!f) return false; void compareWithHead(f.path); } });
  register({
    id: "git.fileHistory",
    title: "Show File History",
    category: "Git",
    enabled: tracked,
    run: (a) => { const p = typeof a === "string" ? a : repoFile(a)?.path; if (!p) return false; void showHistory(p); },
  });
  register({ id: "git.toggleBlame", title: "Toggle Line Blame", category: "Git", dynamicTitle: () => (useGit.getState().blameOn ? "Hide Line Blame" : "Show Line Blame"), run: toggleBlame });
  register({ id: "git.nextChange", title: "Next Change", category: "Git", keys: "Alt+F5", enabled: () => activeDoc(s())?.kind === "text", run: () => jumpChange(1) });
  register({ id: "git.prevChange", title: "Previous Change", category: "Git", keys: "Shift+Alt+F5", enabled: () => activeDoc(s())?.kind === "text", run: () => jumpChange(-1) });
  register({
    id: "git.peekChange",
    title: "Show Change at Cursor",
    category: "Git",
    enabled: () => activeDoc(s())?.kind === "text",
    run: () => {
      const at = changeAtCursor();
      if (!at) return false;
      at.view.dispatch({ effects: setPeek.of(changeRows(at.c, at.view.state.doc)[0]) });
      return true;
    },
  });
  register({
    id: "git.revertChange",
    title: "Revert Change at Cursor",
    category: "Git",
    enabled: () => activeDoc(s())?.kind === "text",
    run: () => {
      const at = changeAtCursor();
      if (!at) {
        s().toast("The cursor is not on a changed line.", "info", 1800);
        return true;
      }
      revertChange(at.view, at.c);
      return true;
    },
  });
}
