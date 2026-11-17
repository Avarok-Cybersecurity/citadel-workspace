/**
 * Two nodes could both claim to be the default, and the workspace opened on
 * whichever the object happened to yield first.
 *
 * The server holds "exactly one node is the default" as an invariant: setting
 * `is_default` on one node clears the flag on every other, under the same lock
 * and the same save. It then broadcasts only the node that was set — so a client
 * applying that broadcast learns the new default and never learns the old one
 * was cleared.
 *
 * `Office.tsx` resolves the landing node with
 * `Object.values(state.nodes).find(n => n.is_default)`, which takes the first
 * match in insertion order. With two flagged nodes that is arbitrary, so
 * different clients could open on different rooms and the one who made the
 * change would see something different from everyone else.
 *
 * The invariant is stated on both sides now: the server writes it, and
 * `upsertNode` — the single place a node enters client state — maintains it.
 */
import { describe, it, expect } from 'vitest';
import { upsertNode } from '../event-setup-utils';
import type { DomainNode } from 'citadel-workspace-client-ts';

interface State { nodes: Record<string, DomainNode> }

function node(id: string, isDefault: boolean): DomainNode {
  return { id, name: id, is_default: isDefault } as unknown as DomainNode;
}

function harness(initial: DomainNode[]): { state: State; set: (fn: (prev: State) => State) => void } {
  const state: State = { nodes: {} };
  for (const n of initial) state.nodes[n.id] = n;
  const set = (fn: (prev: State) => State): void => {
    const next: State = fn(state);
    state.nodes = next.nodes;
  };
  return { state, set };
}

function defaults(state: State): string[] {
  return Object.values(state.nodes).filter((n) => n.is_default).map((n) => n.id).sort();
}

describe('a node arriving from the server', () => {
  it('becomes the only default when it claims to be one', () => {
    const { state, set } = harness([node('lobby', true), node('other', false)]);

    upsertNode(set as never, node('standup', true));

    expect(defaults(state)).toEqual(['standup']);
  });

  it('leaves the existing default alone when it claims nothing', () => {
    // The opposite failure: clearing on every upsert would wipe the default
    // whenever any unrelated node was renamed.
    const { state, set } = harness([node('lobby', true), node('other', false)]);

    upsertNode(set as never, node('other', false));

    expect(defaults(state)).toEqual(['lobby']);
  });

  it('keeps its own flag when it is re-sent as the default', () => {
    const { state, set } = harness([node('lobby', true)]);

    upsertNode(set as never, node('lobby', true));

    expect(defaults(state)).toEqual(['lobby']);
  });

  it('can leave the workspace with no default at all', () => {
    // `is_default: false` on the current default is a legitimate request and
    // must not silently promote something else — the server says so explicitly.
    const { state, set } = harness([node('lobby', true), node('other', false)]);

    upsertNode(set as never, node('lobby', false));

    expect(defaults(state)).toEqual([]);
  });
});
