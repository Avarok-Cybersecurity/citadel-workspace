/**
 * A successful join from the workspace switcher closes the wizard.
 *
 * Join took its `onNext` as `_onNext` and never called it. The switcher's
 * handleNext 'join' case is what ends the flow, so it never ran: after the
 * account was created, the registration hook navigated to /workspace -- the
 * route the switcher is already on -- and "Create Your Profile" stayed up over
 * a workspace that was ready. Landing's handleJoinNext was dead for the same
 * reason.
 *
 * Mocked: the agent socket's `register` (it answers through the real event
 * emitter, as the agent does), `handleAuthSuccess` (it persists the session to
 * IndexedDB, which is storage I/O and not the question), and the stored-session
 * reads the switcher's menu makes on mount.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { eventEmitter } from '@/lib/event-emitter';
import { ConnectionManager } from '@/lib/connection';
import { renderSwitcher, joinFromTheSwitcher } from './switcher-join-flow';

// Hoisted: the static imports below load the websocket service before this line would run.
const { register } = vi.hoisted((): { register: ReturnType<typeof vi.fn> } => ({
  register: vi.fn(async (requestId: string): Promise<void> => {
    queueMicrotask((): void => {
      eventEmitter.emit('websocket-message', { ConnectSuccess: { request_id: requestId, cid: 42n } });
    });
  }),
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
  it('closes the wizard once the account is registered', async (): Promise<void> => {
    vi.spyOn(ConnectionManager.getInstance(), 'handleAuthSuccess').mockResolvedValue(undefined);
    await renderSwitcher();
    await joinFromTheSwitcher('Standard');

    // Positive control: the registration really completed, so a wizard still
    // standing below is the defect and not a join that never finished.
    await waitFor((): void => {
      expect(ConnectionManager.getInstance().handleAuthSuccess).toHaveBeenCalledTimes(1);
    });
    await waitFor((): void => {
      expect(screen.queryByText('Create Your Profile')).toBeNull();
    }, { timeout: 4000 });
  });
});
