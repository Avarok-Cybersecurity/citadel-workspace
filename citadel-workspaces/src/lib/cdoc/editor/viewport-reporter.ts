/**
 * Tells the editor which pages are on screen (SetViewport), so results carry selection
 * rectangles for those pages only: a 500-page selection costs a line per visible line, not
 * per line of the document. Reports are coalesced to one per frame, and an unchanged set is
 * never resent.
 */

/** Runs `task` before the next paint (requestAnimationFrame in the page). */
export type FrameScheduler = (task: () => void) => void;

export function viewportReporter(send: (pages: readonly number[]) => void, nextFrame: FrameScheduler): (pages: readonly number[]) => void {
  let pending: readonly number[] | null = null;
  let sent: string | null = null;
  return (pages: readonly number[]): void => {
    const scheduled: boolean = pending !== null;
    pending = pages;
    if (scheduled) return;
    nextFrame((): void => {
      const latest: readonly number[] = pending ?? [];
      pending = null;
      const key: string = latest.join(',');
      if (key === sent) return;
      sent = key;
      send(latest);
    });
  };
}
