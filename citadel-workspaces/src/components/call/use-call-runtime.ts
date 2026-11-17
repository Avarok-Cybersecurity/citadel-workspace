/**
 * Lazy construction and teardown of the call runtime — the CallManager /
 * CallSession pair.
 *
 * Owns the race-safety rules (memoised in-flight construction, re-check after
 * awaited imports) and the on-demand imports that keep the codec table and
 * WebCodecs pipeline out of the entry chunk. Split from CallProvider.tsx so
 * the provider exposes call actions while the how-the-machinery-comes-to-exist
 * story lives here.
 */

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction , type MutableRefObject } from 'react';
import { rosterPeerName } from '@/lib/roster-peer-name';
import { debugLog } from '@/lib/debug-config';
import { CallManager } from '@/lib/call/call-manager';
import { verdictFromLink } from '@/lib/call/congestion';
import { WebSocketCallTransport } from '@/lib/call/websocket-call-transport';
import type { CallSession } from '@/lib/call/call-session';
import type { CallState } from '@/lib/call/call-state';
import type { CaptureFailure } from '@/lib/call/media-capture';
import type { MessageSenderConfig } from '@/lib/p2p/message-sender-types';
import type { CallCodecCapabilities, CallMediaKinds } from '@/types/call-signals';

interface UseCallRuntimeParams {
  selfCid: bigint | null;
  senderConfig: MessageSenderConfig;
  setCall: Dispatch<SetStateAction<CallState | null>>;
  setStreamsVersion: Dispatch<SetStateAction<number>>;
  setCaptureFailure: Dispatch<SetStateAction<CaptureFailure | null>>;
}

export function useCallRuntime({
  selfCid,
  senderConfig,
  setCall,
  setStreamsVersion,
  setCaptureFailure,
}: UseCallRuntimeParams): { managerRef: MutableRefObject<CallManager | null>; sessionRef: MutableRefObject<CallSession | null>; teardown: () => void; ensureManager: () => Promise<CallManager | null>; ensureSession: () => Promise<CallSession>; } {
  const managerRef: MutableRefObject<CallManager | null> = useRef<CallManager | null>(null);
  /** In-flight construction, so two callers cannot each build a manager. */
  const managerPromiseRef: MutableRefObject<Promise<CallManager | null> | null> = useRef<Promise<CallManager | null> | null>(null);
  const sessionRef: MutableRefObject<CallSession | null> = useRef<CallSession | null>(null);
  /**
   * Which CID the current manager — or the one being built — belongs to.
   *
   * A CallManager bakes `selfCid` into itself and into its transport, but
   * CallLayer keeps this provider mounted across login and workspace routes and
   * merely polls the CID. Without recording what the runtime was built for,
   * `managerRef.current` is returned to the next caller no matter whose account
   * is now signed in, and calling stays bound to the previous identity across
   * logout, reconnect and account switching.
   */
  const managerCidRef: MutableRefObject<bigint | null> = useRef<bigint | null>(null);

  /** Torn down together: a session without its manager cannot end a call. */
  const teardown: () => void = useCallback((): void => {
    sessionRef.current?.close();
    sessionRef.current = null;
    managerRef.current = null;
    managerPromiseRef.current = null;
    managerCidRef.current = null;
    setStreamsVersion((v) => v + 1);
  }, [setStreamsVersion]);

  // Identity changed, so the runtime built for the previous CID must not
  // outlive it. Hanging up first is best-effort — the transport it would go out
  // on belongs to the old identity — but a peer left ringing on a call nobody
  // is in waits out their whole timeout, so it is worth attempting.
  useEffect(() => {
    const builtFor: bigint | null = managerCidRef.current;
    if (builtFor === null || builtFor === selfCid) return;
    const manager: CallManager | null = managerRef.current;
    const state: CallState | null | undefined = manager?.getState();
    if (manager && state && state.status !== 'ended' && state.status !== 'failed') {
      void manager.end('hangup');
    }
    teardown();
  }, [selfCid, teardown]);

  const ensureManager: () => Promise<CallManager | null> = useCallback(async (): Promise<CallManager | null> => {
    if (!selfCid) return null;
    // Both caches are keyed on the identity they were built for. Reusing either
    // across a CID change is what bound calling to the previous account.
    if (managerCidRef.current !== null && managerCidRef.current !== selfCid) teardown();
    if (managerRef.current) return managerRef.current;
    // Memoized while under construction: the async gap below used to let a
    // second caller build a SECOND manager, and whichever finished last won —
    // losing the invite the first one had already handled.
    if (managerPromiseRef.current) return managerPromiseRef.current;

    const builtFor: bigint = selfCid;
    managerCidRef.current = builtFor;
    const build: Promise<CallManager | null> = (async (): Promise<CallManager | null> => {
      const { localCapabilities } = await import('@/lib/call/codec-support');
      const capabilities: CallCodecCapabilities = await localCapabilities();
      const manager: CallManager = new CallManager({
        transport: new WebSocketCallTransport({ selfCid, senderConfig }),
        selfCid,
        capabilities,
        now: () => Date.now(),
        schedule: (fn, delayMs) => {
          const id: number = window.setTimeout(fn, delayMs);
          return () => window.clearTimeout(id);
        },
        onStateChanged: (next): void => {
          setCall(next);
          if (next) {
            // A departed participant's decoders and tracks are released the
            // moment they leave: browsers cap concurrent decoders, so leaks
            // here make later joiners fail for no visible reason.
            for (const p of next.participants.values()) {
              if (p.status === 'left' || p.status === 'declined') {
                sessionRef.current?.removePeer(p.cid);
              }
            }
          }
          // Releasing the camera the moment a call reaches a terminal state,
          // not when the surface happens to unmount — the light staying on
          // after a call ends is what users notice and remember.
          //
          // Deferred by a microtask, and re-checked against the manager's own
          // state. In glare — both sides dialling each other — the manager ends
          // its own call and then adopts the incoming one, and the two happen
          // in one synchronous stretch. Tearing down on the first left
          // `managerRef` null while the reducer went on to `ringing-in`: the
          // loser saw an incoming card whose Accept and Decline both read
          // `managerRef.current` and silently no-opped, the ring tone played
          // its full 45 seconds because sound keys off React state, and the
          // orphan's own deadline then sent CallEnd to the glare WINNER,
          // killing the surviving call too.
          if (next && (next.status === 'ended' || next.status === 'failed')) {
            queueMicrotask(() => {
              const live: CallState | null | undefined = managerRef.current?.getState();
              if (!live || live.status === 'ended' || live.status === 'failed') teardown();
            });
          }
        },
        resolvePeerName: rosterPeerName,
      onKeyframeRequested: () => sessionRef.current?.requestKeyframe(),
        // The two ends of quality adaptation. The receiver already judged every
        // peer's link for the participant tiles; these carry that judgement to
        // the peer whose encoder can act on it, and apply theirs to ours.
        // Without them `applyQualityReport` had no caller at all, so congestion
        // never left rung 0 and the whole ladder was inert.
        observedLink: (cid) => sessionRef.current?.connectionQuality(Date.now()).get(cid),
        onLinkReported: (link) =>
          sessionRef.current?.applyQualityReport(verdictFromLink(link)),
      });
      // Re-checked after the two awaits above, exactly as ensureSession
      // re-checks its import: construction started under one identity can
      // finish under another, and installing it then would hand the new account
      // a manager wired to the old CID.
      if (managerCidRef.current !== builtFor) return null;
      managerRef.current = manager;
      return manager;
    })();
    // Without this catch a single failure was permanent: the rejected promise
    // stayed in the ref, the cid guard above kept matching, and every later
    // start/accept/inbound-signal awaited the SAME rejection — unhandled, with
    // no toast and no retry. One flaky chunk fetch, or a redeploy that
    // invalidated the hash of the dynamically imported codec table, disabled
    // calling until a full page reload.
    //
    // Resolving null rather than rethrowing: every caller already handles a null
    // manager, and the call sites are `void (async …)` wrappers where a
    // rethrow would only become an unhandled rejection.
    const guarded: Promise<CallManager | null> = build.catch((error: unknown) => {
      debugLog('Call', 'call runtime failed to initialise', error);
      if (managerPromiseRef.current === guarded) {
        managerPromiseRef.current = null;
        managerCidRef.current = null;
      }
      return null;
    });
    managerPromiseRef.current = guarded;
    return guarded;
  }, [selfCid, senderConfig, teardown, setCall]);

  /**
   * Loaded on demand, not at import time.
   *
   * CallSession pulls in the capture pump, the WebCodecs pipeline, the codec
   * table and the receive path — none of which can possibly be needed before
   * there is a call. Imported statically it landed in the landing-page entry
   * chunk, so every visitor downloaded a video encoder before the login form
   * had painted.
   */
  const ensureSession: () => Promise<CallSession> = useCallback(async (): Promise<CallSession> => {
    if (sessionRef.current) return sessionRef.current;
    const { CallSession } = await import('@/lib/call/call-session');
    // Re-checked after the await: two callers can race this import, and the
    // second must not replace a session the first already started capturing on.
    if (sessionRef.current) return sessionRef.current;
    const session: CallSession = new CallSession({
      onFrame: (frame) => managerRef.current?.sendFrame(frame),
      onStreamsChanged: () => setStreamsVersion((v) => v + 1),
      // The other half of the speaking indicator. The reducer, the `speaking`
      // field and the ring in ParticipantTile all existed already; nothing
      // dispatched, so the ring could never appear for anyone.
      onSpeakingChanged: (speaking: boolean): void => {
        managerRef.current?.markSelfSpeaking(speaking);
      },
      onCaptureFailed: setCaptureFailure,
      // Our decoder for this peer is stuck; ask their encoder for a keyframe.
      onNeedKeyframe: (peerCid, track) => void managerRef.current?.requestKeyframe(peerCid, track),
      onTrackEnded: (kind: 'audio' | 'video'): void => {
        // Two audiences, both of which were being lied to. The local UI:
        // without this the mic button still read unmuted on a dead mic, and
        // toggling it flipped `enabled` on an ended track — a no-op that
        // still announced a state change. And the peers: heartbeats keep
        // flowing regardless of capture health, so nothing else would ever
        // have told them, and they would render an unmuted tile for a
        // microphone that stopped existing.
        //
        // Read from the manager's own state at call time rather than a
        // captured snapshot: a hub unplugged at once ends both tracks, and
        // two updates computed from one stale snapshot would each undo the
        // other.
        const current: CallMediaKinds | undefined = managerRef.current?.getState()?.selfMedia;
        if (current) {
          void managerRef.current?.setSelfMedia({ ...current, [kind]: false });
        }
        setCaptureFailure({
          kind: 'device-lost',
          message:
            kind === 'audio'
              ? 'Your microphone was disconnected. Reconnect it and rejoin the call to use it again.'
              : 'Your camera was disconnected. Reconnect it and rejoin the call to use it again.',
          // Nothing to retry: re-acquiring a device mid-call is not something
          // this session can do, and offering a retry that cannot work is
          // worse than saying so.
          retryable: false,
        });
        },
    });
    sessionRef.current = session;
    return session;
  }, [setStreamsVersion, setCaptureFailure]);

  return { managerRef, sessionRef, teardown, ensureManager, ensureSession };
}
