/**
 * Where a routing form's answer takes the booker: a member or team type of this node opens here; a
 * member or page elsewhere, or a team type this node no longer has, is a link to that node.
 */
import { describe, expect, it } from 'vitest';
import { routedTo, type RoutingHere } from '../routing-target';
import { INTRO } from './booking-fixture';
import type { ColorToken } from '@/lib/calendar/generated/ColorToken';
import type { Question } from '@/lib/calendar/generated/Question';
import type { BookingRules } from '@/lib/calendar/generated/BookingRules';
import type { Zone } from '@/lib/calendar/generated/Zone';

const DEMO: { id: string; name: string; kind: { round_robin: { hosts: string[]; strategy: "equal"; }; }; durations_min: Array<number>; rules: BookingRules; questions: Array<Question>; color: ColorToken; locked: boolean; zone_lock: Zone | null; } = { ...INTRO, id: 'demo', name: 'Demo', kind: { round_robin: { hosts: ['ana', 'bo'], strategy: 'equal' as const } } };
const here: RoutingHere = { node: 'n1', teams: [DEMO], origin: 'https://w.example', nodeName: (id: string) => (id === 'n2' ? 'Sales' : id) };

describe('a routed booker', () => {
  it('opens a member or team type of this node here', () => {
    expect(routedTo({ member: { username: 'bo', slug: 'n1' } }, here)).toEqual({ kind: 'member', host: 'bo' });
    expect(routedTo({ team_type: { node_id: 'n1', type_id: 'demo' } }, here)).toEqual({ kind: 'team', type: DEMO });
  });

  it('is linked to another node, and to this one for a team type it no longer has', () => {
    expect(routedTo({ member: { username: 'cy', slug: 'n2' } }, here)).toEqual({
      kind: 'away', label: 'Book cy on Sales', href: 'https://w.example/workspace?nodeId=n2&tab=app%3Anet.avarok.calendar&book=cy',
    });
    expect(routedTo({ node: { node_id: 'n2' } }, here)).toEqual({ kind: 'away', label: 'Continue on Sales', href: 'https://w.example/workspace?nodeId=n2&tab=app%3Anet.avarok.calendar' });
    expect(routedTo({ team_type: { node_id: 'n1', type_id: 'gone' } }, here).kind).toBe('away');
  });
});
