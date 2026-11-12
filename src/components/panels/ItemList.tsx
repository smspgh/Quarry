import type { ReactNode } from "react";

export interface ListItem {
  id: string;
  name: string;
  meta?: string;
  /** Secondary line, e.g. the sanitised file name when it differs from the display name. */
  sub?: string;
  unsaved?: boolean;
  readonly?: boolean;
}

/**
 * Shared clickable list used by the Scripts and Macros panels. Click a card to select it;
 * click into the name to rename it (read-only items show plain text).
 */
export function ItemList({ items, selected, onSelect, onRename, trailing, emptyText }: {
  items: ListItem[];
  selected: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  trailing?: (item: ListItem) => ReactNode;
  emptyText?: ReactNode;
}) {
  if (items.length === 0) return emptyText ? <div className="empty-state">{emptyText}</div> : null;
  return (
    <div className="item-list">
      {items.map((it) => (
        <div key={it.id} className={`list-card ${selected === it.id ? "selected" : ""} ${it.readonly ? "readonly" : ""} ${it.sub ? "has-sub" : ""}`} onClick={() => onSelect(it.id)}>
          <div className="list-card-main">
            {it.readonly ? (
              <span className="name" title={it.name}>{it.name}</span>
            ) : (
              <input
                className="input name-input"
                aria-label={`Name${it.unsaved ? " (unsaved)" : ""}`}
                value={it.name}
                title={it.unsaved ? "Unsaved — click Save to keep it" : "Click to rename"}
                onChange={(e) => onRename(it.id, e.target.value)}
                onFocus={() => onSelect(it.id)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
              />
            )}
            {it.sub && <span className="list-card-sub mono truncate" title={`Saved as ${it.sub}`}>{it.sub}</span>}
          </div>
          {it.unsaved && <span className="muted" title="Unsaved">•</span>}
          {it.meta && <span className="meta">{it.meta}</span>}
          {trailing?.(it)}
        </div>
      ))}
    </div>
  );
}
