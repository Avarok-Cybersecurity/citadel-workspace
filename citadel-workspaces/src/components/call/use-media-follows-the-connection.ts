/**
 * The call's media follows the browser's connection to a new leader tab.
 *
 * A new connection serves a session only once it has claimed it, and the claim
 * is announced in every tab (claim-relay.ts). That is the moment the call's
 * media sessions are opened again; CallManager.reopenMedia says what happens
 * when one cannot be.
 */
import { useEffect, type MutableRefObject } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { SESSION_CLAIMED, type ClaimedEvent } from '@/lib/multi-instance/claim-relay';
import type { CallManager } from '@/lib/call/call-manager';

export function useMediaFollowsTheConnection(selfCid: bigint | null, managerRef: MutableRefObject<CallManager | null>): void {
  useEffect(() => {
    return eventEmitter.on<ClaimedEvent>(SESSION_CLAIMED, (event: ClaimedEvent): void => {
      if (selfCid === null || event.cid !== selfCid) return;
      void managerRef.current?.reopenMedia();
    });
  }, [selfCid, managerRef]);
}
