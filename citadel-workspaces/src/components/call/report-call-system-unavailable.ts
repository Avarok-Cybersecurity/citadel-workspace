/**
 * Saying so when the call runtime could not be built.
 *
 * `use-call-runtime` resolves null on a build failure with only a `debugLog`,
 * and all three consumers did `if (!manager) return;` — a guard that reports to
 * nobody, on the feature's front door. Pressing Call did nothing at all, so the
 * user pressed it again; pressing Accept did nothing while the ring tone kept
 * playing; and an inbound signal was dropped, so an incoming call never
 * appeared on screen at all while the caller waited out the timeout and was
 * told the callee did not answer.
 *
 * Three sentences rather than one, because the three moments are different and
 * "something went wrong" would leave the callee wondering whether the caller
 * saw anything.
 */

import { toast } from 'sonner';

export type CallMoment = 'start' | 'accept' | 'inbound';

const MESSAGES: Record<CallMoment, { title: string; description: string }> = {
  start: {
    title: 'Calling is not available right now',
    description: 'The call system could not start. Reload the page and try again.',
  },
  accept: {
    title: 'Could not answer the call',
    description: 'The call system is not ready. Reload the page and ask them to call again.',
  },
  inbound: {
    title: 'Missed an incoming call',
    description: 'The call system could not start. Reload the page to receive calls.',
  },
};

export function reportCallSystemUnavailable(moment: CallMoment): void {
  const { title, description } = MESSAGES[moment];
  toast.error(title, { description });
}
