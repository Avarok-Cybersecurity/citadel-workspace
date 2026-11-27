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
import { domainNode, workspaceState } from './workspace-state';
import manifestText from '../../../../apps/first-party/calendar/manifest.json?raw';
import { CALENDAR_APP_ID } from '@/lib/calendar/app-id';
import { glueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { INTRO, WORKING_HOURS } from '@/lib/calendar/__tests__/booking-fixture';
import { MemoryStore } from '@/lib/calendar/__tests__/memory-store';
import { oneWindow } from '@/lib/citadel-apps/runtime/__tests__/one-window';
import { encodeSettings, SETTINGS_KEY } from '@/lib/calendar/zones';

const NOW = { date: { y: 2024, m: 7, d: 16 }, minute: 600 };
const NAMES = { company: 'Company', 'team-d': 'Team D — Developer experience and tooling', n1: 'Platform' };
/** @type {import('@/lib/calendar/store').EntrySource[]} */
const SOURCES = ['node', 'authored', 'inherited', 'up_pulled'];

function seeded(view) {
  return SOURCES.reduce(
    (state, source) => calendarReducer(state, { type: 'read', source, entries: JULY_WEEK.filter((e) => e.source === source), unreadable: 0, limitedTo: null }),
    initialCalendar(view, NOW.date),
  );
}

function Calendar({ view, zone }) {
  const engine = useCalendarEngine();
  const [state, dispatch] = useReducer(calendarReducer, view, seeded);
  if (engine === null) return <p>Loading the calendar</p>;
  return (
    <main className="mx-auto max-w-6xl p-4">
      <CalendarTab state={state} dispatch={dispatch} engine={engine} viewer={VIEWER} displayZone={zone}
        node={{ id: 'n1', name: 'Platform', zone: 'America/New_York' }} nodeName={(id) => NAMES[id] ?? id}
        now={NOW} onOpenChip={() => {}} onCreate={null} />
    </main>
  );
}

/** The page's clocks, as the glue instance of a mounted tab is given them (glue-steps.ts): pinned, it stands for both the date and the time waited on. */
const PAGE_CLOCK = pinnedClock();
const NODE = domainNode({ id: 'n1', name: 'Platform', parent_id: 'company', children: [], metadata: new TextEncoder().encode(JSON.stringify({ time_zone: 'America/New_York' })) });
const COMPANY = domainNode({ id: 'company', name: 'Company', parent_id: null, children: ['n1'], metadata: new Uint8Array() });
export const TREE = { company: COMPANY, n1: NODE };
/** The Calendar's own shipped manifest, and an install of it on the node, as the registry hands CalendarMount both. */
/** @type {import('citadel-workspace-client-ts').AppManifest} */
const MANIFEST = JSON.parse(manifestText);
/** @type {import('citadel-workspace-client-ts').AppInstall} */
const INSTALL = {
  id: 'install-calendar', app_id: CALENDAR_APP_ID, version: MANIFEST.version, manifest_sha256: '1'.repeat(64), artifact_sha256: '0'.repeat(64),
  pinned_publisher_key: 'ab'.repeat(1952), scope: { Node: 'n1' }, granted: ['storage.user', 'storage.node', 'storage.node.authored', 'nodes.read'],
  details: { host_network_hosts: [], server_network_hosts: [], ihttp_routes: [], ihttp_call_targets: [], ihttp_p2p_routes: [], topics: [] },
  installed_by: VIEWER, installed_at_ms: 1n, state: 'Active', previous: null, injected_header_into: [], source: { Global: { catalogue_version: 1n } },
};

/**
 * The tab's glue instance over the real ports and gate and an in-memory store seeded through the
 * shipped core: the member's settings, the node's events, and another member (ana) who offers a
 * type here. The whole tab as the registry mounts it is MountedCalendar below.
 */
/** @param {CalendarEngine} engine */
export function seededGlue(engine) {
  const store = new MemoryStore(VIEWER);
  store.put('user', SETTINGS_KEY, encodeSettings({ displayZone: { kind: 'fixed', zone: 'America/Chicago' } }));
  for (const e of JULY_WEEK) if (e.source === 'node') store.put({ node: { node_id: 'n1' } }, `cal/event/${e.event.id}`, engine.encodeEvent(e.event));
  const ana = { node_authored: { node_id: 'n1', author: 'ana' } };
  store.values.set(store.where(ana, 'cal/type/t1', false), engine.encodeEventType(INTRO));
  store.values.set(store.where(ana, 'cal/availability', false), engine.encodeAvailability(WORKING_HOURS));
  // Company's all-hands in the coming hour, which goes down: its origin, and the projection its publisher wrote here.
  if (inherited.source !== 'inherited') throw new Error(`the placement fixture's inherited entry is a ${inherited.source} entry`);
  const p = inherited.projection;
  if (p.title === null) throw new Error('the placement fixture\'s inherited projection has no title to show');
  const hour = nextHour(PAGE_CLOCK);
  const when = { once: { start_ms: hour + 3_600_000n, end_ms: hour + 7_200_000n } };
  const allHands = event({ id: 'allhands', origin_node: 'company', rev: p.origin_rev, title: p.title, when, zone: p.zone, propagate: { down: true, up_to: null } });
  store.put({ node: { node_id: 'company' } }, 'cal/event/allhands', engine.encodeEvent(allHands));
  store.put({ node: { node_id: 'n1' } }, 'cal/inherit/company/allhands', engine.encodeProjection(engine.project(allHands)));
  // The member's own-store writes are heard as the page hears them (one-window.ts).
  const page = oneWindow(store.port());
  return glueInstance({
    appId: 'net.avarok.calendar', ports: { storage: page.storage, nodes: treeNodesPort('Workspace', () => TREE) },
    held: new Set(['storage.user', 'storage.node', 'storage.node.authored', 'nodes.read']),
    policy: STANDARD_HOST_POLICY, limits: { topics: null, p2p: null }, clock: PAGE_CLOCK, wallNow: PAGE_CLOCK.now, pageUrl: window.location.href, storageChanges: page.ownChanges,
  });
}

function MountedCalendar({ engine }) {
  const [glue] = useState(() => seededGlue(engine));
  const state = workspaceState({ nodes: TREE, workspace: { id: 'w', name: 'Workspace', metadata: new Uint8Array() } });
  return (
    <WorkspaceContext.Provider value={{ state }}>
      <main className="mx-auto max-w-6xl">
        <CalendarMount glue={glue} install={INSTALL} manifest={MANIFEST} nodeId="n1" me={VIEWER} tabId="calendar" mayEditNode={false} />
      </main>
    </WorkspaceContext.Provider>
  );
}

/** The shipped engine, once the glue's binary is loaded; null until then. */
export function useCalendarEngine() {
  const [engine, setEngine] = useState(/** @type {CalendarEngine | null} */ (null));
  useEffect(() => {
    glue.default({ module_or_path: wasmUrl }).then(() => setEngine(new CalendarEngine(glue, intlOffsetAt())));
  }, []);
  return engine;
}

function Mounted() {
  const engine = useCalendarEngine();
  return engine === null ? <p>Loading the calendar</p> : <MountedCalendar engine={engine} />;
}

export const CALENDAR_SCENARIOS = {
  'calendar-mounted': () => <Mounted />,
  'calendar-month': () => <Calendar view="month" zone="America/New_York" />,
  'calendar-week': () => <Calendar view="week" zone="America/Chicago" />,
  'calendar-day': () => <Calendar view="day" zone="America/New_York" />,
  'calendar-agenda': () => <Calendar view="agenda" zone="America/Chicago" />,
};
