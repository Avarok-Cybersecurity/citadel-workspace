/**
 * Ties CallLiveness to the call lifecycle.
 *
 * CallLiveness knows only about timestamps; this module knows when a call is
 * the kind of thing that needs watching (active), who counts as present, and
 * what "gone" means to the reducer. Kept out of CallManager so the manager
 * stays pure orchestration and within its size budget.
 */

import type { CallSignalPayload } from '@/types/p2p-commands';
import { RING_TIMEOUT_MS } from './call-constants';
import { CallLiveness } from './call-liveness';
import type { CallManagerInternals } from './call-manager-internals';
import type { CallState } from './call-state';
import type { CallTransport } from './call-transport';
import { closeIfFinished, closeSessionFor } from './media-session-lifecycle';

/** The slice of CallManagerOptions the liveness wiring needs. */
export interface CallLivenessBindingOptions {
  transport: CallTransport;
  now: () => number;
  schedule: (fn: () => void, delayMs: number) => () => void;
}

/** Who is expected to heartbeat us — and whom we heartbeat in return. */
function presentPeers(state: CallState): bigint[] {
  return [...state.participants.values()]
    .filter((p) => p.status === 'active' || p.status === 'connecting')
    .map((p) => p.cid);
}

/**
 * A peer that went silent past the timeout is treated exactly as one that said
 * goodbye: same reducer event, same session teardown. The reducer then ends a
 * 1:1 call outright, while a group call carries on for everyone else — the
 * distinction is its rule, not duplicated here.
 */
export async function peerLostBecauseSilent(
  m: CallManagerInternals,
  cid: bigint,
): Promise<void> {
  m.apply({ type: 'peer-left', cid });
  await closeSessionFor(m, cid);
  await closeIfFinished(m);
}

export class CallLivenessBinding {
  private readonly liveness: CallLiveness;
  private running: boolean = false;

  /**
   * When each still-unanswered invitee was first seen with the call up.
   *
   * `active` deliberately has no status deadline — the heartbeat watchdog owns
   * it. But that watchdog only tracks peers who are `active` or `connecting`,
   * and an invitee who never answers is neither: `invite-sent` seeds them
   * `'invited'` and nothing ages that out once the call leaves `ringing-out`.
   *
   * They then block BOTH end conditions — `anyoneActive` is false (invited is
   * not active or connecting) and `everyoneGone` is false (invited is not left
   * or declined). So when the last real participant hung up, the call stayed
   * `active` with nobody in it: stage docked, duration ticking, camera light
   * on, and the phantom tile still rendered. Leave still worked, but only if
   * the user noticed. "Camera on, nobody there, no timer anywhere" is the exact
   * failure CONNECT_TIMEOUT_MS was introduced to prevent one state earlier.
   */
  private readonly invitedSince: Map<bigint, number> = new Map<bigint, number>();

  private readonly now: () => number;

  constructor(options: CallLivenessBindingOptions, internals: () => CallManagerInternals) {
    this.now = options.now;
    this.liveness = new CallLiveness({
      now: options.now,
      schedule: options.schedule,
      sendHeartbeat: (): void => {
        const state: CallState | null = internals().getState();
        if (!state) return;
        for (const cid of presentPeers(state)) {
          // Built per peer, not once for the whole fan-out: the verdict is
          // about THIS peer's stream as it reaches us, and sending one peer's
          // judgement to everyone would have every encoder chase the worst link
          // in the call.
          const link: "good" | "fair" | "poor" | "lost" | undefined = internals().observedLink(cid);
          // Key omitted rather than set to undefined: this is CBOR-encoded, and
          // an explicit undefined is a value on the wire, not an absence.
          const beat: CallSignalPayload = link
            ? { kind: 'CallHeartbeat', call_id: state.callId, link }
            : { kind: 'CallHeartbeat', call_id: state.callId };
          // Best-effort: a heartbeat that fails to send looks to the peer like
          // one lost in transit, and their timeout already covers that case.
          void options.transport.sendSignal(cid, beat).catch(() => undefined);
        }
      },
      onTick: (now): void => {
        for (const [cid, since] of [...this.invitedSince]) {
          if (now - since < RING_TIMEOUT_MS) continue;
          // Deleted BEFORE notifying, matching the silence sweep: the callback
          // ends the call for this peer and can re-enter here.
          this.invitedSince.delete(cid);
          void peerLostBecauseSilent(internals(), cid);
        }
      },
      onPeerLost: (cid): undefined => void peerLostBecauseSilent(internals(), cid),
    });
  }

  /** Called on every state transition; starts, prunes, or stops tracking. */
  observeState(state: CallState | null): void {
    if (!state || state.status === 'ended' || state.status === 'failed') {
      if (this.running) {
        this.liveness.stop();
        this.running = false;
      }
      return;
    }
    if (!this.running) {
      // Armed only once the call is genuinely up. Earlier states have their own
      // guardians — an unanswered dial is the ring timeout's job, and starting
      // during ringing would evict invitees who simply have not picked up yet.
      if (state.status !== 'active') return;
      this.liveness.start(presentPeers(state));
      this.running = true;
      // Falls THROUGH to the seeding loop below rather than returning.
      //
      // In a group call this transition is exactly the moment some peers are
      // still `invited` — the call goes active when the FIRST peer connects.
      // Returning here skipped seeding their `invitedSince`, so their clock
      // started only if some later transition happened to arrive. An invitee
      // whose tab is closed produces no transitions at all: nothing to accept,
      // nothing to decline, no media, no signal. They stayed on "invited" in
      // everyone's roster for the rest of the call, which is the exact case
      // this clock exists for.
    }
    // A peer who left or declined for a known reason must not later be
    // reported lost as well.
    for (const p of state.participants.values()) {
      if (p.status === 'left' || p.status === 'declined') this.liveness.forget(p.cid);

      // Start an invitee's clock the moment the call is up, and stop it as soon
      // as they become anything else. Their own ring timeout covers the dial;
      // this covers the invitee whose tab is closed, who will never send
      // anything at all and so can never be timed out by silence.
      if (p.status === 'invited') {
        if (!this.invitedSince.has(p.cid)) this.invitedSince.set(p.cid, this.now());
      } else {
        this.invitedSince.delete(p.cid);
      }
    }
  }

  /** Any inbound signal for the current call proves the sender is alive. */
  peerSeen(cid: bigint): void {
    if (this.running) this.liveness.seen(cid);
  }
}
