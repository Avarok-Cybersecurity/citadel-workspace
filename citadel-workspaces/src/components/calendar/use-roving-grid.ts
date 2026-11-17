/**
 * The roving tab stop of a Calendar grid (design §3.10): exactly one day, the cursor, is in the
 * tab order; the grid's keys (`gridIntent`) move the cursor, and focus follows it to the new day's
 * cell once that cell is drawn, even when the move changed the month or week on screen.
 */
import { useCallback, useEffect, useRef, type RefObject, type MutableRefObject } from 'react';
import { dateKey, gridIntent, sameDate, type GridIntent, type GridNav, type GridView } from '@/lib/calendar/grid-keyboard';
import type { CivilDate } from '@/lib/calendar/generated/CivilDate';

export interface GridHandlers {
  onFocus: (date: CivilDate) => void;
  onOpenDay: (date: CivilDate) => void;
  /** Null while no event can be made here: `+` and `n` then do nothing and keep their default. */
  onCreate: ((date: CivilDate) => void) | null;
}

export interface DayCell {
  tabIndex: 0 | -1;
  key: string;
  selected: boolean;
  onFocus: () => void;
  /** The grid's keys, on the cell that holds focus (or a chip inside it), so the cell itself is operable. */
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export interface RovingGrid {
  gridRef: React.RefObject<HTMLDivElement>;
  /** What a day's gridcell takes; each view writes them on the cell, where the gates can read them. */
  cell: (date: CivilDate) => DayCell;
}

export function useRovingGrid(cursor: CivilDate, view: GridView, nav: GridNav, handlers: GridHandlers): RovingGrid {
  const gridRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const following: MutableRefObject<boolean> = useRef<boolean>(false);
  const { onFocus, onOpenDay, onCreate } = handlers;

  useEffect((): void => {
    if (!following.current) return;
    following.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${dateKey(cursor)}"]`)?.focus();
  }, [cursor]);

  const onKeyDown: (e: React.KeyboardEvent) => void = useCallback((e: React.KeyboardEvent): void => {
    const intent: GridIntent | null = gridIntent(e.key, cursor, view, nav);
    if (intent === null || (intent.kind === 'create' && onCreate === null)) return;
    e.preventDefault();
    if (intent.kind === 'focus') {
      following.current = true;
      onFocus(intent.date);
    } else if (intent.kind === 'open') {
      onOpenDay(intent.date);
    } else {
      onCreate?.(intent.date);
    }
  }, [cursor, view, nav, onFocus, onOpenDay, onCreate]);

  const cell: (date: CivilDate) => DayCell = useCallback((date: CivilDate): DayCell => {
    const current: boolean = sameDate(date, cursor);
    return {
      tabIndex: current ? 0 : -1,
      key: dateKey(date),
      selected: current,
      onFocus: (): void => {
        if (!current) onFocus(date);
      },
      onKeyDown,
    };
  }, [cursor, onFocus, onKeyDown]);

  return { gridRef, cell };
}
