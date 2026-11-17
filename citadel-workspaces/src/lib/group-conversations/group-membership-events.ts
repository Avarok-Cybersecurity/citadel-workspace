/**
 * Who is in a group: the `group:member-joined` and `group:member-left`
 * handlers.
 *
 * There was a third, for `group:member-kicked`. MemberState carries only
 * EnteredGroup and LeftGroup, so a kick reaches us as LeftGroup like any other
 * departure and that handler could never run.
 *
 * Split out of `group-store.ts` when that file passed the 250-line cap. These
 * two are the only handlers that edit a group's `members` array, and they
 * are the only ones that need `resolveRoleId`, so they cut cleanly.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { debugLog } from '@/lib/debug-config';
import { resolveRoleId } from '@/types/group';
import type { GroupMember } from '@/types/group-entities';
import { updateGroups } from './group-store';

/** Bind the membership events. Called once, from `startGroupEventBindings`. */
export function bindMembershipEvents(): void {
  // `memberCid` is a bigint on the wire into this event, not a string that has
  // to be parsed back. The emitter already holds one and used to call
  // `.toString()` on it purely so this handler could call `BigInt()` on it
  // again -- a round trip that only ever loses. CLAUDE.md: a CID is a bigint,
  // and never a string in a declaration.
  eventEmitter.on('group:member-joined', (data: {
    groupId: string;
    memberCid: bigint;
    memberUsername: string;
    roleId?: string;
  }) => {
    debugLog('GroupStore', 'Member joined:', data);
    const memberCid: bigint = data.memberCid;
    updateGroups(prev =>
      prev.map(group => {
        if (group.id !== data.groupId) return group;
        if (group.members.some(m => m.cid === memberCid)) return group;
        // An id offered from elsewhere is used only if it names a role we
        // actually hold; see resolveRoleId. Null means this group has no roles
        // at all, and a member with no resolvable role is exactly the state
        // that reads as "you do not have permission" — so say so instead of
        // recording it.
        const roleId: string | null = resolveRoleId(group.settings, data.roleId);
        if (roleId === null) {
          debugLog('GroupStore', 'Group has no roles; cannot place joining member', {
            groupId: data.groupId,
            memberCid: memberCid.toString(),
          });
          return group;
        }
        if (data.roleId !== undefined && data.roleId !== roleId) {
          debugLog('GroupStore', 'Discarded a role id that names no role here', {
            groupId: data.groupId,
            offered: data.roleId,
            used: roleId,
          });
        }
        const newMember: GroupMember = {
          cid: memberCid,
          username: data.memberUsername,
          roleId,
          joinedAt: Date.now(),
        };
        return { ...group, members: [...group.members, newMember] };
      }),
    );
  });

  const handleMemberLeft = (data: { groupId: string; memberCid: bigint }): void => {
    debugLog('GroupStore', 'Member left:', data);
    const memberCid: bigint = data.memberCid;
    updateGroups(prev =>
      prev.map(group =>
        group.id === data.groupId
          ? { ...group, members: group.members.filter(m => m.cid !== memberCid) }
          : group,
      ),
    );
  };
  eventEmitter.on('group:member-left', handleMemberLeft);
}
