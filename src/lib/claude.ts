/**
 * Claude Code tabs: each `kind: "claude"` doc has a session here (its transcript and the id of the
 * `claude` process Rust runs for it, src-tauri/src/claude.rs). The process starts with the tab and
 * is resumed (`--resume <session id>`) when a message is sent after it ended or after a restart.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  addNote,
  addUser,
  emptyTranscript,
  ended,
  historyTranscript,
  interruptRequest,
  permissionResponse,
  questionResponse,
  reduce,
  relPath,
  userMessage,
  type Decision,
  type PermissionAsk,
  type Transcript,
} from "./claudeProtocol";
import type { Attachment } from "./claudeImages";
import { editor } from "../editor/manager";
import { activeDoc, newDocId, useStore, type Doc } from "./store";

export type ClaudeStatus = "stopped" | "starting" | "ready";

export interface ClaudeSession {
  cwd: string;
  procId: number | null;
  status: ClaudeStatus;
  t: Transcript;
  /** When the running turn started (for the elapsed time shown while working). */
  turnStart: number | null;
  /** Composer text, kept across tab switches. */
  draft: string;
  /** Pictures waiting to go with the next message. */
  attachments: Attachment[];
  /** A turn finished while the tab was in the background (cleared when it is shown). */
  unseenDone?: boolean;
  /** The permission mode the running process was started with (the setting may have changed since). */
  mode?: string;
}

/** What a Claude tab's badge shows: waiting for an answer, working, or finished out of sight. */
export function useClaudeBadge(docId: string): "ask" | "busy" | "done" | null {
  return useClaude((st) => {
    const s = st.sessions[docId];
    if (!s) return null;
    if (s.t.asks.length) return "ask";
    if (s.t.busy) return "busy";
    return s.unseenDone ? "done" : null;
  });
}

interface ClaudeState {
  sessions: Record<string, ClaudeSession>;
}

export const useClaude = create<ClaudeState>(() => ({ sessions: {} }));

const get = (docId: string) => useClaude.getState().sessions[docId];

function patch(docId: string, f: (s: ClaudeSession) => Partial<ClaudeSession>) {
  useClaude.setState((st) => {
    const s = st.sessions[docId];
    return s ? { sessions: { ...st.sessions, [docId]: { ...s, ...f(s) } } } : st;
  });
}

const procToDoc = new Map<number, string>();
/** Processes we ended on purpose: their exit is not reported as a failure. */
const stopping = new Set<number>();
let reqSeq = 1;

const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

export const claudeEnabled = () => useStore.getState().settings.claudeEnabled;

/** Open a Claude tab for `folder` (or switch to the one already open for it). */
export async function openClaudeTab(folder: string, opts: { sessionId?: string; activate?: boolean; start?: boolean; reuse?: boolean } = {}): Promise<Doc | null> {
  const store = useStore.getState();
  if (opts.reuse !== false) {
    const open = store.docs.find((d) => d.kind === "claude" && d.claude && sameFolder(d.claude.cwd, folder));
    if (open) {
      if (opts.activate !== false) store.setActive(open.id);
      return open;
    }
  }
  const doc: Doc = {
    id: newDocId(),
    kind: "claude",
    path: null,
    name: `Claude · ${baseName(folder)}`,
    dirty: false,
    encoding: "",
    bom: false,
    eol: "CRLF",
    language: "Claude Code",
    readonly: false,
    modifiedMs: 0,
    claude: { cwd: folder, sessionId: opts.sessionId },
  };
  const t = emptyTranscript();
  useClaude.setState((st) => ({ sessions: { ...st.sessions, [doc.id]: { cwd: folder, procId: null, status: "stopped", t: { ...t, sessionId: opts.sessionId ?? null }, turnStart: null, draft: "", attachments: [] } } }));
  store.addDoc(doc, opts.activate !== false);
  // A background tab (session restore) reads its history when it is first shown: each can be
  // megabytes of JSON to parse, and start-up shouldn't wait for tabs nobody is looking at.
  if (opts.sessionId) {
    if (opts.activate === false) historyLater.set(doc.id, opts.sessionId);
    else void loadHistory(doc.id, opts.sessionId);
  }
  if (opts.start !== false) void start(doc.id);
  return doc;
}

export interface Conversation {
  id: string;
  modifiedMs: number;
  title: string;
  size: number;
}

/** Past conversations in a folder (Claude Code's history), newest first. */
export const listConversations = (cwd: string) => invoke<Conversation[]>("claude_conversations", { cwd });

/** Tabs whose history is read when they are first shown (tab id → session id). */
const historyLater = new Map<string, string>();

/** Show a past conversation's messages in a tab (before anything new is said in it). */
async function loadHistory(docId: string, sessionId: string) {
  const s = get(docId);
  if (!s) return;
  patch(docId, (cur) => ({ t: addNote(cur.t, "Loading the earlier messages…") }));
  try {
    const h = await invoke<{ lines: string[]; truncated: boolean }>("claude_history", { cwd: s.cwd, id: sessionId });
    let t = historyTranscript(h.lines, sessionId);
    if (h.truncated) t = { ...t, items: [{ kind: "note", key: "trunc", text: "Older messages are not shown.", tone: "info" }, ...t.items] };
    // Keep anything that happened while loading (a message sent meanwhile). The history items get
    // their own key prefix: the current items keep theirs, which a turn in progress (`live`) refers to.
    patch(docId, (cur) => ({ t: { ...t, items: [...t.items.map((i) => ({ ...i, key: `h${i.key}` })), ...cur.t.items.filter((i) => !(i.kind === "note" && i.text === "Loading the earlier messages…"))], busy: cur.t.busy, asks: cur.t.asks, model: cur.t.model, live: cur.t.live, liveMsg: cur.t.liveMsg, seq: Math.max(cur.t.seq, t.seq) } }));
  } catch (e) {
    patch(docId, (cur) => ({ t: { ...cur.t, items: cur.t.items.filter((i) => !(i.kind === "note" && i.text === "Loading the earlier messages…")).concat({ kind: "note", key: `h${cur.t.seq}`, text: `Earlier messages could not be shown (${e}).`, tone: "info" }), seq: cur.t.seq + 1 } }));
  }
}

/** Continue a past conversation in this tab: its messages are shown and the next message resumes it. */
export async function resumeConversation(docId: string, sessionId: string) {
  stopProc(docId);
  patch(docId, () => ({ procId: null, status: "stopped", t: { ...emptyTranscript(), sessionId }, turnStart: null }));
  const store = useStore.getState();
  const doc = store.docs.find((d) => d.id === docId);
  if (doc?.claude) store.updateDoc(docId, { claude: { cwd: doc.claude.cwd, sessionId } });
  await loadHistory(docId, sessionId);
}

function sameFolder(a: string, b: string) {
  const n = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return n(a) === n(b);
}

const starting = new Map<string, Promise<boolean>>();

/** Start the process for a tab (resuming its session, if it has one). Resolves once it is running. */
function start(docId: string): Promise<boolean> {
  const s = get(docId);
  if (!s) return Promise.resolve(false);
  if (s.procId !== null) return Promise.resolve(true);
  let p = starting.get(docId);
  if (!p) {
    p = spawn(docId, s).finally(() => starting.delete(docId));
    starting.set(docId, p);
  }
  return p;
}

/** Processes started with --resume that haven't reported `system/init` yet (procId → session id). */
const resuming = new Map<number, string>();

async function spawn(docId: string, s: ClaudeSession): Promise<boolean> {
  const { settings } = useStore.getState();
  patch(docId, () => ({ status: "starting" }));
  try {
    const id = await invoke<number>("claude_start", {
      args: { exe: settings.claudePath, cwd: s.cwd, model: settings.claudeModel, permissionMode: settings.claudePermissionMode, resume: s.t.sessionId ?? undefined },
    });
    if (!get(docId)) {
      // The tab closed while the process was starting.
      void invoke("claude_stop", { id });
      return false;
    }
    procToDoc.set(id, docId);
    if (s.t.sessionId) resuming.set(id, s.t.sessionId);
    patch(docId, () => ({ procId: id, status: "ready", mode: settings.claudePermissionMode }));
    return true;
  } catch (e) {
    patch(docId, (cur) => ({ status: "stopped", t: addNote(cur.t, String(e), "error") }));
    return false;
  }
}

async function write(docId: string, line: string): Promise<boolean> {
  const s = get(docId);
  if (!s || s.procId === null) return false;
  try {
    await invoke("claude_send", { id: s.procId, line });
    return true;
  } catch (e) {
    patch(docId, (cur) => ({ t: addNote(cur.t, `Could not reach Claude Code: ${e}`, "error") }));
    return false;
  }
}

/** Send a message (starting or resuming the process first when needed). While a turn runs, Claude
 *  Code queues it and reads it next. */
export async function sendToClaude(docId: string, text: string, images: Attachment[] = []): Promise<boolean> {
  if (!text.trim() && !images.length) return false;
  if (!get(docId)) return false;
  patch(docId, (s) => ({ t: addUser(s.t, text, images.map((i) => i.url)), turnStart: s.t.busy ? s.turnStart : Date.now() }));
  if (!(await start(docId))) {
    patch(docId, (s) => ({ t: { ...s.t, busy: false }, turnStart: null }));
    return false;
  }
  const ok = await write(docId, userMessage(text, images));
  if (!ok) patch(docId, (s) => ({ t: { ...s.t, busy: false }, turnStart: null }));
  return ok;
}

/** Stop the running turn (Claude Code keeps the session; the next message continues it). */
export function interruptClaude(docId: string) {
  const s = get(docId);
  if (!s?.t.busy) return;
  // Pending permission asks are void once the turn stops.
  patch(docId, (cur) => ({ t: { ...cur.t, asks: [] } }));
  void write(docId, interruptRequest(`quarry-int-${reqSeq++}`));
}

export function answerClaude(docId: string, ask: PermissionAsk, decision: Decision) {
  patch(docId, (s) => ({ t: { ...s.t, asks: s.t.asks.filter((a) => a.requestId !== ask.requestId) } }));
  void write(docId, permissionResponse(ask, decision));
}

/** Answer an AskUserQuestion request: question → chosen label(s) or the user's own words. */
export function answerQuestions(docId: string, ask: PermissionAsk, answers: Record<string, string>) {
  patch(docId, (s) => ({ t: { ...s.t, asks: s.t.asks.filter((a) => a.requestId !== ask.requestId) } }));
  void write(docId, questionResponse(ask, answers));
}

export function addAttachments(docId: string, add: Attachment[]) {
  patch(docId, (s) => ({ attachments: [...s.attachments, ...add].slice(0, 20) }));
}

export function removeAttachment(docId: string, id: string) {
  patch(docId, (s) => ({ attachments: s.attachments.filter((a) => a.id !== id) }));
}

export function clearAttachments(docId: string) {
  patch(docId, () => ({ attachments: [] }));
}

// ---------- editor context ----------

/** The text tab used last (the "current file" while a Claude tab is in front). */
let lastTextDocId: string | null = null;

export function lastTextDoc(): Doc | undefined {
  const s = useStore.getState();
  const cur = activeDoc(s);
  if (cur?.kind === "text") return cur;
  return s.docs.find((d) => d.id === lastTextDocId && d.kind === "text");
}

export { relPath };

/** Text that points Claude at a document: the selection as a fenced snippet with its lines, or
 *  the whole file by path (Claude reads it itself). Null when there is nothing to add. */
export function contextFor(doc: Doc, cwd: string, what: "selection" | "file"): string | null {
  const name = doc.path ? relPath(doc.path, cwd) : doc.name;
  if (what === "file") return doc.path ? `\`${name}\`` : null;
  const st = editor.stateOf(doc.id);
  if (!st) return null;
  const sel = st.selection.main;
  if (sel.empty) return null;
  const from = st.doc.lineAt(sel.from).number;
  const to = st.doc.lineAt(sel.to).number;
  const lang = (doc.language || "").toLowerCase().replace(/[^a-z0-9+#]/g, "");
  const where = from === to ? `line ${from}` : `lines ${from}-${to}`;
  const fence = "```";
  return `In \`${name}\` ${where}:\n${fence}${lang === "plaintext" ? "" : lang}\n${st.sliceDoc(sel.from, sel.to)}\n${fence}\n`;
}

let lastClaudeDocId: string | null = null;

/** The Claude tab a file belongs to: the one working in the deepest folder containing it, else the
 *  Claude tab used last. */
export function claudeTabFor(path: string | null): Doc | undefined {
  const tabs = useStore.getState().docs.filter((d) => d.kind === "claude" && d.claude);
  if (path) {
    const inside = tabs.filter((d) => relPath(path, d.claude!.cwd) !== path).sort((a, b) => b.claude!.cwd.length - a.claude!.cwd.length);
    if (inside.length) return inside[0];
  }
  return tabs.find((d) => d.id === lastClaudeDocId) ?? tabs[tabs.length - 1];
}

/** Append text to a Claude tab's message box (on a new line). */
export function appendToDraft(docId: string, text: string) {
  patch(docId, (s) => ({ draft: s.draft && !s.draft.endsWith("\n") ? `${s.draft}\n${text}` : s.draft + text }));
}

export function setClaudeDraft(docId: string, draft: string) {
  patch(docId, () => ({ draft }));
}

function stopProc(docId: string) {
  const s = get(docId);
  if (s?.procId == null) return;
  stopping.add(s.procId);
  void invoke("claude_stop", { id: s.procId });
}

/** Start over in the same folder: a new conversation (the old one stays in Claude Code's history). */
export function newClaudeSession(docId: string) {
  stopProc(docId);
  patch(docId, () => ({ procId: null, status: "stopped", t: emptyTranscript(), turnStart: null }));
  const store = useStore.getState();
  const doc = store.docs.find((d) => d.id === docId);
  if (doc?.claude) store.updateDoc(docId, { claude: { cwd: doc.claude.cwd } });
  void start(docId);
}

/** The tab closed: end its process and forget the transcript. */
export function disposeClaude(docId: string) {
  historyLater.delete(docId);
  stopProc(docId);
  useClaude.setState((st) => {
    const { [docId]: _gone, ...sessions } = st.sessions;
    return { sessions };
  });
}

/** The window is closing: end every Claude process and terminal. */
export async function stopAllClaude() {
  for (const id of procToDoc.keys()) stopping.add(id);
  await Promise.all([invoke("claude_stop_all").catch(() => {}), invoke("pty_kill_all").catch(() => {})]);
}

export const claudeBusy = (docId: string) => !!get(docId)?.t.busy;

// ---------- events ----------

/** stdout lines per tab, applied once per animation frame (streamed text arrives in many small
 *  events; one store update per frame keeps typing smooth). */
const pending = new Map<string, Record<string, unknown>[]>();
let frame = 0;

function flush() {
  frame = 0;
  const batches = [...pending];
  pending.clear();
  const store = useStore.getState();
  for (const [docId, events] of batches) {
    const before = get(docId);
    if (!before) continue;
    const t = events.reduce(reduce, before.t);
    const hidden = store.activeId !== docId;
    const finished = hidden && before.t.busy && !t.busy;
    patch(docId, (s) => ({ t, turnStart: t.busy ? s.turnStart ?? Date.now() : null, unseenDone: s.unseenDone || finished }));
    if (before.t.busy && !t.busy) applyModeWhenIdle(docId);
    // A question in a background tab stalls the turn until it is answered: say so once.
    const name = store.docs.find((d) => d.id === docId)?.name.replace(/^Claude · /, "") ?? "";
    if (hidden && t.asks.length > before.t.asks.length) store.toast(`Claude is waiting for your answer in ${name}.`, "warning", 6000);
    else if (finished) store.toast(`Claude finished in ${name}.`, "info", 3000);
    // Keep the session id on the tab, so the session file can resume it after a restart.
    const doc = store.docs.find((d) => d.id === docId);
    if (t.sessionId && doc?.claude && doc.claude.sessionId !== t.sessionId) store.updateDoc(docId, { claude: { ...doc.claude, sessionId: t.sessionId } });
  }
}

/** The permission mode is a command-line flag: a process started with another one is stopped while
 *  idle, and the next message resumes the conversation with the current setting. */
function applyModeWhenIdle(docId: string) {
  const s = get(docId);
  if (s && s.procId !== null && !s.t.busy && s.mode && s.mode !== useStore.getState().settings.claudePermissionMode) {
    stopProc(docId);
    patch(docId, () => ({ procId: null, status: "stopped", mode: undefined }));
  }
}

let installed = false;

/** Route process output to the tabs (once, at start-up). */
export function installClaudeEvents() {
  if (installed) return;
  installed = true;
  useStore.subscribe((s, prev) => {
    if (s.settings.claudePermissionMode !== prev.settings.claudePermissionMode) for (const id of Object.keys(useClaude.getState().sessions)) applyModeWhenIdle(id);
    if (s.activeId === prev.activeId) return;
    if (s.activeId && get(s.activeId)?.unseenDone) patch(s.activeId, () => ({ unseenDone: false }));
    const later = s.activeId ? historyLater.get(s.activeId) : undefined;
    if (later && s.activeId) {
      historyLater.delete(s.activeId);
      void loadHistory(s.activeId, later);
    }
    const kind = activeDoc(s)?.kind;
    if (kind === "text") lastTextDocId = s.activeId;
    else if (kind === "claude") lastClaudeDocId = s.activeId;
  });
  void listen<{ id: number; line: string }>("claude:out", (e) => {
    const docId = procToDoc.get(e.payload.id);
    if (!docId) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(e.payload.line);
    } catch {
      return; // not an event (stray output)
    }
    if (msg.type === "system" && msg.subtype === "init") resuming.delete(e.payload.id);
    const list = pending.get(docId) ?? [];
    list.push(msg);
    pending.set(docId, list);
    if (!frame) frame = requestAnimationFrame(flush);
  });
  void listen<{ id: number; code: number | null; stderr: string }>("claude:exit", (e) => {
    const { id, code, stderr } = e.payload;
    const docId = procToDoc.get(id);
    procToDoc.delete(id);
    const wanted = stopping.delete(id);
    if (!docId) return;
    flush();
    const s = get(docId);
    if (!s || s.procId !== id) return;
    const failedResume = resuming.get(id);
    resuming.delete(id);
    if (!wanted && failedResume) {
      // Resuming failed before the session started (Claude Code deleted the old transcript, or the
      // folder moved): forget that conversation, or every message would fail the same way.
      const doc = useStore.getState().docs.find((d) => d.id === docId);
      if (doc?.claude) useStore.getState().updateDoc(docId, { claude: { ...doc.claude, sessionId: undefined } });
      const note = `${exitNote(code, stderr, false)}\nThe earlier conversation could not be resumed (Claude Code may no longer have it). Your next message starts a new conversation.`;
      patch(docId, (cur) => ({ procId: null, status: "stopped", turnStart: null, t: { ...ended(cur.t, note), sessionId: null } }));
      return;
    }
    const why = wanted ? undefined : exitNote(code, stderr);
    patch(docId, (cur) => ({ procId: null, status: "stopped", turnStart: null, t: ended(cur.t, why) }));
  });
}

function exitNote(code: number | null, stderr: string, restartHint = true): string {
  const tail = stderr.split(/\r?\n/).filter((l) => l.trim()).slice(-6).join("\n");
  return `Claude Code stopped${code !== null ? ` (exit code ${code})` : ""}.${tail ? `\n${tail}` : ""}${restartHint ? "\nSend a message to start it again." : ""}`;
}

export interface ClaudeInstall {
  path: string;
  version: string;
}

export const detectClaude = (exe: string) => invoke<ClaudeInstall>("claude_detect", { exe });
