/**
 * A tab acts only as the account it selected. The stored-session list is the agent's (shared by
 * every browser on the machine), so its active index names whichever browser wrote last: the
 * Compute Pool spec's fresh tabs acted as pool_a, another browser's account, and every request
 * they sent for it was refused by the agent ("the connection does not own it").
 */
import { describe, expect, it } from 'vitest';
import type { StoredSession, StoredSessions } from '@/types/session-types';
import type { TabSelectionContext } from '../types';
import { tabSelectedSession } from '../tab-session';

const SERVER: string = 'server:12349';
const session = (username: string, cid: bigint): StoredSession => ({
  username, serverAddress: SERVER, fullName: username, lastConnected: 1, cid,
  // Not read by the selection; any value would do.
  sessionSecuritySettings: {} as never,
});
const A: StoredSession = session('pool_a', 4279714676156291116n);
const X: StoredSession = session('pool_x', 12124651227434498787n);
// As the run left it: another browser (A's) wrote the list last, with itself active.
const AGENT_LIST: StoredSessions = { sessions: [A, X], activeSessionIndex: 0 };

describe('the session a tab acts as', () => {
  it('is the one its selection names, whatever the shared list says is active', () => {
    const mine: TabSelectionContext = { selectedUsername: 'pool_x', selectedServerAddress: SERVER, selectedCid: X.cid };
    expect(tabSelectedSession(AGENT_LIST, mine)?.cid).toBe(X.cid);
  });

  it('is none for a tab that has not selected one -- not the account another browser made active', () => {
    expect(tabSelectedSession(AGENT_LIST, null)).toBeNull();
    expect(tabSelectedSession(AGENT_LIST, { selectedUsername: null, selectedServerAddress: null })).toBeNull();
  });

  it('is none when the selection names an account the list does not hold', () => {
    expect(tabSelectedSession(AGENT_LIST, { selectedUsername: 'pool_y', selectedServerAddress: SERVER })).toBeNull();
    expect(tabSelectedSession(AGENT_LIST, { selectedUsername: 'pool_x', selectedServerAddress: 'elsewhere:1' })).toBeNull();
  });
});
