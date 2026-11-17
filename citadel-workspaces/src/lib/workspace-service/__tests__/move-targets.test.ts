/**
 * `MoveNode` was fully plumbed on both sides — typed, permission-gated,
 * broadcast, gate-mapped, state-handled — and had no client method and no UI.
 * Reorganising a workspace was impossible: a capability built from both ends
 * and never joined in the middle.
 *
 * These are the rules the picker uses, so it can only ever offer destinations
 * the server will accept. An offer the server refuses is worse than no offer.
 */

import { describe, it, expect } from 'vitest';
import { moveTargets } from '../move-targets';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

function node(
  id: string,
  parent: string | null,
  children: string[],
  allowed: string[] | null,
  childType: string | null = 'Room',
): DomainNode {
  return {
    id,
    parent_id: parent,
    children,
    allowed_child_types: allowed,
    entity_type: childType ? { Child: childType } : 'Workspace',
  } as unknown as DomainNode;
}

/**
 * root → office → room, plus a second office that accepts rooms.
 *
 * `nested` is the one that makes the descendant rule testable: it is INSIDE
 * office and accepts Offices, so nothing but the descendant check keeps it off
 * the list when office is the node being moved. My first version of this tree
 * had no such node, and the control that allowed descendants passed — the
 * schema rule was quietly doing the work, and the descendant rule was untested.
 */
function tree(): Record<string, DomainNode> {
  return {
    root: node('root', null, ['office', 'other'], ['Office'], null),
    office: node('office', 'root', ['room', 'nested'], ['Room', 'Office'], 'Office'),
    other: node('other', 'root', [], ['Room'], 'Office'),
    room: node('room', 'office', [], [], 'Room'),
    nested: node('nested', 'office', [], ['Office'], 'Office'),
  };
}

describe('where a node may be moved', () => {
  it('offers a parent that accepts its type', () => {
    expect(moveTargets(tree(), 'room').map((n) => n.id)).toContain('other');
  });

  it('never offers the node itself', () => {
    expect(moveTargets(tree(), 'office').map((n) => n.id)).not.toContain('office');
  });

  it('never offers its own descendant', () => {
    // Moving a parent into its own child makes a cycle. `buildTreeFromNodes`
    // guards by DROPPING cycle members, so the visible symptom would be a
    // subtree that silently disappears from the sidebar.
    // `nested` accepts Offices, so the schema rule alone would allow it. Only
    // the descendant check keeps it off the list.
    expect(moveTargets(tree(), 'office').map((n) => n.id)).not.toContain('nested');
  });

  it('never offers the parent it is already under', () => {
    expect(moveTargets(tree(), 'room').map((n) => n.id)).not.toContain('office');
  });

  it('does not offer a parent whose schema refuses the type', () => {
    // `root` accepts Office, not Room.
    expect(moveTargets(tree(), 'room').map((n) => n.id)).not.toContain('root');
  });

  it('returns nothing for a node that is not there', () => {
    expect(moveTargets(tree(), 'ghost')).toEqual([]);
  });

  it('terminates on an already-cyclic tree', () => {
    // Stored data should never contain a cycle, but a walk that assumes so
    // turns a rendering bug into a hung tab.
    const cyclic: { a: DomainNode; b: DomainNode; } = {
      a: node('a', 'b', ['b'], ['Office'], 'Office'),
      b: node('b', 'a', ['a'], ['Office'], 'Office'),
    };

    // Removing the visited guard does not make this throw — it HANGS, and a
    // synchronous loop never yields, so vitest's own timeout cannot fire and
    // the entire suite stops instead of failing. A wall-clock assertion is
    // equally useless for the same reason: the line never runs.
    //
    // So the walk is bounded by construction as well, and THAT is what this
    // asserts: it returns, and it returns the right answer.
    const targets: DomainNode[] = moveTargets(cyclic, 'a');
    expect(targets.map((n) => n.id)).not.toContain('b');
  });
});

describe('under the default schema, where rooms may hold rooms', () => {
  it('offers another room as a destination for a room, and not a node that allows nothing', () => {
    const nodes: Record<string, DomainNode> = {
      office: node('office', null, ['a', 'b', 'leaf'], ['Room', 'Office'], 'Office'),
      a: node('a', 'office', [], ['Room']),
      b: node('b', 'office', [], ['Room']),
      leaf: node('leaf', 'office', [], []),
    };
    expect(moveTargets(nodes, 'a').map((n: DomainNode) => n.id).sort()).toEqual(['b']);
  });
});
