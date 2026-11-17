import type { CallState, CallStatus } from './call-state';
import { CONNECT_TIMEOUT_MS, RING_TIMEOUT_MS } from './call-constants';

/**
 * How long each non-terminal status may last. Absent means no deadline:
 * `active` is the heartbeat watchdog's job, and the two terminal states
 * need none.
 */
const DEADLINE_MS: Partial<Record<CallStatus, number>> = {
  'ringing-out': RING_TIMEOUT_MS,
  'ringing-in': RING_TIMEOUT_MS,
  connecting: CONNECT_TIMEOUT_MS,
};

export interface DeadlineHost {
  schedule: (fn: () => void, ms: number) => () => void;
  getStatus: () => CallStatus | null;
  onExpired: (status: CallStatus) => void;
}

/**
 * A deadline for EVERY non-terminal status, not just `ringing-out`.
 *
 * The manager previously armed one timer in start() and retired it on the
 * first transition out of `ringing-out`, while the heartbeat watchdog refuses
 * to arm until `active`. That left two reachable states with no guardian:
 *
 *  - `connecting` loses the ring timer at the instant it is entered. A group
 *    call where one invitee's media session fails leaves the participant map
 *    as {B: invited, C: left} — not everyone-gone, nobody active — so the call
 *    rested there permanently with the camera live and no timer anywhere.
 *  - `ringing-in` never had one. If the caller's tab is killed no CallEnd is
 *    sent, so the callee rang indefinitely with the tone looping.
 *
 * Re-armed only when the status actually changes, so participant churn within
 * a status does not keep pushing the deadline out.
 */
export class CallDeadline {
  private cancel: (() => void) | null = null;
  private armedFor: CallStatus | null = null;

  constructor(private readonly host: DeadlineHost) {}

  observeState(next: CallState | null): void {
    const status: CallStatus | null = next?.status ?? null;
    if (status === this.armedFor) return;
    this.cancel?.();
    this.cancel = null;
    this.armedFor = status;
    if (!status) return;

    const ms: number | undefined = DEADLINE_MS[status];
    if (ms === undefined) return;

    this.cancel = this.host.schedule(() => {
      // Re-check against the state NOW: a transition can happen between the
      // callback being queued and it running.
      if (this.host.getStatus() !== status) return;
      this.host.onExpired(status);
    }, ms);
  }

  /** Retire any armed deadline; for manager teardown. */
  stop(): void {
    this.cancel?.();
    this.cancel = null;
    this.armedFor = null;
  }
}
