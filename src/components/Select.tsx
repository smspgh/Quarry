import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
  /** Optional group heading shown above the first option of each group. */
  group?: string;
  hint?: string;
  /** Why the option cannot be chosen (its tooltip); it is shown greyed out. */
  disabled?: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  size?: "sm" | "md";
  placeholder?: string;
}

interface FlyoutPos {
  left: number;
  top: number;
  minWidth: number;
  maxHeight: number;
  up: boolean;
}

const VIEWPORT_PAD = 6;
const GAP = 4;
const MAX_H = 320;
const OPTION_H = 30;

/** Pure helper (testable): place a flyout of `need` px next to an anchor rect, flipping up / clamping to the viewport. */
export function placeFlyout(anchor: { left: number; top: number; bottom: number; width: number }, need: number, vw: number, vh: number): FlyoutPos {
  const below = vh - anchor.bottom - GAP - VIEWPORT_PAD;
  const above = anchor.top - GAP - VIEWPORT_PAD;
  const up = below < need && above > below;
  const maxHeight = Math.max(60, Math.min(need, up ? above : below));
  const minWidth = Math.max(120, anchor.width);
  const left = Math.max(VIEWPORT_PAD, Math.min(anchor.left, vw - minWidth - VIEWPORT_PAD));
  const top = up ? Math.max(VIEWPORT_PAD, anchor.top - GAP - maxHeight) : anchor.bottom + GAP;
  return { left, top, minWidth, maxHeight, up };
}

/** Pure helper (testable): type-ahead match. Finds the next option (after `from`) whose label starts with `typed`. */
export function typeAheadIndex(options: { label: string }[], typed: string, from: number): number {
  const q = typed.toLowerCase();
  if (!q) return -1;
  const n = options.length;
  // Single repeated char cycles through matches; otherwise prefer the first match from the top.
  const start = q.length === 1 ? from + 1 : 0;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (options[i].label.toLowerCase().startsWith(q)) return i;
  }
  return -1;
}

/**
 * Themed replacement for a native <select>. Native popups in WebView2 ignore the app theme,
 * so this renders its own flyout using the same tokens as the command palette. The flyout is
 * portalled to <body> with position:fixed so it is never clipped by overflow:hidden ancestors.
 */
export function Select({ value, options, onChange, title, className = "", style, size = "md", placeholder = "Choose…" }: Props) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<FlyoutPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    const dismiss = (e?: Event) => {
      // Scrolling inside the flyout itself (wheel / scrollIntoView) must not close it.
      if (e && listRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) { setPos(null); return; }
    const r = btnRef.current.getBoundingClientRect();
    const groups = new Set(options.map((o) => o.group).filter(Boolean)).size;
    const need = Math.min(MAX_H, options.length * OPTION_H + groups * 24 + 10);
    setPos(placeFlyout(r, need, window.innerWidth, window.innerHeight));
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    typed.current = { text: "", at: 0 };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelectorAll<HTMLElement>(".select-option")[hi]?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  const pick = (v: string) => {
    if (options.find((o) => o.value === v)?.disabled) return;
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  };

  const typeAhead = (ch: string) => {
    const now = Date.now();
    const t = typed.current;
    const text = now - t.at < 700 ? t.text + ch : ch;
    typed.current = { text, at: now };
    const i = typeAheadIndex(options, text, hi);
    if (i >= 0) {
      setHi(i);
      if (!open && !options[i].disabled) onChange(options[i].value);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== " ") {
      e.preventDefault();
      typeAhead(e.key);
      return;
    }
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Tab") { setOpen(false); return; } // let focus move on
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") setHi((h) => Math.min(options.length - 1, h + 1));
    else if (e.key === "ArrowUp") setHi((h) => Math.max(0, h - 1));
    else if (e.key === "PageDown") setHi((h) => Math.min(options.length - 1, h + 8));
    else if (e.key === "PageUp") setHi((h) => Math.max(0, h - 8));
    else if (e.key === "Home") setHi(0);
    else if (e.key === "End") setHi(options.length - 1);
    else if (e.key === "Enter" || e.key === " ") {
      if (options[hi]) pick(options[hi].value);
    } else return;
    e.preventDefault();
  };

  const onBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && (rootRef.current?.contains(next) || listRef.current?.contains(next))) return;
    setOpen(false);
  };

  const optId = (i: number) => `${id}-opt-${i}`;
  let lastGroup: string | undefined;
  return (
    <div ref={rootRef} className={`select-root ${className}`} style={style}>
      <button
        ref={btnRef}
        type="button"
        className={`select-btn ${size} ${open ? "open" : ""}`}
        title={title ?? current?.label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        onBlur={onBlur}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && options[hi] ? optId(hi) : undefined}
      >
        <span className="select-label">{current?.label ?? <span className="muted">{placeholder}</span>}</span>
        <ChevronDown size={14} className="select-caret" />
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={listRef}
            id={`${id}-list`}
            className={`select-flyout portal ${pos.up ? "up" : ""}`}
            role="listbox"
            style={{ left: pos.left, top: pos.top, minWidth: pos.minWidth, maxHeight: pos.maxHeight }}
            onMouseDown={(e) => e.preventDefault()} // keep focus on the button so blur/keys keep working
          >
            {options.map((o, i) => {
              const heading = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={o.value}>
                  {heading && <div className="select-group">{heading}</div>}
                  <button
                    type="button"
                    role="option"
                    id={optId(i)}
                    tabIndex={-1}
                    aria-selected={o.value === value}
                    aria-disabled={o.disabled ? true : undefined}
                    title={o.disabled ?? o.hint}
                    className={`select-option ${i === hi ? "hi" : ""} ${o.value === value ? "selected" : ""} ${o.disabled ? "disabled" : ""}`}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(o.value)}
                  >
                    <span className="select-check">{o.value === value && <Check size={13} />}</span>
                    <span className="select-text">{o.label}</span>
                    {o.hint && <span className="select-hint">{o.hint}</span>}
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
