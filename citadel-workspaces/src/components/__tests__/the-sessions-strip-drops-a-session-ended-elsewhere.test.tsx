/**
 * The strip of live sessions reloaded on mount and on a reconnection, and
 * nothing else. When another window signed an account out (or deleted it), the
 * agent said so with a DisconnectNotification / DeregisterSuccess, the
 * workspace window for that account left -- and every other window kept the
 * account's chip, offering a session that no longer exists, until it was
 * reloaded.
 *
 * Stood in: the agent's session list (the connection manager's query). Real:
 * the hook, the event bus, the ended-elsewhere rule, the forgotten-sessions list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor, type RenderHookResult } from '@testing-library/react';
import type { UseOrphanSessionsResult } from '../useOrphanSessions-types';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

type Row = { cid: bigint; username: string; server_address: string };
const live: { rows: Row[] } = vi.hoisted(() => ({ rows: [] }));

vi.mock('../sync-selected-session-to-wasm', () => ({ syncSelectedSessionToWasm: async (): Promise<void> => undefined }));

import { useOrphanSessions } from '../useOrphanSessions';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { connectionManager } from '@/lib/connection';
import { eventEmitter } from '@/lib/event-emitter';
import { rememberEverything } from '@/lib/sessions/forgotten-sessions';

const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
  <MemoryRouter><ConfirmDialogProvider>{children}</ConfirmDialogProvider></MemoryRouter>
);
const ALICE: Row = { cid: 1n, username: 'alice', server_address: 'x:1' };
const BOB: Row = { cid: 2n, username: 'bob', server_address: 'x:1' };

type Hook = RenderHookResult<UseOrphanSessionsResult, unknown>;

async function loaded(): Promise<Hook> {
  const hook: Hook = renderHook(() => useOrphanSessions(), { wrapper });
  await act(async () => { await hook.result.current.loadActiveSessions(); });
  expect(hook.result.current.sessions.map((s) => s.username)).toEqual(['alice', 'bob']);
  return hook;
}

beforeEach(() => {
  live.rows = [ALICE, BOB];
  rememberEverything();
  // The agent's answers only; the real manager stays whole for its other callers (timers included).
  vi.spyOn(connectionManager, 'waitForReady').mockResolvedValue(undefined);
  vi.spyOn(connectionManager, 'getActiveSessionsResult').mockImplementation(async () => ({ ok: true, sessions: live.rows } as never));
  vi.spyOn(connectionManager, 'getStoredSessions').mockReturnValue({ sessions: [] } as never);
});

describe('the sessions strip, when an account ends in another window', () => {
  it('drops a signed-out account and keeps the rest', async () => {
    const { result } = await loaded();
    act(() => { eventEmitter.emit('websocket-message', { DisconnectNotification: { cid: 2n, peer_cid: null, request_id: null } }); });
    await waitFor(() => expect(result.current.sessions.map((s) => s.username)).toEqual(['alice']));
  });

  it('drops a deleted account', async () => {
    const { result } = await loaded();
    act(() => { eventEmitter.emit('websocket-message', { DeregisterSuccess: { cid: 1n, request_id: null } }); });
    await waitFor(() => expect(result.current.sessions.map((s) => s.username)).toEqual(['bob']));
  });

  it('keeps every chip for a peer\'s disconnect, which names a peer and ends no session', async () => {
    const { result } = await loaded();
    act(() => { eventEmitter.emit('websocket-message', { DisconnectNotification: { cid: 2n, peer_cid: 9n, request_id: null } }); });
    expect(result.current.sessions).toHaveLength(2);
  });

  it('adds the chip of an account that signed in in another window', async () => {
    live.rows = [ALICE];
    const hook: Hook = renderHook(() => useOrphanSessions(), { wrapper });
    await act(async () => { await hook.result.current.loadActiveSessions(); });
    expect(hook.result.current.sessions.map((s) => s.username)).toEqual(['alice']);
    live.rows = [ALICE, BOB];
    act(() => { eventEmitter.emit('instance:registered', { instanceId: 'other-tab', cid: 2n }); });
    await waitFor(() => expect(hook.result.current.sessions.map((s) => s.username)).toEqual(['alice', 'bob']));
  });

  it('adds the chip of a session claimed in another window', async () => {
    live.rows = [ALICE];
    const hook: Hook = renderHook(() => useOrphanSessions(), { wrapper });
    await act(async () => { await hook.result.current.loadActiveSessions(); });
    live.rows = [ALICE, BOB];
    act(() => { eventEmitter.emit('session:claimed', { cid: 2n, relayed: true }); });
    await waitFor(() => expect(hook.result.current.sessions).toHaveLength(2));
  });
});
