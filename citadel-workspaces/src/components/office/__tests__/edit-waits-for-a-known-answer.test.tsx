/**
 * Edit on an office page is offered on a known yes, and says why otherwise.
 *
 * A member whose Settings -> Permissions read "Edit Content: Denied" still got
 * an enabled Edit after a reload -- the gate treated "no answer stored yet" as
 * yes -- and on a page with no node behind it, Save answered "This page is
 * still loading" forever.
 *
 * Mocked: `usePermission`, which fetches from the workspace server. The states
 * it can report are the input under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import type { UsePermissionResult } from '@/hooks/use-permission-result';

const h: { result: Omit<UsePermissionResult, 'refresh'> } = vi.hoisted(() => ({
  result: { allowed: false, loading: false, unanswered: false, answered: false, reason: null } as Omit<UsePermissionResult, 'refresh'>,
}));
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({ ...h.result, refresh: async (): Promise<void> => {} }),
}));

import { BaseOffice } from '../BaseOffice';

const NODE: string = 'office-1';

function renderOffice(nodeId: string | undefined, nodesLoading: boolean = false): void {
  const state: WorkspaceState = {
    members: {},
    nodes: { [NODE]: { id: NODE, name: 'Engineering', mdx_content: '# Hi' } },
    loading: { workspace: false, members: false, nodes: nodesLoading },
    messages: { byPeer: {} },
    typing: { peerIds: [], lastUpdated: 0 },
  } as unknown as WorkspaceState;
  render(
    <MemoryRouter><ConfirmDialogProvider><WorkspaceProvider state={state}>
      <BaseOffice title="Engineering" getInitialContent={(): string => '# Hi'} nodeId={nodeId} />
    </WorkspaceProvider></ConfirmDialogProvider></MemoryRouter>,
  );
}

const editButton = (): HTMLElement => screen.getByTestId('office-edit-content');

beforeEach(() => {
  h.result = { allowed: false, loading: false, unanswered: false, answered: false, reason: null };
});

describe('the office Edit button', () => {
  it('is not offered before the permission has been answered', () => {
    renderOffice(NODE);
    expect(editButton()).toBeDisabled();
    expect(editButton()).toHaveAttribute('title', 'Checking your permissions…');
  });

  it('is not offered on a known no, and gives the reason', () => {
    h.result = { ...h.result, answered: true, reason: 'Your role (Member) does not include Edit Content' };
    renderOffice(NODE);
    expect(editButton()).toBeDisabled();
    expect(editButton()).toHaveAttribute('title', 'Your role (Member) does not include Edit Content');
  });

  it('is offered on a known yes', () => {
    h.result = { ...h.result, allowed: true, answered: true };
    renderOffice(NODE);
    expect(editButton()).toBeEnabled();
  });

  it('on a page with no node, says there is nothing to save to rather than "still loading"', () => {
    h.result = { ...h.result, allowed: true, answered: true };
    renderOffice(undefined);
    expect(editButton()).toBeDisabled();
    expect(editButton().getAttribute('title')).toMatch(/nothing to save to/);
  });
});
