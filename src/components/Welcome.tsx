import { FilePlus2, FolderOpen, FileUp, Keyboard } from "lucide-react";
import { useEffect, useRef } from "react";
import { dirName } from "../lib/actions";
import { runCommand } from "../lib/commands";
import { BrandIcon } from "./BrandIcon";
import { useStore } from "../lib/store";

/** Display form of a path: Windows separators, duplicates differing only by slash direction or case removed. */
export function displayRecent(paths: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const norm = p.replace(/\//g, "\\");
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
    if (out.length >= limit) break;
  }
  return out;
}

export function Welcome() {
  const recent = useStore((s) => s.recentFiles);
  const rootRef = useRef<HTMLDivElement>(null);
  // After the last tab closes focus would otherwise sit on <body>; give keyboard users a landing spot.
  useEffect(() => {
    // Next frame: the editor that just lost its last document is still focused during this commit.
    const id = requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body || a.closest(".editor-stack")) rootRef.current?.querySelector<HTMLElement>(".welcome-action")?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="welcome" ref={rootRef}>
      <div className="welcome-card">
        <div className="welcome-head">
          <BrandIcon size={56} />
          <div>
            <h1>Quarry</h1>
            <p className="tagline">Fast text, code and data editing for Windows 11.</p>
          </div>
        </div>
        <div className="welcome-actions">
          <button className="welcome-action" onClick={() => runCommand("file.new")}>
            <FilePlus2 size={18} />
            <span className="t">New file<small>Ctrl+N</small></span>
          </button>
          <button className="welcome-action" onClick={() => void runCommand("file.open")}>
            <FileUp size={18} />
            <span className="t">Open file<small>Ctrl+O</small></span>
          </button>
          <button className="welcome-action" onClick={() => void runCommand("file.openFolder")}>
            <FolderOpen size={18} />
            <span className="t">Open folder<small>Ctrl+Shift+O</small></span>
          </button>
          <button className="welcome-action" onClick={() => void runCommand("view.commandPalette")}>
            <Keyboard size={18} />
            <span className="t">All commands<small>Ctrl+Shift+P</small></span>
          </button>
        </div>
        {recent.length > 0 && (
          <div>
            <div className="section-title">Recent</div>
            <div className="welcome-recent">
              {displayRecent(recent, 8).map((p) => (
                <button key={p} onClick={() => void runCommand("file.openRecent", p)} title={p}>
                  <span className="name">{p.split(/[\\/]/).pop()}</span>
                  <span className="dir">{dirName(p)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12 }}>
          Drop files anywhere to open them. Files over the large-file threshold open in disk-backed mode.
        </p>
      </div>
    </div>
  );
}
