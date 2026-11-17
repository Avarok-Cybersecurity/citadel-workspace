/**
 * An account added from the workspace switcher is registered at the security
 * level the user chose for it.
 *
 * The switcher rendered `<SecuritySettings onNext onBack />` -- no onComplete,
 * no initialValues -- and `<Join>` without `securitySettings`, so the choice
 * went nowhere and the registration hook fell back to the defaults. A user who
 * picked "High" got a Standard account, permanently, with nothing said. The
 * Landing wizard wired both; the switcher's copy of the wiring never did.
 *
 * Mocked: the agent socket (`websocketService.register`, the one I/O boundary
 * the assertion reads), and the stored-session reads the switcher's menu makes
 * on mount. Everything between the security form and the request is real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { SessionSecuritySettings } from '@/lib/security-utils';
import { renderSwitcher, joinFromTheSwitcher, JOIN_ADDRESS, JOIN_USERNAME } from './switcher-join-flow';

const { register } = vi.hoisted((): { register: ReturnType<typeof vi.fn> } => ({
  register: vi.fn(async (): Promise<void> => {}),
}));

vi.mock('@/lib/websocket-service', async (importOriginal) => {
  const actual: { websocketService: object } = await importOriginal();
  return {
    ...actual,
    websocketService: Object.assign(Object.create(actual.websocketService), { register }),
  };
});

vi.mock('@/lib/connection', async (importOriginal) => {
  const actual: { connectionManager: Record<string, unknown> } = await importOriginal();
  return {
    ...actual,
    connectionManager: Object.assign(Object.create(actual.connectionManager as object), {
      getStoredSessions: (): { sessions: [] } => ({ sessions: [] }),
      getConnectionInfo: (): null => null,
      getActiveSessionsResult: async (): Promise<{ ok: boolean; sessions: []; signedOut: [] }> => ({ ok: true, sessions: [], signedOut: [] }),
      reloadStoredSessions: async (): Promise<void> => {},
    }),
  };
});

vi.mock('@/lib/connection-service', () => ({
  ConnectionService: { getInstance: (): { onConnectionChange: () => () => void } => ({
    onConnectionChange: (): (() => void) => (): void => {},
  }) },
}));

vi.mock('@/lib/tab-context', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, getSelectedUser: async (): Promise<null> => null };
});

describe('joining from the workspace switcher', () => {
  beforeEach((): void => { register.mockClear(); });

  it('registers at the security level chosen in the wizard', async (): Promise<void> => {
    await renderSwitcher();
    await joinFromTheSwitcher('High');

    await waitFor((): void => { expect(register).toHaveBeenCalledTimes(1); });
    const args: unknown[] = register.mock.calls[0];
    // Positive control: this IS the switcher's registration, not some other call.
    expect(args[1]).toBe(JOIN_USERNAME);
    expect(args[4]).toBe(JOIN_ADDRESS);
    // No human check here: the workspace does not ask for one (lib/admission).
    expect(args[5]).toBeNull();
    const sent: SessionSecuritySettings = args[7] as SessionSecuritySettings;
    expect(sent.security_level).toBe('High');
  });
});
