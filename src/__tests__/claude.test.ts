import { describe, expect, it } from "vitest";
import { addUser, emptyTranscript, ended, historyTranscript, latestTodos, lineDiff, patchStats, permissionResponse, questionResponse, reduce, relPath, toolSummary, userMessage, type PermissionAsk, type Transcript } from "../lib/claudeProtocol";
import { fitSize } from "../lib/claudeImages";
import { inline, parseMarkdown, plain } from "../lib/markdown";

/** Fold a list of stdout events (as Claude Code 2.1 prints them) into a transcript. */
const run = (events: Record<string, unknown>[], t: Transcript = emptyTranscript()) => events.reduce(reduce, t);
const last = (t: Transcript) => t.items[t.items.length - 1];
const se = (event: Record<string, unknown>) => ({ type: "stream_event", event, parent_tool_use_id: null });

describe("claude protocol", () => {
  it("takes the session id and model from init", () => {
    const t = run([{ type: "system", subtype: "init", session_id: "abc-1", model: "claude-haiku-5-5" }]);
    expect(t.sessionId).toBe("abc-1");
    expect(t.model).toBe("claude-haiku-5-5");
  });

  it("streams text deltas into one item, then replaces it with the final text", () => {
    let t = addUser(emptyTranscript(), "hi");
    t = run([
      se({ type: "message_start", message: { id: "m1" } }),
      se({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
      se({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
      se({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hel" } }),
      se({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "lo" } }),
    ], t);
    expect(t.items.map((i) => i.kind)).toEqual(["user", "text"]);
    expect(t.items[1]).toMatchObject({ text: "Hello", streaming: true });
    t = run([{ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Hello!" }] }, parent_tool_use_id: null }], t);
    expect(t.items[1]).toMatchObject({ text: "Hello!", streaming: false });
    expect(t.busy).toBe(true);
    t = run([{ type: "result", subtype: "success", is_error: false, duration_ms: 1200, session_id: "s" }], t);
    expect(t.busy).toBe(false);
    expect(last(t)).toMatchObject({ kind: "done", ok: true, ms: 1200 });
  });

  it("adds text that was not streamed (no partial messages)", () => {
    const t = run([{ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "Done." }] } }]);
    expect(t.items).toMatchObject([{ kind: "text", text: "Done.", streaming: false }]);
  });

  it("tracks a tool use from card to result", () => {
    let t = run([{ type: "assistant", message: { id: "m3", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "echo done" } }] } }]);
    expect(t.items[0]).toMatchObject({ kind: "tool", name: "Bash", status: "running" });
    t = run([{ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "done", is_error: false }] } }], t);
    expect(t.items[0]).toMatchObject({ status: "done", result: "done" });
    // The same tool use again (a repeated message) does not add a second card.
    t = run([{ type: "assistant", message: { id: "m3", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: {} }] } }], t);
    expect(t.items).toHaveLength(1);
  });

  it("marks failed tool results and joins block content", () => {
    let t = run([{ type: "assistant", message: { id: "m", content: [{ type: "tool_use", id: "x", name: "Read", input: { file_path: "C:\\a.txt" } }] } }]);
    t = run([{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "x", is_error: true, content: [{ type: "text", text: "no such file" }] }] } }], t);
    expect(t.items[0]).toMatchObject({ status: "error", result: "no such file" });
  });

  it("ignores sub-agent messages", () => {
    const t = run([{ type: "assistant", parent_tool_use_id: "task1", message: { id: "m", content: [{ type: "text", text: "inner" }] } }]);
    expect(t.items).toEqual([]);
  });

  it("queues permission asks and drops cancelled ones", () => {
    let t = run([{
      type: "control_request",
      request_id: "r1",
      request: { subtype: "can_use_tool", tool_name: "Bash", display_name: "Bash", input: { command: "rm -rf x" }, description: "Delete x", decision_reason: "This command requires approval", permission_suggestions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "rm -rf x" }], behavior: "allow", destination: "localSettings" }] },
    }]);
    expect(t.asks).toHaveLength(1);
    expect(t.asks[0]).toMatchObject({ requestId: "r1", tool: "Bash", description: "Delete x" });
    t = run([{ type: "control_cancel_request", request_id: "r1" }], t);
    expect(t.asks).toEqual([]);
  });

  it("notes an interrupt and ends the turn without a Done line", () => {
    let t = addUser(emptyTranscript(), "story");
    t = run([
      { type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } },
      { type: "result", subtype: "error_during_execution", is_error: true, session_id: "s" },
    ], t);
    expect(t.busy).toBe(false);
    expect(last(t)).toMatchObject({ kind: "note", text: "Stopped." });
  });

  it("shows why a turn failed", () => {
    const t = run([{ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" }]);
    expect(last(t)).toMatchObject({ kind: "done", ok: false, text: "Not logged in · Please run /login" });
  });

  it("settles running tools when the process ends", () => {
    let t = run([{ type: "assistant", message: { id: "m", content: [{ type: "tool_use", id: "a", name: "Bash", input: {} }] } }]);
    t = ended(t, "Claude Code exited");
    expect(t.items[0]).toMatchObject({ status: "error" });
    expect(last(t)).toMatchObject({ kind: "note", tone: "error" });
  });
});

describe("claude messages", () => {
  const ask: PermissionAsk = { requestId: "r9", tool: "Bash", input: { command: "x" }, suggestions: [{ type: "addRules", destination: "localSettings" }] };

  it("allows with the original input; Allow for Session scopes the suggested rules to the session", () => {
    expect(JSON.parse(permissionResponse(ask, "allow"))).toEqual({ type: "control_response", response: { subtype: "success", request_id: "r9", response: { behavior: "allow", updatedInput: { command: "x" } } } });
    const s = JSON.parse(permissionResponse(ask, "allowSession")).response.response;
    expect(s.updatedPermissions).toEqual([{ type: "addRules", destination: "session" }]);
    expect(JSON.parse(permissionResponse(ask, "deny")).response.response.behavior).toBe("deny");
  });

  it("puts images before the text", () => {
    const m = JSON.parse(userMessage("what is this?", [{ mediaType: "image/png", data: "AAAA" }]));
    expect(m.type).toBe("user");
    expect(m.message.content.map((c: { type: string }) => c.type)).toEqual(["image", "text"]);
  });

  it("summarises tool uses relative to the folder", () => {
    expect(toolSummary("Edit", { file_path: "C:\\proj\\src\\a.ts" }, "C:\\proj")).toBe("src\\a.ts");
    expect(toolSummary("Bash", { command: "npm test" })).toBe("npm test");
    expect(toolSummary("TodoWrite", { todos: [1, 2] })).toBe("2 items");
  });
});

describe("markdown", () => {
  it("keeps a # that ends a heading word and strips a spaced closing run", () => {
    expect(parseMarkdown("## Using C#")[0]).toMatchObject({ t: "h", level: 2, c: [{ t: "text", v: "Using C#" }] });
    expect(parseMarkdown("## Title ##")[0]).toMatchObject({ t: "h", level: 2, c: [{ t: "text", v: "Title" }] });
  });

  it("links with spaces in <...> and balanced parentheses", () => {
    expect(inline("[n](<docs/My Notes.md>)")[0]).toMatchObject({ t: "link", href: "docs/My Notes.md" });
    expect(inline("[w](https://en.wikipedia.org/wiki/Foo_(bar))")[0]).toMatchObject({ t: "link", href: "https://en.wikipedia.org/wiki/Foo_(bar)" });
    expect(inline("[a](src/a.ts:12) after")[0]).toMatchObject({ t: "link", href: "src/a.ts:12" });
  });

  it("parses headings, paragraphs, code fences and rules", () => {
    const b = parseMarkdown("# Title\n\nSome *text* here.\n\n```ts\nconst a = 1;\n```\n\n---");
    expect(b.map((x) => x.t)).toEqual(["h", "p", "code", "hr"]);
    expect(b[2]).toMatchObject({ lang: "ts", v: "const a = 1;", open: false });
  });

  it("keeps an unterminated fence open (still streaming)", () => {
    expect(parseMarkdown("```js\nlet x")[0]).toMatchObject({ t: "code", open: true, v: "let x" });
  });

  it("parses nested lists", () => {
    const [l] = parseMarkdown("- one\n- two\n  - inner\n- three");
    expect(l).toMatchObject({ t: "list", ordered: false });
    if (l.t !== "list") throw new Error();
    expect(l.items).toHaveLength(3);
    expect(l.items[1].map((x) => x.t)).toEqual(["p", "list"]);
    const [o] = parseMarkdown("3. a\n4. b");
    expect(o).toMatchObject({ t: "list", ordered: true, start: 3 });
  });

  it("parses tables with alignment and escaped pipes", () => {
    const [t] = parseMarkdown("| a | b |\n|:--|--:|\n| `x|y` | 2 \\| 3 |");
    expect(t).toMatchObject({ t: "table", align: ["left", "right"] });
    if (t.t !== "table") throw new Error();
    expect(plain(t.rows[0][0])).toBe("x|y");
    expect(plain(t.rows[0][1])).toBe("2 | 3");
  });

  it("parses inline marks and links, leaving raw HTML as text", () => {
    expect(inline("a **b** _c_ `d` ~~e~~").map((n) => n.t)).toEqual(["text", "strong", "text", "em", "text", "code", "text", "del"]);
    expect(inline("see [docs](https://x.io/a) or https://y.io.")).toMatchObject([{ t: "text" }, { t: "link", href: "https://x.io/a" }, { t: "text" }, { t: "link", href: "https://y.io" }, { t: "text", v: "." }]);
    expect(inline("<img src=x onerror=alert(1)>")).toEqual([{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
    expect(inline("snake_case_name")).toEqual([{ t: "text", v: "snake_case_name" }]);
  });
});

describe("claude phase 2 helpers", () => {
  it("attaches an edit's structuredPatch to its card", () => {
    let t = run([{ type: "assistant", message: { id: "m", content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: "C:\\p\\a.js", old_string: "a - b", new_string: "a + b" } }] } }]);
    const hunk = { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [" x", "-  return a - b;", "+  return a + b;", " }"] };
    t = run([{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "e1", content: "ok" }] }, tool_use_result: { structuredPatch: [hunk] } }], t);
    expect(t.items[0]).toMatchObject({ status: "done", patch: [hunk] });
    expect(patchStats([hunk])).toEqual({ add: 1, del: 1 });
  });

  it("diffs lines with a longest common subsequence", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc").lines).toEqual([" a", "-b", "+B", " c"]);
    expect(lineDiff("", "x").lines).toEqual(["-", "+x"]);
    expect(lineDiff("same", "same").lines).toEqual([" same"]);
    const big = Array.from({ length: 1000 }, (_, i) => String(i)).join("\n");
    const d = lineDiff(big, `${big}\nnew`);
    expect(patchStats([d])).toEqual({ add: 1, del: 0 });
  });

  it("finds the latest to-do list", () => {
    const t = run([
      { type: "assistant", message: { id: "1", content: [{ type: "tool_use", id: "t1", name: "TodoWrite", input: { todos: [{ content: "A", status: "pending" }] } }] } },
      { type: "assistant", message: { id: "2", content: [{ type: "tool_use", id: "t2", name: "TodoWrite", input: { todos: [{ content: "A", status: "completed" }, { content: "B", status: "in_progress", activeForm: "Doing B" }, { content: "C", status: "weird" }] } }] } },
    ]);
    expect(latestTodos(t.items)).toEqual([
      { content: "A", status: "completed", activeForm: undefined },
      { content: "B", status: "in_progress", activeForm: "Doing B" },
      { content: "C", status: "pending", activeForm: undefined },
    ]);
    expect(latestTodos([])).toBeNull();
  });

  it("answers AskUserQuestion by allowing it with the answers added", () => {
    const ask: PermissionAsk = { requestId: "q1", tool: "AskUserQuestion", input: { questions: [{ question: "Colour?", options: [] }] }, suggestions: [] };
    const r = JSON.parse(questionResponse(ask, { "Colour?": "Red" })).response;
    expect(r.request_id).toBe("q1");
    expect(r.response).toEqual({ behavior: "allow", updatedInput: { questions: [{ question: "Colour?", options: [] }], answers: { "Colour?": "Red" } } });
    expect(toolSummary("AskUserQuestion", ask.input)).toBe("Colour?");
  });

  it("keeps image thumbnails on the user's message", () => {
    const t = addUser(emptyTranscript(), "look", ["data:image/png;base64,AA"]);
    expect(t.items[0]).toMatchObject({ kind: "user", images: ["data:image/png;base64,AA"] });
  });

  it("scales pictures to at most 2000 px on the long side", () => {
    expect(fitSize(3840, 2160)).toEqual({ w: 2000, h: 1125 });
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitSize(100, 9000)).toEqual({ w: 22, h: 2000 });
  });

  it("makes paths relative to the folder", () => {
    expect(relPath("C:\\Proj\\src\\a.ts", "c:\\proj\\")).toBe("src/a.ts");
    expect(relPath("C:\\Other\\a.ts", "C:\\Proj")).toBe("C:\\Other\\a.ts");
    expect(relPath("C:\\Project2\\a.ts", "C:\\Proj")).toBe("C:\\Project2\\a.ts");
  });
});

describe("claude history", () => {
  it("rebuilds a conversation from Claude Code's transcript lines", () => {
    const lines = [
      { type: "user", message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }, { type: "text", text: "What colour?" }] } },
      { type: "user", isMeta: true, message: { role: "user", content: [{ type: "text", text: "[Image: source: x]" }] } },
      { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Red" }] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Fix it" }] } },
      { type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: "C:\\p\\a.js" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "e1", content: "ok" }] }, toolUseResult: { structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] }] } },
      { type: "assistant", isSidechain: true, message: { id: "s", content: [{ type: "text", text: "sub-agent" }] } },
      { type: "user", message: { content: [{ type: "text", text: "[Request interrupted by user]" }] } },
    ].map((l) => JSON.stringify(l));
    const t = historyTranscript([...lines, "not json"], "sess-1");
    expect(t.sessionId).toBe("sess-1");
    expect(t.busy).toBe(false);
    expect(t.items.map((i) => i.kind)).toEqual(["user", "text", "user", "tool", "note"]);
    expect(t.items[0]).toMatchObject({ text: "What colour?", images: ["data:image/png;base64,AAAA"] });
    expect(t.items[3]).toMatchObject({ status: "done", patch: [{ lines: ["-a", "+b"] }] });
  });
});
