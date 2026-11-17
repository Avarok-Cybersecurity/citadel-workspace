/**
 * Getting connected with someone whose chat you opened before you were registered.
 *
 * The chat opens regardless (owner, 2026-10-15). When the server says the sender's effective
 * trust covers the peer, the request goes out on open with no click; otherwise the person is
 * offered the button. Which banner follows depends on the PEER's side: their client takes the
 * request unasked when their trust covers us ("Connecting…"), and otherwise they must accept.
 *
 * Effects are injected: the trust check (fail-closed, lib/messaging-trust/peer-trust.ts), the
 * send (the discovery hook's, which correlates refusals), and the outgoing-request record.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { PeerTrust } from '@/lib/workspace-service/messaging-trust-operations';
import { UNTRUSTED } from '@/lib/messaging-trust/peer-trust';

/** `offer`: the button. `sending`: the request is leaving. `connecting` / `waiting`: it left. */
export type ConnectStage = 'offer' | 'sending' | 'connecting' | 'waiting';

export interface ConnectRequestDeps {
  askTrust: () => Promise<PeerTrust>;
  /**
   * Resolves true once the request is on the wire; false when it was not sent (already said why).
   * `announce` is false for the send made on open: nobody asked for it, so nothing pops up.
   */
  send: (announce: boolean) => Promise<boolean>;
  /** A request of ours to this peer is already outstanding. */
  alreadyAsked: () => boolean;
}

/** Where a sent (or unsent) request leaves the banner. */
export function stageAfterSend(sent: boolean, peerTrustsCaller: boolean): ConnectStage {
  if (!sent) return 'offer';
  return peerTrustsCaller ? 'connecting' : 'waiting';
}

export interface ConnectRequest {
  stage: ConnectStage;
  request: () => void;
}

/**
 * `ready` is false until the session that would send is known; `registered` ends it all.
 */
export function useConnectRequest(registered: boolean, ready: boolean, deps: ConnectRequestDeps): ConnectRequest {
  const [stage, setStage] = useState<ConnectStage>('offer');
  const depsRef: MutableRefObject<ConnectRequestDeps> = useRef<ConnectRequestDeps>(deps);
  depsRef.current = deps;
  const peerTrustsCaller: MutableRefObject<boolean> = useRef<boolean>(false);

  const sendNow: (announce: boolean) => Promise<void> = useCallback(async (announce: boolean): Promise<void> => {
    setStage('sending');
    const sent: boolean = await depsRef.current.send(announce).catch((): boolean => false);
    setStage(stageAfterSend(sent, peerTrustsCaller.current));
  }, []);

  useEffect((): (() => void) => {
    let live: boolean = true;
    // A re-run cancels the run before it (StrictMode mounts twice): only the live one acts, and
    // an outstanding request is never sent twice.
    if (registered || !ready) return (): void => { live = false; };
    if (depsRef.current.alreadyAsked()) setStage('waiting');
    const decide = async (): Promise<void> => {
      const trust: PeerTrust = await depsRef.current.askTrust().catch((): PeerTrust => UNTRUSTED);
      if (!live) return;
      peerTrustsCaller.current = trust.peerTrustsCaller;
      if (!trust.trusted) return;
      if (depsRef.current.alreadyAsked()) setStage(stageAfterSend(true, trust.peerTrustsCaller));
      else await sendNow(false);
    };
    const _: Promise<void> = decide();
    return (): void => { live = false; };
  }, [registered, ready, sendNow]);

  const request: () => void = useCallback((): void => { const _: Promise<void> = sendNow(true); }, [sendNow]);
  return { stage, request };
}
