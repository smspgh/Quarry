import { Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useStore } from "../lib/store";
import { ProblemsList, useProblemCount } from "./LspStatus";

export function BottomPanel() {
  const visible = useStore((s) => s.bottomVisible);
  const height = useStore((s) => s.bottomHeight);
  const lines = useStore((s) => s.consoleLines);
  const set = useStore((s) => s.set);
  const clear = useStore((s) => s.clearConsole);
  const tab = useStore((s) => (s.bottomTab === "problems" ? "problems" : "console"));
  const problemCount = useProblemCount();
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, visible]);

  if (!visible) return null;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev: MouseEvent) => set({ bottomHeight: Math.max(80, Math.min(window.innerHeight - 200, startH + (startY - ev.clientY))) });
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="bottom-panel" style={{ height }}>
      <div className="bottom-resizer" onMouseDown={startResize} />
      <div className="bottom-tabs">
        <button className={`bottom-tab ${tab === "console" ? "active" : ""}`} onClick={() => set({ bottomTab: "console" })}>Console</button>
        <button className={`bottom-tab ${tab === "problems" ? "active" : ""}`} onClick={() => set({ bottomTab: "problems" })}>
          Problems{problemCount > 0 && <span className="bottom-tab-count">{problemCount}</span>}
        </button>
        <span className="grow" />
        {tab === "console" && (
          <button className="icon-btn" title="Clear console" onClick={clear}>
            <Trash2 size={14} />
          </button>
        )}
        <button className="icon-btn" title="Close panel (Ctrl+J)" onClick={() => set({ bottomVisible: false })}>
          <X size={14} />
        </button>
      </div>
      <div className="bottom-body" ref={bodyRef}>
        {tab === "problems" && <ProblemsList />}
        {tab === "console" && lines.length === 0 && <div className="console-line muted">Script output and messages appear here.</div>}
        {tab === "console" && lines.map((l) => (
          <div key={l.id} className={`console-line ${l.kind}`}>
            <span className="ts">{new Date(l.ts).toLocaleTimeString()}</span>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
