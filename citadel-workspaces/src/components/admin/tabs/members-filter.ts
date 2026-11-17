/**
 * The members tab's filter (Calendar design §3.6.4): everyone, or only the booking guests, the
 * accounts outside the workspace a live booking link lets in, so an admin can find and remove them.
 */
import type { MemberData } from '../types';

export type MembersFilterChoice = 'everyone' | 'guests';

export function membersShown(members: readonly MemberData[], filter: MembersFilterChoice): MemberData[] {
  return filter === 'guests' ? members.filter((m: MemberData) => m.isGuest) : [...members];
}

export function guestCount(members: readonly MemberData[]): number {
  return members.filter((m: MemberData) => m.isGuest).length;
}
