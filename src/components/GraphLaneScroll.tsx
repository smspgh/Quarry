import { useEffect, useRef } from "react";

/**
 * The scroll bar under the lane column's heading (GRAPH-017): a graph wider than the column
 * scrolls sideways here; the rows only follow (`scroll` px of `total`, `width` px visible). The
 * commit list itself never scrolls sideways.
 */
export function GraphLaneScroll({ scroll, width, total, onScroll }: { scroll: number; width: number; total: number; onScroll: (px: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Shift+wheel, a reveal or a reload moved the lanes: the bar follows.
  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.scrollLeft - scroll) > 0.5) el.scrollLeft = scroll;
  }, [scroll, total]);
  return (
    <div
      ref={ref}
      className="graph-lane-scroll"
      style={{ width }}
      title="More branch lines to the side: drag, or hold Shift and turn the wheel over the lines"
      aria-label="Scroll the branch lines sideways"
      onScroll={(e) => {
        if (Math.abs(e.currentTarget.scrollLeft - scroll) > 0.5) onScroll(e.currentTarget.scrollLeft);
      }}
    >
      <div style={{ width: total, height: 1 }} />
    </div>
  );
}
