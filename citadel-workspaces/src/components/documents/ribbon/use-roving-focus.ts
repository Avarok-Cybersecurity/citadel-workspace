/**
 * Roving tabindex for a toolbar (WAI-ARIA APG): the toolbar is one Tab stop, the arrow keys
 * (Up and Down in an `aria-orientation="vertical"` one),
 * Home and End move between its items, and the item last focused is the one Tab returns to.
 * Items mark themselves `data-roving-item`. A text field keeps the arrows while its caret has
 * somewhere to go, and gives them up at either end, so it is never a trap.
 */
import { useCallback, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type MutableRefObject, type RefObject } from 'react';

const ITEM: string = '[data-roving-item]';

function itemsOf(toolbar: HTMLElement): HTMLElement[] {
  // Nested toolbars (a collapsed group's popover) rove on their own.
  return [...toolbar.querySelectorAll<HTMLElement>(ITEM)].filter((el: HTMLElement): boolean => el.closest('[role="toolbar"]') === toolbar);
}

/** A text field keeps Home and End, and an arrow while its caret can still move that way. */
function fieldKeeps(target: HTMLElement, key: string): boolean {
  if (!(target instanceof HTMLInputElement) || target.type !== 'text') return false;
  if (key === 'Home' || key === 'End') return true;
  const at: number | null = target.selectionStart;
  if (at === null || target.selectionEnd !== at) return true;
  return key === 'ArrowLeft' ? at > 0 : at < target.value.length;
}

export interface RovingFocus {
  readonly ref: RefObject<HTMLDivElement>;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLDivElement>) => void;
}

export function useRovingFocus(): RovingFocus {
  const ref: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const active: MutableRefObject<number> = useRef<number>(0);

  const apply: () => void = useCallback((): void => {
    const toolbar: HTMLDivElement | null = ref.current;
    if (toolbar === null) return;
    const items: HTMLElement[] = itemsOf(toolbar);
    if (active.current >= items.length) active.current = 0;
    items.forEach((el: HTMLElement, i: number): void => { el.tabIndex = i === active.current ? 0 : -1; });
  }, []);

  // After every render: items come and go with state (a dialog trigger, a collapsed group).
  useLayoutEffect(apply);

  const onFocus: (event: FocusEvent<HTMLDivElement>) => void = useCallback((event: FocusEvent<HTMLDivElement>): void => {
    const toolbar: HTMLDivElement | null = ref.current;
    if (toolbar === null) return;
    const index: number = itemsOf(toolbar).indexOf(event.target as HTMLElement);
    if (index >= 0 && index !== active.current) {
      active.current = index;
      apply();
    }
  }, [apply]);

  const onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    const toolbar: HTMLDivElement | null = ref.current;
    if (toolbar === null) return;
    const items: HTMLElement[] = itemsOf(toolbar);
    const from: number = items.indexOf(event.target as HTMLElement);
    if (from < 0) return;
    let to: number;
    const vertical: boolean = toolbar.getAttribute('aria-orientation') === 'vertical';
    switch (event.key) {
      case vertical ? 'ArrowDown' : 'ArrowRight': to = (from + 1) % items.length; break;
      case vertical ? 'ArrowUp' : 'ArrowLeft': to = (from - 1 + items.length) % items.length; break;
      case 'Home': to = 0; break;
      case 'End': to = items.length - 1; break;
      default: return;
    }
    if (fieldKeeps(event.target as HTMLElement, event.key)) return;
    event.preventDefault();
    active.current = to;
    apply();
    items[to].focus();
  }, [apply]);

  return { ref, onKeyDown, onFocus };
}
