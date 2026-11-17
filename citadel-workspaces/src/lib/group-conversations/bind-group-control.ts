/**
 * The receiving half of group-state sync, plus the one moment the owner speaks
 * unprompted.
 *
 * `group:control-received` is folded in by applyGroupControl, which decides
 * what the sender was allowed to change. It is NOT re-announced: only a local
 * user action announces (rename-group, apply-group-settings, assign-group-role),
 * so two members cannot echo a change back and forth.
 *
 * When a member joins a group this device OWNS, the owner sends its current
 * view. A joiner's roles were minted on their own device when they accepted,
 * so until the owner speaks they share no role ids with anyone and do not know
 * the group's name. Bound after bindMembershipEvents, so the snapshot already
 * lists the member who just joined.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { getGroups, updateGroups } from './group-store';
import { applyGroupControl } from './apply-group-control';
import { usernameFrom } from './member-group-record';
import { announceGroupState } from './announce-group-state';
import { groupIdToKey, isValidGroupId } from './group-key';
import type { GroupControlEvent } from './peer-group-control-inbound';

export function bindGroupControl(): void {
  eventEmitter.on('group:control-received', (data: GroupControlEvent) => {
    updateGroups((prev) => applyGroupControl(prev, data, usernameFrom(data.memberUsernames)));
  });

  eventEmitter.on('group:member-joined', (data: { groupId: string; memberCid: bigint }) => {
    const self: bigint | null = instanceManager.cid;
    if (self === null || data.memberCid === self || !isValidGroupId(data.groupId)) return;
    if (groupIdToKey(data.groupId).cid !== self) return;
    announceGroupState(getGroups().find((group) => group.id === data.groupId));
  });
}
