import { useEffect, useState } from 'react';
import { isForDomain } from '@/lib/workspace-events/is-for-domain';
import WorkspaceService from '@/lib/workspace-service';
import { workspaceEvents, type MembersPayload } from '@/lib/workspace-events';
import type { User } from '@/types/workspace-entities';
import { runAsyncSetup } from '@/lib/utils/async-utils';

/**
 * The member roster of a workspace node (office/room), as the server lists it: everyone with
 * access there, inherited members included. Null until the answer for THIS node arrives, and for
 * no node at all, so a reader of it can tell "nobody" from "not known yet".
 *
 * Mirrors MembersSection: request ListMembers for the node, and take only the answer that names
 * it. Another entity's ListMembers response must never replace this one (is-for-domain). The
 * chat's receipts and header and the node's call roster read this one list, so they agree.
 */
export function useNodeRoster(nodeId: string | undefined): readonly User[] | null {
  const [roster, setRoster] = useState<readonly User[] | null>(null);

  useEffect(() => {
    setRoster(null);
    if (!nodeId) return;
    const unsubscribe: () => void = workspaceEvents.onMemberEvent('members:loaded', (payload: MembersPayload) => {
      if (isForDomain(payload.domainId, nodeId)) setRoster(payload.members);
    });
    runAsyncSetup(async () => {
      await WorkspaceService.listMembers(nodeId);
    });
    return unsubscribe;
  }, [nodeId]);

  return roster;
}
