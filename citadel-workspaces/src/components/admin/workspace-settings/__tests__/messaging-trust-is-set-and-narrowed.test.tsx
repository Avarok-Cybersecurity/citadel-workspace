/**
 * The two messaging trust settings: the workspace's (admins) and a member's own narrowing of it.
 * Both show what the server answered, and the member's picker offers only nodes the server
 * would accept. Node labels come from the live tree and the schema, never a type name.
 *
 * Doubled: the bound workspace requests (`messagingTrustApi`), the workspace server's boundary.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DomainNode, MessagingTrustPolicy, MessagingTrustSettings } from 'citadel-workspace-client-ts';
import { WorkspaceContext, type WorkspaceState } from '@/contexts/WorkspaceContext';

const h: { held: MessagingTrustSettings; setWorkspacePolicy: ReturnType<typeof vi.fn>; setMyPolicy: ReturnType<typeof vi.fn> } = vi.hoisted(() => ({
  held: { workspace: 'AllTrusted', mine: null, effective_root: 'workspace-root' },
  setWorkspacePolicy: vi.fn(),
  setMyPolicy: vi.fn(),
}));

vi.mock('@/lib/messaging-trust/messaging-trust-api', () => ({
  messagingTrustApi: {
    getSettings: async (): Promise<MessagingTrustSettings> => h.held,
    setWorkspacePolicy: async (policy: MessagingTrustPolicy): Promise<MessagingTrustSettings> => {
      h.setWorkspacePolicy(policy); h.held = { ...h.held, workspace: policy }; return h.held;
    },
    setMyPolicy: async (policy: MessagingTrustPolicy | null): Promise<MessagingTrustSettings> => {
      h.setMyPolicy(policy); h.held = { ...h.held, mine: policy }; return h.held;
    },
  },
}));

import { MessagingTrustSection } from '../MessagingTrustSection';
import { AutoConnectRow } from '@/components/settings/AutoConnectRow';

// The permission answer is the I/O boundary (GetUserPermissions through the permissions service);
// the control and everything it renders are real. `holds` is whether the reader holds the
// permission asked for, as a settled answer.
const holds: { current: boolean } = vi.hoisted((): { current: boolean } => ({ current: false }));
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): import('@/hooks/use-permission-result').UsePermissionResult => ({
    allowed: holds.current, loading: false, unanswered: false, answered: true, reason: null, refresh: async (): Promise<void> => undefined,
  }),
}));


function node(id: string, name: string, parent: string): DomainNode {
  return { id, name, parent_id: parent, entity_type: { Child: 'Office' } } as unknown as DomainNode;
}
const NODES: Record<string, DomainNode> = {
  eng: node('eng', 'Engineering', 'workspace-root'),
  backend: node('backend', 'Backend', 'eng'),
  sales: node('sales', 'Sales', 'workspace-root'),
};

/** `configures`: the reader holds EditWorkspaceConfig, which is what the server asks. */
function renderWith(ui: JSX.Element, configures: boolean): void {
  holds.current = configures;
  const state: Partial<WorkspaceState> = { workspace: { id: 'workspace-root' } as never, currentUser: {} as never, nodes: NODES };
  render(<WorkspaceContext.Provider value={{ state: state as WorkspaceState, dispatch: (): void => {} } as never}>{ui}</WorkspaceContext.Provider>);
}

const radio = (id: string): HTMLElement => screen.getByTestId(id);

beforeEach(() => {
  h.held = { workspace: 'AllTrusted', mine: null, effective_root: 'workspace-root' };
  h.setWorkspacePolicy.mockClear();
  h.setMyPolicy.mockClear();
});
afterEach(cleanup);

describe('the workspace messaging trust', () => {
  it('shows the server\'s default, Everyone, and writes Ask every time when picked', async () => {
    renderWith(<MessagingTrustSection />, true);
    await waitFor(() => expect(radio('trust-choice-workspace-AllTrusted')).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(radio('trust-choice-workspace-Strict'));
    await waitFor(() => expect(h.setWorkspacePolicy).toHaveBeenCalledWith('Strict'));
    await waitFor(() => expect(radio('trust-choice-workspace-Strict')).toHaveAttribute('aria-checked', 'true'));
  });

  it('waits for a node before it writes the node option', async () => {
    renderWith(<MessagingTrustSection />, true);
    await waitFor(() => expect(radio('trust-choice-workspace-AllTrusted')).toBeEnabled());
    fireEvent.click(radio('trust-choice-workspace-NodeLevelTrusted'));
    expect(await screen.findByTestId('trust-node-picker-workspace')).toBeInTheDocument();
    expect(h.setWorkspacePolicy).not.toHaveBeenCalled();
  });

  it('is read-only for someone who is not an admin', async () => {
    renderWith(<MessagingTrustSection />, false);
    expect(await screen.findByText('Only workspace admins can change this.')).toBeInTheDocument();
    expect(radio('trust-choice-workspace-Strict')).toBeDisabled();
  });
});

describe('a member\'s own messaging trust', () => {
  it('starts as following the workspace and can be made Ask me every time', async () => {
    renderWith(<AutoConnectRow />, false);
    await waitFor(() => expect(radio('trust-choice-mine-follow')).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(radio('trust-choice-mine-ask'));
    await waitFor(() => expect(h.setMyPolicy).toHaveBeenCalledWith('Strict'));
  });

  it('offers only nodes inside the workspace\'s scope, by path and level', async () => {
    h.held = { workspace: { NodeLevelTrusted: { node_id: 'eng' } }, mine: { NodeLevelTrusted: { node_id: 'backend' } }, effective_root: 'backend' };
    renderWith(<AutoConnectRow />, false);
    await waitFor(() => expect(radio('trust-choice-mine-node')).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByTestId('trust-node-picker-mine').textContent).toContain('Engineering › Backend · Office');
  });
});
