/**
 * A full node list replaces the tree; it does not merge into it.
 *
 * Measured live, switching from admin-lab (one office, "Operations") to bench (no
 * offices): bench's empty list merged into admin-lab's nodes, so the sidebar kept showing
 * "Operations" in a workspace that has none. The only request that yields `Nodes` is the
 * unfiltered ListNodes of post-auth setup, so the answer is the whole tree.
 */
import { describe, it, expect } from 'vitest';
import { nodesFromList } from '../event-setup-utils';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

const node = (id: string): DomainNode => ({ id, parent_id: 'workspace-root', name: id } as DomainNode);

describe('a loaded node list', () => {
  it('drops nodes the list no longer holds', () => {
    expect(nodesFromList([])).toEqual({});
    expect(Object.keys(nodesFromList([node('b')]))).toEqual(['b']);
  });
});
