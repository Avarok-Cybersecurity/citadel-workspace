/**
 * One of the node's own events, changed after it was saved, from the controls in its details
 * (event-edit.ts, event-change.ts), over the real core, ports, gate and tree port: an editor of
 * the node cancels it and its projections leave every page below; edits it to stop going down and
 * they leave too; edits its title and the pages below show the new one. A member without EditMdx
 * on the node is offered neither control.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContext, type WorkspaceState } from '@/contexts/WorkspaceContext';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import { saveEvent } from '@/lib/calendar/event-save';
import type { Event } from '@/lib/calendar/generated/Event';
import { event, realEngine, utc } from '@/lib/calendar/__tests__/engine-rig';
import { member, TopicGroup, treeOf, type Member } from '@/lib/calendar/__tests__/tree-rig';
import { CalendarPane } from '../CalendarPane';
import type { TreeNode } from '@/lib/citadel-apps/runtime/nodes-port';

const engine: CalendarEngine = realEngine();
/** a > b > c. */
const TREE: Record<string, TreeNode> = treeOf({ a: null, b: 'a', c: 'b' });
const ALL_HANDS: Event = event({
  id: 'all', origin_node: 'a', author: 'amy', title: 'All hands', propagate: { down: true, up_to: null },
  when: { once: { start_ms: utc('2024-07-16T16:00:00Z'), end_ms: utc('2024-07-16T17:00:00Z') } },
});

beforeEach((): void => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-07-16T15:00:00Z'));
});
afterEach((): void => { vi.useRealTimers(); });

async function opened(mayEditNode: boolean): Promise<Map<string, Uint8Array>> {
  const values: Map<string, Uint8Array> = new Map();
  const amy: Member = member('amy', values, TREE, new TopicGroup());
  const saving: { ok: true; event: Event; store: { kind: "node"; node: string; }; key: string; } = { ok: true as const, event: ALL_HANDS, store: { kind: 'node' as const, node: 'a' }, key: 'cal/event/all' };
  expect(await saveEvent(amy.ports, engine, saving, null, () => {})).toEqual({ kind: 'saved' });
  const state: WorkspaceState = { nodes: TREE, members: {}, workspace: { metadata: [] } } as unknown as WorkspaceState;
  render(
    <WorkspaceContext.Provider value={{ state }}>
      <CalendarPane ports={amy.ports} engine={engine} nodeId="a" me="amy" displayZone="America/New_York" deviceZone="America/New_York" held={new Set()} mayEditNode={mayEditNode} />
    </WorkspaceContext.Provider>,
  );
  fireEvent.click((await screen.findAllByRole('button', { name: /All hands/ }))[0] as HTMLElement);
  await screen.findByTestId('calendar-event-details');
  return values;
}

const projections = (values: Map<string, Uint8Array>): string[] => [...values.keys()].filter((k) => k.includes('cal/inherit/')).sort();
const origin = (values: Map<string, Uint8Array>): Event => engine.decodeEvent(values.get('node:a|cal/event/all') as Uint8Array);
const BELOW: string[] = ['node:b|cal/inherit/a/all', 'node:c|cal/inherit/a/all'];

describe("changing one of the node's own events from its details", () => {
  it('cancels it, recording who, and takes it off every page below', async () => {
    const values: Map<string, Uint8Array> = await opened(true);
    expect(projections(values)).toEqual(BELOW);
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'moved online' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel event' })); });
    await screen.findByText('The event is cancelled.');
    expect(projections(values)).toEqual([]);
    expect(origin(values)).toMatchObject({ rev: 2, status: { cancelled: { by: 'amy', reason: 'moved online' } } });
  });

  it('edited to stop going down, takes it off the pages below', async () => {
    const values: Map<string, Uint8Array> = await opened(true);
    fireEvent.click(screen.getByRole('button', { name: 'Edit event' }));
    const below: HTMLInputElement = screen.getByLabelText('On every page below A') as HTMLInputElement;
    expect(below.checked).toBe(true);
    fireEvent.click(below);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    await waitFor(() => expect(screen.queryByTestId('calendar-event-editor')).toBeNull());
    expect(projections(values)).toEqual([]);
    expect(origin(values)).toMatchObject({ id: 'all', rev: 2, author: 'amy', title: 'All hands', propagate: { down: false, up_to: null } });
  });

  it('edited, shows the new title on the pages below, at the same times', async () => {
    const values: Map<string, Uint8Array> = await opened(true);
    fireEvent.click(screen.getByRole('button', { name: 'Edit event' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'All hands, moved' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    await waitFor(() => expect(screen.queryByTestId('calendar-event-editor')).toBeNull());
    expect(origin(values)).toMatchObject({ rev: 2, title: 'All hands, moved', when: ALL_HANDS.when, created_ms: ALL_HANDS.created_ms });
    expect(BELOW.map((k) => engine.decodeProjection(values.get(k) as Uint8Array).title)).toEqual(['All hands, moved', 'All hands, moved']);
  });

  it('is offered to no one without EditMdx on the node', async () => {
    await opened(false);
    expect(screen.queryByRole('button', { name: 'Edit event' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel event' })).toBeNull();
  });
});
