/**
 * A team type saved while the routing forms are open is offered to them at once (design §3.6.3):
 * the setup reads the node's team types when it mounts, and again when the kernel says one of the
 * node's `cal/type/` keys changed (it tells the writer's own session too), so an editor who adds a
 * round robin and then makes a form can route to it without leaving the page. A change to another
 * node's types, or to this node's events, is not a reason to read them again.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { INTRO } from '@/lib/calendar/__tests__/booking-fixture';
import { realEngine } from '@/lib/calendar/__tests__/engine-rig';
import type { EventType } from '@/lib/calendar/generated/EventType';
import { MemoryStore } from '@/lib/calendar/__tests__/memory-store';
import { calendarPorts, type CalendarPorts } from '@/lib/calendar/ports';
import { saveTeamType } from '@/lib/calendar/team-types';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance, type StorageChange } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import { rosterMembersPort } from '@/lib/citadel-apps/runtime/first-party-ports';
import { RoutingFormsSetup } from '../RoutingFormsSetup';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const NODE: { id: string; name: string; } = { id: 'n1', name: 'Platform' };
const ROTA: EventType = { ...INTRO, id: 'rr', name: 'Support rota', kind: { round_robin: { hosts: ['ana', 'bo'], strategy: 'equal' } } };

interface Rig {
  readonly ports: CalendarPorts;
  /** The kernel's StorageChanged, as the page hands it to the instance. */
  readonly change: (c: StorageChange) => void;
}

/** An editor's instance: the real ports and gate over an in-memory store, with the node's roster. */
function editorRig(): Rig {
  const listeners: Set<(c: StorageChange) => void> = new Set();
  const store: MemoryStore = new MemoryStore('alice');
  const ports: CalendarPorts = calendarPorts(glueInstance({
    appId: 'net.avarok.calendar', policy: STANDARD_HOST_POLICY,
    ports: { storage: store.port(), members: rosterMembersPort(() => [{ username: 'ana', displayName: 'Ana', isOnline: true }]) },
    held: new Set<Capability>(['storage.node', 'members.list']), limits: { topics: null, p2p: null },
    clock: new ManualClock(), pageUrl: 'https://w.example/n1',
    storageChanges: (l) => { listeners.add(l); return () => listeners.delete(l); },
  }));
  return { ports, change: (c: StorageChange): void => { for (const l of listeners) l(c); } };
}

async function openNewForm(): Promise<Rig & { rig: Rig }> {
  const rig: Rig = editorRig();
  const { ports } = rig;
  let n: number = 0;
  render(<RoutingFormsSetup ports={ports} engine={engine} node={NODE} newId={(): string => `id${(n += 1)}`} />);
  fireEvent.click(await screen.findByRole('button', { name: 'New routing form' }));
  fireEvent.change(screen.getByLabelText('Anyone else goes to: kind'), { target: { value: 'team_type' } });
  return { ...rig, rig };
}

const offered = (): string[] =>
  within(screen.getByLabelText('Anyone else goes to: team type')).getAllByRole('option').map((o) => o.textContent ?? '');

describe('the routing forms setup', () => {
  it('offers a team type saved after it mounted, once the kernel says the node\'s types changed', async () => {
    const { rig, ports } = await openNewForm();
    expect(offered()).toEqual(['Platform has no team types yet']);

    await saveTeamType(ports, engine, NODE.id, ROTA);
    act((): void => rig.change({ backend: { node: { node_id: NODE.id } }, key: 'cal/type/rr' }));

    expect(await screen.findByRole('option', { name: 'Support rota' })).toBeTruthy();
    expect(offered()).toEqual(['Choose a team type', 'Support rota']);
  });

  it('does not read them again for a change on another node, or to this node\'s events', async () => {
    const { rig, ports } = await openNewForm();
    await saveTeamType(ports, engine, NODE.id, ROTA);
    act((): void => rig.change({ backend: { node: { node_id: 'n2' } }, key: 'cal/type/rr' }));
    act((): void => rig.change({ backend: { node: { node_id: NODE.id } }, key: 'cal/event/e1' }));
    act((): void => rig.change({ backend: { node_authored: { node_id: NODE.id, author: 'alice' } }, key: 'cal/type/rr' }));
    await act(async (): Promise<void> => { await new Promise((r) => setTimeout(r, 20)); });
    expect(offered()).toEqual(['Platform has no team types yet']);
  });
});
