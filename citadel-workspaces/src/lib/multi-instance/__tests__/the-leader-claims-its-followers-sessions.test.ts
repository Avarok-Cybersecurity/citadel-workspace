/**
 * After the leader tab's connection is replaced, every follower tab's session is claimed on
 * the new one.
 *
 * Measured on the live site: the leader tab reloaded, its new connection claimed only its own
 * session, and the agent refused every request for the follower's ("the connection does not
 * own it"). These drive the real installer through a real event bus; `claim` stands in for
 * the agent's ClaimSession and answers as it does — "not orphaned" when a live connection
 * already owns the session.
 */
import { describe, it, expect } from 'vitest';
import { cidsToClaim, installFollowerSessionClaims, readClaimOutcome } from '../follower-session-claims';
import type { InstanceInfo } from '../instance-manager-types';
import { isOwnedByALiveConnection } from '@/lib/sessions/claim-session';

type Handler = (payload: unknown) => void;

interface World {
  claims: bigint[];
  failures: bigint[];
  reportRequests: () => number;
  instances: InstanceInfo[];
  emit: (event: string, payload?: unknown) => Promise<void>;
  /** Let the report window close. */
  closeWindow: () => void;
  becomeLeader: () => void;
  resign: () => void;
}

function world(tabs: InstanceInfo[], opts: { leader: boolean; ownedByThisConnection?: bigint[]; failing?: bigint[] }): World {
  const handlers: Map<string, Handler[]> = new Map();
  const claims: bigint[] = [];
  const failures: bigint[] = [];
  const instances: InstanceInfo[] = tabs.map((t: InstanceInfo) => ({ ...t }));
  let reportRequests: number = 0;
  let pending: Array<() => void> = [];
  let leader: boolean = opts.leader;
  const claimer: { settle: () => Promise<void> } = installFollowerSessionClaims({
    on: (event: string, handler: Handler): void => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    isLeader: (): boolean => leader,
    selfInstanceId: (): string => 'me',
    instances: (): InstanceInfo[] => instances,
    claim: async (cid: bigint): Promise<unknown> => {
      claims.push(cid);
      if (opts.failing?.includes(cid)) throw new Error('ClaimSession request timed out');
      if (opts.ownedByThisConnection?.includes(cid)) throw new Error(`Session ${cid} is not orphaned`);
      return {};
    },
    isOwnedByALiveConnection,
    reportFailure: (cid: bigint): void => { failures.push(cid); },
    requestReports: (): void => { reportRequests += 1; },
    unregister: (instanceId: string): void => {
      const at: number = instances.findIndex((i: InstanceInfo) => i.instanceId === instanceId);
      if (at >= 0) instances.splice(at, 1);
    },
    reportWindowMs: 5000,
    schedule: (fn: () => void): void => { pending.push(fn); },
  });
  const emit = async (event: string, payload?: unknown): Promise<void> => {
    for (const h of handlers.get(event) ?? []) h(payload);
    await claimer.settle();
  };
  const closeWindow = (): void => { const due: Array<() => void> = pending; pending = []; for (const fn of due) fn(); };
  return { claims, failures, reportRequests: (): number => reportRequests, instances, emit, closeWindow, becomeLeader: (): void => { leader = true; }, resign: (): void => { leader = false; } };
}

const TABS: InstanceInfo[] = [
  { instanceId: 'me', cid: 1n },
  { instanceId: 'bob-tab', cid: 2n },
  { instanceId: 'carol-tab', cid: 3n },
  { instanceId: 'fresh-tab', cid: null },
];

describe('which sessions the leader claims', () => {
  it('every other tab CID, not its own, and nothing for a tab with no session yet', () => {
    expect(cidsToClaim(TABS, 'me', new Set(), false)).toEqual([2n, 3n]);
    expect(cidsToClaim(TABS, 'me', new Set(), true)).toEqual([1n, 2n, 3n]);
  });

  it('skips what this connection already claimed', () => {
    expect(cidsToClaim(TABS, 'me', new Set([2n]), false)).toEqual([3n]);
  });

  it('treats "not orphaned" as already held here, and anything else as a failure', () => {
    expect(readClaimOutcome(null, isOwnedByALiveConnection)).toBe('settled');
    expect(readClaimOutcome(new Error('Session 2 is not orphaned'), isOwnedByALiveConnection)).toBe('settled');
    expect(readClaimOutcome(new Error('ClaimSession request timed out'), isOwnedByALiveConnection)).toBe('failed');
  });
});

describe('when the leader connection is replaced', () => {
  it('claims every follower session on the new connection', async () => {
    const w: World = world(TABS, { leader: true });
    await w.emit('on-ws-connection-success');
    expect(w.claims).toEqual([2n, 3n]);
  });

  it('a follower tab claims nothing, since it has no connection', async () => {
    const w: World = world(TABS, { leader: false });
    await w.emit('on-ws-connection-success');
    await w.emit('instance:registered', { instanceId: 'bob-tab', cid: 2n });
    expect(w.claims).toEqual([]);
  });

  it('a follower promoted to leader claims the others, and its own: the old leader carried it', async () => {
    const w: World = world(TABS, { leader: false });
    w.becomeLeader();
    await w.emit('instance:leader-changed', { isLeader: true, leaderId: 'me' });
    // Not yet: the promotion has only begun to open the connection that will carry the claims.
    expect(w.claims).toEqual([]);
    await w.emit('on-ws-connection-success');
    expect(w.claims).toEqual([1n, 2n, 3n]);
  });

  it('claims once per connection, and again after the connection is replaced', async () => {
    const w: World = world(TABS, { leader: true, ownedByThisConnection: [2n, 3n] });
    await w.emit('on-ws-connection-success');
    await w.emit('instance:registered', { instanceId: 'bob-tab', cid: 2n });
    expect(w.claims).toEqual([2n, 3n]);
    await w.emit('websocket-disconnected');
    await w.emit('on-ws-connection-success');
    expect(w.claims).toEqual([2n, 3n, 1n, 2n, 3n]);
  });

  it('reports a failed claim and retries it when its tab reports it again', async () => {
    const w: World = world(TABS, { leader: true, failing: [3n] });
    await w.emit('on-ws-connection-success');
    expect(w.failures).toEqual([3n]);
    await w.emit('instance:registered', { instanceId: 'carol-tab', cid: 3n });
    expect(w.claims).toEqual([2n, 3n, 3n]);
  });
});

describe("the leader's own session", () => {
  // Measured on the live site (Safari, one tab): a file dropped outside a drop zone opened
  // the file, Back restored the page from the back/forward cache with its socket closed,
  // the leader re-opened it -- and the next message failed "Session unavailable to this
  // connection" until a refresh. The page's mount claim had run once, on the first
  // connection; the replacement claimed the followers' sessions and not its own.
  it('is left to the page on the first connection, which claims it as the page starts', async () => {
    const w: World = world(TABS, { leader: true });
    await w.emit('on-ws-connection-success');
    expect(w.claims).not.toContain(1n);
  });

  it('is claimed again on the connection that replaces the one that carried it', async () => {
    const w: World = world([{ instanceId: 'me', cid: 1n }], { leader: true });
    await w.emit('on-ws-connection-success');
    await w.emit('websocket-disconnected');
    await w.emit('on-ws-connection-success');
    expect(w.claims).toEqual([1n]);
  });

  it('is not claimed before the tab holds one', async () => {
    const w: World = world([{ instanceId: 'me', cid: null }], { leader: true });
    await w.emit('websocket-disconnected');
    await w.emit('on-ws-connection-success');
    expect(w.claims).toEqual([]);
  });
});

describe('a tab that is gone', () => {
  // Measured: a tab closed without its goodbye (or switched account) left its CID in
  // the registry, the claim failed, and every later registration of ANY tab retried it.
  it('is not re-claimed when some other tab registers', async () => {
    const w: World = world(TABS, { leader: true, failing: [3n] });
    await w.emit('on-ws-connection-success');
    await w.emit('instance:registered', { instanceId: 'bob-tab', cid: 2n });
    await w.emit('instance:registered', { instanceId: 'fresh-tab', cid: null });
    expect(w.claims.filter((c: bigint) => c === 3n)).toEqual([3n]);
  });

  it('is asked to report in, and removed when it does not answer', async () => {
    const w: World = world(TABS, { leader: true, failing: [3n] });
    await w.emit('on-ws-connection-success');
    expect(w.reportRequests()).toBe(1);
    await w.emit('instance:registered', { instanceId: 'bob-tab', cid: 2n });
    await w.emit('instance:registered', { instanceId: 'fresh-tab', cid: null });
    w.closeWindow();
    expect(w.instances.map((i: InstanceInfo) => i.instanceId)).toEqual(['me', 'bob-tab', 'fresh-tab']);

    // So the next connection does not claim its CID at all.
    await w.emit('websocket-disconnected');
    await w.emit('on-ws-connection-success');
    expect(w.claims.filter((c: bigint) => c === 3n)).toEqual([3n]);
  });

  it('is not removed by a tab that stopped leading before the window closed', async () => {
    const w: World = world(TABS, { leader: true });
    await w.emit('on-ws-connection-success');
    w.resign();
    w.closeWindow();
    expect(w.instances).toHaveLength(4);
  });
});
