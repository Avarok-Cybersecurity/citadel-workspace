/**
 * Keeps a chat on its newest message while the reader is at the bottom, and
 * counts what they have not seen while they are not. A thin shell over
 * lib/chat-scroll/stick: it measures, dispatches, and scrolls; every decision
 * is the pure module's.
 *
 * One hook for both chats. The viewport is the Radix ScrollArea Viewport.
 */
import { useEffect, useLayoutEffect, useRef, useState, useCallback, type RefObject, type MutableRefObject } from 'react';
import { preferredScrollBehavior } from '@/lib/motion';
import { step, appendedSince, INITIAL_STICK, type StickState, type StickEvent, type StickStep } from '@/lib/chat-scroll/stick';

/** Visible keyboard focus for the scrollable region (an inset outline in the ring colour). */
const FOCUS_RING: readonly string[] = ['focus-visible:outline', 'focus-visible:outline-2', 'focus-visible:outline-offset-[-2px]', 'focus-visible:outline-ring'];

export interface StickToBottom {
  /** Messages that arrived while the reader was away from the bottom. */
  unseen: number;
  /** Scroll smoothly to the newest message and clear the count. */
  viewLatest: () => void;
  /**
   * viewLatest for the "View" button: also moves keyboard focus into the
   * message area, because the button unmounts and focus would fall to <body>,
   * sending the next Tab back to the top of the page.
   */
  reveal: () => void;
}

/** Optional ties from the reader's position to what else the chat does. */
export interface StickLinks {
  /** Kept equal to "the reader is at the bottom" -- the position BEFORE any new content. */
  pinnedRef: MutableRefObject<boolean>;
  /** Called when the count of unseen messages drops to zero (View, or reaching the bottom). */
  onCaughtUp: () => void;
}

export function useStickToBottom<T extends { readonly id: string }>(
  viewportRef: RefObject<HTMLElement>,
  items: readonly T[],
  /** The region's accessible name; unique per conversation ("Messages with Alice"). */
  label: string,
  isOwn?: (item: T) => boolean,
  links?: StickLinks,
): StickToBottom {
  const [unseen, setUnseen] = useState<number>(0);
  const state: MutableRefObject<StickState> = useRef<StickState>(INITIAL_STICK);
  const previous: MutableRefObject<readonly T[]> = useRef<readonly T[]>([]);
  const attached: MutableRefObject<HTMLElement | null> = useRef<HTMLElement | null>(null);
  const hasBeenAttached: MutableRefObject<boolean> = useRef<boolean>(false);
  const cleanup: MutableRefObject<(() => void) | null> = useRef<(() => void) | null>(null);
  // Read through a ref: callers pass an inline function, and a changing dependency would re-run the effect below every render.
  const ownRef: MutableRefObject<((item: T) => boolean) | undefined> = useRef(isOwn);
  ownRef.current = isOwn;
  const linksRef: MutableRefObject<StickLinks | undefined> = useRef(links);
  linksRef.current = links;

  const dispatch: (event: StickEvent) => void = useCallback((event: StickEvent): void => {
    const el: HTMLElement | null = attached.current;
    if (!el) return;
    const result: StickStep = step(state.current, event);
    const before: number = state.current.unseen;
    const hadUnseen: boolean = before > 0;
    state.current = result.state;
    // Only a change is written. `items` can be a new array with nothing new in it (React re-applies a
    // later update over an older one still waiting to render), and a same-value write from the layout
    // effect is not dropped while that update waits: it forced a render that re-applied the update
    // again, a new array, this effect again, until "Maximum update depth exceeded".
    if (result.state.unseen !== before) setUnseen(result.state.unseen);
    if (linksRef.current) linksRef.current.pinnedRef.current = result.state.pinned;
    if (hadUnseen && result.state.unseen === 0) linksRef.current?.onCaughtUp();
    if (result.scroll) el.scrollTo({ top: el.scrollHeight, behavior: preferredScrollBehavior() });
  }, []);

  // The viewport can be replaced (the P2P chat swaps it out for a document tab
  // and back), so the element is checked every render rather than once: no
  // dependency list on purpose, and cheap, as the first line returns when unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el: HTMLElement | null = viewportRef.current;
    if (el === attached.current) return;
    cleanup.current?.();
    cleanup.current = null;
    attached.current = el;
    state.current = INITIAL_STICK;
    setUnseen(0);
    if (!el) return;
    // A scrollable region must be keyboard-focusable (axe scrollable-region-focusable), and
    // reveal() needs somewhere to put focus when the View button unmounts.
    el.tabIndex = 0;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', label);
    // The browser's own 1px focus edge is under 3:1 in dark themes and WebKit. An inset
    // outline, not a ring: a box-shadow paints under content and a bubble cut off at the
    // top edge would cover it.
    el.classList.add(...FOCUS_RING);
    el.scrollTop = el.scrollHeight; // a newly attached viewport opens on the latest
    // A viewport that came back (the chat showed a document tab meanwhile) opens
    // at the bottom, so the reader is caught up: whatever was counted is seen.
    if (linksRef.current) linksRef.current.pinnedRef.current = true;
    if (hasBeenAttached.current) linksRef.current?.onCaughtUp();
    hasBeenAttached.current = true;
    const onScroll = (): void => dispatch({
      type: 'scrolled',
      geometry: { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight },
    });
    el.addEventListener('scroll', onScroll, { passive: true });
    // Late-sizing content (images) and a resized viewport re-pin after layout.
    const observer: ResizeObserver = new ResizeObserver((): void => dispatch({ type: 'resized' }));
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    cleanup.current = (): void => { el.removeEventListener('scroll', onScroll); observer.disconnect(); };
  });
  useEffect(() => (): void => cleanup.current?.(), []);

  // After layout, so scrollHeight already includes the new messages.
  useLayoutEffect(() => {
    const el: HTMLElement | null = viewportRef.current;
    const before: readonly T[] = previous.current;
    previous.current = items;
    if (!el || items.length === 0) return;
    if (before.length === 0) {
      el.scrollTop = el.scrollHeight; // first paint lands on the latest, without animation
      return;
    }
    const added: T[] = appendedSince(before, items);
    dispatch({ type: 'appended', count: added.length, own: ownRef.current ? added.some(ownRef.current) : false });
  }, [items, viewportRef, dispatch]);

  const viewLatest: () => void = useCallback((): void => dispatch({ type: 'view' }), [dispatch]);
  const reveal: () => void = useCallback((): void => {
    dispatch({ type: 'view' });
    attached.current?.focus({ preventScroll: true });
  }, [dispatch]);
  return { unseen, viewLatest, reveal };
}
