import { useEffect, useState } from 'react';
import { p2pRegistrationService } from '@/lib/p2p-registration-service';
import type { PeerInfoResponse } from '@/lib/p2p-registration-service/types';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { callableMembers, type RoomCallRoster } from '@/lib/call/callable-members';
import type { User } from '@/types/workspace-entities';
import { runAsyncSetup } from '@/lib/utils/async-utils';

/**
 * The callable roster of a workspace domain (office/room): every member of its roster
 * (use-node-roster, which takes only the answer naming this domain) except the current
 * user, in the {cid, username} shape startCall wants.
 *
 * Members whose id is not a parseable CID are dropped; a call cannot ring an
 * identity the transport cannot address.
 */
const EMPTY: RoomCallRoster = { callable: [], notConnected: [] };

export function useDomainCallMembers(roster: readonly User[] | null): RoomCallRoster {
  const [members, setMembers] = useState<RoomCallRoster>(EMPTY);

  useEffect(() => {
    if (roster === null) {
      setMembers(EMPTY);
      return;
    }
    let cancelled: boolean = false;
    // Member ids are usernames; the CIDs come from the peer directory. See callable-members.
    runAsyncSetup(async () => {
      const [directory, registered, selfCid] = await Promise.all([
        p2pRegistrationService.listAllPeers(), p2pRegistrationService.listRegisteredPeers(), getCurrentCid(),
      ]);
      if (cancelled) return;
      setMembers(callableMembers(
        roster.map((user: User) => ({ id: user.id, username: user.username, displayName: user.displayName })),
        directory.map((peer: PeerInfoResponse) => ({ cid: peer.cid, username: peer.username ?? peer.peer_username })),
        selfCid ?? undefined,
        new Set(registered.flatMap((peer: PeerInfoResponse): bigint[] => (peer.cid === undefined ? [] : [peer.cid]))),
      ));
    });
    return (): void => { cancelled = true; };
  }, [roster]);

  return members;
}
