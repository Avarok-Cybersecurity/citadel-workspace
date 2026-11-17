/**
 * "Workspace settings" is in ADMIN SETTINGS for whoever holds UpdateWorkspace, and opens the
 * settings dialog.
 *
 * Live (owner, 2026-09-27): nothing opened settings for the workspace itself. The item is gated on
 * the permission the server checks for UpdateWorkspaceProfile, so it is not offered to an admin
 * the server would refuse.
 *
 * Stubbed: usePermission, the permission fetch (server I/O); the gate reads its answer through
 * the production `permits`. The section, dialog and contexts are production code.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';
import { SidebarProvider } from '@/components/ui/sidebar';

const answer: { allowed: boolean } = { allowed: true };
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): { allowed: boolean; loading: boolean; unanswered: boolean; answered: boolean } => ({
    allowed: answer.allowed, loading: false, unanswered: false, answered: true,
  }),
}));
vi.mock('@/components/settings/WorkspaceAppearanceSection', () => ({
  // Its own suite covers it; here it would need the theme provider too.
  WorkspaceAppearanceSection: (): JSX.Element => <div />,
}));
vi.mock('@/components/admin/workspace-settings/MessagingTrustSection', () => ({
  // Its own suite covers it (messaging-trust-is-set-and-narrowed); here it would ask a server.
  MessagingTrustSection: (): JSX.Element => <div />,
}));

const { AdminSettingsSection } = await import('../AdminSettingsSection');

type ContextValue = React.ContextType<typeof WorkspaceContext>;

function renderAsOwner(): void {
  const value: ContextValue = {
    state: {
      workspace: { id: 'workspace-root', name: 'Avarok', description: '' },
      currentUser: { id: 'pia', username: 'pia', name: 'Pia', role: 'Owner' },
    },
  } as unknown as ContextValue;
  render(
    <WorkspaceContext.Provider value={value}>
      <SidebarProvider><AdminSettingsSection /></SidebarProvider>
    </WorkspaceContext.Provider>,
  );
}

describe('Workspace settings in ADMIN SETTINGS', () => {
  it('is offered to someone who may update the workspace, and opens the dialog', () => {
    answer.allowed = true;
    renderAsOwner();
    fireEvent.click(screen.getByTestId('open-workspace-settings'));
    expect(screen.getByTestId('workspace-settings-dialog')).toBeTruthy();
  });

  it('is not offered to someone the server would refuse', () => {
    answer.allowed = false;
    renderAsOwner();
    expect(screen.queryByTestId('open-workspace-settings')).toBeNull();
  });
});
