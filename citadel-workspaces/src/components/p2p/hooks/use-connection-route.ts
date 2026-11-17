/**
 * This session's live path to a peer, for the chat header.
 *
 * Re-read on a path change and on the link going up or down, so the header
 * follows the connection from "Relayed" to "Direct" (or back) as it happens.
 */
import { useEffect, useState } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { connectionRouteFor } from '@/lib/p2p-auto-connect-service/connection-path';
import { PATH_CHANGED_EVENT } from '@/lib/p2p-auto-connect-service/path-changes';
import type { PeerPathReport } from '@/types/ice-servers';

const REFRESH_EVENTS: readonly string[] = [PATH_CHANGED_EVENT, 'p2p-connection-established', 'p2p-connection-lost'];

export function useConnectionRoute(sessionCid: bigint | null, peerCid: bigint): PeerPathReport | null {
  const [route, setRoute] = useState<PeerPathReport | null>(() => connectionRouteFor(sessionCid, peerCid));
  useEffect(() => {
    const refresh = (): void => setRoute(connectionRouteFor(sessionCid, peerCid));
    refresh();
    const offs: (() => void)[] = REFRESH_EVENTS.map((event: string) => eventEmitter.on(event, refresh));
    return (): void => { for (const off of offs) off(); };
  }, [sessionCid, peerCid]);
  return route;
}
