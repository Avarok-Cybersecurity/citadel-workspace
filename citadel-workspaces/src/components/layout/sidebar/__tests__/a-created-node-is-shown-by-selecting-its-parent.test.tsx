/**
 * What you just created is on screen: the sidebar selects the parent it went into.
 *
 * The expandable tree had to remember to open every node above a new one (and
 * once failed to, five levels down, reading as a write that never happened).
 * The focused tree unfolds exactly the selected node's children, so selecting
 * the parent shows the new node -- without opening the new node itself, which
 * nobody asked for.
 *
 * Mocked: `usePermission` (agent I/O) and NodeManagementModal, a protocol-backed
 * form; the stand-in reports success the way the real one does, through
 * `onCreated`, once the server has accepted the node.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UsePermissionResult } from '@/hooks/use-permission-result';
import { ESTATE, renderHierarchy, selectedInUrl } from './render-hierarchy';

vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({
    allowed: true, loading: false, reason: null, unanswered: false, answered: true, refresh: async (): Promise<void> => {},
  }) as UsePermissionResult,
}));
vi.mock('@/components/node/NodeManagementModal', () => ({
  NodeManagementModal: ({ parentId, onCreated }: { parentId?: string; onCreated?: (parentId: string) => void }): JSX.Element => (
    <button type="button" data-testid="server-accepted" onClick={() => parentId !== undefined && onCreated?.(parentId)}>create</button>
  ),
}));

describe('a node created inside a peer', () => {
  it('selects that peer, so the new node shows among its children', async () => {
    renderHierarchy(ESTATE, '/workspace?nodeId=alex');
    await userEvent.click(screen.getByTestId('tree-node-toggle-potsdamer'));
    await userEvent.click(await screen.findByTestId('add-child-row-potsdamer'));
    expect(selectedInUrl()).toBe('alex');

    await userEvent.click(await screen.findByTestId('server-accepted'));
    await waitFor(() => expect(selectedInUrl()).toBe('potsdamer'));
  });
});
