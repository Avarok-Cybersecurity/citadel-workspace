/**
 * A local storage failure must not leave the user connected.
 *
 * `handleLogout` removed the session from memory, persisted, and then
 * disconnected — with the write in the middle. So a `LocalDBSetKV` timeout,
 * which CI shows happening, meant the user pressed Sign Out, the session
 * disappeared from memory and from the UI, and the connection to the server
 * stayed open.
 *
 * That is round 189 pointing the other way: a local storage failure suppressing
 * an action the user asked for. Here the suppressed action is the one that ends
 * a session, which makes it the worse direction of the two.
 */
import { describe, it, expect, vi  } from 'vitest';
import { handleLogout } from '../session-management';
import { removeAllSessions } from '../session-list';

function harness(writeFails: boolean): { state: { storedSessions: { sessions: never[]; }; removeSession: ReturnType<typeof vi.fn>; clearSessions: ReturnType<typeof vi.fn>; currentConnectionInfo: { cid: bigint; }; }; io: { storeSessionsToLocalDB: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; forgetAccountDocuments: ReturnType<typeof vi.fn>; forgetAtRestRoot: ReturnType<typeof vi.fn>; }; } {
  const state: {
    storedSessions: { sessions: never[] };
    removeSession: ReturnType<typeof vi.fn>;
    clearSessions: ReturnType<typeof vi.fn>;
    currentConnectionInfo: { cid: bigint };
  } = {
    storedSessions: { sessions: [] },
    removeSession: vi.fn(),
    clearSessions: vi.fn(),
    currentConnectionInfo: { cid: 7n },
  };
  const io: { storeSessionsToLocalDB: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; forgetAccountDocuments: ReturnType<typeof vi.fn>; forgetAtRestRoot: ReturnType<typeof vi.fn> } = {
    storeSessionsToLocalDB: vi.fn(async () => {
      if (writeFails) throw new Error('LocalDBSetKV request timed out');
    }),
    disconnect: vi.fn(async () => {}),
    forgetAccountDocuments: vi.fn(async () => {}),
    forgetAtRestRoot: vi.fn(async () => {}),
  };
  return { state, io };
}

describe('signing out when the local write times out', () => {
  it('still disconnects', async () => {
    const { state, io } = harness(true);
    await handleLogout('alice', '127.0.0.1:12349', 42n, state as never, io as never);
    expect(io.disconnect).toHaveBeenCalledWith(42n);
  });

  it('does not reject, so the UI is not left mid-sign-out', async () => {
    const { state, io } = harness(true);
    await expect(
      handleLogout('alice', '127.0.0.1:12349', 42n, state as never, io as never),
    ).resolves.toBeUndefined();
  });

  it('disconnects before it writes, so ordering cannot regress silently', async () => {
    // The positive control for the two above: with a WORKING write, the order
    // is still disconnect-then-persist. Testing only the failure path would
    // pass with the write moved back in front, as long as it was wrapped.
    const { state, io } = harness(false);
    const order: string[] = [];
    io.disconnect.mockImplementation(async () => { order.push('disconnect'); });
    io.storeSessionsToLocalDB.mockImplementation(async () => { order.push('persist'); });
    await handleLogout('alice', '127.0.0.1:12349', 42n, state as never, io as never);
    expect(order).toEqual(['disconnect', 'persist']);
  });

  it('removes the account\'s document copies from this device, even when the disconnect fails', async () => {
    const { state, io } = harness(false);
    io.disconnect.mockImplementation(async () => { throw new Error('the agent is gone'); });
    await expect(handleLogout('alice', '127.0.0.1:12349', 42n, state as never, io as never)).rejects.toThrow('the agent is gone');
    expect(io.forgetAccountDocuments).toHaveBeenCalledWith(42n);
  });

  it('removes the key to the account\'s sealed records while the session is still held, and signs out if that fails', async () => {
    const { state, io } = harness(false);
    const order: string[] = [];
    io.forgetAtRestRoot.mockImplementation(async () => { order.push('forget root'); throw new Error('LocalDBDeleteKV request timed out'); });
    io.disconnect.mockImplementation(async () => { order.push('disconnect'); });
    await handleLogout('alice', '127.0.0.1:12349', 42n, state as never, io as never);
    expect(io.forgetAtRestRoot).toHaveBeenCalledWith(42n);
    expect(order).toEqual(['forget root', 'disconnect']);
  });

  it('removing every session disconnects too', async () => {
    const { state, io } = harness(true);
    const disconnectFn: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<void> => {});
    await removeAllSessions(state as never, io as never, disconnectFn);
    expect(disconnectFn).toHaveBeenCalled();
  });
});
