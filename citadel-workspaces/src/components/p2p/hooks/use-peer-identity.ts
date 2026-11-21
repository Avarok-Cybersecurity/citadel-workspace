/**
 * What the agent knows about a peer's identity key, for the chat: the verified mark, the
 * safety number, and a changed key waiting for the person's decision.
 *
 * Read from the agent (`GetPeerIdentity`) when the chat opens, whenever the link comes up, and
 * when the agent reports that the peer signed with another key. The agent keeps the pins; this
 * keeps only the latest answer.
 */
import { useCallback, useEffect, useState } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { getPeerIdentity } from '@/lib/peer-identity/requests';
import { peerKeyChangeOf, type PeerIdentityView, type PeerKeyChange } from '@/lib/peer-identity/wire';

export interface PeerIdentityBinding {
  /** Null until the agent answers, or with no session. */
  view: PeerIdentityView | null;
  /** Why the agent could not say; shown instead of a mark that would claim either way. */
  error: string | null;
  refresh: () => void;
}

const LINK_EVENTS: readonly string[] = ['p2p-connection-established', 'p2p-connection-lost'];

export function usePeerIdentity(sessionCid: bigint | null, peerCid: bigint): PeerIdentityBinding {
  const [view, setView] = useState<PeerIdentityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<number>(0);
  const refresh: () => void = useCallback((): void => setAsked((n: number): number => n + 1), []);

  useEffect(() => {
    if (sessionCid === null) return undefined;
    let live: boolean = true;
    getPeerIdentity(sessionCid, peerCid).then(
      (answer: PeerIdentityView): void => { if (live) { setView(answer); setError(null); } },
      (failure: unknown): void => { if (live) setError(failure instanceof Error ? failure.message : String(failure)); },
    );
    return (): void => { live = false; };
  }, [sessionCid, peerCid, asked]);

  useEffect(() => {
    if (sessionCid === null) return undefined;
    const onWire = (message: unknown): void => {
      const change: PeerKeyChange | null = peerKeyChangeOf(message);
      if (change !== null && change.cid === sessionCid && change.peerCid === peerCid) refresh();
    };
    const offs: (() => void)[] = [
      eventEmitter.on('websocket-message', onWire),
      ...LINK_EVENTS.map((event: string): (() => void) => eventEmitter.on(event, refresh)),
    ];
    return (): void => { for (const off of offs) off(); };
  }, [sessionCid, peerCid, refresh]);

  return { view, error, refresh };
}
