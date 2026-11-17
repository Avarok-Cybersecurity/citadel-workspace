/**
 * How far to scroll the role matrix so a focused cell is fully in view and not under its sticky strips.
 *
 * The matrix keeps its permission column (left) and header row (top) in place while the role
 * columns scroll. The scroller's scroll-padding reserves room for them when something is scrolled
 * into view, but neither engine honours that for focus: WebKit ignores scroll-padding when focus
 * moves (Tab to a Member checkbox with the table scrolled to its last column, and Safari left it
 * under the permission names, WCAG 2.4.11), and does not scroll a focused cell in at all from off
 * the right edge; Chromium leaves a cell that is only partly in view where it is. This measures the
 * strips and the scroller's visible area as they are drawn, so it holds whatever their size.
 * Pure: the caller reads the rects and does the scrolling.
 */
export interface Edges { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/** One axis: back toward the start (negative) out from under the strip, or on to the far edge. */
function along(start: number, end: number, stripEnd: number, viewEnd: number): number {
  if (start < stripEnd) return start - stripEnd;
  return end > viewEnd ? end - viewEnd : 0;
}

/**
 * The scroll that brings `cell` clear of the column and header, and inside `view` (the
 * scroller's visible area). Clearing a strip wins over the far edge: a cell wider than the space
 * between them shows its start.
 */
export function scrollToShowClear(cell: Edges, column: Edges, header: Edges, view: Edges): { left: number; top: number } {
  return { left: along(cell.left, cell.right, column.right, view.right), top: along(cell.top, cell.bottom, header.bottom, view.bottom) };
}
