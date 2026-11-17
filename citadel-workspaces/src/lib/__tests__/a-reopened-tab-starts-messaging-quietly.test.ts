/**
 * A tab that reopens a session starts its background services without calling them broken.
 *
 * Seen live: a reopened tab flashed "Messaging may be unavailable — Some background
 * services failed to start". The startup sequence's only thrower was the P2P
 * registration service's precondition, which read connectionManager's connection record.
 * Only a login writes that record; the claim path (switch-to-session, the login redirect,
 * an account link) sets the tab's CID on the instance manager and never touches it, so
 * start() threw "No active connection" over a session that was working.
 *
 * Mocked, each because it needs the agent or the WASM client: the ILM start, the two peer
 * listings the registration service asks the agent for, and P2P auto-connect. The toast
 * is a recorder. Real: the startup sequence, the registration service and its gate, the
 * CID resolver, the instance manager and the (empty) connection manager.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const toasts: Array<{ title?: string }> = [];
vi.mock('@/hooks/use-toast', () => ({ toast: (t: { title?: string }): void => { toasts.push(t); } }));
vi.mock('@/lib/start-messaging', () => ({ startMessagingForSession: async (): Promise<boolean> => true }));
vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    resetConnectionState: async (): Promise<void> => undefined,
    connectToAllRegisteredPeers: async (): Promise<void> => undefined,
  },
}));
vi.mock('@/lib/p2p-registration-service/discovery', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  listAllPeers: async (): Promise<unknown[]> => [],
}));
vi.mock('@/lib/p2p-registration-service/connection', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  listRegisteredPeersWithRetry: async (): Promise<unknown[]> => [],
}));

import { runStartupSequence } from '../session-startup-sequence';
import { p2pRegistrationService } from '../p2p-registration-service';
import { instanceManager } from '../multi-instance';
import { connectionManager } from '../connection';

const CLAIMED: bigint = 9_1234_5678n;

beforeEach(() => { toasts.length = 0; });
afterEach(() => { p2pRegistrationService.stop(); instanceManager.setCid(null); });

describe('reopening a session in a tab that never logged in', () => {
  it('raises no failure, with the CID known and no connection record', async () => {
    expect(connectionManager.getConnectionInfo()).toBeNull();
    instanceManager.setCid(CLAIMED);

    await runStartupSequence({ cid: CLAIMED.toString(), username: 'alice', serverAddress: 'bench.work.avarok.net', activationType: 'claim' }, () => undefined);

    expect(toasts.map((t) => t.title)).toEqual([]);
  });

  it('still says so when the tab has no session at all', async () => {
    await runStartupSequence({ cid: '0', username: 'alice', serverAddress: 'bench.work.avarok.net', activationType: 'connect' }, () => undefined);
    expect(toasts.map((t) => t.title)).toEqual(['Messaging may be unavailable']);
  });
});

describe('two activations landing together', () => {
  it('start one registration poll, not two', async () => {
    instanceManager.setCid(CLAIMED);
    const started: ReturnType<typeof vi.fn> = vi.fn();
    const { eventEmitter } = await import('../event-emitter');
    eventEmitter.on('p2p:registration-service-started', started);
    await Promise.all([p2pRegistrationService.start(), p2pRegistrationService.start()]);
    eventEmitter.off('p2p:registration-service-started', started);
    expect(started).toHaveBeenCalledOnce();
  });
});
