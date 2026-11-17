/**
 * "Which session is this?" had three answers, and one of them had the order wrong.
 *
 * `lib/p2p/current-cid.ts` documents the priority: the instance manager first
 * (synchronous, set on connect), then the TAB's selection, then the tab's
 * stored session, and only then the global connection — which belongs to the
 * connection rather than to this tab, and is wrong whenever one browser holds
 * two sessions.
 *
 *   - `p2p/messenger-cid-resolver.ts` carried a second copy of the chain, with
 *     its own 500ms literal where the authority uses `CID_LOOKUP_TIMEOUT_MS`.
 *   - `peer-registration-store/state.ts` carried a third — with `connectionInfo`
 *     moved to position TWO, ahead of the tab's own selection. So a browser with
 *     two sessions scoped one tab's pending contact requests by the other tab's
 *     CID.
 *   - `CallLayer` passed the bare `getConnectionInfo()?.cid`: the last step of
 *     the chain used as the only step.
 *
 * The order is the substance here, and a gate can only see that there is one
 * implementation. These hold what it does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const instance: { cid: bigint | null } = { cid: null };
const tab: { selectedCid?: bigint } = {};
const session: { cid?: bigint } = {};
const connection: { cid?: bigint } = {};

vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return instance.cid; } }) };
});
vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<unknown> => (tab.selectedCid ? tab : null),
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getTabSelectedSession: async (): Promise<unknown> => (session.cid ? session : null),
    getConnectionInfo: (): unknown => (connection.cid ? connection : null),
  },
}));

const { getCurrentCid } = await import('../p2p/current-cid');
const { resolveCurrentCid } = await import('../p2p/messenger-cid-resolver');
const { getCurrentSessionCid } = await import('../peer-registration-store/state');

/** Every name the app calls this by. They must not be able to disagree. */
const ANSWERS: ReadonlyArray<readonly [string, () => Promise<bigint | null>]> = [
  ['getCurrentCid', getCurrentCid],
  ['resolveCurrentCid', resolveCurrentCid],
  ['getCurrentSessionCid', getCurrentSessionCid],
];

describe.each(ANSWERS)('%s', (_name, answer: () => Promise<bigint | null>) => {
  beforeEach((): void => {
    instance.cid = null;
    delete tab.selectedCid;
    delete session.cid;
    delete connection.cid;
  });

  it('prefers the instance manager', async () => {
    instance.cid = 1n;
    tab.selectedCid = 2n;
    connection.cid = 3n;
    expect(await answer()).toBe(1n);
  });

  it("prefers the TAB's selection over the global connection", async () => {
    // The whole point. One copy had the connection at position two, so a
    // follower tab answered with the leader's identity.
    tab.selectedCid = 2n;
    connection.cid = 3n;
    expect(await answer()).toBe(2n);
  });

  it("prefers the tab's stored session over the global connection", async () => {
    session.cid = 4n;
    connection.cid = 3n;
    expect(await answer()).toBe(4n);
  });

  it('falls back to the global connection, last', async () => {
    // The positive control: an implementation that never consulted it would
    // satisfy the three tests above and lose the only answer a fresh tab has.
    connection.cid = 3n;
    expect(await answer()).toBe(3n);
  });

  it('answers null rather than guessing', async () => {
    expect(await answer()).toBeNull();
  });
});
