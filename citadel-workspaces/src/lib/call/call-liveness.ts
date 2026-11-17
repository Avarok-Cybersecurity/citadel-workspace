/**
 * Keeps a call honest about who is still in it.
 *
 * Without this, the far side learns a call has ended ONLY from a CallEnd
 * signal. A tab closed hard, a lid shut, a network that drops — any of those
 * and the other person sits in a dead call with their camera on, because
 * nothing ever tells them otherwise.
 *
 * Absence of media frames cannot be used as the signal: a participant who muted
 * and turned their camera off sends nothing at all and is still very much
 * present. So presence is announced explicitly, on the reliable path, and
 * silence is what means gone.
 */

import { CALL_HEARTBEAT_INTERVAL_MS, CALL_HEARTBEAT_TIMEOUT_MS } from './call-constants';

export interface CallLivenessOptions {
  /** Injected so tests are not at the mercy of a real clock. */
  now: () => number;
  schedule: (fn: () => void, delayMs: number) => () => void;
  /** Announce that we are still here. */
  sendHeartbeat: () => void;
  /** A participant has gone silent for too long. */
  onPeerLost: (cid: bigint) => void;
  /**
   * Every tick, before the silence sweep.
   *
   * Exists so a deadline that is NOT about silence can share this timer rather
   * than start a second one. An invitee who never answers sends nothing to be
   * silent with, so `lastSeen` can never expire them.
   */
  onTick?: (now: number) => void;
}

export class CallLiveness {
  private readonly lastSeen: Map<bigint, number> = new Map<bigint, number>();
  private cancelTick: (() => void) | null = null;

  constructor(private readonly options: CallLivenessOptions) {}

  /** Begin tracking, treating every participant as just-seen. */
  start(peers: readonly bigint[]): void {
    const now: number = this.options.now();
    for (const cid of peers) this.lastSeen.set(cid, now);
    this.tick();
  }

  /** Record that a participant is still there. Any signal from them counts. */
  seen(cid: bigint): void {
    // Any inbound signal proves presence, not just a heartbeat — a peer sending
    // media-state changes or keyframe requests is plainly alive, and requiring a
    // heartbeat specifically would evict someone who is demonstrably talking.
    this.lastSeen.set(cid, this.options.now());
  }

  /** Stop tracking a participant who left for a known reason. */
  forget(cid: bigint): void {
    this.lastSeen.delete(cid);
  }

  stop(): void {
    this.cancelTick?.();
    this.cancelTick = null;
    this.lastSeen.clear();
  }

  private tick(): void {
    this.cancelTick = this.options.schedule(() => {
      this.options.sendHeartbeat();

      const now: number = this.options.now();
      this.options.onTick?.(now);
      for (const [cid, seen] of [...this.lastSeen]) {
        if (now - seen >= CALL_HEARTBEAT_TIMEOUT_MS) {
          // Removed BEFORE notifying: the callback ends the call for this peer,
          // which can re-enter here, and a peer reported lost twice would be
          // removed from a participant list it is no longer in.
          this.lastSeen.delete(cid);
          this.options.onPeerLost(cid);
        }
      }

      // Rescheduled rather than an interval: an interval keeps firing after the
      // call is gone if a teardown path misses it, and this way the only way it
      // continues is by explicitly asking to.
      if (this.cancelTick) this.tick();
    }, CALL_HEARTBEAT_INTERVAL_MS);
  }
}
