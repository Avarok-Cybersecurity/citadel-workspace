/**
 * Who a secure link admits, as the dialog edits it, and the grants it sends.
 *
 * A visitor passes if ANY grant admits them, so the draft is a set of independent choices: named
 * members, roles, viewers of one node, the whole workspace, a group's members as of now. A group
 * snapshot is frozen at creation because the server cannot see group chats. Booking guests are
 * accounts outside the workspace that may book on one node; the creator says how many.
 */
import type { LinkGrant } from 'citadel-workspace-client-ts';

export interface GrantDraft {
  members: readonly string[];
  roles: readonly string[];
  nodeViewers: string | null;
  workspace: boolean;
  group: { groupId: string; members: readonly string[] } | null;
  /** `maxGuests` is null until the creator says how many; no grant is sent before then. */
  booking: { nodeId: string; page: string; maxGuests: number | null } | null;
}

/** The server's MAX_BOOKING_GUESTS (citadel-workspace-types/src/secure_links.rs), mirrored. */
export const MAX_BOOKING_GUESTS: number = 50;

const EMPTY: GrantDraft = { members: [], roles: [], nodeViewers: null, workspace: false, group: null, booking: null };

/** A guest count the server accepts: a whole number from 1 to MAX_BOOKING_GUESTS. */
export const isGuestCount = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= MAX_BOOKING_GUESTS;

/** A draft with booking guests chosen but no valid count would send a link that admits fewer than asked. */
export const bookingIncomplete = (d: GrantDraft): boolean => d.booking !== null && (d.booking.maxGuests === null || !isGuestCount(d.booking.maxGuests));

/** The draft a target's default grant starts from. */
export function draftOf(grant: LinkGrant): GrantDraft {
  if (grant === 'Workspace') return { ...EMPTY, workspace: true };
  if ('Members' in grant) return { ...EMPTY, members: [...grant.Members] };
  if ('Roles' in grant) return { ...EMPTY, roles: [...grant.Roles] };
  if ('NodeViewers' in grant) return { ...EMPTY, nodeViewers: grant.NodeViewers };
  if ('BookingGuest' in grant) {
    const { node_id, page, max_guests } = grant.BookingGuest;
    return { ...EMPTY, booking: { nodeId: node_id, page, maxGuests: max_guests } };
  }
  return { ...EMPTY, group: { groupId: grant.GroupSnapshot.group_id, members: [...grant.GroupSnapshot.members] } };
}

export function grantsOf(draft: GrantDraft): LinkGrant[] {
  const grants: LinkGrant[] = [];
  if (draft.members.length > 0) grants.push({ Members: [...draft.members] });
  if (draft.roles.length > 0) grants.push({ Roles: [...draft.roles] });
  if (draft.nodeViewers !== null) grants.push({ NodeViewers: draft.nodeViewers });
  if (draft.workspace) grants.push('Workspace');
  if (draft.group !== null) grants.push({ GroupSnapshot: { group_id: draft.group.groupId, members: [...draft.group.members] } });
  if (draft.booking !== null && !bookingIncomplete(draft) && draft.booking.maxGuests !== null) {
    grants.push({ BookingGuest: { node_id: draft.booking.nodeId, page: draft.booking.page, max_guests: draft.booking.maxGuests } });
  }
  return grants;
}

export const withMember = (d: GrantDraft, username: string): GrantDraft =>
  d.members.includes(username) ? d : { ...d, members: [...d.members, username] };
export const withoutMember = (d: GrantDraft, username: string): GrantDraft =>
  ({ ...d, members: d.members.filter((m: string) => m !== username) });
export const withRole = (d: GrantDraft, roleId: string): GrantDraft =>
  d.roles.includes(roleId) ? d : { ...d, roles: [...d.roles, roleId] };
export const withoutRole = (d: GrantDraft, roleId: string): GrantDraft =>
  ({ ...d, roles: d.roles.filter((r: string) => r !== roleId) });

/** How a set of grants reads in a list: "alice, bob · Admins · Everyone". */
export function describeGrants(grants: readonly LinkGrant[], roleName: (id: string) => string): string {
  const parts: string[] = grants.map((g: LinkGrant): string => {
    if (g === 'Workspace') return 'Everyone in the workspace';
    if ('Members' in g) return g.Members.join(', ');
    if ('Roles' in g) return g.Roles.map(roleName).join(', ');
    if ('NodeViewers' in g) return 'Anyone who can see the page';
    if ('BookingGuest' in g) return `Up to ${g.BookingGuest.max_guests} guest${g.BookingGuest.max_guests === 1 ? '' : 's'} from outside`;
    const n: number = g.GroupSnapshot.members.length;
    return `${n} group member${n === 1 ? '' : 's'} (as of creation)`;
  });
  return parts.length === 0 ? 'Nobody' : parts.join(' · ');
}
