/**
 * A member list: mapped, its names and presence choices recorded, then emitted as
 * `members:loaded` with the domain it is about. Split from generated-variant-handlers.ts.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { isVariant, type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import type { ConnectionInfo } from './workspace-handlers';
import { mapWasmMember, type MappedMember } from './member-mapping';
import { recordMemberNames } from '@/lib/member-names';
import { recordPresenceChoices } from '@/lib/published-presence';

/** Handles a `BannedMembers` response; false for any other. */
export function emitBannedMembers(response: WorkspaceProtocolResponse, connectionInfo: ConnectionInfo): boolean {
  if (!isVariant(response, 'BannedMembers')) return false;
  const rawMembers: Record<string, unknown>[] = response.BannedMembers.members as unknown as Record<string, unknown>[];
  const members: MappedMember[] = rawMembers.map((m: Record<string, unknown>): MappedMember => mapWasmMember(m));
  recordMemberNames(members);
  eventEmitter.emit('members:banned-loaded', { members, connection: connectionInfo });
  return true;
}

/** Handles a `Members` response; false for any other. */
export function emitMembers(response: WorkspaceProtocolResponse, connectionInfo: ConnectionInfo): boolean {
  if (!isVariant(response, 'Members')) return false;
  // The response now says WHICH domain it is about, and the payload carries
  // it through. Four subscribers each accepted any member list that arrived
  // and took last-writer-wins -- the sidebar, the admin members tab, the
  // user-search corpus and the group-call roster -- so a list fetched for one
  // domain rendered inside another, and the admin tab then sent role changes
  // naming ITS entity with users taken from somebody else's list.
  type Members = Extract<WorkspaceProtocolResponse, { Members: unknown }>['Members'];
  // The members are mapped one by one from their wire records.
  type MembersWire = Omit<Members, 'members'> & { members: Record<string, unknown>[] };
  const { members: rawMembers, domain_id: domainId, inherited_from: inheritedFrom, guests }: MembersWire =
    response.Members as MembersWire;

  const mappedMembers: MappedMember[] = rawMembers.map((m: Record<string, unknown>): MappedMember => mapWasmMember(m));
  recordMemberNames(mappedMembers);
  // Before the emit: subscribers compute presence from it (useMemberEventSetup).
  recordPresenceChoices(mappedMembers);
  eventEmitter.emit('members:loaded', {
    members: mappedMembers,
    domainId,
    inheritedFrom,
    guests,
    connection: connectionInfo,
  });
  return true;
}
