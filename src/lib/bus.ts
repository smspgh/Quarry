/** Minimal typed event bus for cross-component commands (e.g. telling the big-file view to open find). */
type Handler = (payload?: unknown) => void;

const handlers = new Map<string, Set<Handler>>();
/** Events addressed to a document whose view is not mounted yet: `docId -> event -> payload`. */
const pending = new Map<string, Map<string, unknown>>();

const docKey = (docId: string, event: string) => `${event}@${docId}`;

export const bus = {
  on(event: string, fn: Handler): () => void {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(fn);
    return () => handlers.get(event)?.delete(fn);
  },
  emit(event: string, payload?: unknown) {
    handlers.get(event)?.forEach((fn) => fn(payload));
  },
  /**
   * Deliver `event` to the view of document `docId`. If that view is not mounted
   * (e.g. the tab was just activated and React has not rendered it yet) the event is
   * queued and replayed when the view calls `onFor`. Only the latest payload per
   * event is kept.
   */
  emitFor(docId: string, event: string, payload?: unknown) {
    const set = handlers.get(docKey(docId, event));
    if (set && set.size > 0) {
      set.forEach((fn) => fn(payload));
      return;
    }
    if (!pending.has(docId)) pending.set(docId, new Map());
    pending.get(docId)!.set(event, payload);
  },
  /** Subscribe to events addressed to `docId`; replays a queued event immediately. */
  onFor(docId: string, event: string, fn: Handler): () => void {
    const off = bus.on(docKey(docId, event), fn);
    const q = pending.get(docId);
    if (q?.has(event)) {
      const payload = q.get(event);
      q.delete(event);
      if (q.size === 0) pending.delete(docId);
      fn(payload);
    }
    return off;
  },
  /** Drop queued events for a document (call when it is closed). */
  clearPending(docId: string) {
    pending.delete(docId);
  },
};
