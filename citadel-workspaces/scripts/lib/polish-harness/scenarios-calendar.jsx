/**
 * The Calendar tab in each view, on the shipped engine (the vendored glue and its committed
 * binary, over the browser's Intl), fed the placement fixture: every kind of entry a node shows.
 * The harness serves no public/ directory, so the binary is handed to the glue's own init by URL.
 */
import { nextHour, pinnedClock } from './pinned-clock.js';
import { useEffect, useReducer, useState } from 'react';
import * as glue from '../../../vendor/calendar/calendar_glue.js';
import wasmUrl from '../../../public/calendar/calendar_glue_bg.wasm?url';
import { CalendarTab } from '@/components/calendar/CalendarTab';
import { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import { intlOffsetAt } from '@/lib/calendar/engine/intl-offsets';
import { calendarReducer, initialCalendar } from '@/lib/calendar/store';
import { inherited, JULY_WEEK, VIEWER } from '@/lib/calendar/__tests__/placement-fixture';
import { event } from '@/lib/calendar/__tests__/event-fixture';
import { treeNodesPort } from '@/lib/citadel-apps/runtime/nodes-port';
import { CalendarMount } from '@/components/calendar/CalendarMount';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';
import { glueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { INTRO, WORKING_HOURS } from '@/lib/calendar/__tests__/booking-fixture';
import { MemoryStore } from '@/lib/calendar/__tests__/memory-store';
import { encodeSettings, SETTINGS_KEY } from '@/lib/calendar/zones';

const NOW = { date: { y: 2024, m: 7, d: 16 }, minute: 600 };
const NAMES = { company: 'Company', 'team-d': 'Team D — Developer experience and tooling', n1: 'Platform' };
const SOURCES = ['node', 'authored', 'inherited', 'up_pulled'];

function seeded(view) {
  return SOURCES.reduce(
    (state, source) => calendarReducer(state, { type: 'read', source, entries: JULY_WEEK.filter((e) => e.source === source), unreadable: 0, limitedTo: null }),
    initialCalendar(view, NOW.date),
  );
}

function Calendar({ view, zone }) {
  const [engine, setEngine] = useState(null);
  const [state, dispatch] = useReducer(calendarReducer, view, seeded);
  useEffect(() => {
    glue.default({ module_or_path: wasmUrl }).then(() => setEngine(new CalendarEngine(glue, intlOffsetAt())));
  }, []);
  if (engine === null) return <p>Loading the calendar</p>;
  return (
    <main className="mx-auto max-w-6xl p-4">
      <CalendarTab state={state} dispatch={dispatch} engine={engine} viewer={VIEWER} displayZone={zone}
        node={{ id: 'n1', name: 'Platform', zone: 'America/New_York' }} nodeName={(id) => NAMES[id] ?? id}
        now={NOW} onOpenChip={() => {}} onCreate={null} />
    </main>
  );
}

/** The page's own clock, as the glue instance of a mounted tab is given it (glue-steps.ts). */
const PAGE_CLOCK = pinnedClock();
const NODE = { id: 'n1', name: 'Platform', parent_id: 'company', children: [], metadata: [...new TextEncoder().encode(JSON.stringify({ time_zone: 'America/New_York' }))] };
const COMPANY = { id: 'company', name: 'Company', parent_id: null, children: ['n1'], metadata: [] };
const TREE = { company: COMPANY, n1: NODE };

/**
 * The whole tab as the registry mounts it, over the real ports and gate and an in-memory store
 * seeded through the shipped core: the member's settings, the node's events, and another member
 * (ana) who offers a type here.
 */
function MountedCalendar({ engine }) {
  const [glue] = useState(() => {
    const store = new MemoryStore(VIEWER);
    store.put('user', SETTINGS_KEY, encodeSettings({ displayZone: { kind: 'fixed', zone: 'America/Chicago' } }));
    for (const e of JULY_WEEK) if (e.source === 'node') store.put({ node: { node_id: 'n1' } }, `cal/event/${e.event.id}`, engine.encodeEvent(e.event));
    const ana = { node_authored: { node_id: 'n1', author: 'ana' } };
    store.values.set(store.where(ana, 'cal/type/t1', false), engine.encodeEventType(INTRO));
    store.values.set(store.where(ana, 'cal/availability', false), engine.encodeAvailability(WORKING_HOURS));
    // Company's all-hands in the coming hour, which goes down: its origin, and the projection its publisher wrote here.
    const p = inherited.projection;
    const hour = nextHour(PAGE_CLOCK);
    const when = { once: { start_ms: hour + 3_600_000n, end_ms: hour + 7_200_000n } };
    const allHands = event({ id: 'allhands', origin_node: 'company', rev: p.origin_rev, title: p.title, when, zone: p.zone, propagate: { down: true, up_to: null } });
    store.put({ node: { node_id: 'company' } }, 'cal/event/allhands', engine.encodeEvent(allHands));
    store.put({ node: { node_id: 'n1' } }, 'cal/inherit/company/allhands', engine.encodeProjection(engine.project(allHands)));
    return glueInstance({
      appId: 'net.avarok.calendar', ports: { storage: store.port(), nodes: treeNodesPort('Workspace', () => TREE) },
      held: new Set(['storage.user', 'storage.node', 'storage.node.authored', 'nodes.read']),
      policy: STANDARD_HOST_POLICY, limits: { topics: null, p2p: null }, clock: PAGE_CLOCK, pageUrl: window.location.href, storageChanges: () => () => {},
    });
  });
  const state = { nodes: TREE, members: {}, workspace: { metadata: [] } };
  return (
    <WorkspaceContext.Provider value={{ state }}>
      <main className="mx-auto max-w-6xl">
        <CalendarMount glue={glue} install={{}} manifest={{ name: 'Calendar' }} nodeId="n1" me={VIEWER} tabId="calendar" mayEditNode={false} />
      </main>
    </WorkspaceContext.Provider>
  );
}

function Mounted() {
  const [engine, setEngine] = useState(null);
  useEffect(() => {
    glue.default({ module_or_path: wasmUrl }).then(() => setEngine(new CalendarEngine(glue, intlOffsetAt())));
  }, []);
  return engine === null ? <p>Loading the calendar</p> : <MountedCalendar engine={engine} />;
}

export const CALENDAR_SCENARIOS = {
  'calendar-mounted': () => <Mounted />,
  'calendar-month': () => <Calendar view="month" zone="America/New_York" />,
  'calendar-week': () => <Calendar view="week" zone="America/Chicago" />,
  'calendar-day': () => <Calendar view="day" zone="America/New_York" />,
  'calendar-agenda': () => <Calendar view="agenda" zone="America/Chicago" />,
};
