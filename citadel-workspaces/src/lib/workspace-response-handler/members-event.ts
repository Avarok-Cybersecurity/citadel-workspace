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

/** Handles a `Members` response; false for any other. */
export function emitMembers(response: WorkspaceProtocolResponse, connectionInfo: ConnectionInfo): boolean {
  if (!isVariant(response, 'Members')) return false;
  // The response now says WHICH domain it is about, and the payload carries
  // it through. Four subscribers each accepted any member list that arrived
  // and took last-writer-wins -- the sidebar, the admin members tab, the
  // user-search corpus and the group-call roster -- so a list fetched for one
  // domain rendered inside another, and the admin tab then sent role changes
  // naming ITS entity with users taken from somebody else's list.
  //
  // Tolerates the old shape (a bare array) so a client running against a
  // server that predates the field still works, with the domain unknown.
  type MembersWire = { domain_id?: string | null; members: Record<string, unknown>[]; inherited_from?: Record<string, string>; guests?: string[] };
  const payload: MembersWire | Record<string, unknown>[] = response.Members as MembersWire | Record<string, unknown>[];
  const rawMembers: Record<string, unknown>[] = Array.isArray(payload) ? payload : payload.members;
  const domainId: string | undefined = Array.isArray(payload) ? undefined : payload.domain_id ?? undefined;
  // Absent from a server that predates it, which lists direct members only.
  const inheritedFrom: Readonly<Record<string, string>> = Array.isArray(payload) ? {} : payload.inherited_from ?? {};
  // Absent from a server that predates booking guests, which has none.
  const guests: readonly string[] = Array.isArray(payload) ? [] : payload.guests ?? [];

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
