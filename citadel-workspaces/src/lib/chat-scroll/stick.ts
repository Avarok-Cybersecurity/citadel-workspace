/**
 * Whether a chat should follow its newest message, and how many the reader has
 * not seen. Plain numbers in, plain decisions out: no DOM, so every rule is
 * tested directly. The hook that applies it (use-stick-to-bottom) is a shell.
 *
 * "Pinned" is judged from the position the reader LEFT the list in (the last
 * scroll event), never from a measurement taken after new content has grown
 * scrollHeight -- that is how a new message made a reader who was at the
 * bottom look "far from the bottom" and be left behind.
 */

export interface Geometry {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Within this many pixels of the end counts as being at the bottom (sub-pixel and rounding slack). */
export const AT_BOTTOM_PX: number = 24;

export interface StickState {
  pinned: boolean;
  /** Messages that arrived while the reader was not at the bottom. */
  unseen: number;
  /** A programmatic smooth scroll to the bottom is under way. */
  following: boolean;
  lastTop: number;
}

export type StickEvent =
  | { type: 'scrolled'; geometry: Geometry }
  | { type: 'appended'; count: number; own: boolean }
  | { type: 'resized' }
  | { type: 'view' };

export interface StickStep {
  state: StickState;
  /** The shell should scroll to the bottom now. */
  scroll: boolean;
}

export const INITIAL_STICK: StickState = { pinned: true, unseen: 0, following: false, lastTop: 0 };

export function atBottom(g: Geometry): boolean {
  return g.scrollHeight - g.scrollTop - g.clientHeight <= AT_BOTTOM_PX;
}

export function step(state: StickState, event: StickEvent): StickStep {
  switch (event.type) {
    case 'scrolled': {
      const g: Geometry = event.geometry;
      if (atBottom(g)) return { state: { pinned: true, unseen: 0, following: false, lastTop: g.scrollTop }, scroll: false };
      // Our own smooth scroll passes through positions that are not the bottom;
      // only a move UP is the reader taking over.
      if (state.following && g.scrollTop >= state.lastTop) {
        return { state: { ...state, lastTop: g.scrollTop }, scroll: false };
      }
      return { state: { ...state, pinned: false, following: false, lastTop: g.scrollTop }, scroll: false };
    }
    case 'appended': {
      if (event.count <= 0) return { state, scroll: false };
      if (state.pinned || event.own) return { state: { ...state, pinned: true, unseen: 0, following: true }, scroll: true };
      return { state: { ...state, unseen: state.unseen + event.count }, scroll: false };
    }
    case 'resized':
      return { state, scroll: state.pinned };
    case 'view':
      return { state: { ...state, pinned: true, unseen: 0, following: true }, scroll: true };
  }
}

/**
 * The items added at the END of the list since `previous`. Items prepended (an
 * older page loading), edited or re-ordered in place add nothing, and an empty
 * `previous` is the first paint, which is a jump rather than an arrival.
 */
export function appendedSince<T extends { readonly id: string }>(previous: readonly T[], next: readonly T[]): T[] {
  if (previous.length === 0 || next.length === 0) return [];
  const lastKnown: string = previous[previous.length - 1].id;
  const at: number = next.findIndex((item: T): boolean => item.id === lastKnown);
  return at === -1 ? [] : next.slice(at + 1);
}

/** Beyond this the exact number stops helping and only widens the pill. */
export const LABEL_CAP: number = 99;

/** "3 new messages" / "1 new message" / "99+ new messages". */
export function unseenLabel(count: number): string {
  const shown: string = count > LABEL_CAP ? `${LABEL_CAP}+` : String(count);
  return `${shown} new ${count === 1 ? 'message' : 'messages'}`;
}
