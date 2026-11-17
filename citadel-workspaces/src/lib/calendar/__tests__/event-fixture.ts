/** Event values for tests and harness scenarios: plain data, safe in Node and in a browser. */
import type { CivilDateTime } from '../generated/CivilDateTime';
import type { Event } from '../generated/Event';

export const NY: string = 'America/New_York';

export const at = (y: number, m: number, d: number, hour: number, minute: number): CivilDateTime => ({ date: { y, m, d }, minute: hour * 60 + minute });

export const utc = (iso: string): bigint => BigInt(Date.parse(iso));

/** A confirmed one-off public event at n1; `overrides` replace whole fields. */
export const event = (overrides: Partial<Event>): Event => ({
  id: 'e1', rev: 1, origin_node: 'n1', author: 'alice', title: 'Standup', body: null, kind: 'plain', status: 'confirmed',
  when: { once: { start_ms: utc('2024-07-15T13:00:00Z'), end_ms: utc('2024-07-15T13:30:00Z') } },
  zone: NY, location: 'in_app', hosts: ['alice'], invitees: [], visibility: 'public', propagate: { down: false, up_to: null },
  reminders: [], notes_doc: null, source: null, created_ms: 1n, updated_ms: 2n, ...overrides,
});
