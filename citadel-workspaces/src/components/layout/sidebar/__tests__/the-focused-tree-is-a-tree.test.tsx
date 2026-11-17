/**
 * The focused sidebar is a tree to assistive tech and to the keyboard, and it
 * shows the selection's path, peers and children -- driven through the real
 * HierarchySidebar and the router, as the app drives it.
 *
 * Mocked: `usePermission` (agent I/O), answered "allowed" like the other
 * sidebar specs. Everything that decides what is on screen is production.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTreeSchema } from '@/lib/entity-type-registry';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import type { UsePermissionResult } from '@/hooks/use-permission-result';
import type { DomainNode, TreeSchema } from '../tree-node-types';
import { ESTATE, domainNode, renderHierarchy, selectedInUrl } from './render-hierarchy';

vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({
    allowed: true, loading: false, reason: null, unanswered: false, answered: true, refresh: async (): Promise<void> => {},
  }) as UsePermissionResult,
}));

const config = (type: string, label: string, plural: string): TreeSchema['entity_type_configs'][number] => ({
  type_name: type, icon: 'folder', label, plural_label: plural, name_placeholder: '', description_placeholder: '',
});

beforeAll(() => {
  // Renamed levels: an admin called Buildings "Sites". Nothing may say "Building".
  setTreeSchema({ entity_type_configs: [config('City', 'City', 'Cities'), config('Building', 'Site', 'Sites'), config('Floor', 'Floor', 'Floors')] } as unknown as TreeSchema);
});

const row = (id: string): HTMLElement => screen.getByTestId(`tree-node-${id}`);

describe('the focused tree', () => {
  it('lands on the workspace: one promoted row, its top level beneath it', () => {
    renderHierarchy(ESTATE);
    const tree: HTMLElement = screen.getByRole('tree', { name: 'Workspace hierarchy' });
    const root: HTMLElement = within(tree).getByTestId(`tree-node-${WORKSPACE_ROOT_ID}`);
    expect(root).toHaveAttribute('aria-level', '1');
    expect(root).toHaveAttribute('aria-selected', 'true');
    expect(root).toHaveAttribute('aria-expanded', 'true');
    expect(root).toHaveTextContent('Lexelnet');
    expect(row('berlin')).toHaveAttribute('aria-level', '2');
    expect(row('munich')).toHaveAttribute('aria-selected', 'false');
    // Nothing deeper is mounted until something deeper is selected.
    expect(screen.queryByTestId('tree-node-alex')).toBeNull();
    expect(screen.queryByTestId('tree-ancestor-stack')).toBeNull();
  });

  it('descends: the old selection joins the stack, its peers are listed, its children unfold', async () => {
    renderHierarchy(ESTATE);
    await userEvent.click(row('berlin'));
    await waitFor(() => expect(selectedInUrl()).toBe('berlin'));
    await userEvent.click(await screen.findByTestId('tree-node-alex'));
    await waitFor(() => expect(selectedInUrl()).toBe('alex'));

    const stack: HTMLElement = screen.getByTestId('tree-ancestor-stack');
    expect(within(stack).getByTestId(`tree-node-${WORKSPACE_ROOT_ID}`)).toHaveAttribute('aria-level', '1');
    expect(within(stack).getByTestId('tree-node-berlin')).toHaveAttribute('aria-level', '2');
    // The parent says what it holds, in the schema's renamed words.
    expect(within(stack).getByTestId('tree-node-berlin')).toHaveTextContent('2 sites');
    expect(row('alex')).toHaveAttribute('aria-level', '3');
    expect(row('alex')).toHaveAttribute('aria-selected', 'true');
    expect(row('potsdamer')).toHaveAttribute('aria-expanded', 'false');
    expect(row('floor3')).toHaveAttribute('aria-level', '4');
    expect(screen.queryByTestId('tree-node-pfloor1')).toBeNull();
    expect(screen.queryByText(/Building/)).toBeNull();
  });

  it('climbs when an ancestor is pressed', async () => {
    renderHierarchy(ESTATE, '/workspace?nodeId=floor3');
    await userEvent.click(within(screen.getByTestId('tree-ancestor-stack')).getByTestId('tree-node-berlin'));
    await waitFor(() => expect(selectedInUrl()).toBe('berlin'));
    await waitFor(() => expect(screen.queryByTestId('tree-node-floor3')).toBeNull());
  });

  it('peeks into a peer without leaving the selection, from a real button on the row', async () => {
    renderHierarchy(ESTATE, '/workspace?nodeId=alex');
    const peek: HTMLElement = screen.getByTestId('tree-node-toggle-potsdamer');
    const menu: HTMLElement = screen.getByTestId('tree-node-menu-potsdamer');
    expect(peek.tagName).toBe('BUTTON');
    // The row is the treeitem and may hold controls; what must never happen is a button inside a button.
    expect(row('potsdamer')).toHaveAttribute('role', 'treeitem');
    expect(row('potsdamer').tagName).not.toBe('BUTTON');
    for (const control of [peek, menu]) expect(control.parentElement?.closest('button')).toBeNull();
    expect(peek).toHaveAccessibleName('Expand Potsdamer Platz');

    await userEvent.click(peek);
    expect(await screen.findByTestId('tree-node-pfloor1')).toBeInTheDocument();
    expect(peek).toHaveAttribute('aria-expanded', 'true');
    expect(row('potsdamer')).toHaveAttribute('aria-expanded', 'true');
    // The peek's click is its own: the row under it was not selected.
    expect(selectedInUrl()).toBe('alex');
  });

  it('lets a ⋯ menu item act without also selecting the row it sits on', async () => {
    renderHierarchy(ESTATE, '/workspace?nodeId=alex');
    await userEvent.click(screen.getByTestId('tree-node-menu-potsdamer'));
    // The menu renders in a portal, and React bubbles its clicks through the row.
    await userEvent.click(await screen.findByTestId('move-node-potsdamer'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(selectedInUrl()).toBe('alex');
  });

  it('offers Add with the schema\'s label, and no Add where nothing may be added', async () => {
    renderHierarchy(ESTATE, '/workspace?nodeId=berlin');
    expect(screen.getByTestId('add-child-row-berlin')).toHaveTextContent('Add Site');
    expect(screen.getByTestId('add-node-button')).toHaveAccessibleName('Add Site to Berlin');

    await userEvent.click(row('alex'));
    await userEvent.click(await screen.findByTestId('tree-node-floor3'));
    await waitFor(() => expect(selectedInUrl()).toBe('floor3'));
    expect(screen.queryByTestId('add-child-row-floor3')).toBeNull();
    expect(screen.getByTestId('add-node-button')).toBeDisabled();
  });

  it('collapses a deep stack to seven rows, and opens it on demand', async () => {
    const deep: DomainNode[] = [domainNode('l1', WORKSPACE_ROOT_ID, 'Floor', ['Floor'], 'L1'), domainNode('top2', WORKSPACE_ROOT_ID, 'Floor')];
    for (let i: number = 2; i <= 11; i += 1) deep.push(domainNode(`l${i}`, `l${i - 1}`, 'Floor', ['Floor'], `L${i}`));
    renderHierarchy(deep, '/workspace?nodeId=l11');
    const stack: HTMLElement = screen.getByTestId('tree-ancestor-stack');
    expect(within(stack).getAllByRole('treeitem')).toHaveLength(7);
    const more: HTMLElement = within(stack).getByTestId('tree-more-ancestors');
    expect(more).toHaveTextContent('5 more');
    await userEvent.click(more);
    await waitFor(() => expect(within(stack).getAllByRole('treeitem')).toHaveLength(11));
  });
});

describe('the focused tree\'s keyboard', () => {
  it('moves with ↑/↓, peeks with →, enters with → again, and climbs with ←', async () => {
    renderHierarchy(ESTATE, '/workspace?nodeId=alex');
    row('alex').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(row('floor3'));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByTestId('add-child-row-alex'));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(row('potsdamer'));
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(row('floor3'));

    row('potsdamer').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByTestId('tree-node-pfloor1')).toBeInTheDocument();
    expect(selectedInUrl()).toBe('alex');
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(row('pfloor1'));

    row('alex').focus();
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(selectedInUrl()).toBe('berlin'));
    // The row acted on is focused again after the re-render, not dropped to <body>.
    await waitFor(() => expect(document.activeElement).toBe(row('berlin')));
  });

  it('selects with Enter, and keeps the focus on what was selected', async () => {
    renderHierarchy(ESTATE, '/workspace?nodeId=berlin');
    row('alex').focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(selectedInUrl()).toBe('alex'));
    await waitFor(() => expect(document.activeElement).toBe(row('alex')));
  });
});
