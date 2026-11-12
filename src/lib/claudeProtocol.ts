/**
 * Claude Code's stream-json protocol (`claude -p --input-format stream-json --output-format
 * stream-json`), as plain data: messages we write to its stdin, and `reduce`, which folds each line it
 * prints into a transcript. Pure, so it is unit-tested; the session plumbing is in claude.ts.
 */

export type ToolStatus = "running" | "done" | "error";

/** One hunk of a unified diff (Claude Code's `structuredPatch`): lines start with " ", "-" or "+". */
export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export type Item =
  /** `images`: data: URLs of the pictures sent with the message (thumbnails). */
  | { kind: "user"; key: string; text: string; images?: string[] }
  | { kind: "text"; key: string; text: string; streaming: boolean }
  | { kind: "tool"; key: string; id: string; name: string; input: Record<string, unknown>; status: ToolStatus; result?: string; patch?: Hunk[] }
  | { kind: "note"; key: string; text: string; tone: "info" | "error" }
  | { kind: "done"; key: string; ms: number; ok: boolean; text?: string };

/** A tool use waiting for the user's Allow / Deny. */
export interface PermissionAsk {
  requestId: string;
  tool: string;
  input: Record<string, unknown>;
  description?: string;
  reason?: string;
  /** Rules Claude Code proposes for "always allow"; sent back (scoped to the session) by Allow for Session. */
  suggestions: unknown[];
  toolUseId?: string;
}

export interface Transcript {
  items: Item[];
  asks: PermissionAsk[];
  sessionId: string | null;
  model: string | null;
  /** A turn is running (from sending until its `result`). */
  busy: boolean;
  /** Content block being streamed: message id + block index → item key. */
  live: Record<string, string>;
  liveMsg: string | null;
  seq: number;
}

export const emptyTranscript = (): Transcript => ({ items: [], asks: [], sessionId: null, model: null, busy: false, live: {}, liveMsg: null, seq: 0 });

// ---------- messages to Claude Code ----------

export interface ImagePart {
  mediaType: string;
  /** Base64 without the data: prefix. */
  data: string;
}

export function userMessage(text: string, images: ImagePart[] = []): string {
  const content: unknown[] = images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } }));
  if (text) content.push({ type: "text", text });
  return JSON.stringify({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" });
}

export function interruptRequest(requestId: string): string {
  return JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "interrupt" } });
}

export type Decision = "allow" | "allowSession" | "deny";

/** Answers to AskUserQuestion: question text → chosen label(s) (several joined with ", ") or the user's own words. */
export function questionResponse(ask: PermissionAsk, answers: Record<string, string>): string {
  const response = { behavior: "allow", updatedInput: { ...ask.input, answers } };
  return JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: ask.requestId, response } });
}

export function permissionResponse(ask: PermissionAsk, decision: Decision): string {
  const response =
    decision === "deny"
      ? { behavior: "deny", message: "The user declined this action in Quarry." }
      : {
          behavior: "allow",
          updatedInput: ask.input,
          ...(decision === "allowSession"
            ? { updatedPermissions: ask.suggestions.map((s) => (s && typeof s === "object" ? { ...(s as object), destination: "session" } : s)) }
            : {}),
        };
  return JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: ask.requestId, response } });
}

// ---------- events from Claude Code ----------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Text of a tool result's `content` (a string, or blocks of which only text is kept). */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const o = obj(b);
        if (o.type === "text") return str(o.text) ?? "";
        if (o.type === "image") return "[image]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

type Unkeyed<I> = I extends unknown ? Omit<I, "key"> & { key?: string } : never;
type NewItem = Unkeyed<Item>;

function push(t: Transcript, item: NewItem): Transcript {
  const key = item.key ?? `i${t.seq}`;
  return { ...t, seq: t.seq + 1, items: [...t.items, { ...item, key } as Item] };
}

function patchItem(t: Transcript, key: string, f: (i: Item) => Item): Transcript {
  return { ...t, items: t.items.map((i) => (i.key === key ? f(i) : i)) };
}

/** The user's own message, shown at once (Claude Code does not echo it). */
export function addUser(t: Transcript, text: string, images: string[] = []): Transcript {
  return { ...push(t, { kind: "user", text, ...(images.length ? { images } : {}) }), busy: true };
}

export function addNote(t: Transcript, text: string, tone: "info" | "error" = "info"): Transcript {
  return push(t, { kind: "note", text, tone });
}

/** The process ended: nothing is running or waiting any more. */
export function ended(t: Transcript, note?: string): Transcript {
  const items = t.items.map((i) => (i.kind === "tool" && i.status === "running" ? { ...i, status: "error" as const } : i.kind === "text" && i.streaming ? { ...i, streaming: false } : i));
  const next = { ...t, items, busy: false, asks: [], live: {}, liveMsg: null };
  return note ? addNote(next, note, "error") : next;
}

/** Fold one stdout line (already parsed) into the transcript. Unknown events are ignored. */
export function reduce(t: Transcript, m: Json): Transcript {
  // Messages from inside a sub-agent (Task tool) are not shown; the Task card stands for them.
  if (m.parent_tool_use_id) return t;
  switch (m.type) {
    case "system":
      if (m.subtype === "init") return { ...t, sessionId: str(m.session_id) ?? t.sessionId, model: str(m.model) ?? t.model };
      return t;
    case "stream_event":
      return streamEvent(t, obj(m.event));
    case "assistant":
      return assistant(t, obj(m.message));
    case "user":
      return toolResults(t, obj(m.message), obj(m.tool_use_result));
    case "control_request":
      return controlRequest(t, m);
    case "control_cancel_request": {
      const id = str(m.request_id);
      return { ...t, asks: t.asks.filter((a) => a.requestId !== id) };
    }
    case "result":
      return result(t, m);
    default:
      return t;
  }
}

function streamEvent(t: Transcript, e: Json): Transcript {
  switch (e.type) {
    case "message_start":
      return { ...t, liveMsg: str(obj(e.message).id) ?? null };
    case "content_block_start": {
      const block = obj(e.content_block);
      if (block.type !== "text" || !t.liveMsg) return t;
      const liveKey = `${t.liveMsg}:${e.index}`;
      const key = `t${t.seq}`;
      const next = push(t, { kind: "text", key, text: str(block.text) ?? "", streaming: true });
      return { ...next, live: { ...next.live, [liveKey]: key } };
    }
    case "content_block_delta": {
      const d = obj(e.delta);
      if (d.type !== "text_delta" || !t.liveMsg) return t;
      const key = t.live[`${t.liveMsg}:${e.index}`];
      if (!key) return t;
      const add = str(d.text) ?? "";
      return patchItem(t, key, (i) => (i.kind === "text" ? { ...i, text: i.text + add } : i));
    }
    default:
      return t;
  }
}

/** A complete assistant message (Claude Code sends one per content block). Text replaces what was
 *  streamed for it; tool uses become cards. */
function assistant(t: Transcript, msg: Json): Transcript {
  const id = str(msg.id) ?? "";
  const content = Array.isArray(msg.content) ? msg.content : [];
  let next = t;
  for (const raw of content) {
    const b = obj(raw);
    if (b.type === "text") {
      const text = str(b.text) ?? "";
      // The streamed item for this message that is still open, if any.
      const liveKey = Object.entries(next.live).find(([k, key]) => k.startsWith(`${id}:`) && next.items.some((i) => i.key === key && i.kind === "text" && i.streaming))?.[1];
      if (liveKey) next = patchItem(next, liveKey, (i) => (i.kind === "text" ? { ...i, text, streaming: false } : i));
      else if (text.trim()) next = push(next, { kind: "text", text, streaming: false });
    } else if (b.type === "tool_use") {
      const toolId = str(b.id) ?? "";
      if (next.items.some((i) => i.kind === "tool" && i.id === toolId)) continue;
      next = push(next, { kind: "tool", id: toolId, name: str(b.name) ?? "tool", input: obj(b.input), status: "running" });
    }
  }
  return next;
}

/** Tool results; `extra` is Claude Code's `tool_use_result` (an edit's `structuredPatch`). */
function toolResults(t: Transcript, msg: Json, extra: Json = {}): Transcript {
  const content = msg.content;
  if (typeof content === "string") {
    return content.startsWith("[Request interrupted") ? addNote(t, "Stopped.") : t;
  }
  if (!Array.isArray(content)) return t;
  let next = t;
  for (const raw of content) {
    const b = obj(raw);
    if (b.type === "tool_result") {
      const id = str(b.tool_use_id);
      const tool = next.items.find((i) => i.kind === "tool" && i.id === id);
      if (!tool) continue;
      const status: ToolStatus = b.is_error ? "error" : "done";
      const patch = Array.isArray(extra.structuredPatch) ? (extra.structuredPatch as Hunk[]) : undefined;
      next = patchItem(next, tool.key, (i) => (i.kind === "tool" ? { ...i, status, result: resultText(b.content), ...(patch && content.length === 1 ? { patch } : {}) } : i));
    } else if (b.type === "text" && typeof b.text === "string" && b.text.startsWith("[Request interrupted")) {
      next = addNote(next, "Stopped.");
    }
  }
  return next;
}

function controlRequest(t: Transcript, m: Json): Transcript {
  const r = obj(m.request);
  const requestId = str(m.request_id);
  if (r.subtype !== "can_use_tool" || !requestId) return t;
  const ask: PermissionAsk = {
    requestId,
    tool: str(r.display_name) ?? str(r.tool_name) ?? "tool",
    input: obj(r.input),
    description: str(r.description),
    reason: str(r.decision_reason),
    suggestions: Array.isArray(r.permission_suggestions) ? r.permission_suggestions : [],
    toolUseId: str(r.tool_use_id),
  };
  return { ...t, asks: [...t.asks.filter((a) => a.requestId !== requestId), ask] };
}

function result(t: Transcript, m: Json): Transcript {
  const ok = m.subtype === "success" && !m.is_error;
  const interrupted = m.subtype === "error_during_execution";
  const ms = typeof m.duration_ms === "number" ? m.duration_ms : 0;
  const settled = ended(t);
  if (interrupted) return { ...settled, sessionId: str(m.session_id) ?? t.sessionId };
  // A failed turn's reason (not logged in, usage limit, ...) is only in `result`.
  const text = !ok ? str(m.result) ?? (Array.isArray(m.errors) ? m.errors.map(String).join("\n") : undefined) : undefined;
  return { ...push(settled, { kind: "done", ms, ok, ...(text ? { text } : {}) }), sessionId: str(m.session_id) ?? t.sessionId };
}

// ---------- history ----------

/**
 * A past conversation from Claude Code's JSONL transcript (the user / assistant lines Rust's
 * `claude_history` returns), as a transcript: prompts (with their pictures), replies and tool cards.
 */
export function historyTranscript(lines: string[], sessionId: string): Transcript {
  let t: Transcript = { ...emptyTranscript(), sessionId };
  for (const line of lines) {
    let m: Json;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.isSidechain || m.isMeta) continue;
    const msg = obj(m.message);
    if (m.type === "assistant") {
      t = reduce(t, { type: "assistant", message: msg });
      continue;
    }
    if (m.type !== "user") continue;
    const content = msg.content;
    const blocks = Array.isArray(content) ? content.map(obj) : typeof content === "string" ? [{ type: "text", text: content }] : [];
    if (blocks.some((b) => b.type === "tool_result")) {
      t = reduce(t, { type: "user", message: msg, tool_use_result: m.toolUseResult });
      continue;
    }
    const text = blocks.filter((b) => b.type === "text").map((b) => str(b.text) ?? "").filter((s) => !s.startsWith("<")).join("\n").trim();
    if (text.startsWith("[Request interrupted")) {
      t = addNote(t, "Stopped.");
      continue;
    }
    const images = blocks
      .filter((b) => b.type === "image")
      .map((b) => obj(b.source))
      .filter((s) => s.type === "base64" && typeof s.data === "string")
      .map((s) => `data:${str(s.media_type) ?? "image/png"};base64,${s.data}`);
    if (text || images.length) t = addUser(t, text, images);
  }
  return { ...ended(t), sessionId };
}

// ---------- display helpers ----------

/** One-line summary of a tool use for its card ("npm test", "src/app.ts", ...). */
export function toolSummary(name: string, input: Record<string, unknown>, cwd?: string): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const rel = (p: string) => (cwd && p.toLowerCase().startsWith(cwd.toLowerCase()) ? p.slice(cwd.length).replace(/^[\\/]/, "") || p : p);
  switch (name) {
    case "Bash":
    case "PowerShell":
      return s("command");
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return rel(s("file_path") || s("notebook_path"));
    case "Glob":
      return s("pattern");
    case "Grep":
      return s("pattern") + (s("path") ? `  in ${rel(s("path"))}` : "");
    case "WebFetch":
      return s("url");
    case "WebSearch":
      return s("query");
    case "Task":
    case "Agent":
      return s("description");
    case "AskUserQuestion": {
      const q = Array.isArray(input.questions) ? obj(input.questions[0]) : {};
      return str(q.question) ?? "";
    }
    case "TodoWrite": {
      const todos = Array.isArray(input.todos) ? input.todos.length : 0;
      return `${todos} item${todos === 1 ? "" : "s"}`;
    }
    default: {
      const first = Object.values(input).find((v) => typeof v === "string");
      return typeof first === "string" ? first : "";
    }
  }
}

/** `path` relative to `cwd` when it is inside it (forward slashes, as Claude writes them). */
export function relPath(path: string, cwd: string): string {
  const base = cwd.replace(/[\\/]+$/, "").toLowerCase();
  const p = path.toLowerCase();
  if (p.startsWith(`${base}\\`) || p.startsWith(`${base}/`)) return path.slice(base.length + 1).replace(/\\/g, "/");
  return path;
}

/** The file a tool works on, when it has one (cards make it clickable). */
export function toolFile(input: Record<string, unknown>): string | null {
  const p = input.file_path ?? input.notebook_path;
  return typeof p === "string" && p ? p : null;
}

/** The to-do list from Claude's latest TodoWrite, or null when it has not made one. */
export function latestTodos(items: Item[]): Todo[] | null {
  for (let k = items.length - 1; k >= 0; k--) {
    const i = items[k];
    if (i.kind === "tool" && i.name === "TodoWrite" && Array.isArray(i.input.todos)) {
      return (i.input.todos as unknown[]).map((x) => {
        const o = obj(x);
        const status = o.status === "completed" || o.status === "in_progress" ? o.status : "pending";
        return { content: str(o.content) ?? "", status, activeForm: str(o.activeForm) };
      });
    }
  }
  return null;
}

/** Lines added and removed by a patch. */
export function patchStats(hunks: Hunk[]): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const h of hunks) for (const l of h.lines) l.startsWith("+") ? add++ : l.startsWith("-") ? del++ : 0;
  return { add, del };
}

const DIFF_CELLS = 400_000;

/**
 * A line diff of `before` → `after` as one hunk (for an edit that has not happened yet, which has
 * no structuredPatch). Lines shared at the start and end are matched first; the rest by longest
 * common subsequence, falling back to "all removed, all added" when that middle is very large.
 * Line numbers count from 1 within the snippet.
 */
export function lineDiff(before: string, after: string): Hunk {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  const lines: string[] = a.slice(0, head).map((l) => ` ${l}`);
  if (am.length * bm.length > DIFF_CELLS) {
    lines.push(...am.map((l) => `-${l}`), ...bm.map((l) => `+${l}`));
  } else {
    // lcs[i][j] = length of the LCS of am[i..] and bm[j..].
    const lcs: Uint32Array[] = Array.from({ length: am.length + 1 }, () => new Uint32Array(bm.length + 1));
    for (let i = am.length - 1; i >= 0; i--) {
      for (let j = bm.length - 1; j >= 0; j--) lcs[i][j] = am[i] === bm[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
    let i = 0;
    let j = 0;
    while (i < am.length || j < bm.length) {
      if (i < am.length && j < bm.length && am[i] === bm[j]) {
        lines.push(` ${am[i++]}`);
        j++;
        // Removals before additions (unified-diff order).
      } else if (i < am.length && (j >= bm.length || lcs[i + 1][j] >= lcs[i][j + 1])) lines.push(`-${am[i++]}`);
      else lines.push(`+${bm[j++]}`);
    }
  }
  lines.push(...a.slice(a.length - tail).map((l) => ` ${l}`));
  return { oldStart: 1, oldLines: a.length, newStart: 1, newLines: b.length, lines };
}
