/**
 * The switcher's list, and which row says "you are here".
 *
 * Both were inline in a 250-line hook and therefore only reachable through a
 * render with a connection manager and an IndexedDB read behind it — which is
 * why the precedence between the tab's selection and the connection's CID was
 * never tested, despite being the rule that keeps one tab's label from changing
 * when another tab connects.
 */

import { describe, it, expect } from 'vitest';
import { toStoredWorkspaces, pickCurrentWorkspace, switcherWorkspaces } from '../stored-workspace-list';
import type { ActiveSession } from '@/types/session-types';
import type { StoredSession } from '@/types/session-types';
import type { StoredWorkspace } from '@/components/layout/sidebar/stored-workspace-list';

const session = (username: string, cid: bigint, serverAddress = 'ws://a'): StoredSession =>
  ({ username, serverAddress, cid }) as StoredSession;

describe('the workspace switcher list', () => {
  it('marks only the connected CID active', () => {
    const rows: StoredWorkspace[] = toStoredWorkspaces([session('alice', 1n), session('bob', 2n)], 'Acme', 2n);
    expect(rows.map((r) => r.isActive)).toEqual([false, true]);
  });

  it('gives every row a distinct id even when a username repeats across servers', () => {
    const rows: StoredWorkspace[] = toStoredWorkspaces(
      [session('alice', 1n, 'ws://a'), session('alice', 2n, 'ws://b')],
      'Acme',
      1n,
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it('falls back to the username when no workspace name has loaded yet', () => {
    const [row] = toStoredWorkspaces([session('alice', 1n)], undefined, 1n);
    expect(row.workspaceName).toBe('alice');
  });

  it("prefers this tab's selection over whichever session the shared client last connected", () => {
    const rows: StoredWorkspace[] = toStoredWorkspaces([session('alice', 1n), session('bob', 2n)], 'Acme', 2n);

    // bob is the active connection; this tab is looking at alice.
    const current: StoredWorkspace | undefined = pickCurrentWorkspace(rows, {
      selectedUsername: 'alice',
      selectedServerAddress: 'ws://a',
    });

    expect(current?.username).toBe('alice');
  });

  it('matches a tab selection on server address too, not username alone', () => {
    const rows: StoredWorkspace[] = toStoredWorkspaces(
      [session('alice', 1n, 'ws://a'), session('alice', 2n, 'ws://b')],
      'Acme',
      1n,
    );

    const current: StoredWorkspace | undefined = pickCurrentWorkspace(rows, {
      selectedUsername: 'alice',
      selectedServerAddress: 'ws://b',
    });

    expect(current?.cid).toBe(2n);
  });

  it('falls back to the connected session when this tab has selected nothing', () => {
    const rows: StoredWorkspace[] = toStoredWorkspaces([session('alice', 1n), session('bob', 2n)], 'Acme', 2n);
    expect(pickCurrentWorkspace(rows, null)?.username).toBe('bob');
  });

  it('picks nothing rather than a wrong row when the selection names an absent session', () => {
    const rows: StoredWorkspace[] = toStoredWorkspaces([session('alice', 1n)], 'Acme', null);
    expect(
      pickCurrentWorkspace(rows, { selectedUsername: 'carol', selectedServerAddress: 'ws://a' }),
    ).toBeUndefined();
  });
});

describe('the switcher across two workspace orgs', () => {
  // Measured live: alice, now on admin-lab, saw only admin-lab accounts -- the bench
  // sessions live on the same agent were missing, because the switcher read saved
  // accounts only and a resumed session is never saved -- and every group was labelled
  // with the CURRENT workspace's name.
  const live = (username: string, cid: bigint, host: string, full_name?: string): ActiveSession =>
    ({ username, cid, server_address: '104.21.0.1:443', server_host: host, full_name }) as ActiveSession;

  it('adds live sessions the saved list does not hold, so another org can be reached', () => {
    const rows: StoredWorkspace[] = switcherWorkspaces(
      [session('alice.lab', 5n, 'admin-lab.work.avarok.net')],
      [live('alice.lab', 5n, 'admin-lab.work.avarok.net'), live('alice0924', 1n, 'bench.work.avarok.net', 'Alice Anders')],
      'Admin Lab', 5n,
    );
    expect(rows.map((r) => `${r.username}@${r.serverAddress}`)).toEqual(['alice.lab@admin-lab.work.avarok.net', 'alice0924@bench.work.avarok.net']);
    expect(rows[1]).toMatchObject({ cid: 1n, fullName: 'Alice Anders', isActive: false });
  });

  it('labels only the current server with the current workspace name', () => {
    const rows: StoredWorkspace[] = switcherWorkspaces(
      [session('alice.lab', 5n, 'admin-lab.work.avarok.net'), session('bob0924', 2n, 'bench.work.avarok.net')],
      [], 'Admin Lab', 5n,
    );
    expect(rows.map((r) => r.workspaceName)).toEqual(['Admin Lab', 'bench.work.avarok.net']);
  });
});
