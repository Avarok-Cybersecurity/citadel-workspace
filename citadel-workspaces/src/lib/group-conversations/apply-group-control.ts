/**
 * Folding a control message -- a rename, the role definitions, the role
 * assignments -- into the group it names.
 *
 * Pure, like apply-group-message, so every permission rule can be tested
 * without a socket or a store. Each part is judged on its own permission, on
 * THIS device's copy of the roles as it stood before the message:
 *
 *   name         editGroupSettings
 *   settings     manageRoles  (and only below the sender's own role)
 *   assignments  assignRoles  (and only below the sender's own role)
 *
 * The group key's owner is always permitted. The sender sends its whole view;
 * a part it may not change is simply not taken, so a member allowed to assign
 * roles but not rename cannot rename by accident or by design.
 *
 * A control message never creates a group. Unlike a chat message it is not
 * proof of anything the receiver can check, and a group built from one would
 * have been authorised by the very message that described it.
 */
import type { GroupConversation, GroupMember, GroupRole, GroupSettings } from '@/types/group';
import { resolveRoleId } from '@/types/group';
import type { GroupControlEvent } from './peer-group-control-inbound';
import {
  assignmentWithinReach,
  mayDo,
  rolesChangeBelowSender,
  sameSettings,
  senderStanding,
  type SenderStanding,
} from './group-control-guards';

function nextSettings(group: GroupConversation, offered: GroupSettings | undefined, standing: SenderStanding): GroupSettings {
  if (!offered || !mayDo(standing, 'manageRoles')) return group.settings;
  if (!rolesChangeBelowSender(group.settings, offered, standing)) return group.settings;
  return sameSettings(group.settings, offered) ? group.settings : offered;
}

function nextMember(
  member: GroupMember,
  before: GroupSettings,
  after: GroupSettings,
  offeredRoleId: string | undefined,
  standing: SenderStanding,
): GroupMember {
  const to: GroupRole | undefined = offeredRoleId === undefined ? undefined : after.roles.find((r) => r.id === offeredRoleId);
  const from: GroupRole | undefined = before.roles.find((r) => r.id === member.roleId);
  if (to && to.id !== member.roleId && assignmentWithinReach(from, to, standing)) {
    return { ...member, roleId: to.id };
  }
  // New role definitions can leave a member naming a role that no longer exists.
  const resolved: string | null = resolveRoleId(after, member.roleId);
  return resolved === null || resolved === member.roleId ? member : { ...member, roleId: resolved };
}

/**
 * A learnt group (learn-joined-groups) holds only its key, so it has nothing of
 * its own to judge a snapshot against: the first FULL snapshot from a member is
 * taken whole. The sender is in the group -- the server delivers a group's
 * messages only among its members -- and the owner's later announcements are
 * always permitted, so a wrong answer does not stick.
 */
function adoptSnapshot(
  group: GroupConversation,
  control: GroupControlEvent['control'],
  usernameFor: (cid: bigint) => string,
): GroupConversation | null {
  const { settings, assignments } = control;
  if (!settings || !assignments) return null;
  const known: Map<bigint, GroupMember> = new Map(group.members.map((m): [bigint, GroupMember] => [m.cid, m]));
  const joinedAt: number = Date.now();
  const members: GroupMember[] = assignments.map((a): GroupMember => ({
    ...(known.get(a.cid) ?? { cid: a.cid, username: usernameFor(a.cid), joinedAt }),
    roleId: resolveRoleId(settings, a.role_id) ?? settings.defaultRoleId,
  }));
  const { awaitingState: _awaiting, ...held } = group;
  return { ...held, name: control.name?.trim() || group.name, settings, members };
}

export function applyGroupControl(
  groups: GroupConversation[],
  event: GroupControlEvent,
  usernameFor: (cid: bigint) => string,
): GroupConversation[] {
  const group: GroupConversation | undefined = groups.find((g) => g.id === event.groupId);
  if (!group) return groups;
  if (group.awaitingState) {
    const adopted: GroupConversation | null = adoptSnapshot(group, event.control, usernameFor);
    return adopted ? groups.map((g) => (g.id === group.id ? adopted : g)) : groups;
  }

  const standing: SenderStanding = senderStanding(group, event.senderCid, event.ownerCid);
  const { control } = event;

  const offeredName: string | undefined = control.name?.trim();
  const name: string = offeredName && mayDo(standing, 'editGroupSettings') ? offeredName : group.name;
  const settings: GroupSettings = nextSettings(group, control.settings, standing);

  const offeredRoles: Map<bigint, string> = new Map<bigint, string>(
    mayDo(standing, 'assignRoles') ? (control.assignments ?? []).map((a) => [a.cid, a.role_id]) : [],
  );
  const members: GroupMember[] = group.members.map((member) =>
    nextMember(member, group.settings, settings, offeredRoles.get(member.cid), standing),
  );

  // Identity is the store's only no-op guard; see mark-group-read.ts.
  const unchanged: boolean = name === group.name
    && settings === group.settings
    && members.every((member, i) => member === group.members[i]);
  if (unchanged) return groups;

  return groups.map((g) => (g.id === group.id ? { ...g, name, settings, members } : g));
}
