import { useEffect } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import type { User } from '@/types/workspace-entities';

/**
 * Tell somebody their peer registration request was refused.
 *
 * The store clears the outgoing request when the refusal arrives — and before
 * round 463 it did not even do that, because it keyed the cleanup on a
 * `peer_cid` that `PeerRegisterFailure` does not carry. Once it was cleared,
 * the request simply disappeared from the outgoing list with no word about why.
 *
 * `usePeerDiscovery` already says something, but only while the discovery modal
 * is open, and only for requests sent from that modal — it correlates through
 * an in-memory ref that dies with the component. A refusal arrives when the
 * other person gets round to answering, which is usually long after the modal
 * has closed, so in practice the silent path was the normal one.
 *
 * A component rather than a toast from the store: that is library code, and
 * business logic reaching for the toaster is what SBIO exists to prevent. Same
 * arrangement as `PersistFailureNotice` beside it.
 *
 * Renders nothing. It exists to be mounted.
 */
export function PeerRefusalNotice(): null {
  const { toast } = useToast();
  const members: Record<string, User> = useWorkspace().state.members;

  useEffect(() => {
    const onRefused = (payload: { peerUsername?: string; reason?: string }): void => {
      // Only for a request THIS tab still knew about: the store returns the
      // record it removed, and a missing one means the refusal was for another
      // session's request, already-cleared, or arrived twice.
      if (!payload.peerUsername) return;
      // The SDK's decline carries no reason, so a refusal made by the other
      // person's "strangers" setting is told apart by the policy they publish.
      const peer: User | undefined = Object.values(members).find((m: User) => m.username === payload.peerUsername);
      if (peer?.acceptsRequestsFromStrangers === false) {
        toast({
          variant: 'destructive',
          title: `${peer.displayName || peer.username} isn't accepting messages from people they aren't connected with`,
          description: 'Your request was declined automatically. It has been withdrawn.',
        });
        return;
      }
      toast({
        variant: 'destructive',
        title: `${payload.peerUsername} did not accept your request`,
        description: payload.reason
          ? `The request has been withdrawn. ${payload.reason}`
          : 'The request has been withdrawn. You can send another one.',
      });
    };

    eventEmitter.on('peer-registration:refused', onRefused);
    return (): void => { eventEmitter.off('peer-registration:refused', onRefused); };
  }, [toast, members]);

  return null;
}
