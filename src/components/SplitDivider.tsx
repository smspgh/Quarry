import { useState } from "react";
import { useStore } from "../lib/store";

/** The bar between the two panes of the split editor: drag to resize, double-click for half and half. */
export function SplitDivider() {
  const [dragging, setDragging] = useState(false);

  const setRatio = (ratio: number) =>
    useStore.setState((s) => (s.split ? { split: { ...s.split, ratio: Math.max(0.15, Math.min(0.85, ratio)) } } : {}));

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const area = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    setDragging(true);
    const move = (ev: MouseEvent) => setRatio((ev.clientX - area.left) / area.width);
    const up = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      className={`split-divider ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize split editor"
      title="Drag to resize; double-click to split evenly"
      onMouseDown={startResize}
      onDoubleClick={() => setRatio(0.5)}
    />
  );
}
