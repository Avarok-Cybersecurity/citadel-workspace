/**
 * TEST RIG: members' Calendar instances over the real glue gate and iHTTP router, a fake relay and
 * one shared store that answers on a later turn, as the kernel does; each serves bookings as host.
 */
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance, type GlueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY, type IhttpLimits } from '@/lib/citadel-apps/host/limits';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import type { IhttpEndpoint } from '@/lib/citadel-apps/glue-sdk/ihttp-endpoint';
import { BookingHost } from '../booking-host';
import { BOOKING_ROUTES } from '../booking-wire';
import { serveCalendar } from '../calendar-endpoint';
import type { BookingChoice } from '../booking-form';
import { calendarPorts, type CalendarPorts } from '../ports';
import { realEngine, utc } from './engine-rig';
import { INTRO } from './booking-fixture';
import type { IhttpRelay } from './ihttp-relay';
import { MemoryStore } from './memory-store';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

export const engine: CalendarEngine = realEngine();
/**
 * The page's server-call pace is proven in a-glue-app-never-outruns-the-one-server-rate.test.ts; on
 * this rig's clock, which no one advances, it would leave a call waiting for good once a test makes
 * more calls than one second's budget, so it is lifted, as tree-rig.ts lifts it.
 */
const POLICY: { serverCallsPerSecond: number; memoryMaxPages: number; computeBudgetMs: number; hostNetTimeoutMs: number; serverNetTimeoutMs: number; portTimeoutMs: number; hostCallsPerSecond: number; maxLiveInstancesPerPage: number; maxRequestBytes: number; maxReplyBytes: number; maxLiveReplies: number; replyTtlMs: number; maxLogBytes: number; peerAuthorizationsPerSecond: number; ihttp: IhttpLimits; } = { ...STANDARD_HOST_POLICY, serverCallsPerSecond: 100_000 };
const HELD: Capability[] = ['storage.user', 'storage.node', 'storage.node.authored', 'ihttp.serve', 'ihttp.call', 'notifications'];
export const NOW: bigint = utc('2024-07-15T12:00:00Z');
export const SLOT: { start_ms: bigint; end_ms: bigint; } = { start_ms: utc('2024-07-16T13:00:00Z'), end_ms: utc('2024-07-16T13:30:00Z') };
export const choice: BookingChoice = { type: INTRO, durationMin: 30, slot: SLOT, zone: 'America/New_York', answers: [{ question_id: 'q-topic', value: 'Roadmap' }] };

export interface Member {
  readonly name: string;
  readonly ports: CalendarPorts;
  readonly endpoint: IhttpEndpoint;
  readonly host: BookingHost;
  readonly notes: string[];
}

export async function member(name: string, relay: IhttpRelay, shared: Map<string, Uint8Array>): Promise<Member> {
  const notes: string[] = [];
  const store: MemoryStore = new MemoryStore(name, shared);
  const glue: GlueInstance = glueInstance({
    appId: 'net.avarok.calendar', held: new Set<Capability>(HELD), policy: POLICY, limits: { topics: null, p2p: null },
    ports: { storage: store.slowPort(), ihttp: relay.port(name), notify: { Notify: ({ title, body }) => { notes.push(`${title}: ${body}`); return { ok: null }; } } },
    clock: new ManualClock(), pageUrl: 'https://w.example/n1', storageChanges: () => (): void => {},
  });
  const ports: CalendarPorts = calendarPorts(glue);
  const host: BookingHost = new BookingHost({ ports, engine, node: 'n1', me: name, nowMs: () => NOW });
  return { name, ports, endpoint: await serveCalendar(ports, BOOKING_ROUTES, host.handle, { relay: true, p2p: false }), host, notes };
}
