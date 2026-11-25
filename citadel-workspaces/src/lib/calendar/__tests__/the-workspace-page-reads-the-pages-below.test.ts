/**
 * The Calendar on the workspace's own page (owner, 2026-11-25: "Could not read events from the pages
 * below: it is not available right now (not_found)"). The workspace is a sentinel on the server,
 * never a stored node, so the page's tree holds only the spaces under it, whose parent names the
 * sentinel. The tree port answered the sentinel `not_found`, the walk around the node failed, and
 * the pages below were reported unreadable on every workspace with a page under it.
 *
 * Over the real ports, gate, tree port and core, with the tree the page holds (withWorkspaceRoot
 * applied as the glue binding applies it): a page below with no events yet reads as empty, not as a
 * failure; an event a page below sends up is shown; and a page below the reader may not read is
 * still said, so a real failure is not hidden by the fix.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withWorkspaceRoot, type PageNode } from '@/lib/citadel-apps/runtime/nodes-port';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import type { CalendarEngine } from '../engine/calendar-engine';
import { calendarReducer, initialCalendar, type CalendarAction, type CalendarState, type EntrySource, type LoadState } from '../store';
import { useCalendarSources } from '../use-calendar-sources';
import { event, realEngine } from './engine-rig';
import { member, TopicGroup, treeOf, type Member } from './tree-rig';

const engine: CalendarEngine = realEngine();
/** As the server sends it: Technology and TODOs under the workspace, Team under Technology; no workspace node. */
const SENT: Record<string, PageNode> = treeOf({ tech: WORKSPACE_ROOT_ID, todos: WORKSPACE_ROOT_ID, team: 'tech' });
const READY: LoadState = { kind: 'ready', unreadable: 0, limitedTo: null };
const SOURCES: readonly EntrySource[] = ['node', 'authored', 'private', 'inherited', 'up_pulled'];

async function workspacePage(tree: Record<string, PageNode>, setUp: (m: Member) => void = (): void => {}): Promise<CalendarState> {
  const amy: Member = member('amy', new Map(), tree, new TopicGroup());
  setUp(amy);
  let state: CalendarState = initialCalendar('agenda', { y: 2024, m: 7, d: 16 });
  const dispatch = (a: CalendarAction): void => { state = calendarReducer(state, a); };
  renderHook(() => useCalendarSources(amy.ports, engine, WORKSPACE_ROOT_ID, dispatch));
  await waitFor(() => expect(SOURCES.every((s) => state.loads.get(s)?.kind !== undefined && state.loads.get(s)?.kind !== 'loading')).toBe(true));
  return state;
}

describe("the Calendar on the workspace's own page", () => {
  it('reads pages below with no events yet as empty, with nothing reported', async () => {
    const state: CalendarState = await workspacePage({ ...withWorkspaceRoot(SENT, 'Stealth Inference OS') });
    expect(SOURCES.map((s) => [s, state.loads.get(s)])).toEqual(SOURCES.map((s) => [s, READY]));
    expect(state.entries.size).toBe(0);
  });

  it('shows an event a page below sends up to the workspace', async () => {
    const offsite = event({ id: 'offsite', origin_node: 'team', title: 'Offsite', propagate: { down: false, up_to: WORKSPACE_ROOT_ID } });
    const state: CalendarState = await workspacePage({ ...withWorkspaceRoot(SENT, 'Stealth Inference OS') }, (amy: Member): void => {
      amy.store.put({ node: { node_id: 'team' } }, 'cal/event/offsite', engine.encodeEvent(offsite));
    });
    expect(state.loads.get('up_pulled')).toEqual(READY);
    expect([...state.entries.values()].map((e) => (e.source === 'up_pulled' ? e.event.title : e.source))).toEqual(['Offsite']);
  });

  it('still says when a page below cannot be read', async () => {
    const state: CalendarState = await workspacePage({ ...withWorkspaceRoot(SENT, 'Stealth Inference OS') }, (amy: Member): void => {
      amy.store.unreadable.add('team');
    });
    expect(state.loads.get('up_pulled')).toEqual({ kind: 'failed', reason: 'it was refused (permission)' });
    expect(state.loads.get('node')).toEqual(READY);
  });
});

describe('the tree the page holds, with the workspace in it', () => {
  it('names the workspace and lists the spaces whose parent is the workspace or none', () => {
    const tree: Readonly<Record<string, PageNode>> = withWorkspaceRoot({ ...SENT, loose: { id: 'loose', name: 'Loose', parent_id: null, children: [] } }, 'Stealth Inference OS');
    expect(tree[WORKSPACE_ROOT_ID]).toEqual({ id: WORKSPACE_ROOT_ID, name: 'Stealth Inference OS', parent_id: null, children: ['tech', 'todos', 'loose'] });
  });

  it('keeps a workspace node the page already holds', () => {
    const held: Record<string, PageNode> = treeOf({ [WORKSPACE_ROOT_ID]: null, tech: WORKSPACE_ROOT_ID });
    expect(withWorkspaceRoot(held, 'Other name')).toBe(held);
  });
});
