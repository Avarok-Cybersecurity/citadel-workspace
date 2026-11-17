/**
 * The switcher's rows say which accounts the agent holds, and a click on one it
 * does not hold signs in rather than claiming a CID the agent never had.
 *
 * Root cause of "Session 14197768845630597388 not found" from the top bar: the
 * rows were the browser's SAVED accounts, kept after a sign-out, a deletion in
 * another window or an agent restart, and a click claimed the saved record's CID
 * whenever the agent's own list did not name the account. The agent's GetSessions
 * answer is the authority on "signed in" (agent-holds-session.ts); a saved record
 * is only what is known about the account.
 */
import { describe, it, expect } from 'vitest';
import { planSwitch, switcherWorkspaces, type StoredWorkspace } from '../stored-workspace-list';
import type { ActiveSession, StoredSession } from '@/types/session-types';

const saved = (username: string, cid: bigint, serverAddress: string): StoredSession =>
  ({ username, serverAddress, cid }) as StoredSession;
const live = (username: string, cid: bigint, host: string): ActiveSession =>
  ({ username, cid, server_address: '104.21.0.1:443', server_host: host }) as ActiveSession;

const BENCH: string = 'bench.work.avarok.net';
const STALE: bigint = 14197768845630597388n;

describe('which rows are signed in', () => {
  it('marks a saved account the agent does not list as signed out', () => {
    const rows: StoredWorkspace[] = switcherWorkspaces(
      [saved('alice', 1n, BENCH), saved('bob', STALE, BENCH)], [live('alice', 1n, BENCH)], 'Bench', 1n,
    );
    expect(rows.map((r: StoredWorkspace) => [r.username, r.signedIn])).toEqual([['alice', true], ['bob', false]]);
  });

  it('carries the CID the agent holds, not the saved copy', () => {
    const [row] = switcherWorkspaces([saved('bob', STALE, BENCH)], [live('bob', 9n, BENCH)], 'Bench', null);
    expect(row).toMatchObject({ signedIn: true, cid: 9n });
  });

  it('claims to know nothing when the agent did not answer', () => {
    const [row] = switcherWorkspaces([saved('bob', STALE, BENCH)], null, 'Bench', null);
    expect(row.signedIn).toBeNull();
  });

  it('counts every session the agent lists but nobody saved as signed in', () => {
    const rows: StoredWorkspace[] = switcherWorkspaces([], [live('carol', 3n, BENCH)], 'Bench', null);
    expect(rows[0]).toMatchObject({ username: 'carol', signedIn: true, cid: 3n });
  });
});

describe('what a click does', () => {
  const bob: Pick<StoredWorkspace, 'username' | 'serverAddress' | 'cid'> = { username: 'bob', serverAddress: BENCH, cid: STALE };

  it('signs in to an account the agent does not hold, rather than claiming its saved CID', () => {
    expect(planSwitch(bob, [live('alice', 1n, BENCH)], STALE)).toEqual({ kind: 'sign-in' });
  });

  it("switches by the agent's CID when it holds the account", () => {
    expect(planSwitch(bob, [live('bob', 9n, BENCH)], STALE)).toEqual({ kind: 'switch', cid: 9n });
  });

  it('tries the saved CID only when the agent could not be asked', () => {
    expect(planSwitch(bob, null, STALE)).toEqual({ kind: 'switch', cid: STALE });
    expect(planSwitch({ ...bob, cid: undefined }, null, undefined)).toEqual({ kind: 'no-cid' });
  });
});
