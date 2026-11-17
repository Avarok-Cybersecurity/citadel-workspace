/**
 * A second connect success must not erase who the session belongs to.
 *
 * `handleSuccessfulConnection` runs from the WebSocket when a ConnectSuccess
 * lands, and it knows only the CID. It ASSIGNED `{ cid }` over the connection
 * record, so anything already there went with it — including the `username`
 * that `handleAuthSuccess` writes on the login path.
 *
 * `permissionsService.getCurrentUserId()` reads exactly that username, and its
 * own comment records the consequence without the cause: "the synchronous
 * accessor is null for a user who logged IN rather than registering". A null
 * there is a permissions fetch that cannot say who it is for; CI reports it as
 * the workspace administrator's Edit button, disabled for sixty seconds, over a
 * title reading "Permissions have not been loaded for this domain".
 *
 * The same shape as the workspace metadata, which is shared with theming and
 * was being assigned over: a partial write to a shared record has to merge.
 */
import { describe, it, expect } from 'vitest';
import { ConnectionStateCore } from '../state-core';

/** Leadership plays no part in what these tests check; a follower's answer keeps it inert. */
const NOT_LEADING: () => boolean = (): boolean => false;

describe('a connect success that knows only the CID', () => {
  it('keeps the username the auth path recorded', () => {
    const state: ConnectionStateCore = new ConnectionStateCore(NOT_LEADING);
    state.setCurrentConnectionInfo({
      cid: 42n,
      username: 'admin',
      serverAddress: '127.0.0.1:12349',
    });

    state.updateCurrentConnectionInfo({ cid: 42n });

    expect(state.currentConnectionInfo?.username).toBe('admin');
    expect(state.currentConnectionInfo?.serverAddress).toBe('127.0.0.1:12349');
  });

  it('still records the CID when there was nothing there yet', () => {
    // The registration path, where the success arrives before anything else.
    const state: ConnectionStateCore = new ConnectionStateCore(NOT_LEADING);
    state.updateCurrentConnectionInfo({ cid: 7n });
    expect(state.currentConnectionInfo?.cid).toBe(7n);
  });

  it('takes a newer CID over the one it held', () => {
    const state: ConnectionStateCore = new ConnectionStateCore(NOT_LEADING);
    state.setCurrentConnectionInfo({ cid: 1n, username: 'admin' });
    state.updateCurrentConnectionInfo({ cid: 2n });
    expect(state.currentConnectionInfo?.cid).toBe(2n);
    expect(state.currentConnectionInfo?.username).toBe('admin');
  });
});
