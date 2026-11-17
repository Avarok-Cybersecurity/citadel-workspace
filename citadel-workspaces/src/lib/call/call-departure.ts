/**
 * The tab a call lives in, closing mid-call.
 *
 * The call lives in the tab whose session is in it. When that tab closes, its
 * CallEnd would go out through the leader -- an async path through the
 * messenger that a closing document does not live to finish. The peer heard
 * nothing and sat in a dead call until its heartbeat timeout, camera on.
 *
 * A BroadcastChannel post IS synchronous, so on `pagehide` a follower hands
 * the leader what it needs to end the call for it: the session, the call and
 * who is in it. The leader, which stays, says goodbye on the session's behalf
 * and releases the media sessions. A leader closing on its own call has
 * nobody to hand to, so it starts its own hang-up and the peer's heartbeat
 * timeout remains the backstop (call-liveness.ts).
 */
import type { CallState } from './call-state';
import type { CallTransport } from './call-transport';
import type { CallSignalPayload } from '@/types/p2p-commands';

export const CALL_DEPARTED: 'call-departed' = 'call-departed';

export interface CallDeparted {
  cid: bigint;
  callId: string;
  peers: bigint[];
}

/** What a closing tab hands over: only a call still in progress. */
export function departureOf(state: CallState | null, selfCid: bigint | null): CallDeparted | null {
  if (!state || selfCid === null) return null;
  if (state.status === 'ended' || state.status === 'failed') return null;
  return { cid: selfCid, callId: state.callId, peers: [...state.participants.keys()] };
}

/** A 'call-departed' channel payload, or null for anything else (it crosses documents). */
export function readCallDeparted(payload: unknown): CallDeparted | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p: Record<string, unknown> = payload as Record<string, unknown>;
  if (typeof p.cid !== 'bigint' || typeof p.callId !== 'string' || !Array.isArray(p.peers)) return null;
  if (!p.peers.every((peer: unknown): boolean => typeof peer === 'bigint')) return null;
  return { cid: p.cid, callId: p.callId, peers: p.peers as bigint[] };
}

export interface DepartureDeps {
  isLeader: () => boolean;
  /** The ordinary call transport, as the departed session: the same requests its own tab would send. */
  transportFor: (cid: bigint) => CallTransport;
  reportFailure: (peerCid: bigint, error: unknown) => void;
}

/** The leader ending a departed tab's call for it. Every peer, each on its own. */
export async function endForDepartedTab(payload: unknown, deps: DepartureDeps): Promise<void> {
  if (!deps.isLeader()) return;
  const departed: CallDeparted | null = readCallDeparted(payload);
  if (!departed) return;
  const transport: CallTransport = deps.transportFor(departed.cid);
  const bye: CallSignalPayload = { kind: 'CallEnd', call_id: departed.callId, reason: 'hangup' };
  await Promise.all(
    departed.peers.map(async (peerCid: bigint): Promise<void> => {
      try {
        await transport.sendSignal(peerCid, bye);
        await transport.closeSession(peerCid);
      } catch (error: unknown) {
        deps.reportFailure(peerCid, error);
      }
    }),
  );
}
