/**
 * A member who has not accepted the CURRENT terms is stopped by a prompt until they do; one who
 * has is never shown it. Mocked: the telemetry requests (workspace I/O). The context, the gate
 * and the dialog are production.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { CurrentTerms, MyConsent } from 'citadel-workspace-client-ts';
import type { TelemetryApi } from '@/lib/telemetry/telemetry-api';
import { MemoryRouter } from 'react-router-dom';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { eventEmitter } from '@/lib/event-emitter';

type ApiMocks<K extends keyof TelemetryApi> = { [P in K]: Mock<TelemetryApi[P]> };
const api: ApiMocks<'getMyConsent' | 'getTerms' | 'acceptTerms'> = vi.hoisted(() => ({ getMyConsent: vi.fn(), getTerms: vi.fn(), acceptTerms: vi.fn() }));
vi.mock('@/lib/telemetry/telemetry-api', () => ({ telemetryApi: api }));
// The session store, the WASM client and the tab's stored selection are the sign-out's I/O.
const session: Record<'disconnect' | 'removeSession' | 'stop' | 'clearSelectedUser', Mock> = vi.hoisted(() => ({
  disconnect: vi.fn(), removeSession: vi.fn(), stop: vi.fn(), clearSelectedUser: vi.fn(),
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getTabSelectedSession: async (): Promise<{ cid: bigint; username: string; serverAddress: string }> => ({ cid: 9n, username: 'u', serverAddress: 'srv' }),
    disconnect: session.disconnect, removeSession: session.removeSession,
  },
}));
vi.mock('@/lib/tab-context', () => ({ getSelectedUser: async (): Promise<{ selectedCid: bigint }> => ({ selectedCid: 9n }), clearSelectedUser: session.clearSelectedUser }));
// jsdom has no IndexedDB: the sign-out's check for edits held on the device reads the stand-in (none held).
const deviceStore: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
vi.mock('@/lib/storage-utils', async () => (await import('@/lib/cdoc/collab/__tests__/doubles/memory-storage')).memoryStorageUtils(deviceStore));
vi.mock('@/lib/wasm-connection-manager', () => ({ wasmConnectionManager: { stop: session.stop } }));
import { TermsGate } from '../TermsGate';
import { trackSignupConsent } from '@/lib/telemetry/signup-consent-pending';

const consent = (current: boolean): MyConsent => ({
  accepted_platform_version: current ? 2 : 1, accepted_workspace_version: null, required_platform_version: 2,
  required_workspace_version: null, terms_current: current, telemetry_enabled: false, uploads_allowed: false,
});
const TERMS: CurrentTerms = { platform: { version: 2, text: 'new platform text' }, workspace: { version: 4, text: 'our house rules' } };
const STATE: WorkspaceState = { workspace: { id: 'w', name: 'W' }, currentUser: { id: 'u', username: 'u', name: 'U' }, members: {}, nodes: {} } as unknown as WorkspaceState;

function renderGate(state: WorkspaceState = STATE): void {
  render(
    <MemoryRouter><ConfirmDialogProvider><WorkspaceProvider state={state}><TermsGate /></WorkspaceProvider></ConfirmDialogProvider></MemoryRouter>,
  );
}

beforeEach(() => { vi.resetAllMocks(); trackSignupConsent(Promise.resolve()); api.getTerms.mockResolvedValue(TERMS); });

describe('the terms prompt', () => {
  it('blocks a member whose accepted terms are out of date, showing both documents', async () => {
    api.getMyConsent.mockResolvedValue(consent(false));
    renderGate();
    const gate: HTMLElement = await screen.findByTestId('terms-gate');
    expect(gate).toHaveTextContent('new platform text');
    expect(gate).toHaveTextContent('our house rules');
  });

  it('is never shown to a member who is current', async () => {
    api.getMyConsent.mockResolvedValue(consent(true));
    renderGate();
    await waitFor(() => expect(api.getMyConsent).toHaveBeenCalled());
    expect(screen.queryByTestId('terms-gate')).toBeNull();
    expect(api.getTerms).not.toHaveBeenCalled();
  });

  it('does not ask before there is a signed-in member in a loaded workspace', () => {
    renderGate({ ...STATE, currentUser: undefined } as WorkspaceState);
    expect(api.getMyConsent).not.toHaveBeenCalled();
  });

  it('waits for the sign-up acceptance still being written', async () => {
    let finish: () => void = () => undefined;
    trackSignupConsent(new Promise<void>((resolve) => { finish = resolve; }));
    api.getMyConsent.mockResolvedValue(consent(true));
    renderGate();
    await Promise.resolve();
    expect(api.getMyConsent).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(api.getMyConsent).toHaveBeenCalled());
  });

  it('accepts the versions it showed and then goes away', async () => {
    api.getMyConsent.mockResolvedValue(consent(false));
    api.acceptTerms.mockResolvedValue(consent(true));
    renderGate();
    fireEvent.click(await screen.findByTestId('terms-gate-accept'));
    await waitFor(() => expect(screen.queryByTestId('terms-gate')).toBeNull());
    expect(api.acceptTerms).toHaveBeenCalledWith(2, 4);
  });

  it('stays, with the reason, when the server refuses', async () => {
    api.getMyConsent.mockResolvedValue(consent(false));
    api.acceptTerms.mockRejectedValue(new Error('Terms version is not current'));
    renderGate();
    fireEvent.click(await screen.findByTestId('terms-gate-accept'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Terms version is not current');
    expect(screen.getByTestId('terms-gate')).toBeInTheDocument();
  });

  it('can be left by signing out, which disconnects the session instead of accepting', async () => {
    api.getMyConsent.mockResolvedValue(consent(false));
    session.disconnect.mockResolvedValue(undefined);
    session.removeSession.mockResolvedValue(undefined);
    session.clearSelectedUser.mockResolvedValue(undefined);
    renderGate();
    fireEvent.click(await screen.findByTestId('terms-gate-signout'));
    await waitFor(() => expect(session.disconnect).toHaveBeenCalledWith({ cid: 9n, username: 'u', serverAddress: 'srv' }));
    expect(api.acceptTerms).not.toHaveBeenCalled();
  });

  it('follows the server when it volunteers a consent answer', async () => {
    api.getMyConsent.mockResolvedValue(consent(true));
    renderGate();
    await waitFor(() => expect(api.getMyConsent).toHaveBeenCalled());
    expect(screen.queryByTestId('terms-gate')).toBeNull();
    eventEmitter.emit('workspace:telemetry', { answer: { Consent: consent(false) } });
    expect(await screen.findByTestId('terms-gate')).toBeInTheDocument();
    eventEmitter.emit('workspace:telemetry', { answer: { Consent: consent(true) } });
    await waitFor(() => expect(screen.queryByTestId('terms-gate')).toBeNull());
  });

  it('does not take another kind of telemetry answer for a consent', async () => {
    api.getMyConsent.mockResolvedValue(consent(true));
    renderGate();
    await waitFor(() => expect(api.getMyConsent).toHaveBeenCalled());
    eventEmitter.emit('workspace:telemetry', { answer: { Deleted: { segments: 1 } } });
    await Promise.resolve();
    expect(screen.queryByTestId('terms-gate')).toBeNull();
  });
});
