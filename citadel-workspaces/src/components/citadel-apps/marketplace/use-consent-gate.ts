/**
 * The consent panel's overlay guard, fed from the page: the panel counts as shown from its mount
 * while the tab is visible (hiding the tab starts the 600 ms again), and any pointer movement or
 * focus-moving key after that counts as the person being there. See lib/citadel-apps/consent-gate.ts.
 *
 * Only the timer reads the clock. A timer can fire before its clock says the time is up (Node
 * arms timers from the event loop's cached time), so a fire that is early arms the timer again
 * for what is left rather than drawing a closed button nothing would draw again.
 */
import { useEffect, useReducer } from 'react';
import type { Clock } from '@/lib/cdoc/collab/ports';
import { gateOpen, gateReducer, HIDDEN_GATE, msUntilElapsed, NAVIGATION_KEYS } from '@/lib/citadel-apps/consent-gate';

export function useConsentGate(clock: Clock): boolean {
  const [state, dispatch] = useReducer(gateReducer, HIDDEN_GATE);

  useEffect(() => {
    const visibility = (): void => {
      dispatch(document.visibilityState === 'visible' ? { kind: 'shown', at: clock.now() } : { kind: 'hidden' });
    };
    const moved = (): void => dispatch({ kind: 'moved' });
    const key = (event: KeyboardEvent): void => { if (NAVIGATION_KEYS.has(event.key)) moved(); };
    visibility();
    window.addEventListener('pointermove', moved);
    window.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', visibility);
    return (): void => {
      window.removeEventListener('pointermove', moved);
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [clock]);

  const { shownAt, elapsed } = state;
  useEffect(() => {
    if (shownAt === null || elapsed) return undefined;
    let cancel: () => void = (): void => {};
    const check = (): void => {
      const now: number = clock.now();
      const wait: number = msUntilElapsed(shownAt, now);
      if (wait === 0) dispatch({ kind: 'clock', at: now });
      else cancel = clock.after(wait, check);
    };
    check();
    return (): void => cancel();
  }, [shownAt, elapsed, clock]);

  return gateOpen(state);
}
