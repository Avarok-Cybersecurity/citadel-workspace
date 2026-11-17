/**
 * The two privacy switches that used to say "Not enforced" now each reach the
 * party that enforces them:
 *
 * - Profile Visibility is sent to the workspace server, which withholds the
 *   profile from non-contacts (kernel `profile_visibility.rs`). Its switch
 *   shows what the SERVER holds, not a local guess.
 * - Requests from strangers is decided by this client (incoming-request-policy),
 *   so it is saved locally, and published so a refused requester can be told.
 *
 * `WorkspaceService` is mocked: it is the send to the server, and what is under
 * test is which request each switch sends. The local settings module is real.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { WorkspaceContext, useWorkspace } from '@/contexts/WorkspaceContext';
import type { ProfileUpdate } from '@/lib/workspace-service/messaging-operations';

const sent: ProfileUpdate[] = [];
vi.mock('@/lib/workspace-service', () => ({
  default: { updateUserProfile: vi.fn(async (u: ProfileUpdate): Promise<void> => { sent.push(u); }) },
}));
vi.mock('@/components/passkey/SignInKeysSection', () => ({ SignInKeysSection: (): null => null }));
// Its own requests and confirmations are covered in diagnostics-privacy.test.tsx.
vi.mock('../DiagnosticsPrivacySection', () => ({ DiagnosticsPrivacySection: (): null => null }));

import { PrivacySettingsTab } from '../PrivacySettingsTab';
import { getPrivacySettings, savePrivacySettings, DEFAULT_PRIVACY_SETTINGS } from '@/lib/privacy-settings';

function WithUser({ show }: { show: boolean | undefined }): JSX.Element {
  const base: ReturnType<typeof useWorkspace>['state'] = useWorkspace().state;
  return (
    <WorkspaceContext.Provider value={{ state: { ...base, currentUser: { id: 'a', username: 'a', name: 'A', showProfileToStrangers: show } } }}>
      <PrivacySettingsTab />
    </WorkspaceContext.Provider>
  );
}

beforeEach(() => { sent.length = 0; localStorage.clear(); savePrivacySettings({ ...DEFAULT_PRIVACY_SETTINGS }); });
afterEach(() => cleanup());

describe('Profile Visibility', () => {
  it('shows the value the server holds', () => {
    render(<WithUser show={false} />);
    expect(screen.getByRole('switch', { name: 'Profile Visibility' }).getAttribute('aria-checked')).toBe('false');
  });

  it('sends the change to the server', async () => {
    render(<WithUser show={true} />);
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Profile Visibility' })); });
    expect(sent).toEqual([{ showProfileToStrangers: false }]);
  });

  it('cannot be flipped before the server has said what it holds', () => {
    render(<WithUser show={undefined} />);
    expect(screen.getByRole('switch', { name: 'Profile Visibility' })).toHaveProperty('disabled', true);
  });
});

describe('requests from people you are not connected with', () => {
  it('saves the choice where the refusal is made, and publishes it', async () => {
    render(<WithUser show={true} />);
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Requests From Strangers' })); });
    expect(getPrivacySettings().acceptRequestsFromStrangers).toBe(false);
    expect(sent).toEqual([{ acceptsRequestsFromStrangers: false }]);
  });
});

describe('Online Status', () => {
  // The server's peer list reports presence to everyone, so other members'
  // clients can only honour the choice if it is published on the record.
  it('saves the choice this client obeys, and publishes it for everyone else', async () => {
    render(<WithUser show={true} />);
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Online Status' })); });
    expect(getPrivacySettings().showOnlineStatus).toBe(false);
    expect(sent).toEqual([{ showsOnlineStatus: false }]);
  });
});

describe('what the tab claims', () => {
  it('calls nothing unenforced any more', () => {
    render(<WithUser show={true} />);
    expect(screen.queryAllByText(/Not enforced yet/)).toHaveLength(0);
  });

  it('states the screenshot limit plainly, and lets it be switched', () => {
    render(<WithUser show={true} />);
    expect(screen.getByText(/Best effort: only catches the PrintScreen key on Windows and Linux/)).toBeTruthy();
    expect(screen.getByText(/macOS and phone screenshots/)).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Screenshot Alerts' })).toHaveProperty('disabled', false);
  });
});
