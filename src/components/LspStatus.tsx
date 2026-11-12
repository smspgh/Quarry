import { CircleAlert, CircleX, Download, Info, LoaderCircle, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { editor } from "../editor/manager";
import { runCommand } from "../lib/commands";
import { installServer } from "../lib/lspInstall";
import { restartServers, SERVERS, useLsp, type Problem } from "../lib/lsp";
import { useStore, type Doc } from "../lib/store";

const SHORT: Record<string, string> = { typescript: "TypeScript", python: "Pyright", rust: "rust-analyzer", go: "gopls", c: "clangd", csharp: "C#", css: "CSS", html: "HTML" };

/** Status bar: the language server of the active file (state, install offer) and its problem counts. */
export function LspStatusItem({ doc }: { doc: Doc }) {
  const key = useLsp((s) => s.docServer[doc.id]);
  const server = useLsp((s) => (key ? s.servers[key] : undefined));
  const problems = useLsp((s) => s.problems[doc.id]);
  const custom = useStore((s) => (server ? s.settings.lspCommands[server.def]?.trim() : undefined));
  if (!key || !server) return null;
  const def = SERVERS.find((d) => d.id === server.def);
  if (!def) return null;
  const errors = problems?.filter((p) => p.severity === "error").length ?? 0;
  const warnings = problems?.filter((p) => p.severity === "warning").length ?? 0;
  const name = SHORT[def.id] ?? def.name;
  return (
    <>
      {server.status === "ready" && (
        <button className="status-item clickable lsp-counts" title="Problems in this file (F8 next, Shift+F8 previous). Click to list all problems" onClick={() => runCommand("view.problems")}>
          <CircleX size={12} className={errors ? "lsp-err" : ""} /> {errors}
          <TriangleAlert size={12} className={warnings ? "lsp-warn" : ""} /> {warnings}
        </button>
      )}
      {server.status === "starting" && (
        <span className="status-item" title={`Starting the ${def.name} language server in ${server.root}`}><LoaderCircle size={12} className="spin" /> {name}</span>
      )}
      {server.status === "ready" && (
        <span className="status-item lsp-ready" title={`${def.name} language server · project ${server.root}\nF12 definition · Shift+F12 references · F2 rename · Ctrl+Space suggestions`}>
          {server.progress ? <LoaderCircle size={12} className="spin" /> : <Sparkles size={12} />} {server.progress ? `${name}: ${server.progress}` : name}
        </span>
      )}
      {server.status === "missing" && custom && (
        <button className="status-item clickable lsp-missing" title={`The command set in Settings for ${def.name} wasn't found:
${custom}
Click to open Settings`} onClick={() => runCommand("view.settings")}>
          <TriangleAlert size={12} /> {name} command not found
        </button>
      )}
      {server.status === "missing" && !custom && (
        <button className="status-item clickable lsp-missing" title={`The ${def.name} language server isn't installed. Click to install it (${def.install})`} onClick={() => installServer(def)}>
          <Download size={12} /> Install {name} support
        </button>
      )}
      {(server.status === "failed" || server.status === "stopped") && (
        <button className="status-item clickable lsp-missing" title={`${server.error ?? "The language server stopped"}\nClick to restart`} onClick={() => void restartServers()}>
          <RotateCcw size={12} /> {name} stopped
        </button>
      )}
    </>
  );
}

const ICON = { error: CircleX, warning: TriangleAlert, info: Info, hint: CircleAlert } as const;

/** Bottom panel › Problems: every open file's diagnostics, errors first; click to go there. */
export function ProblemsList() {
  const problems = useLsp((s) => s.problems);
  const docs = useStore((s) => s.docs);
  const files = docs
    .filter((d) => problems[d.id]?.length)
    .map((d) => ({ doc: d, list: [...problems[d.id]].sort((a, b) => rank(a) - rank(b) || a.from - b.from) }));
  if (!files.length) {
    const anyServer = Object.keys(useLsp.getState().docServer).length > 0;
    return <div className="console-line muted">{anyServer ? "No problems in the open files." : "Problems from language servers appear here. Open a file in a supported language (Settings › Code intelligence)."}</div>;
  }
  const go = (d: Doc, p: Problem) => {
    useStore.getState().setActive(d.id);
    requestAnimationFrame(() => {
      editor.goTo(p.line, p.col);
      editor.focus();
    });
  };
  return (
    <div className="problems">
      {files.map(({ doc, list }) => (
        <div key={doc.id} className="problems-file">
          <div className="problems-file-head" title={doc.path ?? doc.name}>
            {doc.name} <span className="muted">{list.length}</span>
          </div>
          {list.map((p, i) => {
            const Icon = ICON[p.severity];
            return (
              <button key={i} className={`problems-row ${p.severity}`} onClick={() => go(doc, p)} title={p.message}>
                <Icon size={13} />
                <span className="problems-msg">{p.message.split("\n")[0]}</span>
                {p.source && <span className="muted">{p.source}</span>}
                <span className="muted problems-pos">Ln {p.line}, Col {p.col}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const rank = (p: Problem) => ({ error: 0, warning: 1, info: 2, hint: 3 })[p.severity];

/** Count for the Problems tab title. */
export function useProblemCount() {
  return useLsp((s) => Object.values(s.problems).reduce((n, l) => n + l.filter((p) => p.severity === "error" || p.severity === "warning").length, 0));
}
