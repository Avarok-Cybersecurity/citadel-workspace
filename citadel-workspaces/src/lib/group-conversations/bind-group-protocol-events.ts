/**
 * The shell that acts on group-protocol-events: the store's owner, each send's outcome, and the
 * notices the user is shown. All the decisions are in the pure modules it calls.
 */
import type { GroupStateSource } from '@avarok/citadel-protocol-types';
import { eventEmitter } from '@/lib/event-emitter';
import { toast } from '@/hooks/use-toast';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import type { GroupConversation } from '@/types/group';
import { withOwner } from './group-owner';
import { recordSendOutcome } from './group-send-outcomes';
import type { GroupSendOutcome } from './group-send-outcome';
import { ownerChangedNotice, restoredNotice, type GroupNotice } from './group-protocol-notices';

export interface GroupProtocolStore {
  readonly name: (groupId: string) => string | undefined;
  readonly update: (change: (prev: GroupConversation[]) => GroupConversation[]) => void;
}

export function bindGroupProtocolEvents(store: GroupProtocolStore): void {
  eventEmitter.on('group:owner-changed', (data: { groupId: string; ownerCid: bigint; ownerName: string }) => {
    store.update((prev: GroupConversation[]): GroupConversation[] => withOwner(prev, data.groupId, data.ownerCid));
    toast(ownerChangedNotice(store.name(data.groupId), data.ownerName, data.ownerCid === instanceManager.cid));
  });

  eventEmitter.on('group:send-outcome', (data: { requestId: string; outcome: GroupSendOutcome }) => {
    recordSendOutcome(data.requestId, data.outcome);
  });

  eventEmitter.on('group:restored', (data: { groupId: string; source: GroupStateSource }) => {
    const notice: GroupNotice | null = restoredNotice(store.name(data.groupId), data.source);
    if (notice !== null) toast(notice);
  });
}
