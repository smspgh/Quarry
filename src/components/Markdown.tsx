import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Copy } from "lucide-react";
import React, { memo, useEffect, useMemo, useState } from "react";
import { parseMarkdown, type Block, type Inline } from "../lib/markdown";

/** Where a link goes: web links open in the browser, anything else is treated as a file path. */
export interface LinkHandler {
  (href: string): void;
}

/** Markdown from Claude, rendered as React elements (never as HTML). */
export const Markdown = memo(function Markdown({ text, onLink }: { text: string; onLink: LinkHandler }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="md">{blocks.map((b, i) => <BlockView key={i} b={b} onLink={onLink} />)}</div>;
});

function BlockView({ b, onLink }: { b: Block; onLink: LinkHandler }): React.ReactElement {
  switch (b.t) {
    case "p":
      return <p><Inlines nodes={b.c} onLink={onLink} /></p>;
    case "h": {
      const H = `h${Math.min(6, b.level + 1)}` as "h2";
      return <H><Inlines nodes={b.c} onLink={onLink} /></H>;
    }
    case "code":
      return <CodeBlock code={b.v} lang={b.lang} streaming={b.open} />;
    case "list": {
      const items = b.items.map((it, i) => <li key={i}>{it.map((x, j) => <BlockView key={j} b={x} onLink={onLink} />)}</li>);
      return b.ordered ? <ol start={b.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "quote":
      return <blockquote>{b.c.map((x, i) => <BlockView key={i} b={x} onLink={onLink} />)}</blockquote>;
    case "hr":
      return <hr />;
    case "table":
      return (
        <div className="md-table-wrap">
          <table>
            <thead><tr>{b.head.map((c, i) => <th key={i} style={{ textAlign: b.align[i] ?? undefined }}><Inlines nodes={c} onLink={onLink} /></th>)}</tr></thead>
            <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ textAlign: b.align[j] ?? undefined }}><Inlines nodes={c} onLink={onLink} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
  }
}

function Inlines({ nodes, onLink }: { nodes: Inline[]; onLink: LinkHandler }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return <React.Fragment key={i}>{n.v}</React.Fragment>;
          case "code":
            return <code key={i}>{n.v}</code>;
          case "br":
            return <br key={i} />;
          case "strong":
            return <strong key={i}><Inlines nodes={n.c} onLink={onLink} /></strong>;
          case "em":
            return <em key={i}><Inlines nodes={n.c} onLink={onLink} /></em>;
          case "del":
            return <del key={i}><Inlines nodes={n.c} onLink={onLink} /></del>;
          case "link":
            return (
              <a key={i} href="#" title={n.href} onClick={(e) => { e.preventDefault(); onLink(n.href); }}>
                <Inlines nodes={n.c} onLink={onLink} />
              </a>
            );
        }
      })}
    </>
  );
}

/** Highlighted spans for `code` (null until the language has loaded, or for unknown languages). */
function useHighlight(code: string, lang: string, enabled: boolean): React.ReactNode[] | null {
  const [out, setOut] = useState<React.ReactNode[] | null>(null);
  useEffect(() => {
    setOut(null);
    if (!enabled || !lang) return;
    const desc = LanguageDescription.matchLanguageName(languages, lang, true);
    if (!desc) return;
    let live = true;
    desc.load().then((support) => {
      if (!live) return;
      const nodes: React.ReactNode[] = [];
      const tree = support.language.parser.parse(code);
      highlightCode(
        code,
        tree,
        classHighlighter,
        (text, classes) => nodes.push(classes ? <span key={nodes.length} className={classes}>{text}</span> : text),
        () => nodes.push("\n"),
      );
      setOut(nodes);
    }).catch(() => {});
    return () => { live = false; };
  }, [code, lang, enabled]);
  return out;
}

export function CodeBlock({ code, lang, streaming = false }: { code: string; lang: string; streaming?: boolean }) {
  const spans = useHighlight(code, lang, !streaming);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || "text"}</span>
        <button className="icon-btn xs" title={copied ? "Copied" : "Copy code"} aria-label="Copy code" onClick={copy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre className="selectable"><code>{spans ?? code}</code></pre>
    </div>
  );
}
