/**
 * Which pages hold a painted canvas. Scrolling never repaints a page it has painted while that
 * page stays within `warmPages` of the view: its canvas stays mounted, bitmap and all. Pages in
 * view and one either side mount at once; the rest of the warm window is painted ahead in idle
 * time, nearest first, `mountsPerTick` canvases per tick, since each costs a canvas transfer and
 * a paint. Pure: page numbers in, page numbers out.
 */

export interface PaintAhead {
  /** Pages either side of the view kept painted once painted, and painted ahead when idle. */
  readonly warmPages: number;
  /** Canvases mounted per idle tick beyond the ones in view. */
  readonly mountsPerTick: number;
  /** Runs a task when the main thread is idle; the result cancels it. */
  readonly idle: (task: () => void) => () => void;
}

/** The pages to keep mounted now: those near the view, and those already mounted still in the warm window. */
export function keptPages(near: readonly number[], warm: readonly number[], mounted: ReadonlySet<number>): number[] {
  const kept: Set<number> = new Set<number>(near);
  for (const page of warm) if (mounted.has(page)) kept.add(page);
  return [...kept].sort((a: number, b: number): number => a - b);
}

/** `kept` plus up to `budget` more warm pages, nearest to `center` first; `more` when some still wait. */
export function aheadPages(kept: readonly number[], warm: readonly number[], center: number, budget: number): { readonly pages: number[]; readonly more: boolean } {
  const have: Set<number> = new Set<number>(kept);
  const waiting: number[] = warm
    .filter((p: number): boolean => !have.has(p))
    .sort((a: number, b: number): number => Math.abs(a - center) - Math.abs(b - center) || a - b);
  const added: number[] = waiting.slice(0, budget);
  return { pages: [...kept, ...added].sort((a: number, b: number): number => a - b), more: waiting.length > added.length };
}
