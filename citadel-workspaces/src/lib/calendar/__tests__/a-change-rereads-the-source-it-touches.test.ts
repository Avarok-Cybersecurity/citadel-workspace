/**
 * Which sources a change re-reads (change-routing.ts): this node's own keys by store, an event on
 * an ancestor re-reads what is inherited here, an event below re-reads what is pulled up, and a
 * topic message, which cannot say whose store, re-reads both of this node's event sources.
 */
import { describe, expect, it } from 'vitest';
import { sourcesOfStorageChange, sourcesOfTopicChange, type Around } from '../change-routing';

const AT_B: Around = { node: 'b', chain: ['b', 'a'], below: new Set(['c']) };

describe('routing a StorageChanged', () => {
  it.each([
    [{ node: { node_id: 'b' } }, 'cal/event/x', ['node']],
    [{ node_authored: { node_id: 'b', author: 'amy' } }, 'cal/event/x', ['authored']],
    [{ node: { node_id: 'b' } }, 'cal/inherit/a/x', ['inherited']],
    [{ node: { node_id: 'a' } }, 'cal/event/x', ['inherited']],
    [{ node_authored: { node_id: 'a', author: 'amy' } }, 'cal/event/x', []],
    [{ node: { node_id: 'c' } }, 'cal/event/x', ['up_pulled']],
    [{ node_authored: { node_id: 'c', author: 'amy' } }, 'cal/event/x', ['up_pulled']],
    [{ node: { node_id: 'elsewhere' } }, 'cal/event/x', []],
    [{ node: { node_id: 'c' } }, 'cal/type/t', []],
    ['user', 'cal/private/x', ['private']],
  ] as const)('%j %s re-reads %j', (backend, key, sources) => {
    expect(sourcesOfStorageChange({ backend, key }, AT_B)).toEqual(sources);
  });
});

describe('routing a cal topic message', () => {
  it.each([
    [{ node: 'b', key: 'cal/event/x' }, ['node', 'authored']],
    [{ node: 'b', key: 'cal/inherit/a/x' }, ['inherited']],
    [{ node: 'a', key: 'cal/event/x' }, ['inherited']],
    [{ node: 'c', key: 'cal/event/x' }, ['up_pulled']],
    [{ node: 'z', key: 'cal/event/x' }, []],
  ] as const)('%j re-reads %j', (change, sources) => {
    expect(sourcesOfTopicChange(change, AT_B)).toEqual(sources);
  });
});
