/**
 * Where a routed booker goes from this node's booking page (design §3.6.3): a member of this node
 * opens their page here (a member target's slug is the node their page is on, booking.ts); a team
 * type of this node opens it here; anything on another node is a workspace link to it, which the
 * booker follows only if they can see that node. A team type this node no longer has is a link
 * to the node too, where the booker chooses again, never a page that cannot be found.
 */
import { bookingLink, calendarTabLink } from './booking-link';
import type { EventType } from './generated/EventType';
import type { RoutingTarget } from './generated/RoutingTarget';

export type Routed =
  | { readonly kind: 'member'; readonly host: string }
  | { readonly kind: 'team'; readonly type: EventType }
  | { readonly kind: 'away'; readonly href: string; readonly label: string };

export interface RoutingHere {
  readonly node: string;
  readonly teams: readonly EventType[];
  readonly origin: string;
  readonly nodeName: (id: string) => string;
}

export function routedTo(target: RoutingTarget, here: RoutingHere): Routed {
  if ('member' in target) {
    const { username, slug } = target.member;
    if (slug === here.node) return { kind: 'member', host: username };
    return { kind: 'away', href: bookingLink(here.origin, { node: slug, host: username, typeId: null }), label: `Book ${username} on ${here.nodeName(slug)}` };
  }
  const node: string = 'team_type' in target ? target.team_type.node_id : target.node.node_id;
  if ('team_type' in target && node === here.node) {
    const type: EventType | undefined = here.teams.find((t: EventType) => t.id === target.team_type.type_id);
    if (type !== undefined) return { kind: 'team', type };
  }
  return { kind: 'away', href: calendarTabLink(here.origin, node), label: `Continue on ${here.nodeName(node)}` };
}
