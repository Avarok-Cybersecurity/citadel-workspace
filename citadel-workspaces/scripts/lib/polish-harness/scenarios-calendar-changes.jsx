/**
 * The Calendar pane as an editor of Platform sees it (company > n1 > n2), over the shipped engine,
 * the real ports, gate and tree port, and an in-memory store: one of Platform's own events that goes
 * down, its projection already written on Team below by its save, a booking the viewer hosts, and
 * the viewer's own copy of one they made with bo (which they may reschedule).
 * The store's keys are left on `window.__calendarKeys` for the checks to read what the controls
 * wrote; it is the harness's, never the app's.
 */
import { nextHour, pinnedClock } from './pinned-clock.js';
import { useEffect, useState } from 'react';
import * as glue from '../../../vendor/calendar/calendar_glue.js';
import wasmUrl from '../../../public/calendar/calendar_glue_bg.wasm?url';
import { CalendarPane } from '@/components/calendar/CalendarPane';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';
import { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import { intlOffsetAt } from '@/lib/calendar/engine/intl-offsets';
import { saveEvent } from '@/lib/calendar/event-save';
import { calendarPorts } from '@/lib/calendar/ports';
import { event } from '@/lib/calendar/__tests__/event-fixture';
import { MemoryStore } from '@/lib/calendar/__tests__/memory-store';
import { VIEWER } from '@/lib/calendar/__tests__/placement-fixture';
import { glueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { treeNodesPort } from '@/lib/citadel-apps/runtime/nodes-port';

const PAGE_CLOCK = pinnedClock();
const TREE = {
  company: { id: 'company', name: 'Company', parent_id: null, children: ['n1'], metadata: [] },
  n1: { id: 'n1', name: 'Platform', parent_id: 'company', children: ['n2'], metadata: [] },
  n2: { id: 'n2', name: 'Team', parent_id: 'n1', children: [], metadata: [] },
};
const ZONE = 'America/New_York';

/** The hour after the pinned one and the next, so both fall on the pinned day in whichever view the pane opens on. */
function hours() {
  const hour = nextHour(PAGE_CLOCK);
  return [{ once: { start_ms: hour + 3_600_000n, end_ms: hour + 7_200_000n } }, { once: { start_ms: hour + 7_200_000n, end_ms: hour + 9_000_000n } }];
}

async function seeded(engine) {
  const store = new MemoryStore(VIEWER);
  const ports = calendarPorts(glueInstance({
    appId: 'net.avarok.calendar', ports: { storage: store.port(), nodes: treeNodesPort('Workspace', () => TREE) },
    held: new Set(['storage.user', 'storage.node', 'storage.node.authored', 'nodes.read']),
    policy: { ...STANDARD_HOST_POLICY, serverCallsPerSecond: 100_000 }, limits: { topics: null, p2p: null }, clock: PAGE_CLOCK, pageUrl: window.location.href, storageChanges: () => () => {},
  }));
  const [first, second] = hours();
  const review = event({ id: 'review', origin_node: 'n1', author: VIEWER, hosts: [VIEWER], title: 'Quarterly review', when: first, zone: ZONE, propagate: { down: true, up_to: null } });
  const saved = await saveEvent(ports, engine, { ok: true, event: review, store: { kind: 'node', node: 'n1' }, key: 'cal/event/review' }, null, () => {});
  if (saved.kind !== 'saved') throw new Error(`the scenario's event was not saved: ${saved.kind}`);
  const mine = { node_authored: { node_id: 'n1', author: VIEWER } };
  const { start_ms, end_ms } = second.once;
  const booking = { id: 'b1', page: { member: { username: VIEWER, slug: 'intro' } }, type_id: 't1', host: VIEWER, booker: { member: { username: 'ana' } }, start_ms, end_ms, zone: ZONE, answers: [], state: 'confirmed' };
  store.put(mine, 'cal/booking-ack/b1', engine.encodeBooking(booking));
  store.put(mine, 'cal/event/b1', engine.encodeEvent(event({ id: 'b1', origin_node: 'n1', author: VIEWER, hosts: [VIEWER], title: 'Intro with ana', kind: { booking: { booking_id: 'b1' } }, visibility: 'busy_only', when: second, zone: ZONE })));
  // The viewer's own copy of a booking they made with bo: what offers Reschedule.
  const third = { once: { start_ms: second.once.start_ms + 1_800_000n, end_ms: second.once.end_ms + 1_800_000n } };
  store.put('user', 'cal/private/b2', engine.encodeEvent(event({ id: 'b2', origin_node: 'n1', author: VIEWER, hosts: ['bo'], title: 'Call with bo', kind: { booking: { booking_id: 'b2' } }, visibility: 'private', when: third, zone: ZONE })));
  window.__calendarKeys = () => [...store.values.keys()];
  window.__calendarEvent = (key) => engine.decodeEvent(store.values.get(key));
  return ports;
}

function Changes() {
  const [ready, setReady] = useState(null);
  useEffect(() => {
    glue.default({ module_or_path: wasmUrl }).then(async () => {
      const engine = new CalendarEngine(glue, intlOffsetAt());
      setReady({ engine, ports: await seeded(engine) });
    });
  }, []);
  if (ready === null) return <p>Loading the calendar</p>;
  const state = { nodes: TREE, members: {}, workspace: { metadata: [] } };
  return (
    <WorkspaceContext.Provider value={{ state }}>
      <main className="mx-auto max-w-6xl">
        <CalendarPane ports={ready.ports} engine={ready.engine} nodeId="n1" me={VIEWER} displayZone={ZONE} deviceZone={ZONE} held={new Set(['ihttp.call'])} mayEditNode />
      </main>
    </WorkspaceContext.Provider>
  );
}

export const CALENDAR_CHANGE_SCENARIOS = { 'calendar-changes': () => <Changes /> };
