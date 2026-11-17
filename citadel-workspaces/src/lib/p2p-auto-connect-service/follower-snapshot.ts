/**
 * A tab that starts holding a session hears which of its P2P links are already up.
 *
 * The leader tells followers about a connection only when it forms
 * (`connected-peers-update`, from setPeerConnected). A follower that loaded, or
 * switched to the session, AFTER its link came up had missed that one message
 * and never got another: its peer read "Offline", and it would not send, across
 * a connection that was working. Now, when a tab registers a CID it did not hold
 * before, the leader repeats the update — path included — for every peer that
 * session is connected to. It goes out as the same state-sync, addressed to that
 * session, so the follower applies it exactly as it would have the first time.
 */
type Handler = (payload: unknown) => void;

export interface FollowerSnapshotDeps {
  on: (event: string, handler: Handler) => void;
  isLeader: () => boolean;
  selfInstanceId: () => string;
  peersFor: (localCid: bigint) => bigint[];
  /** Re-send one connection's update (setPeerConnected, which broadcasts with its path). */
  announce: (localCid: bigint, peerCid: bigint) => void;
}

/** The CID a registration newly gives another tab, or null when there is nothing new to tell. */
export function newlyHeldCid(payload: unknown, selfInstanceId: string): bigint | null {
  const p: { instanceId?: unknown; cid?: unknown; previous?: unknown } | null =
    payload as { instanceId?: unknown; cid?: unknown; previous?: unknown } | null;
  if (typeof p?.cid !== 'bigint' || p.instanceId === selfInstanceId) return null;
  return p.previous === p.cid ? null : p.cid;
}

export function installFollowerSnapshots(deps: FollowerSnapshotDeps): void {
  deps.on('instance:registered', (payload: unknown): void => {
    if (!deps.isLeader()) return;
    const cid: bigint | null = newlyHeldCid(payload, deps.selfInstanceId());
    if (cid === null) return;
    for (const peerCid of deps.peersFor(cid)) deps.announce(cid, peerCid);
  });
}
