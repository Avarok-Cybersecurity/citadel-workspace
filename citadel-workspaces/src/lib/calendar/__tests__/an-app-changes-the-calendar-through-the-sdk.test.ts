/**
 * Another app reaches the member's Calendar through the SDK (design §3.8): over the real glue gate,
 * a relay that stamps each caller, the Calendar's served routes and the page's mirror
 * (sdk-client.ts), every decision the core's. The member is asked once per app, however many
 * calls race in; an app in another member's session is refused and writes nothing; a change at a
 * revision the event has moved on from is stale; an app removes only the events it added.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY, type IhttpLimits } from '@/lib/citadel-apps/host/limits';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import { ihttpEndpoint } from '@/lib/citadel-apps/glue-sdk/ihttp-endpoint';
import { BookingHost } from '../booking-host';
import { calendarHandler, calendarRoutes, serveCalendar } from '../calendar-endpoint';
import type { NewEvent } from '../generated/NewEvent';
import { calendarPorts, type CalendarPorts } from '../ports';
import { EVENT_PREFIX } from '../read-sources';
import { CalendarSdk } from '../sdk-client';
import { SdkHost, type ConsentAnswer } from '../sdk-host';
import { NOW, engine } from './booking-rig';
import { IhttpRelay } from './ihttp-relay';
import { MemoryStore } from './memory-store';
import type { Events } from '@/lib/calendar/generated/Events';
import type { SdkCall } from '@/lib/calendar/sdk-client';

const POLICY: { serverCallsPerSecond: number; memoryMaxPages: number; computeBudgetMs: number; hostNetTimeoutMs: number; serverNetTimeoutMs: number; portTimeoutMs: number; hostCallsPerSecond: number; maxLiveInstancesPerPage: number; maxRequestBytes: number; maxReplyBytes: number; maxLiveReplies: number; replyTtlMs: number; maxLogBytes: number; peerAuthorizationsPerSecond: number; ihttp: IhttpLimits; } = { ...STANDARD_HOST_POLICY, serverCallsPerSecond: 100_000 };
const KANBAN: string = 'com.acme.kanban';
const STANDUP: NewEvent = {
  node: 'n1', title: 'Standup', when: { once: { start_ms: NOW + 3_600_000n, end_ms: NOW + 5_400_000n } }, zone: 'Europe/Berlin',
  location: 'in_app', visibility: 'public', propagate: { down: false, up_to: null }, reminders: [], reference: 'card-1',
};

function instance(app: string, user: string, relay: IhttpRelay, store: MemoryStore, held: Capability[]): CalendarPorts {
  return calendarPorts(glueInstance({
    appId: app, held: new Set<Capability>(held), policy: POLICY, limits: { topics: null, p2p: null },
    ports: { storage: store.port(), ihttp: relay.appPort(user, app) }, clock: new ManualClock(), pageUrl: 'https://w.example/n1', storageChanges: () => () => {},
  }));
}

interface Rig {
  /** Amy's Calendar's own ports: what it stored. */
  readonly ports: CalendarPorts;
  readonly asked: string[];
  /** An app's mirror, running in `user`'s session, calling amy's Calendar. */
  readonly app: (app: string, user: string) => CalendarSdk;
}

async function rig(answers: ConsentAnswer[]): Promise<Rig> {
  const relay: IhttpRelay = new IhttpRelay();
  const store: MemoryStore = new MemoryStore('amy');
  const asked: string[] = [];
  const ports: CalendarPorts = instance('net.avarok.calendar', 'amy', relay, store, ['storage.user', 'storage.node', 'storage.node.authored', 'ihttp.serve']);
  let n: number = 0;
  const ask = async (appId: string): Promise<ConsentAnswer> => {
    asked.push(appId);
    await new Promise((r) => setTimeout(r, 5));
    return answers.shift() ?? 'unanswered';
  };
  const sdk: SdkHost = new SdkHost({ ports, engine, me: 'amy', nowMs: (): bigint => NOW, newId: (): string => `e${(n += 1)}`, ask });
  const bookings: BookingHost = new BookingHost({ ports, engine, node: 'n1', me: 'amy', nowMs: (): bigint => NOW });
  await serveCalendar(ports, calendarRoutes(engine), calendarHandler(sdk, bookings), { relay: true, p2p: false });
  const app = (appId: string, user: string): CalendarSdk => {
    const caller: CalendarPorts = instance(appId, user, relay, new MemoryStore(user), ['ihttp.call']);
    return new CalendarSdk(ihttpEndpoint(caller.ihttp, () => Promise.reject(new Error('serves nothing'))).client, engine.sdk, 'amy');
  };
  return { ports, asked, app };
}

const posted = async (r: Rig): Promise<string[]> => (await r.ports.storage.authoredKeys('n1', EVENT_PREFIX)).map((k) => `${k.author}:${k.key}`);

describe('an app using the Calendar SDK', () => {
  it('asks the member once for racing calls, then adds, lists, updates and removes its own event', async () => {
    const r: Rig = await rig(['allow']);
    const kanban: CalendarSdk = r.app(KANBAN, 'amy');
    const [a, b] = await Promise.all([kanban.addEvent(STANDUP), kanban.addEvent({ ...STANDUP, reference: 'card-2' })]);
    expect([a, b]).toEqual([{ ok: { id: 'e1', rev: 1 } }, { ok: { id: 'e2', rev: 1 } }]);
    expect(r.asked).toEqual([KANBAN]);
    expect(await posted(r)).toEqual(['amy:cal/event/e1', 'amy:cal/event/e2']);

    const listed: SdkCall<Events> = await kanban.list({ node: 'n1', from_ms: NOW, to_ms: NOW + 86_400_000n, include: 'own' });
    expect('ok' in listed ? listed.ok.events.map((e) => [e.id, e.title, e.source?.app_id]) : listed).toEqual([['e1', 'Standup', KANBAN], ['e2', 'Standup', KANBAN]]);
    expect(await kanban.updateEvent('e1', { rev: 1, title: 'Daily', when: null, zone: null, location: null, reminders: null })).toEqual({ ok: 2 });
    expect(await kanban.removeEvent('e2', 1)).toEqual({ ok: null });
    expect(await posted(r)).toEqual(['amy:cal/event/e1']);
    expect(await kanban.health()).toEqual({ ok: { wire: 1 } });
    expect(await kanban.freeBusy({ node: 'n1', users: ['amy', 'bo'], from_ms: NOW, to_ms: NOW + 86_400_000n })).toEqual({
      ok: { users: [{ user: 'amy', busy: [{ start_ms: NOW + 3_600_000n, end_ms: NOW + 5_400_000n }] }, { user: 'bo', busy: [] }] },
    });
    expect(r.asked).toEqual([KANBAN]);
  });

  it("refuses an app in another member's session, writing nothing and asking no one", async () => {
    const r: Rig = await rig(['allow']);
    const bobs: CalendarSdk = r.app(KANBAN, 'bob');
    expect(await bobs.addEvent(STANDUP)).toMatchObject({ refused: { code: 'cross_user' } });
    expect(await bobs.list({ node: 'n1', from_ms: 0n, to_ms: 1n, include: 'own' })).toMatchObject({ refused: { code: 'cross_user' } });
    expect(await posted(r)).toEqual([]);
    expect(r.asked).toEqual([]);
  });

  it('says stale at an old revision, and lets an app change only the events it added', async () => {
    const r: Rig = await rig(['allow', 'allow']);
    const kanban: CalendarSdk = r.app(KANBAN, 'amy');
    await kanban.addEvent(STANDUP);
    expect(await kanban.updateEvent('e1', { rev: 1, title: 'Daily', when: null, zone: null, location: null, reminders: null })).toEqual({ ok: 2 });
    expect(await kanban.removeEvent('e1', 1)).toEqual({ refused: { code: 'stale', current_rev: 2, detail: null } });
    const other: CalendarSdk = r.app('com.other', 'amy');
    expect(await other.removeEvent('e1', 2)).toMatchObject({ refused: { code: 'not_found' } });
    expect(await posted(r)).toEqual(['amy:cal/event/e1']);
  });

  it('remembers a refusal, and asks again after "Allow once"', async () => {
    const r: Rig = await rig(['once', 'refuse']);
    const kanban: CalendarSdk = r.app(KANBAN, 'amy');
    expect(await kanban.addEvent(STANDUP)).toEqual({ ok: { id: 'e1', rev: 1 } });
    expect(await kanban.addEvent(STANDUP)).toMatchObject({ refused: { code: 'not_consented' } });
    expect(await kanban.addEvent(STANDUP)).toMatchObject({ refused: { code: 'not_consented' } });
    expect(r.asked).toEqual([KANBAN, KANBAN]);
  });
});
