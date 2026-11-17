/**
 * visibleSaveState over time: the status the title bar shows now, asked again at each deadline the
 * pure function names. The clock is the caller's (browserClock in the app, a stepped one in tests).
 */
import { useEffect, useState } from 'react';
import type { Clock } from '@/lib/cdoc/collab/ports';
import type { SaveStatus } from '@/lib/document-save/save-status';
import { INITIAL_SAVE_INDICATOR, visibleSaveState, type SaveIndicatorTiming, type VisibleSave } from '@/lib/document-save/visible-save-state';

const same = (a: VisibleSave, b: VisibleSave): boolean =>
  a.shown === b.shown && a.wakeAt === b.wakeAt && a.memory.pendingSince === b.memory.pendingSince
  && a.memory.savingShownAt === b.memory.savingShownAt && a.memory.settled === b.memory.settled;

export function useVisibleSave(status: SaveStatus, clock: Clock, timing: SaveIndicatorTiming): SaveStatus {
  const [view, setView] = useState<VisibleSave>((): VisibleSave => visibleSaveState(status, INITIAL_SAVE_INDICATOR, clock.now(), timing));
  const [wakes, setWakes] = useState<number>(0);
  useEffect((): void => {
    setView((previous: VisibleSave): VisibleSave => {
      const next: VisibleSave = visibleSaveState(status, previous.memory, clock.now(), timing);
      return same(previous, next) ? previous : next;
    });
  }, [status, wakes, clock, timing]);
  const wakeAt: number | null = view.wakeAt;
  useEffect((): (() => void) | undefined => {
    if (wakeAt === null) return undefined;
    return clock.after(Math.max(0, wakeAt - clock.now()), (): void => setWakes((n: number): number => n + 1));
  }, [wakeAt, clock]);
  return view.shown;
}
