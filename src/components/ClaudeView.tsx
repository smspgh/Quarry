import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  ExternalLink,
  FileText,
  FolderTree,
  History,
  Info,
  ListTodo,
  LoaderCircle,
  MessageCircleQuestion,
  Paperclip,
  ShieldQuestion,
  Square,
  SquarePen,
  SquareTerminal,
  TextSelect,
  X,
} from "lucide-react";
import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openPath, showInExplorerPanel } from "../lib/actions";
import { bus } from "../lib/bus";
import { runCommand } from "../lib/commands";
import {
  addAttachments,
  answerClaude,
  answerQuestions,
  appendToDraft,
  clearAttachments,
  contextFor,
  interruptClaude,
  lastTextDoc,
  listConversations,
  newClaudeSession,
  relPath,
  removeAttachment,
  resumeConversation,
  sendToClaude,
  setClaudeDraft,
  useClaude,
  type Conversation,
} from "../lib/claude";
import { imageFromPath, isImagePath, prepareImage, type Attachment } from "../lib/claudeImages";
import { latestTodos, lineDiff, patchStats, toolFile, toolSummary, type Hunk, type Item, type PermissionAsk, type Todo } from "../lib/claudeProtocol";
import { useStore, type Doc } from "../lib/store";
import { Markdown } from "./Markdown";
import { editor } from "../editor/manager";

const folderName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

/** Claude's mark: the tab icon, the empty state and the working indicator. */
export function ClaudeMark({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`claude-mark ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g fill="currentColor">
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x="11" y="2" width="2" height="9" rx="1" transform={`rotate(${i * 45} 12 12)`} />
        ))}
      </g>
    </svg>
  );
}

/** Open a link from Claude's reply: web links in the browser; paths (relative to the folder, with an
 *  optional `:line` or `#L12`) as tabs. */
function linkOpener(cwd: string) {
  return (href: string) => {
    if (/^(https?|mailto):/i.test(href)) {
      void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href)).catch(() => {});
      return;
    }
    const raw = href.replace(/^file:\/\/\/?/i, "");
    let decoded = raw;
    try {
      decoded = decodeURI(raw);
    } catch {
      /* a stray % : use the link as written */
    }
    const m = /^(.*?)(?:#L(\d+)|:(\d+))?$/.exec(decoded)!;
    let path = m[1].replace(/\//g, "\\");
    if (!/^[a-z]:\\|^\\\\/i.test(path)) path = `${cwd.replace(/[\\/]+$/, "")}\\${path.replace(/^\.\\/, "")}`;
    const line = Number(m[2] ?? m[3]) || undefined;
    void openPath(path, { line });
  };
}

const toast = (msg: string) => useStore.getState().toast(msg, "error");

export function ClaudeView({ doc, visible }: { doc: Doc; visible: boolean }) {
  const session = useClaude((st) => st.sessions[doc.id]);
  const model = useStore((s) => s.settings.claudeModel);
  const setting = useStore((s) => s.settings.claudePermissionMode);
  // What applies to this conversation now: a running process keeps the mode it started with until its task ends.
  const runningMode = useClaude((st) => st.sessions[doc.id]?.mode);
  const mode = runningMode ?? setting;
  const modePending = !!runningMode && runningMode !== setting;
  // Re-render when tabs change, so the "current file" buttons follow the last text tab.
  useStore((s) => s.activeId);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => editor.registerFocus(doc.id, () => input.current?.focus()), [doc.id]);
  const historyBtn = useRef<HTMLButtonElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const stick = useRef(true);

  const cwd = session?.cwd ?? doc.claude?.cwd ?? "";
  const items = session?.t.items ?? [];
  const asks = session?.t.asks ?? [];
  const busy = !!session?.t.busy;
  const onLink = useMemo(() => linkOpener(cwd), [cwd]);
  const todos = useMemo(() => latestTodos(items), [items]);
  const lastTodoKey = useMemo(() => [...items].reverse().find((i) => i.kind === "tool" && i.name === "TodoWrite")?.key, [items]);

  // Follow the conversation while the view is scrolled to the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, asks, busy]);

  useEffect(() => {
    if (visible) requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  }, [visible]);

  // Files dropped on this tab (App.tsx routes drops over a Claude tab here).
  useEffect(() => {
    if (!visible) return;
    return bus.on("claude.drop", (paths) => {
      const list = paths as string[];
      const images = list.filter(isImagePath);
      const others = list.filter((p) => !isImagePath(p));
      if (others.length) appendToDraft(doc.id, others.map((p) => `\`${relPath(p, cwd)}\``).join(" "));
      void Promise.all(images.map((p) => imageFromPath(p).catch((e) => { toast(`Could not attach ${p}: ${e}`); return null; })))
        .then((got) => addAttachments(doc.id, got.filter((a): a is Attachment => !!a)));
      input.current?.focus();
    });
  }, [visible, doc.id, cwd]);

  if (!session) return null;

  const send = () => {
    const text = session.draft.trim();
    if (!text && !session.attachments.length) return;
    stick.current = true;
    const images = session.attachments;
    setClaudeDraft(doc.id, "");
    clearAttachments(doc.id);
    void sendToClaude(doc.id, text, images);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.items].filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => !!f);
    if (!files.length) return;
    e.preventDefault();
    void Promise.all(files.map((f) => prepareImage(f, f.name && f.name !== "image.png" ? f.name : "Pasted image").catch((err) => { toast(`Could not attach the picture: ${err}`); return null; })))
      .then((got) => addAttachments(doc.id, got.filter((a): a is Attachment => !!a)));
  };

  const browseImages = async () => {
    const picked = await openDialog({ multiple: true, title: "Attach images", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] });
    const paths = !picked ? [] : Array.isArray(picked) ? picked : [picked];
    const got = await Promise.all(paths.map((p) => imageFromPath(p).catch((e) => { toast(`Could not attach ${p}: ${e}`); return null; })));
    addAttachments(doc.id, got.filter((a): a is Attachment => !!a));
    input.current?.focus();
  };

  const textDoc = lastTextDoc();
  const addContext = (what: "selection" | "file") => {
    if (!textDoc) return;
    const text = contextFor(textDoc, cwd, what);
    if (text) appendToDraft(doc.id, text);
    else useStore.getState().toast(what === "selection" ? `Nothing is selected in ${textDoc.name}.` : `${textDoc.name} has not been saved to a file yet.`, "info");
    input.current?.focus();
  };

  // The answered card unmounts with focus in it; give the keyboard to the composer unless the next card took it.
  const answered = (answer: () => void) => {
    answer();
    requestAnimationFrame(() => {
      const at = document.activeElement;
      if (!at || at === document.body || !at.isConnected) input.current?.focus();
    });
  };

  const modelLabel = (session.t.model ?? model) || "Default model";
  const canSend = !!session.draft.trim() || session.attachments.length > 0;

  return (
    <div className="claude-view" hidden={!visible}>
      <header className="claude-head">
        <ClaudeMark size={18} className="accent" />
        <div className="claude-title">
          <span className="claude-folder">{folderName(cwd)}</span>
          <span className="claude-path" title={cwd}>{cwd}</span>
        </div>
        <span className="claude-chip" title="Model (Settings › Claude Code)">{modelLabel}</span>
        <span className={`claude-status ${busy ? "busy" : session.status}`}>
          {busy ? "Working" : session.status === "starting" ? "Starting" : session.status === "ready" ? "Ready" : "Idle"}
        </span>
        <button ref={historyBtn} className="icon-btn" title="Past conversations in this folder" aria-label="Past conversations" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><History size={15} /></button>
        <button className="icon-btn" title="New conversation" aria-label="New conversation" onClick={() => newClaudeSession(doc.id)}><SquarePen size={15} /></button>
        <button className="icon-btn" title="Open the Claude Code command line in a terminal tab (a separate conversation)" aria-label="Open Claude Code terminal" onClick={() => void runCommand("claude.openTerminal", { folder: cwd })}><SquareTerminal size={15} /></button>
        <button className="icon-btn" title="Show folder in the Explorer" aria-label="Show folder in the Explorer" onClick={() => void showInExplorerPanel(cwd)}><FolderTree size={15} /></button>
      </header>

      {historyOpen && (
        <HistoryMenu
          cwd={cwd}
          current={session.t.sessionId}
          anchor={historyBtn.current}
          onClose={() => setHistoryOpen(false)}
          onPick={(id) => { setHistoryOpen(false); stick.current = true; void resumeConversation(doc.id, id); }}
        />
      )}

      <div
        ref={scroller}
        className="claude-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        <div className="claude-feed selectable" role="log" aria-live="polite" aria-label={`Claude Code in ${folderName(cwd)}`}>
          {items.length === 0 ? (
            <Empty folder={folderName(cwd)} cwd={cwd} mode={mode} onPick={(t) => { setClaudeDraft(doc.id, t); input.current?.focus(); }} onResume={(id) => void resumeConversation(doc.id, id)} />
          ) : (
            items.map((it) => <ItemView key={it.key} item={it} cwd={cwd} onLink={onLink} latestTodos={it.key === lastTodoKey} />)
          )}
          {asks.map((a) =>
            a.tool === "AskUserQuestion" ? (
              <QuestionCard key={a.requestId} ask={a} onSubmit={(ans) => answered(() => answerQuestions(doc.id, a, ans))} onSkip={() => answered(() => answerClaude(doc.id, a, "deny"))} />
            ) : (
              <AskCard key={a.requestId} ask={a} cwd={cwd} onAnswer={(d) => answered(() => answerClaude(doc.id, a, d))} />
            ),
          )}
          {busy && asks.length === 0 && <Working since={session.turnStart} todos={todos} />}
        </div>
      </div>

      <div className="claude-composer">
        <div className="claude-input">
          {session.attachments.length > 0 && (
            <div className="claude-attach">
              {session.attachments.map((a) => (
                <div key={a.id} className="claude-thumb" title={a.name}>
                  <img src={a.url} alt={a.name} />
                  <button className="claude-thumb-x" title="Remove" aria-label={`Remove ${a.name}`} onClick={() => removeAttachment(doc.id, a.id)}><X size={11} /></button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={input}
            rows={1}
            value={session.draft}
            placeholder={busy ? "Add to the request (Claude reads it next)…" : `Ask Claude to do something in ${folderName(cwd)}… (paste screenshots here)`}
            aria-label="Message to Claude"
            onChange={(e) => setClaudeDraft(doc.id, e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              } else if (e.key === "Escape" && busy) {
                e.preventDefault();
                interruptClaude(doc.id);
              }
            }}
            style={{ height: autoHeight(session.draft) }}
          />
          <div className="claude-input-foot">
            <button className="icon-btn" title="Attach images (or paste / drop them)" aria-label="Attach images" onClick={() => void browseImages()}><Paperclip size={15} /></button>
            <button className="icon-btn" disabled={!textDoc?.path} title={textDoc?.path ? `Mention ${textDoc.name}` : "Open a file to mention it"} aria-label="Mention the current file" onClick={() => addContext("file")}><FileText size={15} /></button>
            <button className="icon-btn" disabled={!textDoc} title={textDoc ? `Add the selection in ${textDoc.name}` : "Select text in a file to add it"} aria-label="Add the editor selection" onClick={() => addContext("selection")}><TextSelect size={15} /></button>
            <span className="claude-mode" title="Settings › Claude Code › Permissions">
              {mode === "acceptEdits" ? "Edits are applied automatically · commands ask first" : "Asks before edits and commands"}
              {modePending && " · the new setting applies when this task ends"}
            </span>
            <span className="claude-hint">{busy ? "Esc to stop" : "Enter to send · Shift+Enter for a new line"}</span>
            {busy && (
              <button className="claude-btn stop" title="Stop (Esc)" aria-label="Stop" onClick={() => interruptClaude(doc.id)}><Square size={12} fill="currentColor" /></button>
            )}
            <button className="claude-btn send" title="Send (Enter)" aria-label="Send" disabled={!canSend} onClick={send}><ArrowUp size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Textarea height for its text: grows with the lines typed, up to about 12 lines. */
function autoHeight(text: string) {
  const lines = Math.min(12, Math.max(1, text.split("\n").length));
  return `calc(${lines} * 1.5em + 14px)`;
}

const SUGGESTIONS = [
  "Explain how this project is organised",
  "Find likely bugs and suggest fixes",
  "Write tests for the most important code",
  "Summarise the recent changes",
];

function Empty({ folder, cwd, mode, onPick, onResume }: { folder: string; cwd: string; mode: string; onPick: (t: string) => void; onResume: (id: string) => void }) {
  const [recent, setRecent] = useState<Conversation[]>([]);
  useEffect(() => {
    let live = true;
    listConversations(cwd).then((c) => live && setRecent(c.slice(0, 4)), () => {});
    return () => { live = false; };
  }, [cwd]);
  return (
    <div className="claude-empty">
      <ClaudeMark size={40} className="accent" />
      <h2>What should Claude do in {folder}?</h2>
      <p>
        Claude Code works in this folder: it reads files, makes changes and runs commands.{" "}
        {mode === "acceptEdits" ? "File edits are applied automatically; commands ask you first." : "It asks before every edit and command."}
      </p>
      <div className="claude-suggest">
        {SUGGESTIONS.map((s) => <button key={s} className="claude-suggestion" onClick={() => onPick(s)}>{s}</button>)}
      </div>
      {recent.length > 0 && (
        <div className="claude-recent">
          <div className="claude-recent-title">Continue a conversation</div>
          {recent.map((c) => (
            <button key={c.id} className="claude-recent-item" onClick={() => onResume(c.id)} title={c.title}>
              <History size={13} />
              <span className="claude-recent-text">{c.title}</span>
              <span className="claude-recent-when">{ago(c.modifiedMs)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "5 min ago", "yesterday", "3 Oct". */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86400) return "yesterday";
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(ms).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

/** The folder's past conversations (Claude Code's history); picking one continues it in this tab. */
function HistoryMenu({ cwd, current, anchor, onClose, onPick }: { cwd: string; current: string | null; anchor: HTMLElement | null; onClose: () => void; onPick: (id: string) => void }) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listConversations(cwd).then(setList, (e) => setError(String(e)));
  }, [cwd]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && e.target !== anchor && !anchor?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key, true); };
  }, [anchor, onClose]);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [list]);
  const r = anchor?.getBoundingClientRect();
  const style = r ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) } : { top: 60, right: 16 };
  return createPortal(
    <div ref={ref} className="palette ctx-menu claude-history" role="menu" style={style}>
      <div className="claude-history-head">Conversations in this folder</div>
      {error && <div className="claude-history-empty">{error}</div>}
      {!error && list === null && <div className="claude-history-empty">Loading…</div>}
      {list?.length === 0 && <div className="claude-history-empty">No earlier conversations here yet.</div>}
      {list?.map((c) => (
        <button key={c.id} className={`palette-item claude-history-item ${c.id === current ? "current" : ""}`} role="menuitem" title={c.title} onClick={() => onPick(c.id)}>
          <span className="title">{c.title}</span>
          <span className="claude-history-when">{c.id === current ? "open" : ago(c.modifiedMs)}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

function Working({ since, todos }: { since: number | null; todos: Todo[] | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const secs = since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
  const current = todos?.find((t) => t.status === "in_progress");
  const doneCount = todos?.filter((t) => t.status === "completed").length ?? 0;
  return (
    <div className="claude-working" aria-live="off">
      <ClaudeMark size={16} className="accent spin" />
      <span>{current ? `${current.activeForm || current.content}…` : "Working…"}</span>
      <span className="muted">
        {todos && todos.length > 0 ? `${doneCount}/${todos.length} tasks · ` : ""}
        {secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`} · Esc to stop
      </span>
    </div>
  );
}

const ItemView = memo(function ItemView({ item, cwd, onLink, latestTodos: isLatestTodos }: { item: Item; cwd: string; onLink: (h: string) => void; latestTodos: boolean }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="claude-user">
          {item.images && item.images.length > 0 && (
            <div className="claude-user-imgs">{item.images.map((u, i) => <img key={i} src={u} alt={`Attached image ${i + 1}`} />)}</div>
          )}
          {item.text}
        </div>
      );
    case "text":
      return <div className={`claude-text ${item.streaming ? "streaming" : ""}`}><Markdown text={item.text} onLink={onLink} /></div>;
    case "tool":
      if (item.name === "TodoWrite") return <TodoCard item={item} full={isLatestTodos} />;
      return <ToolCard item={item} cwd={cwd} />;
    case "note":
      return (
        <div className={`claude-note ${item.tone}`}>
          {item.tone === "error" ? <CircleAlert size={14} /> : <Info size={14} />}
          <span>{item.text}</span>
        </div>
      );
    case "done":
      return item.ok ? (
        <div className="claude-done"><Check size={12} /> Done in {formatMs(item.ms)}</div>
      ) : (
        <div className="claude-note error"><CircleAlert size={14} /><span>{item.text || "The request failed."}</span></div>
      );
  }
});

const formatMs = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

const RESULT_MAX = 12_000;
const clip = (s: string) => (s.length > RESULT_MAX ? `${s.slice(0, RESULT_MAX)}\n… ${(s.length - RESULT_MAX).toLocaleString()} more characters` : s);

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const WRITE_PREVIEW_LINES = 400;

/** What an edit changes: the real patch once it ran, else a diff of the strings it was given. */
function editHunks(name: string, input: Record<string, unknown>, patch?: Hunk[]): { hunks: Hunk[]; numbered: boolean } | null {
  if (patch?.length) return { hunks: patch, numbered: true };
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  if (name === "Edit" && str(input.old_string) !== null) return { hunks: [lineDiff(str(input.old_string)!, str(input.new_string) ?? "")], numbered: false };
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    return { hunks: (input.edits as Record<string, unknown>[]).map((e) => lineDiff(str(e.old_string) ?? "", str(e.new_string) ?? "")), numbered: false };
  }
  if (name === "Write" && str(input.content) !== null) {
    const lines = str(input.content)!.replace(/\n$/, "").split("\n");
    const shown = lines.slice(0, WRITE_PREVIEW_LINES).map((l) => `+${l}`);
    if (lines.length > WRITE_PREVIEW_LINES) shown.push(` … ${lines.length - WRITE_PREVIEW_LINES} more lines`);
    return { hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: shown }], numbered: true };
  }
  return null;
}

function ToolCard({ item, cwd }: { item: Extract<Item, { kind: "tool" }>; cwd: string }) {
  const edit = useMemo(() => (EDIT_TOOLS.has(item.name) ? editHunks(item.name, item.input, item.patch) : null), [item.name, item.input, item.patch]);
  const stats = edit ? patchStats(edit.hunks) : null;
  // Small finished edits open by themselves, so changes can be seen at a glance.
  const [open, setOpen] = useState(() => !!edit && item.status === "done" && stats!.add + stats!.del <= 30);
  const wasRunning = useRef(item.status === "running");
  useEffect(() => {
    if (wasRunning.current && item.status === "done" && edit && stats!.add + stats!.del <= 30) setOpen(true);
    wasRunning.current = item.status === "running";
  }, [item.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const file = toolFile(item.input);
  const summary = toolSummary(item.name, item.input, cwd);
  return (
    <div className={`claude-tool ${item.status}`}>
      <div className="claude-tool-row">
        <button className="claude-tool-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="claude-tool-state">
            {item.status === "running" ? <LoaderCircle size={13} className="spin" /> : item.status === "error" ? <X size={13} /> : <Check size={13} />}
          </span>
          <span className="claude-tool-name">{item.name}</span>
          <span className="claude-tool-sum">{summary}</span>
          {stats && (stats.add > 0 || stats.del > 0) && (
            <span className="claude-stats">
              {stats.add > 0 && <span className="add">+{stats.add}</span>}
              {stats.del > 0 && <span className="del">−{stats.del}</span>}
            </span>
          )}
          <ChevronRight size={13} className={`claude-tool-chev ${open ? "open" : ""}`} />
        </button>
        {file && (
          <button className="icon-btn xs" title={`Open ${file}`} aria-label={`Open ${file}`} onClick={() => void openPath(file)}><ExternalLink size={12} /></button>
        )}
      </div>
      {open && (
        <div className="claude-tool-body">
          {edit ? <PatchView hunks={edit.hunks} numbered={edit.numbered} /> : <ToolInput name={item.name} input={item.input} />}
          {item.result !== undefined && item.result !== "" && (!edit || item.status === "error") && <pre className={`claude-pre ${item.status === "error" ? "error" : ""}`}>{clip(item.result)}</pre>}
        </div>
      )}
    </div>
  );
}

/** What a tool was asked to do: the command, or the raw input. */
function ToolInput({ name, input }: { name: string; input: Record<string, unknown> }) {
  // The ask card re-renders on every keystroke in the composer; the line diff is not cheap.
  const edit = useMemo(() => (EDIT_TOOLS.has(name) ? editHunks(name, input) : null), [name, input]);
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  if ((name === "Bash" || name === "PowerShell") && str("command")) return <pre className="claude-pre cmd">{str("command")}</pre>;
  if (edit) return <PatchView hunks={edit.hunks} numbered={edit.numbered} />;
  return <pre className="claude-pre">{clip(JSON.stringify(input, null, 2))}</pre>;
}

/** A unified diff with old / new line numbers (numbers hidden for snippet diffs, which have none). */
export function PatchView({ hunks, numbered = true }: { hunks: Hunk[]; numbered?: boolean }) {
  return (
    <div className={`claude-patch ${numbered ? "" : "plain"}`} role="table" aria-label="Changes">
      {hunks.map((h, i) => {
        let o = h.oldStart;
        let n = h.newStart;
        return (
          <React.Fragment key={i}>
            {i > 0 && <div className="claude-hunk-gap" aria-hidden="true">⋯</div>}
            {h.lines.map((l, j) => {
              const sign = l[0];
              if (sign === "\\") return null; // "\ No newline at end of file"
              const cls = sign === "+" ? "add" : sign === "-" ? "del" : "ctx";
              const oldNo = sign === "+" ? "" : o++;
              const newNo = sign === "-" ? "" : n++;
              return (
                <div key={j} className={`pl ${cls}`} role="row">
                  {numbered && <span className="ln">{oldNo}</span>}
                  {numbered && <span className="ln">{newNo}</span>}
                  <span className="sg">{sign === " " ? "" : sign === "-" ? "−" : sign}</span>
                  <span className="tx">{l.slice(1)}</span>
                </div>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/** Claude's to-do list. The latest one is shown in full; earlier versions shrink to one line. */
function TodoCard({ item, full }: { item: Extract<Item, { kind: "tool" }>; full: boolean }) {
  const todos = latestTodos([item]) ?? [];
  const done = todos.filter((t) => t.status === "completed").length;
  if (!full) {
    return (
      <div className="claude-todos-line"><ListTodo size={13} /> Updated the task list · {done}/{todos.length} done</div>
    );
  }
  return (
    <div className="claude-todos">
      <div className="claude-todos-head"><ListTodo size={14} /> Tasks <span className="muted">{done}/{todos.length} done</span></div>
      <ul>
        {todos.map((t, i) => (
          <li key={i} className={t.status}>
            {t.status === "completed" ? <CircleCheck size={14} /> : t.status === "in_progress" ? <CircleDot size={14} /> : <Circle size={14} />}
            <span>{t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const VERBS: Record<string, string> = {
  Bash: "run a command",
  PowerShell: "run a PowerShell command",
  Write: "create or overwrite a file",
  Edit: "edit a file",
  MultiEdit: "edit a file",
  NotebookEdit: "edit a notebook",
  WebFetch: "fetch a web page",
  WebSearch: "search the web",
};

/** Take focus unless the user is typing a message. */
function useGrabFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!(document.activeElement instanceof HTMLTextAreaElement && document.activeElement.value)) ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}

function AskCard({ ask, cwd, onAnswer }: { ask: PermissionAsk; cwd: string; onAnswer: (d: "allow" | "allowSession" | "deny") => void }) {
  const allow = useGrabFocus<HTMLButtonElement>();
  const file = toolFile(ask.input);
  return (
    <div className="claude-ask" role="group" aria-label={`Permission: ${ask.tool}`}>
      <div className="claude-ask-head">
        <ShieldQuestion size={16} />
        <span>Claude wants to {VERBS[ask.tool] ?? `use ${ask.tool}`}</span>
      </div>
      {ask.description && <div className="claude-ask-desc">{ask.description}</div>}
      {file ? <div className="claude-ask-file">{toolSummary(ask.tool, ask.input, cwd)}</div> : null}
      <ToolInput name={ask.tool} input={ask.input} />
      <div className="claude-ask-actions">
        <button ref={allow} className="btn btn-primary" onClick={() => onAnswer("allow")}>Allow</button>
        <button className="btn" title="Don't ask again for this in this conversation" onClick={() => onAnswer("allowSession")}>Allow for this conversation</button>
        <button className="btn" onClick={() => onAnswer("deny")}>Deny</button>
      </div>
    </div>
  );
}

interface Question {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

/** Claude asks the user to choose (AskUserQuestion): options per question, or the user's own answer. */
function QuestionCard({ ask, onSubmit, onSkip }: { ask: PermissionAsk; onSubmit: (answers: Record<string, string>) => void; onSkip: () => void }) {
  const qs = (Array.isArray(ask.input.questions) ? ask.input.questions : []) as Question[];
  const [picks, setPicks] = useState<string[][]>(() => qs.map(() => []));
  const [own, setOwn] = useState<string[]>(() => qs.map(() => ""));
  const first = useGrabFocus<HTMLButtonElement>();
  const answerOf = (i: number) => own[i].trim() || picks[i].join(", ");
  const ready = qs.length > 0 && qs.every((_, i) => answerOf(i));
  const submit = (p = picks, o = own) => onSubmit(Object.fromEntries(qs.map((q, i) => [q.question, o[i].trim() || p[i].join(", ")])));
  const choose = (i: number, label: string, multi: boolean) => {
    const next = picks.map((p, k) => (k !== i ? p : multi ? (p.includes(label) ? p.filter((x) => x !== label) : [...p, label]) : [label]));
    const ownNext = own.map((t, k) => (k === i ? "" : t));
    setPicks(next);
    setOwn(ownNext);
    // One single-choice question: a click is the answer.
    if (qs.length === 1 && !multi) submit(next, ownNext);
  };
  return (
    <div className="claude-ask claude-question" role="group" aria-label="Claude has a question">
      <div className="claude-ask-head"><MessageCircleQuestion size={16} /><span>{qs.length === 1 ? "Claude has a question" : `Claude has ${qs.length} questions`}</span></div>
      {qs.map((q, i) => (
        <div key={i} className="claude-q">
          <div className="claude-q-text">
            {q.header && <span className="claude-chip">{q.header}</span>}
            <span>{q.question}</span>
            {q.multiSelect && <span className="muted">Choose any</span>}
          </div>
          <div className="claude-q-options" role={q.multiSelect ? "group" : "radiogroup"}>
            {q.options.map((o, j) => {
              const on = picks[i].includes(o.label);
              return (
                <button
                  key={j}
                  ref={i === 0 && j === 0 ? first : undefined}
                  role={q.multiSelect ? "checkbox" : "radio"}
                  aria-checked={on}
                  className={`claude-option ${on ? "on" : ""}`}
                  onClick={() => choose(i, o.label, !!q.multiSelect)}
                >
                  <span className="claude-option-label">{o.label}</span>
                  {o.description && <span className="claude-option-desc">{o.description}</span>}
                </button>
              );
            })}
          </div>
          <input
            className="input"
            placeholder="Or type your own answer"
            value={own[i]}
            aria-label={`Your own answer: ${q.question}`}
            onChange={(e) => {
              const v = e.target.value;
              setOwn(own.map((t, k) => (k === i ? v : t)));
              if (v) setPicks(picks.map((p, k) => (k === i ? [] : p)));
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && ready) { e.preventDefault(); submit(); } }}
          />
        </div>
      ))}
      <div className="claude-ask-actions">
        {!(qs.length === 1 && !qs[0].multiSelect) || own[0]?.trim() ? (
          <button className="btn btn-primary" disabled={!ready} onClick={() => submit()}>Send answer{qs.length > 1 ? "s" : ""}</button>
        ) : null}
        <button className="btn" title="Let Claude continue without an answer" onClick={onSkip}>Skip</button>
      </div>
    </div>
  );
}
