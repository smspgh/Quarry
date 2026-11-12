import { History, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { clearHistory, ensureHistoryLoaded, historyOf, historyVersion, removeHistoryEntry, subscribeHistory, type HistoryKind } from "../lib/searchHistory";

/** Rows rendered at first, and added each time the list is scrolled near its end. */
const PAGE = 100;
const PAD = 6;
/** From this many uses an entry's count is highlighted, as a hint that the task may be worth automating. */
const FREQUENT = 10;
const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Pure helper (testable): one-line label for a history entry (line breaks shown as ⏎; an entry of
 *  only spaces / tabs is described, since it would otherwise look empty). */
export function historyLabel(text: string): string {
  if (!text.trim() && !/[\r\n]/.test(text)) return `(${text.length} whitespace character${text.length === 1 ? "" : "s"})`;
  return (text.length > 300 ? `${text.slice(0, 300)}…` : text).replace(/\r?\n/g, " ⏎ ");
}

/** "Clear" × shown inside a find / replace box while it has text. */
export function ClearButton({ value, onClear, label }: { value: string; onClear: () => void; label: string }) {
  if (!value) return null;
  return (
    <button className="icon-btn xs" title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={onClear}>
      <X size={13} />
    </button>
  );
}

/**
 * History button for a find or replace box. Opens a scrollable list of earlier entries, newest
 * first, with the date and time each was last used. `anchor` is the box the list lines up with.
 */
export function HistoryMenu({ kind, anchor, onPick }: { kind: HistoryKind; anchor: React.RefObject<HTMLElement | null>; onPick: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useSyncExternalStore(subscribeHistory, historyVersion);
  const entries = historyOf(kind);
  const label = kind === "find" ? "Search history" : "Replace history";

  useLayoutEffect(() => {
    if (!open) return;
    const r = (anchor.current ?? btnRef.current)?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(260, r.width);
    const below = window.innerHeight - r.bottom - PAD;
    const above = r.top - PAD;
    const up = below < 200 && above > below;
    const maxHeight = Math.min(360, up ? above - 4 : below - 4);
    setPos({ left: Math.max(PAD, Math.min(r.left, window.innerWidth - width - PAD)), top: up ? r.top - 4 - maxHeight : r.bottom + 4, width, maxHeight });
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const toggle = () => {
    if (open) return setOpen(false);
    setShown(PAGE);
    setHi(0);
    setOpen(true);
    void ensureHistoryLoaded();
    requestAnimationFrame(() => listRef.current?.focus());
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) anchor.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  };
  const pick = (text: string) => {
    onPick(text);
    close();
  };

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (shown < entries.length && el.scrollTop + el.clientHeight > el.scrollHeight - 200) setShown((n) => n + PAGE);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const n = Math.min(shown, entries.length);
    let next = hi;
    if (e.key === "ArrowDown") next = Math.min(n - 1, hi + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, hi - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "PageDown") next = Math.min(n - 1, hi + 10);
    else if (e.key === "PageUp") next = Math.max(0, hi - 10);
    else if (e.key === "Enter" && entries[hi]) pick(entries[hi].text);
    else if (e.key === "Delete" && entries[hi]) removeHistoryEntry(kind, entries[hi].text);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
    e.stopPropagation();
    if (next >= shown - 5 && shown < entries.length) setShown((s) => s + PAGE);
    setHi(next);
  };

  return (
    <>
      <button
        ref={btnRef}
        className={`icon-btn xs ${open ? "on" : ""}`}
        title={`${label} (Alt+↓)`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-history-button={kind}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        <History size={14} />
      </button>
      {open &&
        createPortal(
          <div ref={popRef} className="history-menu" style={pos ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight } : { left: -9999, top: 0 }}>
            <div className="history-head">
              <span>{label}</span>
              <span className="muted">{entries.length.toLocaleString()} {entries.length === 1 ? "entry" : "entries"}</span>
              <span className="grow" />
              {entries.length > 0 && (
                <button className="icon-btn xs" title={`Clear ${label.toLowerCase()}`} onClick={() => clearHistory(kind)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            <div ref={listRef} className="history-list" role="listbox" aria-label={label} tabIndex={0} onScroll={onScroll} onKeyDown={onKey} aria-activedescendant={entries[hi] ? `hist-${kind}-${hi}` : undefined}>
              {entries.length === 0 && <div className="history-empty">Nothing yet. Searches you run are listed here.</div>}
              {entries.slice(0, shown).map((e, i) => (
                <div
                  key={e.text}
                  id={`hist-${kind}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === hi}
                  className={`history-item ${i === hi ? "hi" : ""}`}
                  title={e.text.length > 2000 ? `${e.text.slice(0, 2000)}…` : e.text}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(e.text)}
                >
                  <span className="history-text mono">{historyLabel(e.text)}</span>
                  {e.count > 1 && (
                    <span className={`history-count ${e.count >= FREQUENT ? "frequent" : ""}`} title={`Used ${e.count.toLocaleString()} times${e.count >= FREQUENT ? ". Running this often? A macro or script could do it for you." : ""}`}>
                      ×{e.count.toLocaleString()}
                    </span>
                  )}
                  <span className="history-when">{e.at ? when.format(e.at) : ""}</span>
                  <button
                    className="icon-btn xs history-remove"
                    title="Remove from history (Delete)"
                    aria-label="Remove from history"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      removeHistoryEntry(kind, e.text);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {shown < entries.length && <div className="history-more muted">Scroll for more…</div>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Alt+↓ in a find / replace box opens its history list. */
export function openHistoryFromKey(e: React.KeyboardEvent, kind: HistoryKind): boolean {
  if (!(e.altKey && e.key === "ArrowDown")) return false;
  const wrap = (e.currentTarget as HTMLElement).closest(".input-wrap");
  const btn = wrap?.querySelector<HTMLButtonElement>(`[data-history-button="${kind}"]`);
  if (!btn) return false;
  e.preventDefault();
  e.stopPropagation();
  btn.click();
  return true;
}
