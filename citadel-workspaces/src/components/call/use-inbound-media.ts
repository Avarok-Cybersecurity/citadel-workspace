/**
 * Routes MediaFrameNotification / MediaGapNotification from the WebSocket
 * event stream into the live call session.
 *
 * A hook rather than provider code so the provider stays pure wiring — and so
 * the frame path, which runs 30-60 times a second, is one screen of code.
 *
 * This is also the last hop before decode and render, and the router upstream
 * is best-effort: a stale instance registry, or two tabs sharing one cid, can
 * land another session's media here (routing-rules.ts documents the paths).
 * Downstream, ReceiverPool.accept is get-or-create — a frame for ANY peer cid
 * builds a decoder and notifies the UI when its stream appears. So without the
 * two gates below, a misrouted frame did not just leak: it became a rendered
 * participant, another account's audio and video playing in a call it was
 * never part of. Every frame must therefore be (a) addressed to the session
 * this tab is running as, and (b) from a peer this tab's call actually opened
 * media with.
 */

import { useEffect, type RefObject } from 'react';
import type { CallSession } from '@/lib/call/call-session';
import { CALL_TRACK_AUDIO } from '@/types/p2p-commands';
import { eventEmitter } from '@/lib/event-emitter';
import { isForThisSession, notificationCid } from '@/lib/sessions/notification-ownership';
import { getCurrentCid } from '@/lib/p2p/current-cid';

/**
 * Cached rather than awaited per frame: `getCurrentCid` is async (its fallback
 * chain reads IndexedDB), and an await inside a 30-60/s handler both defers
 * every frame and lets a slow lookup reorder them across a fast one. The same
 * 2s cadence CallLayer already uses to poll identity is fresh enough here —
 * identity changes tear the session down anyway, which drops frames by itself.
 */
const SESSION_CID_POLL_MS: number = 2_000;

/** The wire carries u64 cids as bigint, but some paths deliver strings. */
function wireCid(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

export function useInboundMedia(sessionRef: RefObject<CallSession | null>): void {
  useEffect(() => {
    let currentCid: bigint | null = null;
    let disposed: boolean = false;
    const refreshCid = (): void => {
      void getCurrentCid()
        .then((cid: bigint | null): void => {
          if (!disposed) currentCid = cid;
        })
        .catch((): void => undefined);
    };
    refreshCid();
    const cidTimer: number = window.setInterval(refreshCid, SESSION_CID_POLL_MS);

    /**
     * Which peers this tab's call has a confirmed media session with.
     *
     * Membership never reaches this layer from the call manager, so it is
     * learned from the service's own `MediaSessionOpened` confirmations — the
     * response to the `MediaOpen` this tab sent for every answered participant,
     * mid-call joiners included, routed back by request_id to the tab that
     * asked. A frame from a peer the service never confirmed is a misroute (or
     * a stray), and decoding it is what turned it into a participant.
     *
     * Keyed to the CallSession instance: one session exists per call and is
     * discarded at teardown, so admissions cannot leak into the next call.
     * `MediaSessionClosed` deliberately does NOT revoke here — a late close
     * from a timed-out open attempt racing a successful retry would silence a
     * live peer for the rest of the call.
     */
    let admittedFor: CallSession | null = null;
    let admitted: Set<bigint> = new Set<bigint>();

    const admits = (session: CallSession, peerCid: bigint): boolean =>
      admittedFor === session && admitted.has(peerCid);

    const onMessage = (message: Record<string, unknown>): void => {
      // Every variant handled here carries the RECIPIENT session in `cid`. A
      // mismatch means the router delivered another session's call to this
      // tab; acting on it is exactly the defect this gate exists to close.
      const addressedTo: bigint | null = notificationCid(message);

      const opened: { peer_cid: bigint } | undefined = message.MediaSessionOpened as
        | { peer_cid: bigint }
        | undefined;
      if (opened) {
        const session: CallSession | null = sessionRef.current;
        if (!session) return;
        if (!isForThisSession(addressedTo, currentCid)) return;
        const peerCid: bigint | null = wireCid(opened.peer_cid);
        if (peerCid === null) return;
        if (admittedFor !== session) {
          admittedFor = session;
          admitted = new Set<bigint>();
        }
        admitted.add(peerCid);
        return;
      }

      const frame: { cid: bigint; peer_cid: bigint; track: number; kind: number; timestamp: number; flags: number; payload: number[]; } | undefined = message.MediaFrameNotification as
        | { cid: bigint; peer_cid: bigint; track: number; kind: number; timestamp: number; flags: number; payload: number[] }
        | undefined;
      if (frame) {
        const session: CallSession | null = sessionRef.current;
        if (!session) return;
        if (!isForThisSession(addressedTo, currentCid)) return;
        const peerCid: bigint | null = wireCid(frame.peer_cid);
        // Dropped, not decoded: an unknown peer must not become a participant.
        if (peerCid === null || !admits(session, peerCid)) return;
        session.acceptFrame(peerCid, {
          track: frame.track,
          kind: frame.kind,
          timestamp: frame.timestamp,
          flags: frame.flags,
          payload: new Uint8Array(frame.payload),
        });
        return;
      }

      const gap: { peer_cid: bigint; track: number; } | undefined = message.MediaGapNotification as
        | { peer_cid: bigint; track: number }
        | undefined;
      if (gap) {
        const session: CallSession | null = sessionRef.current;
        if (!session) return;
        // Same gates as frames: a gap drives keyframe requests and the quality
        // tracker, and another session's gaps must not steer this call.
        if (!isForThisSession(addressedTo, currentCid)) return;
        const peerCid: bigint | null = wireCid(gap.peer_cid);
        if (peerCid === null || !admits(session, peerCid)) return;
        // The keyframe request, when video needs one, flows back through the
        // session's onNeedKeyframe callback with the affected track.
        session.acceptGap(peerCid, gap.track, gap.track !== CALL_TRACK_AUDIO);
      }
    };
    eventEmitter.on('websocket-message', onMessage);
    return (): void => {
      disposed = true;
      window.clearInterval(cidTimer);
      eventEmitter.off('websocket-message', onMessage);
    };
  }, [sessionRef]);
}
