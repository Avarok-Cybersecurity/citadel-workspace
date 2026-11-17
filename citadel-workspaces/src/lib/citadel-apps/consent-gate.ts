/**
 * The Install button's guard against an overlay that tricks a click onto it: Install is enabled
 * only once the consent panel has been on screen for 600 ms, continuously, AND the person has
 * moved the pointer since it appeared (a keyboard user's Tab or arrow counts: they are driving
 * the page, and an overlay cannot type for them). Clickjacking from another site is already
 * refused by `frame-ancestors 'none'`; this is for something drawn over the dialog in this page.
 *
 * Pure: the hook in components/citadel-apps feeds it times and events. Whether the 600 ms have
 * run is decided once, from one clock reading, when the hook's timer fires; drawing the button
 * reads only this state, so a draw and a timer can never disagree about the time.
 */

export const CONSENT_VISIBLE_MS: number = 600;

export interface GateState {
  /** When the panel last became visible; null while it is hidden. */
  shownAt: number | null;
  /** Whether the person moved the pointer (or used the keyboard) since then. */
  moved: boolean;
  /** Whether a clock reading has shown the panel visible for CONSENT_VISIBLE_MS since shownAt. */
  elapsed: boolean;
}

export const HIDDEN_GATE: GateState = { shownAt: null, moved: false, elapsed: false };

export type GateEvent = { kind: 'shown'; at: number } | { kind: 'hidden' } | { kind: 'moved' } | { kind: 'clock'; at: number };

/** How long, at `now`, until a panel shown at `shownAt` has been visible long enough; 0 once it has. */
export function msUntilElapsed(shownAt: number, now: number): number {
  return Math.max(0, shownAt + CONSENT_VISIBLE_MS - now);
}

export function gateReducer(state: GateState, event: GateEvent): GateState {
  switch (event.kind) {
    case 'shown': return state.shownAt === null ? { shownAt: event.at, moved: false, elapsed: false } : state;
    case 'hidden': return HIDDEN_GATE;
    case 'moved': return state.shownAt === null ? state : { ...state, moved: true };
    case 'clock': return state.shownAt === null || msUntilElapsed(state.shownAt, event.at) > 0 ? state : { ...state, elapsed: true };
  }
}

export function gateOpen(state: GateState): boolean {
  return state.shownAt !== null && state.moved && state.elapsed;
}

/** Keys that move focus, so a keyboard user can satisfy the guard without a pointer. */
export const NAVIGATION_KEYS: ReadonlySet<string> = new Set(['Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp']);
