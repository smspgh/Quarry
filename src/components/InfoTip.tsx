import { Info } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const PAD = 8;

/**
 * "i" button with a help popover. Hovering shows it; clicking (or Enter / Space) keeps it open
 * until the next click elsewhere, a second click on the "i", or Escape.
 */
export function InfoTip({ text, label = "More information" }: { text: string; label?: string }) {
  const [hover, setHover] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = hover || stuck;

  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const b = btnRef.current?.getBoundingClientRect();
    const t = tipRef.current;
    if (!b || !t) return;
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    const left = Math.max(PAD, Math.min(b.left, window.innerWidth - w - PAD));
    const below = b.bottom + 6;
    const top = below + h > window.innerHeight - PAD ? Math.max(PAD, b.top - 6 - h) : below;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!stuck) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !tipRef.current?.contains(t)) setStuck(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      setStuck(false);
      setHover(false);
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [stuck]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`icon-btn xs tip-btn ${stuck ? "on" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => {
          // A second click dismisses it even though the pointer is still over the "i".
          if (stuck) setHover(false);
          setStuck(!stuck);
        }}
      >
        <Info size={13} />
      </button>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="info-tip"
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
            onMouseEnter={() => stuck || setHover(true)}
            onMouseLeave={() => setHover(false)}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
