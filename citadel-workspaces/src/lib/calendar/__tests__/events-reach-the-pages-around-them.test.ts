/**
 * Propagation (design 3.5, C7) end to end over the real ports, gate, tree port and core, with one
 * shared store and tree: an editor at A saves an event that goes down, and it shows read-only at
 * every page below, from A; a member at D posts one with `up_to` E, and it shows at E; a reader who
 * may not view A sees the projection without a link; cancelling the origin removes it everywhere;
 * a page the kernel refuses is named in the save's outcome while the rest are written; and every
 * window hears `{ node, key }` on the `cal` topic and nothing else.
 */
import { describe, expect, it } from 'vitest';
import type { CalendarEngine } from '../engine/calendar-engine';
import type { EventCheck } from '../event-draft';
import { saveEvent } from '../event-save';
import type { Event } from '../generated/Event';
import { readInherited, readUpPulled } from '../read-propagated';
import { chainOf, descendantsOf } from '../tree-walk';
import { event, realEngine } from './engine-rig';
import { member, TopicGroup, treeOf, type Member } from './tree-rig';
import type { SaveOutcome } from '@/lib/calendar/event-save';
import type { PropagatedRead } from '@/lib/calendar/read-propagated';
import type { TreeNode } from '@/lib/citadel-apps/runtime/nodes-port';

const engine: CalendarEngine = realEngine();
/** a > e > d, and a > b > c. */
const TREE: Record<string, TreeNode> = treeOf({ a: null, e: 'a', d: 'e', b: 'a', c: 'b' });
const NONE = (): void => {};

function world(): { values: Map<string, Uint8Array>; group: TopicGroup; join: (me: string) => Member } {
  const values: Map<string, Uint8Array> = new Map();
  const group: TopicGroup = new TopicGroup();
  return { values, group, join: (me: string): Member => member(me, values, TREE, group) };
}

const official = (e: Event): Extract<EventCheck, { ok: true }> => ({ ok: true, event: e, store: { kind: 'node', node: e.origin_node }, key: `cal/event/${e.id}` });
const posted = (e: Event): Extract<EventCheck, { ok: true }> => ({ ok: true, event: e, store: { kind: 'authored', node: e.origin_node, author: e.author }, key: `cal/event/${e.id}` });

async function inheritedAt(m: Member, node: string): Promise<{ title: string | null; from: string; linked: boolean }[]> {
  const read: PropagatedRead = await readInherited(m.ports, engine, node);
  return read.entries.map((x) => (x.source === 'inherited' ? { title: x.projection.title, from: x.projection.origin_node, linked: x.linked } : { title: null, from: '?', linked: false }));
}

describe('an event that goes down', () => {
  it('shows read-only on every page below its origin, from the origin, and never on the origin', async () => {
    const w: { values: Map<string, Uint8Array>; group: TopicGroup; join: (me: string) => Member; } = world();
    const amy: Member = w.join('amy');
    const allHands: Event = event({ id: 'all', origin_node: 'a', title: 'All hands', body: 'secret agenda', propagate: { down: true, up_to: null } });
    expect(await saveEvent(amy.ports, engine, official(allHands), null, NONE)).toEqual({ kind: 'saved' });
    const bob: Member = w.join('bob');
    for (const node of ['b', 'c', 'd', 'e']) expect(await inheritedAt(bob, node)).toEqual([{ title: 'All hands', from: 'a', linked: true }]);
    expect(await inheritedAt(bob, 'a')).toEqual([]);
    const stored: string[] = [...w.values.keys()].filter((k) => k.includes('cal/inherit/'));
    expect(stored.sort()).toEqual(['b', 'c', 'd', 'e'].map((n) => `node:${n}|cal/inherit/a/all`));
  });

  it('shows the projection without a link to a reader who may not view the origin', async () => {
    const w: { values: Map<string, Uint8Array>; group: TopicGroup; join: (me: string) => Member; } = world();
    await saveEvent(w.join('amy').ports, engine, official(event({ id: 'x', origin_node: 'a', propagate: { down: true, up_to: null } })), null, NONE);
    const guest: Member = w.join('guest');
    guest.store.unreadable.add('a');
    expect(await inheritedAt(guest, 'c')).toEqual([{ title: 'Standup', from: 'a', linked: false }]);
  });

  it("shows a newer origin's fields over a stale projection, until the publisher's next save rewrites it", async () => {
    const w: { values: Map<string, Uint8Array>; group: TopicGroup; join: (me: string) => Member; } = world();
    const amy: Member = w.join('amy');
    const first: Event = event({ id: 'x', origin_node: 'a', propagate: { down: true, up_to: null } });
    await saveEvent(amy.ports, engine, official(first), null, NONE);
    amy.store.put({ node: { node_id: 'a' } }, 'cal/event/x', engine.encodeEvent({ ...first, rev: 2, title: 'Moved standup', body: 'not projected' }));
    expect(await inheritedAt(amy, 'c')).toEqual([{ title: 'Moved standup', from: 'a', linked: true }]);
  });

  it('is removed from every page below when its origin is cancelled', async () => {
    const w: { values: Map<string, Uint8Array>; group: TopicGroup; join: (me: string) => Member; } = world();
    const amy: Member = w.join('amy');
    const first: Event = event({ id: 'x', origin_node: 'a', propagate: { down: true, up_to: null } });
    await saveEvent(amy.ports, engine, official(first), null, NONE);
    const cancelled: Event = { ...first, rev: 2, status: { cancelled: { by: 'amy', reason: null } } };
    expect(await saveEvent(amy.ports, engine, official(cancelled), first, NONE)).toEqual({ kind: 'saved' });
    expect([...w.values.keys()].filter((k) => k.includes('cal/inherit/'))).toEqual([]);
    for (const node of ['b', 'c']) expect(await inheritedAt(amy, node)).toEqual([]);
  });

  it('names each page the kernel refuses, keeps the event saved and still writes the others', async () => {
    const w: { values: Map<string, Uint8Array>; group: TopicGroup; join: (me: string) => Member; } = world();
    const amy: Member = w.join('amy');
    amy.store.unwritable.add('c');
    const progress: [number, number][] = [];
    const outcome: SaveOutcome = await saveEvent(amy.ports, engine, official(event({ id: 'x', origin_node: 'a', propagate: { down: true, up_to: null } })), null, (d, of) => progress.push([d, of]));
    expect(outcome).toEqual({ kind: 'partly', failed: [{ node: 'c', reason: 'it was refused (permission)' }] });
    expect(progress.at(-1)).toEqual([4, 4]);
    expect(w.values.has('node:a|cal/event/x')).toBe(true);
    expect(await inheritedAt(amy, 'd')).toHaveLength(1);
  });

  it('is refused whole, before it is written, when more pages lie below than the core allows', async () => {
    const parents: Record<string, string | null> = { root: null };
    for (let i: number = 0; i < 257; i += 1) parents[`p${i}`] = 'root';
    const amy: Member = member('amy', new Map(), treeOf(parents), new TopicGroup());
    const outcome: SaveOutcome = await saveEvent(amy.ports, engine, official(event({ id: 'x', origin_node: 'root', propagate: { down: true, up_to: null } })), null, NONE);
    expect(outcome.kind).toBe('refused');
    expect(amy.store.values.size).toBe(0);
  });
});

describe('an event that goes up', () => {
  it('shows at the page it names and the pages between, from where it was posted', async () => {
    const w: { values: Map<string, Uint8Array>; group: TopicGroup; join: (me: string) => Member; } = world();
    const dan: Member = w.join('dan');
    await saveEvent(dan.ports, engine, posted(event({ id: 'one-on-one', origin_node: 'd', author: 'dan', propagate: { down: false, up_to: 'e' } })), null, NONE);
    const eve: Member = w.join('eve');
    const atE: PropagatedRead = await readUpPulled(eve.ports, engine, await chainOf(eve.ports, 'e'), await descendantsOf(eve.ports, 'e', 256));
    expect(atE.entries.map((x) => x.source === 'up_pulled' && [x.event.id, x.event.origin_node])).toEqual([['one-on-one', 'd']]);
    const atA: PropagatedRead = await readUpPulled(eve.ports, engine, await chainOf(eve.ports, 'a'), await descendantsOf(eve.ports, 'a', 256));
    expect(atA.entries).toEqual([]);
  });
});

describe('the cal topic', () => {
  it('tells the other windows which key on which node changed, and nothing about the event', async () => {
    const w: { values: Map<string, Uint8Array>; group: TopicGroup; join: (me: string) => Member; } = world();
    const amy: Member = w.join('amy');
    await amy.ports.topics.open('cal');
    await saveEvent(amy.ports, engine, official(event({ id: 'x', origin_node: 'a', body: 'secret agenda' })), null, NONE);
    expect(w.group.sent.map((s) => engine.decodeChange(s.body))).toEqual([{ node: 'a', key: 'cal/event/x' }]);
    const text: string = new TextDecoder().decode(w.group.sent[0]?.body);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('Standup');
  });
});
