/**
 * A peer connection's path, kept current.
 *
 * The agent delivers a connection as soon as it works over the server relay and
 * upgrades it in the background, so PeerConnectSuccess says where traffic goes
 * at delivery, not where it will end up. Every later change arrives as a
 * PeerPathChangedNotification: `request_id` null, `cid` the session it belongs
 * to, routed by cid to the tab that holds that session.
 *
 * The leader records each change it sees on the wire too, although the router
 * hands it to another tab: the snapshot the leader sends a late follower
 * (follower-snapshot) is read from the leader's record, and would otherwise
 * carry the first path for ever.
 */
import type { PeerPathReport } from '@/types/ice-servers';
import { parsePeerPathReport } from '@/lib/ice-servers/path';

export const PATH_CHANGED_EVENT: 'p2p:path-changed' = 'p2p:path-changed';

export interface PathChange {
  cid: bigint;
  peerCid: bigint;
  route: PeerPathReport;
}

/** The change a wire message carries; null for anything but a well-formed PeerPathChangedNotification. */
export function pathChangeOf(message: unknown): PathChange | null {
  if (typeof message !== 'object' || message === null) return null;
  const v: unknown = (message as { PeerPathChangedNotification?: unknown }).PeerPathChangedNotification;
  if (typeof v !== 'object' || v === null) return null;
  const { cid, peer_cid }: { cid?: unknown; peer_cid?: unknown } = v as { cid?: unknown; peer_cid?: unknown };
  const route: PeerPathReport | null = parsePeerPathReport(v);
  if (typeof cid !== 'bigint' || typeof peer_cid !== 'bigint' || route === null) return null;
  return { cid, peerCid: peer_cid, route };
}

export interface PathChangeDeps {
  bus: {
    on: (event: string, handler: (payload: unknown) => void) => unknown;
    emit: (event: string, change: PathChange) => void;
  };
  isLeader: () => boolean;
  /** The event carrying every wire message on the leader, before routing. */
  wireEvent: string;
  /** Returns false when the pair is not connected here. */
  core: { updateConnectionPath: (cid: bigint, peerCid: bigint, route: PeerPathReport) => boolean };
}

export function installPathChanges({ bus, isLeader, wireEvent, core }: PathChangeDeps): void {
  const apply = (message: unknown): void => {
    const change: PathChange | null = pathChangeOf(message);
    if (change === null) return;
    if (core.updateConnectionPath(change.cid, change.peerCid, change.route)) bus.emit(PATH_CHANGED_EVENT, change);
  };
  bus.on('websocket-message', apply);
  bus.on(wireEvent, (message: unknown): void => { if (isLeader()) apply(message); });
}
