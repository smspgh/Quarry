/**
 * Code intelligence through language servers (`@codemirror/lsp-client`). One server process per
 * (server, project root), started on first use by src-tauri/src/lsp.rs. Text tabs share Quarry's
 * single EditorView (editor/manager.ts swaps their states), so this file has its own Workspace: a
 * file stays open on the server while its tab is open, not just while it is on screen, and
 * diagnostics are kept for every open file (status bar counts, Problems panel).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChangeSet, Text, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  findReferences,
  hoverTooltips,
  jumpToDefinition,
  jumpToImplementation,
  jumpToTypeDefinition,
  LSPClient,
  LSPPlugin,
  formatDocument as lspFormat,
  renameSymbol,
  serverCompletion,
  serverDiagnostics,
  showSignatureHelp,
  signatureHelp,
  Workspace,
  type Transport,
  type WorkspaceFile,
} from "@codemirror/lsp-client";
import { create } from "zustand";
import { editor } from "../editor/manager";
import { compartments } from "../editor/cmSetup";
import { autocompletion } from "@codemirror/autocomplete";
import { languageIdOf, offsetOf, pathToUri, sanitizeHTML, serverFor, severityOf, splitCommand, uriKey, uriToPath, SERVERS, type ServerDef, type Severity } from "./lspServers";
import { useStore, type Doc } from "./store";

// ---------- state shown in the UI ----------

export type ServerStatus = "starting" | "ready" | "missing" | "failed" | "stopped";

export interface Problem {
  from: number;
  to: number;
  line: number;
  col: number;
  severity: Severity;
  message: string;
  source?: string;
}

interface LspState {
  /** Per server + root key. */
  servers: Record<string, { def: string; root: string; status: ServerStatus; error?: string; progress?: string }>;
  /** Server key each text tab uses. */
  docServer: Record<string, string>;
  /** Diagnostics per text tab. */
  problems: Record<string, Problem[]>;
}

export const useLsp = create<LspState>(() => ({ servers: {}, docServer: {}, problems: {} }));

const patchServer = (key: string, p: Partial<LspState["servers"][string]>) =>
  useLsp.setState((s) => (s.servers[key] ? { servers: { ...s.servers, [key]: { ...s.servers[key], ...p } } } : s));

// ---------- workspace ----------

class QuarryFile implements WorkspaceFile {
  constructor(public uri: string, public languageId: string, public version: number, public doc: Text, public docId: string) {}
  getView(): EditorView | null {
    return editor.viewOf(this.docId);
  }
}

/** Open files on one server: a tab's file stays open on the server until the tab closes. */
class QuarryWorkspace extends Workspace {
  files: QuarryFile[] = [];

  getFile(uri: string): QuarryFile | null {
    const k = uriKey(uri);
    return this.files.find((f) => uriKey(f.uri) === k) ?? null;
  }

  /** Changes since the last sync: the editor plugin's own record while the tab is on screen, else
   *  (or when the two disagree) the whole text. */
  syncFiles() {
    const out = [];
    for (const file of this.files) {
      const state = editor.stateOf(file.docId);
      if (!state || state.doc === file.doc || state.doc.eq(file.doc)) {
        if (state) file.doc = state.doc;
        continue;
      }
      const view = file.getView();
      const plugin = view ? LSPPlugin.get(view) : null;
      const mine = plugin && uriKey(plugin.uri) === uriKey(file.uri) ? plugin : null;
      let changes: ChangeSet;
      if (mine && mine.syncedDoc === file.doc && mine.unsyncedChanges.length === file.doc.length && mine.unsyncedChanges.newLength === state.doc.length) {
        changes = mine.unsyncedChanges;
      } else {
        changes = ChangeSet.of({ from: 0, to: file.doc.length, insert: state.doc }, file.doc.length);
      }
      mine?.clear();
      out.push({ file, prevDoc: file.doc, changes });
      file.doc = state.doc;
      file.version++;
    }
    if (out.length) this.pullSoon();
    return out;
  }

  openFile(uri: string, languageId: string, view: EditorView) {
    if (this.getFile(uri)) return;
    const docId = docForUri(uri) ?? editor.currentDocId;
    if (!docId) return;
    const file = new QuarryFile(uri, languageId, 1, view.state.doc, docId);
    this.files.push(file);
    this.client.didOpen(file);
    this.pullSoon();
  }

  /** Open a tab's file on the server when the tab attaches, shown or not: rename edits and
   *  problems cover every open file, not only the tabs looked at since start-up. */
  openDoc(docId: string, uri: string, languageId: string) {
    void this.client.initializing.then(
      () => {
        const state = editor.stateOf(docId);
        if (!state || this.getFile(uri) || docUris.get(docId) !== uri || !this.client.connected) return;
        const file = new QuarryFile(uri, languageId, 1, state.doc, docId);
        this.files.push(file);
        this.client.didOpen(file);
        this.pullSoon();
      },
      () => {},
    );
  }

  private pullTimer = 0;

  /** Servers with pull diagnostics (TypeScript 7) are asked for every open file's problems after a
   *  change settles: an edit in one file can change the problems in another. */
  pullSoon(delay = 400) {
    window.clearTimeout(this.pullTimer);
    this.pullTimer = window.setTimeout(() => void this.pull(), delay);
  }

  private async pull() {
    const client = this.client;
    await client.initializing.catch(() => null);
    if (!client.connected || !client.serverCapabilities?.diagnosticProvider) return;
    client.sync();
    for (const file of this.files) {
      client
        .request<{ textDocument: { uri: string } }, { kind: string; items?: LspDiagnostic[] }>("textDocument/diagnostic", { textDocument: { uri: file.uri } })
        .then((r) => {
          if (r?.kind === "full" && this.files.includes(file)) applyDiagnostics(file.docId, r.items ?? []);
        })
        .catch(() => {});
    }
  }

  /** The plugin goes away whenever its tab leaves the screen; the file stays open (see closeDoc). */
  closeFile() {}

  closeDoc(docId: string) {
    const file = this.files.find((f) => f.docId === docId);
    if (!file) return;
    this.files = this.files.filter((f) => f !== file);
    if (this.client.connected) this.client.didClose(file.uri);
  }

  /** Files the server mentions that are not open (references): read from disk, not opened. */
  async requestFile(uri: string): Promise<WorkspaceFile | null> {
    const open = this.getFile(uri);
    if (open) return open;
    try {
      const { fs } = await import("./ipc");
      const f = await fs.readText(uriToPath(uri));
      return { uri, languageId: languageIdOf(uri), version: 0, doc: Text.of(f.content.split(/\r\n?|\n/)), getView: () => null };
    } catch {
      return null;
    }
  }

  /** Edits from the server (rename) to an open file, on screen or not. */
  updateFile(uri: string, update: TransactionSpec) {
    const file = this.getFile(uri);
    if (file) editor.dispatchTo(file.docId, update);
  }

  /** Show another file (Go to Definition): open it in a tab and return the editor once it has the text. */
  async displayFile(uri: string): Promise<EditorView | null> {
    const { openPath } = await import("./actions");
    const doc = await openPath(uriToPath(uri));
    if (!doc) return null; // openPath said why
    if (doc.kind !== "text") {
      useStore.getState().toast(`${doc.name} opened in large-file mode, which has no code navigation; use Go to Line to reach the definition.`, "info", 6000);
      return null;
    }
    // The tab becomes the editor's document once React has shown it (an empty file is fine too).
    for (let i = 0; i < 120 && editor.currentDocId !== doc.id; i++) await new Promise((r) => setTimeout(r, 25));
    if (editor.currentDocId === doc.id) return editor.view;
    useStore.getState().toast(`Opened ${doc.name}, but couldn't move to the definition in time.`, "info", 4000);
    return null;
  }
}

// ---------- servers ----------

interface Running {
  key: string;
  def: ServerDef;
  root: string;
  client: LSPClient;
  procId: number | null;
  workspace: () => QuarryWorkspace;
}

const running = new Map<string, Running>();
const procToKey = new Map<number, string>();
/** Text tab → its file's URI (tabs with a server only). */
const docUris = new Map<string, string>();

function docForUri(uri: string): string | null {
  const k = uriKey(uri);
  for (const [docId, u] of docUris) if (uriKey(u) === k) return docId;
  return null;
}

/** Requests from the server the client library doesn't answer, answered here so servers don't wait. */
function answerServerRequest(root: string, msg: { id: unknown; method: string; params?: { items?: unknown[] } }): unknown | undefined {
  switch (msg.method) {
    case "workspace/configuration":
      return (msg.params?.items ?? []).map(() => null);
    case "workspace/workspaceFolders":
      return [{ uri: pathToUri(root), name: root.split(/[\\/]/).pop() }];
    case "workspace/diagnostic/refresh":
      for (const r of running.values()) if (r.root === root) r.workspace().pullSoon(50);
      return null;
    case "client/registerCapability":
    case "client/unregisterCapability":
    case "window/workDoneProgress/create":
      return null;
    case "window/showMessageRequest":
      return null;
    default:
      return undefined;
  }
}

function transportFor(key: string, root: string, procId: () => number | null): Transport {
  const handlers = new Set<(v: string) => void>();
  const send = (message: string) => {
    const id = procId();
    if (id === null) throw new Error("language server is not running");
    void invoke("lsp_send", { id, msg: message }).catch(() => {});
  };
  incoming.set(key, (raw) => {
    try {
      const m = JSON.parse(raw);
      if (m && typeof m === "object" && "id" in m && "method" in m) {
        const result = answerServerRequest(root, m);
        if (result !== undefined) {
          send(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
          return;
        }
      }
    } catch {
      return;
    }
    for (const h of handlers) h(raw);
  });
  return { send, subscribe: (h) => void handlers.add(h), unsubscribe: (h) => void handlers.delete(h) };
}

const incoming = new Map<string, (raw: string) => void>();

/** Make the per-tab completion setting follow LSP: suggestions while typing only where a server answers. */
const completionFor = (lsp: boolean) => autocompletion({ activateOnTyping: lsp });

interface Launch {
  command: string;
  args: string[];
  init?: Record<string, unknown>;
}

/** The program to run: the user's command from Settings, else the default; TypeScript depends on
 *  the TypeScript version installed (see `lsp_typescript` in lsp.rs). Null: not installed. */
async function launchOf(def: ServerDef, root: string): Promise<Launch | null> {
  const override = useStore.getState().settings.lspCommands[def.id]?.trim();
  if (override) {
    const [command, ...args] = splitCommand(override);
    return { command, args, init: def.initializationOptions };
  }
  if (def.id !== "typescript") return { command: def.command, args: def.args, init: def.initializationOptions };
  const ts = await invoke<{ command: string; args: string[]; tsserver: string | null } | null>("lsp_typescript", { root }).catch(() => null);
  if (!ts) return null;
  return { command: ts.command, args: ts.args, init: ts.tsserver ? { ...def.initializationOptions, tsserver: { fallbackPath: ts.tsserver } } : def.initializationOptions };
}

function makeClient(root: string, key: string, initializationOptions?: Record<string, unknown>): LSPClient {
  const diag = serverDiagnostics();
  return new LSPClient({
    rootUri: pathToUri(root),
    initializationOptions,
    timeout: 15_000,
    sanitizeHTML,
    workspace: (c) => new QuarryWorkspace(c),
    notificationHandlers: {
      "textDocument/publishDiagnostics": (_client, params: { uri: string; diagnostics: LspDiagnostic[] }) => {
        const docId = docForUri(params.uri);
        if (docId) applyDiagnostics(docId, params.diagnostics);
        return true;
      },
      "$/progress": (_c, params: { value?: { kind?: string; title?: string; message?: string; percentage?: number } }) => {
        const v = params.value;
        if (v?.kind === "begin" || v?.kind === "report") {
          const pct = typeof v.percentage === "number" ? ` ${Math.round(v.percentage)}%` : "";
          patchServer(key, { progress: `${v.title ?? v.message ?? "Working"}${pct}` });
        } else if (v?.kind === "end") patchServer(key, { progress: undefined });
        return true;
      },
      "window/logMessage": () => true,
    },
    extensions: [
      { clientCapabilities: diag.clientCapabilities, editorExtension: diag.editorExtension },
      { clientCapabilities: { textDocument: { diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false } }, workspace: { diagnostics: { refreshSupport: true } } } },
      serverCompletion(),
      hoverTooltips({ hoverTime: 350 }),
      signatureHelp(),
    ],
  });
}

interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
}

/** Store a file's diagnostics and show them in its editor state (on screen or not). */
function applyDiagnostics(docId: string, diags: LspDiagnostic[]) {
  const doc = editor.docOf(docId);
  if (!doc) return;
  const line = (n: number) => (n >= 1 && n <= doc.lines ? doc.line(n) : null);
  const problems: Problem[] = diags.map((d) => {
    const from = offsetOf(line, d.range.start, doc.length);
    const to = Math.max(from, offsetOf(line, d.range.end, doc.length));
    return { from, to, line: d.range.start.line + 1, col: d.range.start.character + 1, severity: severityOf(d.severity), message: d.message, source: d.source };
  });
  problems.sort((a, b) => a.from - b.from);
  useLsp.setState((s) => ({ problems: { ...s.problems, [docId]: problems } }));
  editor.setLspDiagnostics(docId, problems);
}

const startingServers = new Map<string, Promise<Running>>();
/** Bumped by stopAllServers(): a launch that was in flight then is stale and stops its process. */
let generation = 0;

/** The server for (def, root), started once even when several tabs ask at the same time. */
function startServer(def: ServerDef, root: string): Promise<Running> {
  const key = `${def.id}|${root.toLowerCase()}`;
  const have = running.get(key);
  if (have) return Promise.resolve(have);
  let p = startingServers.get(key);
  if (!p) {
    p = launch(def, root, key).finally(() => startingServers.delete(key));
    startingServers.set(key, p);
  }
  return p;
}

async function launch(def: ServerDef, root: string, key: string): Promise<Running> {
  const gen = generation;
  const how = await launchOf(def, root);
  const client = makeClient(root, key, how?.init);
  const entry: Running = { key, def, root, client, procId: null, workspace: () => client.workspace as QuarryWorkspace };
  if (gen !== generation) return entry; // servers were stopped meanwhile: don't start
  running.set(key, entry);
  useLsp.setState((s) => ({ servers: { ...s.servers, [key]: { def: def.id, root, status: "starting" } } }));
  // A server that isn't there or doesn't start is forgotten, so the next file of that language
  // tries again (after an install outside Quarry, or a fixed command in Settings).
  const forget = () => {
    if (running.get(key) === entry) running.delete(key);
    if (entry.procId !== null) {
      procToKey.delete(entry.procId);
      void invoke("lsp_stop", { id: entry.procId }).catch(() => {});
      entry.procId = null;
    }
    client.disconnect();
  };
  try {
    if (!how) throw new Error(`${def.name} is not installed`);
    const id = await invoke<number>("lsp_start", { command: how.command, args: how.args, cwd: root });
    entry.procId = id;
    if (gen !== generation) {
      forget();
      return entry;
    }
    procToKey.set(id, key);
    client.connect(transportFor(key, root, () => entry.procId));
    client.initializing.then(
      () => {
        if (running.get(key) !== entry) return;
        patchServer(key, { status: "ready" });
        reattach(key);
      },
      (e) => {
        if (running.get(key) !== entry) return;
        forget();
        patchServer(key, { status: "failed", error: String(e?.message ?? e) });
      },
    );
  } catch (e) {
    forget();
    const missing = /not installed|not found/i.test(String(e));
    patchServer(key, { status: missing ? "missing" : "failed", error: String(e) });
  }
  return entry;
}

/** Tabs whose server `key` (re)started after a crash or a failed start: connect them to the new client. */
function reattach(key: string) {
  const { docServer } = useLsp.getState();
  for (const d of useStore.getState().docs) if (d.kind === "text" && docServer[d.id] === key && !docUris.has(d.id)) void attachDoc(d);
}

/** Server `key` is gone: unhook its tabs from the dead client (they keep showing its status, and
 *  reattach() connects them when it starts again). */
function orphanDocs(key: string) {
  const { docServer } = useLsp.getState();
  for (const [docId, k] of Object.entries(docServer)) {
    if (k !== key) continue;
    docUris.delete(docId);
    if (editor.stateOf(docId)) editor.reconfigureDoc(docId, [compartments.lsp.reconfigure([]), compartments.completion.reconfigure(completionFor(false))]);
    editor.setLspDiagnostics(docId, []);
  }
  useLsp.setState((s) => ({ problems: Object.fromEntries(Object.entries(s.problems).filter(([docId]) => s.docServer[docId] !== key)) }));
}

/** Connect a text tab to its language server (when there is one, it's enabled and installed). */
export async function attachDoc(doc: Doc) {
  if (doc.kind !== "text") return;
  const { settings, folder } = useStore.getState();
  const def = settings.lspEnabled && doc.path ? serverFor(doc.path, settings.lspDisabled) : null;
  const prevUri = docUris.get(doc.id);
  if (!def || !doc.path) {
    if (prevUri) detachDoc(doc.id);
    return;
  }
  const uri = pathToUri(doc.path);
  if (prevUri && uriKey(prevUri) === uriKey(uri)) return;
  if (prevUri) detachDoc(doc.id);
  const root = await invoke<string>("lsp_find_root", { file: doc.path, markers: def.rootMarkers, fallback: folder ?? undefined });
  const server = await startServer(def, root);
  if (!useStore.getState().docs.some((d) => d.id === doc.id)) return; // closed meanwhile
  useLsp.setState((s) => ({ docServer: { ...s.docServer, [doc.id]: server.key } }));
  // Not installed / failed (the status bar says so), or stopped by a restart meanwhile. The tab is
  // left unconnected; reattach() connects it when the server starts.
  if (server.procId === null || running.get(server.key) !== server) return;
  docUris.set(doc.id, uri);
  editor.reconfigureDoc(doc.id, [
    compartments.lsp.reconfigure(server.client.plugin(uri, languageIdOf(doc.path))),
    compartments.completion.reconfigure(completionFor(true)),
  ]);
  server.workspace().openDoc(doc.id, uri, languageIdOf(doc.path));
}

/** The tab closed (or its file changed): close the file on the server. */
export function detachDoc(docId: string) {
  const uri = docUris.get(docId);
  docUris.delete(docId);
  const key = useLsp.getState().docServer[docId];
  useLsp.setState((s) => {
    const { [docId]: _a, ...docServer } = s.docServer;
    const { [docId]: _b, ...problems } = s.problems;
    return { docServer, problems };
  });
  if (!uri || !key) return;
  running.get(key)?.workspace().closeDoc(docId);
  if (editor.stateOf(docId)) editor.reconfigureDoc(docId, [compartments.lsp.reconfigure([]), compartments.completion.reconfigure(completionFor(false))]);
}

export const hasLsp = (docId: string | null | undefined) => {
  if (!docId) return false;
  const key = useLsp.getState().docServer[docId];
  return !!key && useLsp.getState().servers[key]?.status === "ready";
};

/** Stop every server (window closing, or Settings turned code intelligence off). */
export async function stopAllServers() {
  generation++;
  startingServers.clear();
  for (const r of running.values()) r.client.disconnect();
  running.clear();
  procToKey.clear();
  await invoke("lsp_stop_all").catch(() => {});
  useLsp.setState({ servers: {} });
}

/** Restart: stop all servers and connect the open tabs again (after installing one, or changing settings). */
export async function restartServers() {
  const docs = useStore.getState().docs.filter((d) => d.kind === "text");
  for (const d of docs) detachDoc(d.id);
  await stopAllServers();
  useLsp.setState({ docServer: {}, problems: {} });
  for (const d of docs) void attachDoc(d);
}

// ---------- commands (run on the visible editor) ----------

type Cmd = (view: EditorView) => boolean;
const onView = (cmd: Cmd) => () => {
  const view = editor.view;
  if (!view || !hasLsp(editor.currentDocId)) return false;
  view.focus();
  return cmd(view);
};

export const lspCommands = {
  definition: onView(jumpToDefinition),
  typeDefinition: onView(jumpToTypeDefinition),
  implementation: onView(jumpToImplementation),
  references: onView(findReferences),
  rename: onView(renameSymbol),
  signature: onView(showSignatureHelp),
  format: onView(lspFormat),
};

// ---------- wiring ----------

let installed = false;

/** Listen for server output and follow the tabs (once, at start-up). */
export function installLsp() {
  if (installed) return;
  installed = true;
  void listen<{ id: number; msg: string }>("lsp:msg", (e) => {
    const key = procToKey.get(e.payload.id);
    if (key) incoming.get(key)?.(e.payload.msg);
  });
  void listen<{ id: number; code: number | null; stderr: string }>("lsp:exit", (e) => {
    const key = procToKey.get(e.payload.id);
    procToKey.delete(e.payload.id);
    if (!key) return;
    const r = running.get(key);
    if (r) {
      r.procId = null;
      r.client.disconnect();
      running.delete(key);
    }
    orphanDocs(key);
    const tail = e.payload.stderr.split(/\r?\n/).filter((l) => l.trim()).slice(-3).join("\n");
    patchServer(key, { status: "stopped", error: `Exited${e.payload.code !== null ? ` with code ${e.payload.code}` : ""}${tail ? `: ${tail}` : ""}`, progress: undefined });
  });
  // Follow the tabs: connect new files, disconnect closed ones, reconnect renamed ones.
  let known = new Map<string, string | null>();
  useStore.subscribe((s, prev) => {
    if (s.docs === prev.docs && s.settings === prev.settings) return;
    const now = new Map(s.docs.filter((d) => d.kind === "text").map((d) => [d.id, d.path]));
    for (const [id] of known) if (!now.has(id)) detachDoc(id);
    for (const d of s.docs) {
      if (d.kind !== "text") continue;
      if (!known.has(d.id) || known.get(d.id) !== d.path) void attachDoc(d);
    }
    known = now;
  });
  // Links in hover documentation open in the browser, never inside Quarry's window.
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.(".cm-tooltip a, .cm-lsp-documentation a") as HTMLAnchorElement | null;
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("href") ?? "";
      if (/^https?:/i.test(href)) void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href)).catch(() => {});
    },
    true,
  );
}

export { SERVERS };
