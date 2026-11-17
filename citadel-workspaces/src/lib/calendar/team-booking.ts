/**
 * Booking a team's type (design §3.6.2), the booker's side. The team type lives on the node
 * (`storage.node(n)` `cal/type/<id>`, team-types.ts); each host's instance verifies its own part
 * at claim, exactly as for a member's own type (booking-claim.ts).
 *
 * - Round robin: the core ranks the free hosts by the type's strategy; the booker claims the first,
 *   and when no instance of that host answers, the next. With nobody online the booking is left
 *   as a request addressed to the first.
 * - Collective: every host is claimed in turn, stopping at the first that does not confirm. The
 *   core decides the outcome; when it is not booked, each host that confirmed is sent a cancel
 *   with reason `collective_incomplete`, and the booker is shown the refusing host's other times.
 *   The booker's own copy, naming every host, is written only once all confirmed.
 */
import { cancelBooking, claimWith, keepOwnCopy, ownCopy, requestBooking, type BookerDeps, type Claimed } from './booking';
import type { BookOutcome } from './booking-form';
import type { Booking } from './generated/Booking';
import type { CollectiveOutcome } from './generated/CollectiveOutcome';
import type { Event } from './generated/Event';
import type { HostAnswer } from './generated/HostAnswer';

/**
 * Whom a booking page's Confirm claims: one member; a round robin's free hosts in the order the
 * core ranked them (team-slots.ts `rankedFor`); or every host of a collective.
 */
export type BookTarget =
  | { readonly kind: 'member'; readonly host: string }
  | { readonly kind: 'round_robin'; readonly ranked: readonly string[] }
  | { readonly kind: 'collective'; readonly hosts: readonly string[] };

/** `COLLECTIVE_INCOMPLETE` in the core's team.rs. */
export const COLLECTIVE_INCOMPLETE: string = 'collective_incomplete';

const withHost = (booking: Booking, host: string): Booking => ({ ...booking, host, page: { member: { username: host, slug: pageSlug(booking) } } });
const pageSlug = (b: Booking): string => ('member' in b.page ? b.page.member.slug : b.page.node.slug);

/** Claims `ranked` in order (the core's `rank_hosts`), moving on only past a host nobody answers for. */
export async function bookRoundRobin(d: BookerDeps, booking: Booking, ranked: readonly string[]): Promise<BookOutcome> {
  const first: string | undefined = ranked[0];
  if (first === undefined) return { kind: 'failed', reason: 'no host is free at that time' };
  for (const host of ranked) {
    const claimed: Claimed = await claimWith(d, withHost(booking, host), null);
    if (claimed.kind === 'unreachable') continue;
    if (claimed.kind === 'confirmed') await keepOwnCopy(d, ownCopy(claimed.booking, d), null);
    return claimed;
  }
  return requestBooking(d.ports, d.engine, withHost(booking, first), d.node, d.me);
}

const answerOf = (claimed: Claimed): HostAnswer =>
  claimed.kind === 'confirmed' ? 'confirmed' : claimed.kind === 'taken' ? { conflict: { alternatives: claimed.alternatives } } : 'unreachable';

/** Claims every host of a collective type in turn; all of them, or none of them. */
export async function bookCollective(d: BookerDeps, booking: Booking, hosts: readonly string[]): Promise<BookOutcome> {
  const answers: [string, HostAnswer][] = [];
  let failed: string | null = null;
  for (const host of hosts) {
    const claimed: Claimed = await claimWith(d, withHost(booking, host), null);
    answers.push([host, answerOf(claimed)]);
    if (claimed.kind !== 'confirmed') {
      failed = claimed.kind === 'failed' || claimed.kind === 'unreachable' ? claimed.reason : null;
      break;
    }
  }
  const outcome: CollectiveOutcome = d.engine.team.collectiveOutcome(answers);
  if (outcome === 'booked') {
    const own: Event = ownCopy({ ...booking, state: 'confirmed' }, d);
    await keepOwnCopy(d, { ...own, hosts: [...hosts] }, null);
    return { kind: 'confirmed', booking: { ...booking, state: 'confirmed' } };
  }
  const { cancel, conflict } = outcome.rolled_back;
  const undone: string[] = [];
  for (const host of cancel) {
    const done: { ok: true; } | { ok: false; reason: string; } = await cancelBooking(d.client, host, booking.id, COLLECTIVE_INCOMPLETE);
    if (!done.ok) undone.push(`${host} (${done.reason})`);
  }
  if (undone.length > 0) return { kind: 'failed', reason: `the booking was not made, and could not be withdrawn from ${undone.join(', ')}` };
  if (conflict !== null) return { kind: 'taken', alternatives: conflict[1] };
  return { kind: 'failed', reason: failed ?? 'not every host could be reached' };
}
