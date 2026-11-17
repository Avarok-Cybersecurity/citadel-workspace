/**
 * An owner renames the workspace from Workspace settings, and the dialog tells the truth about
 * whether it saved.
 *
 * Spied: WorkspaceService.updateWorkspaceProfile, the server round-trip (the kernel side is
 * covered by an_owner_edits_the_workspace_profile.rs). The dialog, its form rules and the
 * workspace context are production code.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';
import WorkspaceService from '@/lib/workspace-service';
import { WorkspaceSettingsDialog } from '../WorkspaceSettingsDialog';

// Permission-gated and covered in telemetry/__tests__; it needs a PermissionsProvider this test has no use for.
vi.mock('../telemetry/TelemetrySection', () => ({ TelemetrySection: (): null => null }));
// Its own suite covers it (messaging-trust-is-set-and-narrowed); here it would ask a server.
vi.mock('../MessagingTrustSection', () => ({ MessagingTrustSection: (): null => null }));
// Its own suite covers it (an-admin-can-require-a-human-check); it is permission-gated like the telemetry section.
vi.mock('../TurnstileAdmissionSwitch', () => ({ TurnstileAdmissionSwitch: (): null => null }));
vi.mock('@/components/settings/WorkspaceAppearanceSection', () => ({
  // Its own suite covers it; here it would need the theme and permission providers too.
  WorkspaceAppearanceSection: (): JSX.Element => <div data-testid="appearance-section" />,
}));

type ContextValue = React.ContextType<typeof WorkspaceContext>;

function renderDialog(onOpenChange: (open: boolean) => void): void {
  const value: ContextValue = {
    state: { workspace: { id: 'workspace-root', name: 'Avarok', description: 'We build things', metadata: undefined } },
  } as unknown as ContextValue;
  render(
    <WorkspaceContext.Provider value={value}>
      <WorkspaceSettingsDialog open onOpenChange={onOpenChange} />
    </WorkspaceContext.Provider>,
  );
}

afterEach(() => { vi.restoreAllMocks(); });

describe('workspace settings', () => {
  it('opens on the stored values with nothing to save', () => {
    renderDialog(vi.fn());
    expect((screen.getByTestId('workspace-settings-name') as HTMLInputElement).value).toBe('Avarok');
    expect((screen.getByTestId('workspace-settings-description') as HTMLTextAreaElement).value).toBe('We build things');
    expect((screen.getByTestId('workspace-settings-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends only the new name, and closes once the server accepts it', async () => {
    const save = vi.spyOn(WorkspaceService, 'updateWorkspaceProfile').mockResolvedValue(undefined);
    const onOpenChange: ReturnType<typeof vi.fn> = vi.fn();
    renderDialog(onOpenChange);
    fireEvent.change(screen.getByTestId('workspace-settings-name'), { target: { value: 'Avarok Labs' } });
    fireEvent.click(screen.getByTestId('workspace-settings-save'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(save).toHaveBeenCalledWith('workspace-root', { name: 'Avarok Labs' });
  });

  it("stays open and shows the server's reason when the save is refused", async () => {
    vi.spyOn(WorkspaceService, 'updateWorkspaceProfile').mockRejectedValue(new Error('Permission denied: UpdateWorkspace required'));
    const onOpenChange: ReturnType<typeof vi.fn> = vi.fn();
    renderDialog(onOpenChange);
    fireEvent.change(screen.getByTestId('workspace-settings-name'), { target: { value: 'Avarok Labs' } });
    fireEvent.click(screen.getByTestId('workspace-settings-save'));
    expect((await screen.findByRole('alert')).textContent).toContain('Permission denied');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
