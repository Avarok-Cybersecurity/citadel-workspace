/**
 * The Calendar pane as an editor of Platform sees team bookings, polls and routing forms, over the
 * shipped engine, the real ports, gate, tree and roster ports, and an in-memory store: ana, bo and
 * cy keep working hours here; Platform has a round robin of ana and bo (ana already has two
 * bookings this month, bo none) and a collective of both; ana asks a poll and so does the viewer
 * (bo said yes to its second time); and a routing form sends Sales to bo and anything else to the
 * round robin. The install holds no iHTTP, so a booking is left as a request to the first host
 * ranked, which is what the checks read. The store's keys and a decoder are left on `window` for
 * the checks; they are the harness's, never the app's.
 */
import { pinnedClock } from './pinned-clock.js';
import { useEffect, useState } from 'react';
import * as glue from '../../../vendor/calendar/calendar_glue.js';
import wasmUrl from '../../../public/calendar/calendar_glue_bg.wasm?url';
import { CalendarPane } from '@/components/calendar/CalendarPane';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';
import { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import { intlOffsetAt } from '@/lib/calendar/engine/intl-offsets';
import { calendarPorts } from '@/lib/calendar/ports';
import { event } from '@/lib/calendar/__tests__/event-fixture';
import { INTRO, WORKING_HOURS } from '@/lib/calendar/__tests__/booking-fixture';
import { MemoryStore } from '@/lib/calendar/__tests__/memory-store';
import { VIEWER } from '@/lib/calendar/__tests__/placement-fixture';
import { glueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { treeNodesPort } from '@/lib/citadel-apps/runtime/nodes-port';
import { rosterMembersPort } from '@/lib/citadel-apps/runtime/first-party-ports';
import { saveConsent } from '@/lib/calendar/sdk-store';

const PAGE_CLOCK = pinnedClock();
const TREE = {
  company: { id: 'company', name: 'Company', parent_id: null, children: ['n1'], metadata: [] },
  n1: { id: 'n1', name: 'Platform', parent_id: 'company', children: [], metadata: [] },
};
const ZONE = 'America/New_York';
const ROSTER = ['ana', 'bo', 'cy', VIEWER].map((u) => ({ username: u, displayName: u, isOnline: true }));
const at = (iso, minutes) => ({ start_ms: BigInt(Date.parse(iso)), end_ms: BigInt(Date.parse(iso)) + BigInt(minutes * 60_000) });
const team = (id, name, kind) => ({ ...INTRO, id, name, kind, questions: [] });
const PLAN = { ...INTRO, id: 'plan', name: 'Planning', kind: 'poll', questions: [] };

function seed(engine, store) {
  const as = (author) => ({ node_authored: { node_id: 'n1', author } });
  const set = (backend, key, value) => store.values.set(store.where(backend, key, false), value);
  for (const host of ['ana', 'bo', 'cy']) set(as(host), 'cal/availability', engine.encodeAvailability(WORKING_HOURS));
  for (const host of ['ana', 'bo']) set(as(host), 'cal/type/t1', engine.encodeEventType(INTRO));
  set(as(VIEWER), 'cal/type/plan', engine.encodeEventType(PLAN));
  set({ node: { node_id: 'n1' } }, 'cal/type/rr', engine.encodeEventType(team('rr', 'Support rota', { round_robin: { hosts: ['ana', 'bo'], strategy: 'equal' } })));
  set({ node: { node_id: 'n1' } }, 'cal/type/panel', engine.encodeEventType(team('panel', 'Panel interview', { collective: { hosts: ['ana', 'bo'] } })));
  for (const [id, iso] of [['a1', '2024-07-02T14:00:00Z'], ['a2', '2024-07-09T14:00:00Z']]) {
    set(as('ana'), `cal/event/${id}`, engine.encodeEvent(event({ id, origin_node: 'n1', author: 'ana', hosts: ['ana'], title: 'Booked', kind: { booking: { booking_id: id } }, visibility: 'busy_only', when: { once: at(iso, 30) }, zone: ZONE })));
  }
  const poll = (id, host, title, proposals) => ({ id, type_id: 'plan', host, title, zone: ZONE, proposals, state: 'open' });
  set(as('ana'), 'cal/poll/pa', engine.team.encodePoll(poll('pa', 'ana', 'Offsite planning', [at('2024-07-22T14:00:00Z', 60), at('2024-07-23T14:00:00Z', 60)])));
  set(as(VIEWER), 'cal/poll/pv', engine.team.encodePoll(poll('pv', VIEWER, 'Retro', [at('2024-07-24T15:00:00Z', 30), at('2024-07-25T15:00:00Z', 30)])));
  set(as('bo'), 'cal/poll-vote/pv', engine.team.encodePollVote({ poll_id: 'pv', yes: [1], maybe: [] }));
  const topic = { id: 'q-topic', label: 'What is it about?', kind: { choice: { options: ['Sales', 'Support'] } }, required: true };
  set({ node: { node_id: 'n1' } }, 'cal/routing/f1', engine.team.encodeRoutingForm({
    id: 'f1', name: 'Talk to the right person', questions: [topic],
    rules: [{ when: [{ question_id: 'q-topic', test: { is: { value: 'Sales' } } }], target: { member: { username: 'bo', slug: 'n1' } } }],
    fallback: { team_type: { node_id: 'n1', type_id: 'rr' } },
  }));
}

function build(engine) {
  const store = new MemoryStore(VIEWER);
  seed(engine, store);
  const ports = calendarPorts(glueInstance({
    appId: 'net.avarok.calendar', ports: { storage: store.port(), nodes: treeNodesPort('Workspace', () => TREE), members: rosterMembersPort(() => ROSTER) },
    held: new Set(['storage.user', 'storage.node', 'storage.node.authored', 'nodes.read', 'members.list']),
    policy: { ...STANDARD_HOST_POLICY, serverCallsPerSecond: 100_000 }, limits: { topics: null, p2p: null }, clock: PAGE_CLOCK, pageUrl: window.location.href, storageChanges: () => () => {},
  }));
  // An app the viewer allowed and one they refused, for the Apps panel (design §3.8).
  void saveConsent(ports, engine, 'com.acme.kanban', 'allow').then(() => saveConsent(ports, engine, 'com.acme.spam', 'refuse'));
  window.__calendarKeys = () => [...store.values.keys()];
  window.__calendarRead = (codec, key) => engine[codec](store.values.get(key));
  window.__calendarTeam = (codec, key) => engine.team[codec](store.values.get(key));
  return ports;
}

function Teams() {
  const [ready, setReady] = useState(null);
  useEffect(() => {
    glue.default({ module_or_path: wasmUrl }).then(() => {
      const engine = new CalendarEngine(glue, intlOffsetAt());
      setReady({ engine, ports: build(engine) });
    });
  }, []);
  if (ready === null) return <p>Loading the calendar</p>;
  const state = { nodes: TREE, members: {}, workspace: { metadata: [] } };
  return (
    <WorkspaceContext.Provider value={{ state }}>
      <main className="mx-auto max-w-6xl">
        <CalendarPane ports={ready.ports} engine={ready.engine} nodeId="n1" me={VIEWER} displayZone={ZONE} deviceZone={ZONE} held={new Set()} mayEditNode />
      </main>
    </WorkspaceContext.Provider>
  );
}

export const CALENDAR_TEAM_SCENARIOS = { 'calendar-teams': () => <Teams /> };
