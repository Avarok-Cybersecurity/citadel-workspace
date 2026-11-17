/**
 * The Privacy tab's diagnostics rows: off by default, turning off or deleting asks first and says
 * stored logs go, and the accepted terms can be read.
 *
 * Mocked: the telemetry requests (workspace I/O). The confirm dialog, switch and terms dialog are
 * production.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CurrentTerms, MyConsent } from 'citadel-workspace-client-ts';
import type { TelemetryApi } from '@/lib/telemetry/telemetry-api';
import { act } from '@testing-library/react';
import { eventEmitter } from '@/lib/event-emitter';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';

type ApiMocks<K extends keyof TelemetryApi> = { [P in K]: Mock<TelemetryApi[P]> };
const api: ApiMocks<'getMyConsent' | 'getTerms' | 'setConsent' | 'deleteMine'> = vi.hoisted(() => ({ getMyConsent: vi.fn(), getTerms: vi.fn(), setConsent: vi.fn(), deleteMine: vi.fn() }));
vi.mock('@/lib/telemetry/telemetry-api', () => ({ telemetryApi: api }));
import { DiagnosticsPrivacySection } from '../DiagnosticsPrivacySection';

const consent = (over: Partial<MyConsent> = {}): MyConsent => ({
  accepted_platform_version: 1, accepted_workspace_version: null, required_platform_version: 1, required_workspace_version: null,
  terms_current: true, telemetry_enabled: false, uploads_allowed: false, ...over,
});
const TERMS: CurrentTerms = { platform: { version: 1, text: 'platform words' }, workspace: null };

function renderSection(): void {
  const state: WorkspaceState = { workspace: { id: 'w', name: 'Acme' }, members: {}, nodes: {} } as unknown as WorkspaceState;
  render(<ConfirmDialogProvider><WorkspaceProvider state={state}><DiagnosticsPrivacySection /></WorkspaceProvider></ConfirmDialogProvider>);
}

beforeEach(() => { vi.resetAllMocks(); api.getTerms.mockResolvedValue(TERMS); });

describe('the diagnostics switch', () => {
  it('is off when the member never opted in, and names the workspace and what is sent', async () => {
    api.getMyConsent.mockResolvedValue(consent());
    renderSection();
    const sw: HTMLElement = await screen.findByRole('switch', { name: 'Share diagnostic logs' });
    await waitFor(() => expect(sw).toBeEnabled());
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Diagnostics in Acme/)).toBeTruthy();
    expect(screen.getByText(/names, files and addresses removed/)).toBeTruthy();
  });

  it('turns on without a question', async () => {
    api.getMyConsent.mockResolvedValue(consent());
    api.setConsent.mockResolvedValue(consent({ telemetry_enabled: true, uploads_allowed: true }));
    renderSection();
    const sw: HTMLElement = await screen.findByRole('switch', { name: 'Share diagnostic logs' });
    await waitFor(() => expect(sw).toBeEnabled());
    await userEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    expect(api.setConsent).toHaveBeenCalledWith(true);
  });

  it('turning off warns that stored logs are deleted, and does nothing if declined', async () => {
    api.getMyConsent.mockResolvedValue(consent({ telemetry_enabled: true, uploads_allowed: true }));
    renderSection();
    const sw: HTMLElement = await screen.findByRole('switch', { name: 'Share diagnostic logs' });
    await waitFor(() => expect(sw).toBeEnabled());
    await userEvent.click(sw);
    expect(await screen.findByText(/already stored for you in this workspace are deleted/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.setConsent).not.toHaveBeenCalled();
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('turning off, once confirmed, sends the change', async () => {
    api.getMyConsent.mockResolvedValue(consent({ telemetry_enabled: true, uploads_allowed: true }));
    api.setConsent.mockResolvedValue(consent());
    renderSection();
    const sw: HTMLElement = await screen.findByRole('switch', { name: 'Share diagnostic logs' });
    await waitFor(() => expect(sw).toBeEnabled());
    await userEvent.click(sw);
    await userEvent.click(await screen.findByRole('button', { name: 'Stop sharing' }));
    await waitFor(() => expect(api.setConsent).toHaveBeenCalledWith(false));
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
  });

  it('cannot be changed while the accepted terms are out of date', async () => {
    api.getMyConsent.mockResolvedValue(consent({ terms_current: false }));
    renderSection();
    const sw: HTMLElement = await screen.findByRole('switch', { name: 'Share diagnostic logs' });
    expect(await screen.findByText('Accept the updated terms to change this.')).toBeTruthy();
    expect(sw).toBeDisabled();
  });
});

describe('deleting stored logs', () => {
  it('asks first and deletes only when confirmed', async () => {
    api.getMyConsent.mockResolvedValue(consent());
    api.deleteMine.mockResolvedValue(3);
    renderSection();
    const del: HTMLElement = await screen.findByRole('button', { name: 'Delete' });
    await waitFor(() => expect(del).toBeEnabled());
    await userEvent.click(del);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(api.deleteMine).not.toHaveBeenCalled();
    await userEvent.click(del);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' })); // the dialog's, the row is hidden behind it
    await waitFor(() => expect(api.deleteMine).toHaveBeenCalledTimes(1));
  });
});

describe('the accepted terms', () => {
  it('shows the accepted versions and opens the terms', async () => {
    api.getMyConsent.mockResolvedValue(consent({ accepted_workspace_version: 2 }));
    renderSection();
    expect(await screen.findByTestId('accepted-terms')).toHaveTextContent(/platform terms \(version 1\) and this workspace's terms \(version 2\)/);
    await userEvent.click(await screen.findByRole('button', { name: 'Read the terms' }));
    expect(screen.getByTestId('terms-dialog')).toHaveTextContent('platform words');
  });
});

describe('a consent answer nobody on this screen asked for', () => {
  it('moves the switch to what the server says', async () => {
    api.getMyConsent.mockResolvedValue(consent());
    renderSection();
    const sw: HTMLElement = await screen.findByRole('switch', { name: 'Share diagnostic logs' });
    await waitFor(() => expect(sw).toBeEnabled());
    act(() => eventEmitter.emit('workspace:telemetry', { answer: { Consent: consent({ telemetry_enabled: true }) } }));
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('leaves the switch alone when the answer is of another kind', async () => {
    api.getMyConsent.mockResolvedValue(consent());
    renderSection();
    const sw: HTMLElement = await screen.findByRole('switch', { name: 'Share diagnostic logs' });
    await waitFor(() => expect(sw).toBeEnabled());
    act(() => eventEmitter.emit('workspace:telemetry', { answer: { Deleted: { segments: 3 } } }));
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });
});
