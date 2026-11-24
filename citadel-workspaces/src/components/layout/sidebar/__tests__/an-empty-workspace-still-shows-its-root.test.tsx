/**
 * A new workspace with no spaces still shows its own row.
 *
 * Measured live: the hierarchy of a freshly made workspace was a sentence and
 * nothing else. `workspaceRoot` found no root in an empty node list, and the
 * section replaced the whole tree with its empty text -- so the workspace could
 * not be selected, and its Add row and ⋯ menu were never drawn.
 *
 * Driven through the real HierarchySidebar with the live schema in state.
 * Mocked: `usePermission` (agent I/O), so a case can be a reader who may add or
 * one who may not; everything that decides what is drawn is production.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { setTreeSchema } from '@/lib/entity-type-registry';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import type { UsePermissionResult } from '@/hooks/use-permission-result';
import type { TreeSchema } from '../tree-node-types';
import { emptyWorkspaceRoot } from '../tree-node-utils';
import { renderHierarchy } from './render-hierarchy';

const permission: { allowed: boolean } = { allowed: true };
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({
    allowed: permission.allowed, loading: false, reason: permission.allowed ? null : 'You may not reorganise the workspace',
    unanswered: false, answered: true, refresh: async (): Promise<void> => {},
  }) as UsePermissionResult,
}));

beforeAll(() => {
  // render-hierarchy's schema puts "City" under the workspace; an admin renamed it "Region".
  setTreeSchema({ entity_type_configs: [{ type_name: 'City', icon: 'folder', label: 'Region', plural_label: 'Regions', name_placeholder: '', description_placeholder: '' }] } as unknown as TreeSchema);
});
beforeEach(() => { permission.allowed = true; });

const rootRow = (): HTMLElement => within(screen.getByRole('tree', { name: 'Workspace hierarchy' })).getByTestId(`tree-node-${WORKSPACE_ROOT_ID}`);

describe('an empty workspace', () => {
  it('draws its root, named after the workspace and selected', () => {
    renderHierarchy([]);
    expect(rootRow()).toHaveTextContent('Lexelnet');
    expect(rootRow()).toHaveAttribute('aria-selected', 'true');
    expect(rootRow()).toHaveAttribute('aria-level', '1');
  });

  it('offers the schema\'s top-level type, by its live name, to someone who may add', () => {
    renderHierarchy([]);
    expect(screen.getByTestId(`add-child-row-${WORKSPACE_ROOT_ID}`)).toHaveTextContent('Add Region');
    expect(screen.getByTestId('add-node-button')).toHaveAccessibleName(/Add Region to Lexelnet/);
    expect(screen.getByTestId('tree-empty')).toHaveTextContent(/Click the \+ button/);
  });

  it('still draws the root for someone who may not add, without the Add row', () => {
    permission.allowed = false;
    renderHierarchy([]);
    expect(rootRow()).toHaveTextContent('Lexelnet');
    expect(screen.queryByTestId(`add-child-row-${WORKSPACE_ROOT_ID}`)).toBeNull();
    expect(screen.getByTestId('tree-empty')).toHaveTextContent(/administrator/i);
  });
});

describe('emptyWorkspaceRoot', () => {
  it('is the workspace, holding nothing yet, allowing the given top-level types once each', () => {
    const root: ReturnType<typeof emptyWorkspaceRoot> = emptyWorkspaceRoot('Lexelnet', ['City', 'City', 'Annex']);
    expect(root.id).toBe(WORKSPACE_ROOT_ID);
    expect(root.name).toBe('Lexelnet');
    expect(root.children).toEqual([]);
    expect(root.allowed_child_types).toEqual(['City', 'Annex']);
  });
});
