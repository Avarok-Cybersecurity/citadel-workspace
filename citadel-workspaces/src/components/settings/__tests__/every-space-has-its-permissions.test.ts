/**
 * Settings → Permissions lists every space the sidebar shows.
 *
 * Found live (2026-09-29): with one office and no rooms, the tab said "No nodes
 * in this workspace" beside a sidebar showing that office. It listed only nodes
 * that HAD children, then leaves under them; a top-level office's parent is the
 * workspace, not a node, so an office without rooms was neither.
 */
import { describe, it, expect } from 'vitest';
import { permissionSections, type PermissionSection } from '../permission-sections';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

function node(id: string, name: string, parent: string | null): DomainNode {
  return {
    id, parent_id: parent, entity_type: parent === null ? 'Workspace' : { Child: 'Office' }, depth: parent === null ? 0 : 1,
    name, description: '', owner_id: 'someone', members: [], children: [], mdx_content: '', mdx_content_hash: null,
    rules: null, chat_enabled: false, chat_channel_id: null, default_permissions: {} as DomainNode['default_permissions'],
    metadata: [], allowed_child_types: null, is_default: false, created_at: 0n, updated_at: 0n,
  };
}

const ids = (sections: PermissionSection[]): Array<[string, string[]]> =>
  sections.map((s: PermissionSection): [string, string[]] => [s.id, s.children.map((c) => c.id)]);

describe('permissionSections', () => {
  it('lists an office with no rooms (the live case)', () => {
    expect(ids(permissionSections([node('office', 'Two-Mac office', WORKSPACE_ROOT_ID)]))).toEqual([['office', []]]);
  });

  it('lists several top-level offices, each with its rooms', () => {
    const nodes: DomainNode[] = [
      node('ops', 'Operations', WORKSPACE_ROOT_ID), node('eng', 'Engineering', WORKSPACE_ROOT_ID),
      node('standup', 'Standup', 'eng'),
    ];
    expect(ids(permissionSections(nodes))).toEqual([['eng', ['standup']], ['ops', []]]);
  });

  it('keeps a room nested in a room, under its top-level space', () => {
    const nodes: DomainNode[] = [
      node('eng', 'Engineering', WORKSPACE_ROOT_ID), node('team', 'Team', 'eng'), node('pair', 'Pairing', 'team'),
    ];
    expect(ids(permissionSections(nodes))).toEqual([['eng', ['team', 'pair']]]);
  });

  it('does not list the workspace root node as a space when the server includes it', () => {
    const nodes: DomainNode[] = [node(WORKSPACE_ROOT_ID, 'mac2', null), node('office', 'Office', WORKSPACE_ROOT_ID)];
    expect(ids(permissionSections(nodes))).toEqual([['office', []]]);
  });

  it('is empty only when there are no spaces', () => {
    expect(permissionSections([])).toEqual([]);
  });
});
