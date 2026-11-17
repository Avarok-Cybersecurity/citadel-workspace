import { useRef } from 'react';
import type React from 'react';
import type { CallStatus } from '@/lib/call/call-state';

/**
 * When the call last entered the status it is in.
 *
 * CI reported a group call as `stage says Call connecting` and nothing else,
 * for the full sixty seconds a spec was willing to wait. `connecting` has a
 * thirty-second deadline that fails the call, and the manager honours it —
 * there is a test driving the real manager with a hung media open that proves
 * so. Which leaves two possibilities that the label cannot tell apart: the
 * deadline never armed, or the call re-entered `connecting` and the clock kept
 * restarting.
 *
 * The age of the status separates them, and it is the one number the surface
 * does not show. Exposed as data rather than folded into the accessible name:
 * a name that changes every second is one a screen reader re-announces every
 * second, which is why the duration on the controls is `aria-hidden`.
 *
 * A ref rather than state, and a timestamp rather than an elapsed count, so
 * nothing here schedules a render.
 */
export function useStatusSince(status: CallStatus, now: () => number = Date.now): number {
  const seen: React.MutableRefObject<{ status: CallStatus; at: number } | null> =
    useRef<{ status: CallStatus; at: number } | null>(null);
  if (seen.current === null || seen.current.status !== status) {
    seen.current = { status, at: now() };
  }
  return seen.current.at;
}
