/**
 * The workspace setting "Require a human check (Cloudflare Turnstile) to sign
 * in": off by default, admin-only, and turning it ON asks first because older
 * apps cannot pass it. What it shows is what the server answered.
 *
 * Doubled: the two kernel requests under the port (GetSignInSettings and
 * UpdateSignInSettings), at `admissionSettingOver`; the port itself and its
 * reading of the server's answers are the production ones.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SignInSettings } from 'citadel-workspace-client-ts';
import { WorkspaceContext, type WorkspaceState } from '@/contexts/WorkspaceContext';
import { ADMISSION_COPY } from '@/lib/admission/copy';
import { admissionSettingOver, NO_SUCH_SETTING, type AdmissionSettingPort } from '@/lib/admission/workspace-setting';
import { TurnstileAdmissionSwitch } from '../TurnstileAdmissionSwitch';

// The permission answer is the I/O boundary (GetUserPermissions through the permissions service);
// the control and everything it renders are real. `holds` is whether the reader holds the
// permission asked for, as a settled answer.
const holds: { current: boolean } = vi.hoisted((): { current: boolean } => ({ current: false }));
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): import('@/hooks/use-permission-result').UsePermissionResult => ({
    allowed: holds.current, loading: false, unanswered: false, answered: true, reason: null, refresh: async (): Promise<void> => undefined,
  }),
}));

type Update = (settings: SignInSettings) => Promise<SignInSettings>;

/** `configures`: the reader holds EditWorkspaceConfig, which is what the server asks. */
function renderSwitch(configures: boolean, port: AdmissionSettingPort, workspace: Record<string, unknown> = { id: 'ws-1', name: 'Bench' }): void {
  holds.current = configures;
  const state: Partial<WorkspaceState> = { workspace: workspace as never, currentUser: {} as never };
  render(
    <WorkspaceContext.Provider value={{ state: state as WorkspaceState, dispatch: (): void => {} } as never}>
      <TurnstileAdmissionSwitch port={port} />
    </WorkspaceContext.Provider>,
  );
}

/** A server holding `stored`; `refuse` makes its update answer Error with that text. */
function server(stored: boolean, refuse: string | null = null): { port: AdmissionSettingPort; update: ReturnType<typeof vi.fn<Update>> } {
  let held: boolean = stored;
  const update = vi.fn<Update>(async (settings: SignInSettings): Promise<SignInSettings> => {
    if (refuse !== null) throw new Error(refuse);
    held = settings.require_turnstile_sign_in;
    return { require_turnstile_sign_in: held };
  });
  const port: AdmissionSettingPort = admissionSettingOver({
    getSignInSettings: async (): Promise<SignInSettings> => ({ require_turnstile_sign_in: held }),
    updateSignInSettings: update,
  });
  return { port, update };
}
const failing = (message: string): AdmissionSettingPort => admissionSettingOver({
  getSignInSettings: async (): Promise<SignInSettings> => { throw new Error(message); },
  updateSignInSettings: async (): Promise<SignInSettings> => { throw new Error(message); },
});
const on = (required: boolean): SignInSettings => ({ require_turnstile_sign_in: required });
const toggle = (): HTMLElement => screen.getByTestId('turnstile-admission-toggle');

describe('the human-check setting', () => {
  it('is off by default, with its label and explanation, once the server has said so', async () => {
    renderSwitch(true, server(false).port);
    expect(screen.getByLabelText(ADMISSION_COPY.settingLabel)).toBe(toggle());
    expect(toggle()).toBeDisabled();
    await waitFor(() => expect(toggle()).toBeEnabled());
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(ADMISSION_COPY.settingHint)).toBeInTheDocument();
  });

  it('shows on when the server holds it on', async () => {
    renderSwitch(true, server(true).port);
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'));
  });

  it('asks before turning it on, and writes only once confirmed', async () => {
    const { port, update } = server(false);
    renderSwitch(true, port);
    await waitFor(() => expect(toggle()).toBeEnabled());
    fireEvent.click(toggle());
    expect(await screen.findByText(ADMISSION_COPY.confirmBody)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('turnstile-admission-confirm'));
    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith(on(true)));
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'));
  });

  it('Cancel leaves it off', async () => {
    const { port, update } = server(false);
    renderSwitch(true, port);
    await waitFor(() => expect(toggle()).toBeEnabled());
    fireEvent.click(toggle());
    fireEvent.click(await screen.findByTestId('turnstile-admission-cancel'));
    expect(update).not.toHaveBeenCalled();
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
  });

  it('turns off without asking', async () => {
    const { port, update } = server(true);
    renderSwitch(true, port);
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(toggle());
    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith(on(false)));
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'false'));
  });

  it('a refused change shows the server\'s reason and leaves the switch as the server holds it', async () => {
    const { port } = server(false, 'Permission denied: only an admin can change how people sign in to this workspace');
    renderSwitch(true, port);
    await waitFor(() => expect(toggle()).toBeEnabled());
    fireEvent.click(toggle());
    fireEvent.click(await screen.findByTestId('turnstile-admission-confirm'));
    expect(await screen.findByRole('alert')).toHaveTextContent('only an admin');
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
  });

  it('shows what the server answered a change with, not what was asked', async () => {
    const keepsOff: AdmissionSettingPort = admissionSettingOver({
      getSignInSettings: async (): Promise<SignInSettings> => on(false),
      updateSignInSettings: async (): Promise<SignInSettings> => on(false),
    });
    renderSwitch(true, keepsOff);
    await waitFor(() => expect(toggle()).toBeEnabled());
    fireEvent.click(toggle());
    fireEvent.click(await screen.findByTestId('turnstile-admission-confirm'));
    await waitFor(() => expect(toggle()).toBeEnabled());
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
  });

  it('is disabled, with the reason, for a member who is not an admin', async () => {
    renderSwitch(false, server(false).port);
    expect(toggle()).toBeDisabled();
    expect(screen.getByTestId('turnstile-admission-reason')).toHaveTextContent(ADMISSION_COPY.adminsOnly);
  });

  it('is disabled, with the reason, on a server that has no such setting, or predates it', async () => {
    for (const message of [NO_SUCH_SETTING, 'Failed to deserialize command: unknown variant `GetSignInSettings`, expected one of ...']) {
      renderSwitch(true, failing(message));
      expect(await screen.findByTestId('turnstile-admission-reason')).toHaveTextContent(ADMISSION_COPY.serverUnsupported);
      expect(toggle()).toBeDisabled();
      document.body.innerHTML = '';
    }
  });

  it('any other failure to read is shown, never taken for "off"', async () => {
    renderSwitch(true, failing('the sign-in settings are unavailable: the host is down'));
    expect(await screen.findByRole('alert')).toHaveTextContent('the host is down');
    expect(toggle()).toBeDisabled();
  });
});
