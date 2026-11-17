/**
 * An account is welcomed once, not on every sign-in.
 *
 * The "Welcome to Citadel Workspaces" notification was added on every
 * connection change with nothing recording that it had been shown, into a
 * notification store that lives only in memory. So every page load, and every
 * sign-out and sign-in, greeted the account afresh (owner, 2026-11-15).
 *
 * The record is kept where the account's other per-account state is: the
 * agent's LocalDB under the account's CID. CIDs are permanent per account and
 * the agent keeps an account's LocalDB across sign-out, so the record survives
 * both a reload and a sign-out.
 *
 * Mocks, each an I/O or start-up boundary of an orchestrating hook rather than
 * the behaviour under test:
 *  - connection-service: hands the test the connection-change subscriber, so a
 *    sign-in is one call rather than a live WebSocket;
 *  - connection: the stored-session lookup and the manager's initialisation;
 *  - websocket-service: the AGENT. Its LocalDB is a Map that outlives every
 *    mount, which is what the agent's account store does;
 *  - post-auth-setup, user-service, workspace-service, revfs-loader,
 *    health-check, session-startup-service, use-session-lost-with-agent: the
 *    rest of sign-in's network work, irrelevant to whether a greeting is due.
 * NotificationService is real: the assertion is on what it was given.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import NotificationService from '@/lib/notification-service';
import type { Notification } from '@/lib/notification-service/types';

interface ConnectionChange { cid: bigint; isConnected: boolean; userContext: { selectedCid: bigint } }
type ConnectionSubscriber = (connection: ConnectionChange) => Promise<void>;

const harness: {
  subscriber: ConnectionSubscriber | null;
  agentLocalDb: Map<string, number[]>;
  failReads: boolean;
} = vi.hoisted(() => ({ subscriber: null, agentLocalDb: new Map<string, number[]>(), failReads: false }));

const slot: (cid: bigint, key: string) => string = (cid: bigint, key: string): string => `${cid.toString()}/${key}`;

vi.mock('@/lib/connection-service', () => ({
  ConnectionService: {
    getInstance: (): { onConnectionChange: (subscriber: ConnectionSubscriber) => () => void; cleanup: () => void } => ({
      onConnectionChange: (subscriber: ConnectionSubscriber): (() => void) => {
        harness.subscriber = subscriber;
        return (): void => { harness.subscriber = null; };
      },
      cleanup: (): void => {},
    }),
  },
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: {
    initialize: async (): Promise<void> => {},
    getStoredSessionsArray: (): { cid: bigint; username: string; serverAddress: string }[] => [ALICE, BOB].map((cid: bigint) => ({
      cid, username: `user${cid.toString()}`, serverAddress: 'server:12349',
    })),
  },
}));
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (cid: bigint, key: string): Promise<{ value: number[] }> => {
      if (harness.failReads) throw new Error('LocalDBGetKV timed out after 5000ms');
      const value: number[] | undefined = harness.agentLocalDb.get(slot(cid, key));
      if (value === undefined) throw new Error('Key not found');
      return { value };
    },
    sendLocalDBSet: async (cid: bigint, key: string, value: number[]): Promise<void> => {
      harness.agentLocalDb.set(slot(cid, key), value);
    },
    sendP2PMessageReliable: async (): Promise<void> => {},
    sendMessage: async (): Promise<void> => {},
  },
}));
vi.mock('@/lib/post-auth-setup', () => ({ postAuthSetup: async (): Promise<void> => {} }));
vi.mock('@/lib/user-service', () => ({
  default: { loadUserRegistration: async (): Promise<void> => {}, cleanup: async (): Promise<void> => {} },
}));
vi.mock('@/lib/workspace-service', () => ({ default: { cleanup: (): void => {} } }));
vi.mock('@/lib/revfs/revfs-loader', () => ({ startRevfs: async (): Promise<void> => {} }));
vi.mock('@/lib/health-check', () => ({
  healthCheckService: { startHealthChecks: (): void => {}, stopHealthChecks: (): void => {} },
}));
vi.mock('@/lib/session-startup-service', () => ({}));
vi.mock('../use-session-lost-with-agent', () => ({ useSessionLostWithAgent: (): void => {} }));

import { useConnectionHandler } from '../useConnectionHandler';

const ALICE: bigint = 1001n;
const BOB: bigint = 2002n;
const WELCOME: string = 'Welcome to Citadel Workspaces';

/** Welcomes added for `cid` since the test began. */
let welcomes: Map<string, number>;
let stopCounting: () => void;

/**
 * A page load signed in as `cid`: a fresh mount of the hook (a reload or a
 * sign-in remounts the app), the connection arriving for that account, and the
 * greeting's delay elapsing. Unmounted afterwards, as a sign-out or reload does.
 */
async function signInAs(cid: bigint): Promise<void> {
  const { unmount } = renderHook(() => useConnectionHandler());
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.subscriber).not.toBeNull();
  await harness.subscriber?.({ cid, isConnected: true, userContext: { selectedCid: cid } });
  await vi.advanceTimersByTimeAsync(5000);
  unmount();
}

describe('the welcome notification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.agentLocalDb.clear();
    harness.failReads = false;
    welcomes = new Map<string, number>();
    stopCounting = NotificationService.getInstance().registerNotificationHandler((n: Notification): void => {
      if (n.title !== WELCOME || n.read) return;
      const who: string = n.recipientCid ?? 'nobody';
      welcomes.set(who, (welcomes.get(who) ?? 0) + 1);
    });
  });

  afterEach(() => {
    stopCounting();
    vi.useRealTimers();
  });

  it('greets an account on its first sign-in', async () => {
    await signInAs(ALICE);
    expect(welcomes.get(ALICE.toString())).toBe(1);
  });

  it('is not shown again after a reload', async () => {
    await signInAs(ALICE);
    await signInAs(ALICE);
    expect(welcomes.get(ALICE.toString())).toBe(1);
  });

  it('is not shown again after signing out and back in', async () => {
    await signInAs(ALICE);
    await signInAs(BOB);
    await signInAs(ALICE);
    expect(welcomes.get(ALICE.toString())).toBe(1);
  });

  it('is per account: a second account on the same device is still greeted', async () => {
    await signInAs(ALICE);
    await signInAs(BOB);
    expect(welcomes.get(BOB.toString())).toBe(1);
  });

  it('does not greet when the agent cannot say whether it already has', async () => {
    harness.failReads = true;
    await signInAs(ALICE);
    expect(welcomes.get(ALICE.toString())).toBeUndefined();
    expect(harness.agentLocalDb.size).toBe(0);
  });
});
