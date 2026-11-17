/**
 * The host's booking writes are announced on the `cal` topic as an event save is (booking-host.ts):
 * a confirmed booking and a cancelled one each say `{ node, key }` of the booking's event, which a
 * pane routes to the source that shows it, and nothing of the booking itself. The acknowledgement
 * is not announced.
 */
import { describe, expect, it } from 'vitest';
import { BookingHost } from '../booking-host';
import { bookingOf } from '../booking';
import { saveAvailability, saveEventType } from '../booking-pages';
import { sourcesOfTopicChange } from '../change-routing';
import { realEngine, utc } from './engine-rig';
import { INTRO, WORKING_HOURS } from './booking-fixture';
import { member, TopicGroup, treeOf } from './tree-rig';
import type { CalChange } from '@/lib/calendar/generated/CalChange';
import type { IhttpMessage } from '@/lib/citadel-apps/glue-sdk/ihttp-io';
import type { Booking } from '@/lib/calendar/generated/Booking';
import type { Member } from '@/lib/calendar/__tests__/tree-rig';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const NOW: bigint = utc('2024-07-15T12:00:00Z');
const SLOT: { start_ms: bigint; end_ms: bigint; } = { start_ms: utc('2024-07-16T13:00:00Z'), end_ms: utc('2024-07-16T13:30:00Z') };
const caller = (username: string): { username: string; cid: bigint; app_id: string; install_id: string; via: "relay"; } => ({ username, cid: 2n, app_id: 'net.avarok.calendar', install_id: 'i1', via: 'relay' as const });

describe("the host's booking writes", () => {
  it('announce the booking event on the cal topic when confirmed and when cancelled, and nothing of the booking', async () => {
    const group: TopicGroup = new TopicGroup();
    const ana: Member = member('ana', new Map(), treeOf({ n1: null }), group);
    await saveEventType(ana.ports, engine, 'n1', 'ana', INTRO);
    await saveAvailability(ana.ports, engine, 'n1', 'ana', WORKING_HOURS);
    await ana.ports.topics.open('cal');
    const host: BookingHost = new BookingHost({ ports: ana.ports, engine, node: 'n1', me: 'ana', nowMs: () => NOW });
    const booking: Booking = bookingOf({ type: INTRO, durationMin: 30, slot: SLOT, zone: 'America/New_York', answers: [{ question_id: 'q-topic', value: 'Roadmap secret' }] }, { id: 'b1', node: 'n1', host: 'ana', me: 'bob' });

    const made: IhttpMessage = await host.handle({ caller: caller('bob'), method: 'POST', path: '/book', query: '', body: engine.encodeBooking(booking) });
    expect(made.status).toBe(201);
    expect((await host.cancelAsHost('b1', 'travelling')).status).toBe(200);

    const changes: CalChange[] = group.sent.map((s) => engine.decodeChange(s.body));
    expect(changes).toEqual([{ node: 'n1', key: 'cal/event/b1' }, { node: 'n1', key: 'cal/event/b1' }]);
    expect(sourcesOfTopicChange(changes[0] as (typeof changes)[number], { node: 'n1', chain: ['n1'], below: new Set() })).toEqual(['node', 'authored']);
    for (const s of group.sent) expect(new TextDecoder().decode(s.body)).not.toMatch(/secret|travelling|bob/);
  });
});
