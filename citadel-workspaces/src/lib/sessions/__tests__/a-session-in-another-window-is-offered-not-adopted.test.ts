/**
 * Switching to an account that is live in another browser window asks first.
 *
 * `claimSessionForThisTab` answered "not orphaned, no tab of ours holds it"
 * with `already-active`, and the switch went on to select a session this tab's
 * socket does not carry: the workspace sat there and nothing ever answered.
 * The agent refuses `ClaimSession { only_if_orphaned: false }` for a session
 * held by another connection ("in use by another connection"), so the only
 * takeover is a sign-in with the password. The switch now says so and offers it.
 *
 * Mocked: the agent's ClaimSession answers, and the session-selection I/O the
 * switch would run after a successful claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h: { holder: 'orphan' | 'this-connection' | 'another-connection'; claims: boolean[]; selected: number } = vi.hoisted(
  (): { holder: 'orphan' | 'this-connection' | 'another-connection'; claims: boolean[]; selected: number } =>
    ({ holder: 'another-connection', claims: [], selected: 0 }),
);

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    claimSession: vi.fn(async (cid: bigint, onlyIfOrphaned: boolean): Promise<void> => {
      h.claims.push(onlyIfOrphaned);
      if (h.holder === 'orphan') return;
      if (onlyIfOrphaned) throw new Error(`Session ${cid} is not orphaned`);
      if (h.holder === 'another-connection') throw new Error(`Session ${cid} is in use by another connection`);
    }),
  },
}));
vi.mock('@/lib/tab-context', () => ({
  setSelectedUser: vi.fn(async (): Promise<void> => { h.selected += 1; }),
}));
// What a successful switch goes on to do: load the workspace and start messaging.
vi.mock('@/lib/post-auth-setup', () => ({ postAuthSetup: vi.fn(async (): Promise<void> => {}) }));
vi.mock('@/lib/start-messaging', () => ({ startMessagingForSession: vi.fn(async (): Promise<void> => {}) }));
vi.mock('@/lib/multi-instance', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  instanceChannel: { announcePresence: (): void => {} },
}));

import { claimSessionForThisTab } from '../claim-session';
import { takeoverPrompt } from '../takeover';
import { switchToSession } from '../switch-to-session';
import { instanceManager } from '@/lib/multi-instance';

beforeEach(() => { h.claims = []; h.selected = 0; });

describe('claiming a session somebody holds', () => {
  it('reports another connection, having moved nothing', async () => {
    h.holder = 'another-connection';
    expect(await claimSessionForThisTab(7n)).toEqual({ status: 'held-by-another-connection' });
  });

  it('still selects a session this connection already holds', async () => {
    h.holder = 'this-connection';
    expect(await claimSessionForThisTab(7n)).toEqual({ status: 'already-active' });
  });

  it('claims an orphan outright, asking only once', async () => {
    h.holder = 'orphan';
    expect(await claimSessionForThisTab(7n)).toEqual({ status: 'claimed' });
    expect(h.claims).toEqual([true]);
  });
});

describe('switching to it', () => {
  const target: Parameters<typeof switchToSession>[0] = {
    cid: 7n, username: 'alice0924', server_address: 'wss://bench.work.avarok.net/', workspaceName: 'Bench', storedSessionIndex: -1,
  };

  it('asks, and on yes starts the sign-in that moves it', async () => {
    h.holder = 'another-connection';
    const confirm: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<boolean> => true);
    const signInAs: ReturnType<typeof vi.fn> = vi.fn();
    await switchToSession(target, { navigate: vi.fn(), toast: vi.fn(), confirm, signInAs, signInAgain: vi.fn() });

    expect(confirm).toHaveBeenCalledWith(takeoverPrompt('alice0924', false));
    expect(takeoverPrompt('alice0924', false).title).toBe('alice0924 is open in another browser window');
    expect(signInAs).toHaveBeenCalledWith('alice0924');
    expect(h.selected).toBe(0);
  });

  it('does nothing further on no', async () => {
    h.holder = 'another-connection';
    const signInAs: ReturnType<typeof vi.fn> = vi.fn();
    await switchToSession(target, { navigate: vi.fn(), toast: vi.fn(), confirm: async (): Promise<boolean> => false, signInAs, signInAgain: vi.fn() });
    expect(signInAs).not.toHaveBeenCalled();
    expect(h.selected).toBe(0);
  });
});

describe('switching between two accounts in this browser', () => {
  it('switches at once to a session this connection already holds', async () => {
    // mia0924 registered first, then nia0924 was added in the same tab: mia's
    // session is live on THIS browser's connection, so "not orphaned" is the
    // agent's answer and the switch must go ahead rather than stop there.
    h.holder = 'this-connection';
    instanceManager.setCid(8n);
    const navigate: ReturnType<typeof vi.fn> = vi.fn();
    const signInAs: ReturnType<typeof vi.fn> = vi.fn();
    await switchToSession(
      { cid: 7n, username: 'mia0924', server_address: 'bench.work.avarok.net', workspaceName: 'Bench', storedSessionIndex: -1 },
      { navigate, toast: vi.fn(), confirm: async (): Promise<boolean> => false, signInAs, signInAgain: vi.fn() },
    );

    expect(signInAs).not.toHaveBeenCalled();
    expect(h.selected).toBe(1);
    expect(instanceManager.cid).toBe(7n);
    expect(navigate).toHaveBeenCalled();
  });

  it('is the sequence the workspace switcher runs', async () => {
    // The switcher carried its own copy of the switch, which never set the
    // instance CID, so the tab kept reading the account it had left.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { stripComments } = await import('@/test-utils/strip-comments');
    const source: string = stripComments(readFileSync(
      join(process.cwd(), 'src/components/layout/sidebar/useWorkspaceSwitcher.tsx'), 'utf8'));
    expect(source).toMatch(/\bswitchToSession\s*\(/);
    expect(source).not.toMatch(/\bclaimSessionForThisTab\s*\(/);
  });
});
