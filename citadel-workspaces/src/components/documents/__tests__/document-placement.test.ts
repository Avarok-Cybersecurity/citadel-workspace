/**
 * The level a new document takes is the one the live schema permits under its parent; several
 * means the person chooses, none means the entry is refused with the reason. Types here are
 * named so that no default template name ("Room") can be assumed into a pass. No mocks.
 */
import { describe, it, expect } from 'vitest';
import type { TreeSchema } from 'citadel-workspace-client-ts';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { domainNode } from '@/components/layout/sidebar/__tests__/render-hierarchy';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import { childTypesUnder, documentPlacement } from '../document-placement';

const SCHEMA: TreeSchema = {
  id: 'estate', name: 'estate', max_depth: null, entity_type_configs: [],
  rules: [{ parent_type: 'Workspace', allowed_child_types: ['City'] }, { parent_type: 'City', allowed_child_types: ['Building'] }],
};
const NODES: Record<string, DomainNode> = {
  berlin: domainNode('berlin', WORKSPACE_ROOT_ID, 'City', ['Building'], 'Berlin'),
  alex: domainNode('alex', 'berlin', 'Building', ['Floor', 'Desk'], 'Alexanderplatz 1'),
  floor3: domainNode('floor3', 'alex', 'Floor', [], 'Floor 3'),
};

describe('where a new document goes', () => {
  it('takes the one type the schema permits under a stored node', () => {
    expect(documentPlacement(childTypesUnder('berlin', NODES, SCHEMA), 'Berlin')).toEqual({ kind: 'one', type: 'Building' });
  });

  it('asks when the schema permits several', () => {
    expect(documentPlacement(childTypesUnder('alex', NODES, SCHEMA), 'Alexanderplatz 1')).toEqual({ kind: 'pick', types: ['Floor', 'Desk'] });
  });

  it('is refused, with the reason, under a node that may hold nothing', () => {
    expect(documentPlacement(childTypesUnder('floor3', NODES, SCHEMA), 'Floor 3')).toEqual({
      kind: 'blocked', reason: 'Nothing can be added inside Floor 3',
    });
  });

  it('reads the Workspace rule for an unstored workspace root, and waits for the schema', () => {
    expect(childTypesUnder(WORKSPACE_ROOT_ID, NODES, SCHEMA)).toEqual(['City']);
    expect(childTypesUnder(WORKSPACE_ROOT_ID, NODES, null)).toBeNull();
    expect(documentPlacement(null, 'Lexelnet')).toMatchObject({ kind: 'blocked' });
  });
});
