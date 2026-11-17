/**
 * The two ends of sharing a session between windows: joining it here too, and
 * hearing that this window was let go of it.
 *
 * `openHereToo` is tested over its seam (find, join, open), each recorded.
 * The detach watcher runs for real on the app's event emitter; the tab's
 * stored selection is stood in for, because it lives in IndexedDB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tab: { cid: bigint; username: string } = vi.hoisted(() => ({ cid: 7n, username: 'alice' }));
vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint; selectedUsername: string }> => ({ selectedCid: tab.cid, selectedUsername: tab.username }),
}));

import { openHereToo, type OpenHereTooDeps } from '../open-here-too';
import { onThisTabDetached, detachedFrom } from '../detached';
import type { SwitchTarget } from '../switch-to-session';
import { eventEmitter } from '@/lib/event-emitter';

const ALICE: SwitchTarget = { cid: 7n, username: 'alice', server_address: 'wss://w/', workspaceName: 'W', storedSessionIndex: 0 };

function seam(found: SwitchTarget | null, joins: boolean): OpenHereTooDeps & { steps: string[] } {
  const steps: string[] = [];
  return {
    steps,
    findTarget: async (): Promise<SwitchTarget | null> => { steps.push('find'); return found; },
    join: async (cid: bigint, password: string): Promise<void> => {
      steps.push(`join ${cid} ${password}`);
      if (!joins) throw new Error('The password does not match this session');
    },
    open: async (target: SwitchTarget): Promise<void> => { steps.push(`open ${target.username}`); },
  };
}

describe('opening a session here too', () => {
  it('joins, then opens it the way any switch does', async () => {
    const s: OpenHereTooDeps & { steps: string[] } = seam(ALICE, true);
    await openHereToo(s, 'alice', 'pw');
    expect(s.steps).toEqual(['find', 'join 7 pw', 'open alice']);
  });

  it('opens nothing when the join is refused', async () => {
    const s: OpenHereTooDeps & { steps: string[] } = seam(ALICE, false);
    await expect(openHereToo(s, 'alice', 'bad')).rejects.toThrow('password does not match');
    expect(s.steps).toEqual(['find', 'join 7 bad']);
  });

  it('says so when the agent no longer has the session', async () => {
    const s: OpenHereTooDeps & { steps: string[] } = seam(null, true);
    await expect(openHereToo(s, 'alice', 'pw')).rejects.toThrow('no longer signed in');
    expect(s.steps).toEqual(['find']);
  });
});

describe('a window let go of its session', () => {
  const role = (cid: bigint, r: string): Record<string, unknown> => ({ SessionRoleNotification: { cid, role: r, attached: 1, request_id: null } });
  let offered: string[] = [];
  beforeEach(() => { offered = []; });

  it('is offered the session back', async () => {
    const stop: () => void = onThisTabDetached((u: string) => offered.push(u));
    eventEmitter.emit('websocket-message', role(7n, 'Detached'));
    await vi.waitFor(() => expect(offered).toEqual(['alice']));
    stop();
  });

  it('is not bothered about another session, or a role that keeps it', async () => {
    const stop: () => void = onThisTabDetached((u: string) => offered.push(u));
    eventEmitter.emit('websocket-message', role(8n, 'Detached'));
    eventEmitter.emit('websocket-message', role(7n, 'Secondary'));
    await Promise.resolve();
    await Promise.resolve();
    expect(offered).toEqual([]);
    stop();
  });

  it('reads the notice wrapped or bare', () => {
    expect(detachedFrom({ Response: role(7n, 'Detached') })).toBe(7n);
    expect(detachedFrom(role(7n, 'Primary'))).toBeNull();
  });
});
