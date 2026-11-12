/** Tallest scroll range used for a virtual list. Chromium can't lay out much past 33.5 M px, so
 *  past this the scroll range is scaled down and rows are placed relative to the scroll position. */
const MAX_PX = 12_000_000;

/** Pure scroll geometry (large-file view and its filter pane) so the clamp math is testable without a DOM. */
export function bigGeometry(total: number, viewH: number, rowH: number) {
  const fullRows = Math.max(1, Math.floor(viewH / rowH));
  const renderRows = Math.ceil(viewH / rowH) + 1;
  const maxTop = Math.max(0, total - fullRows);
  const scale = Math.min(1, MAX_PX / Math.max(1, maxTop * rowH));
  const spacerH = viewH + maxTop * rowH * scale;
  return { fullRows, renderRows, maxTop, scale, spacerH };
}
