/**
 * The agent holds back a native notice for what this window shows; it learns
 * that from ReportFocus, sent when it changes and only to an agent that hosts.
 */
import { describe, it, expect } from 'vitest';
import { createFocusReporter, type FocusDeps, type FocusReporter } from '../report-focus';

type Said = { session_cid: bigint; peer_cid: bigint | null; focused: boolean };

function rig(hosts: boolean): { deps: FocusDeps; said: Said[]; state: { front: boolean; peer: bigint | null; failNext: boolean } } {
  const said: Said[] = [];
  const state: { front: boolean; peer: bigint | null; failNext: boolean } = { front: true, peer: null, failNext: false };
  const deps: FocusDeps = {
    hosts: async () => hosts,
    ownCid: async () => 7n,
    activePeer: () => state.peer,
    inFront: () => state.front,
    send: async (request: Record<string, unknown>) => {
      if (state.failNext) { state.failNext = false; throw new Error('The websocket service is not ready'); }
      const command: { ReportFocus: Said } = (request.ConnectionManagement as { management_command: { ReportFocus: Said } }).management_command;
      said.push(command.ReportFocus);
    },
  };
  return { deps, said, state };
}

describe('reporting focus', () => {
  it('says what is in front when it changes, and only then', async () => {
    const { deps, said, state } = rig(true);
    const report: () => Promise<void> = createFocusReporter(deps).changed;
    await report();
    await report();
    state.peer = 9n;
    await report();
    state.front = false;
    await report();
    expect(said).toEqual([
      { session_cid: 7n, peer_cid: null, focused: true },
      { session_cid: 7n, peer_cid: 9n, focused: true },
      { session_cid: 7n, peer_cid: null, focused: false },
    ]);
  });

  it('says nothing to an agent that raises no notices', async () => {
    const { deps, said } = rig(false);
    await createFocusReporter(deps).changed();
    expect(said).toEqual([]);
  });
});

// The agent keys focus by connection, and drops a report from a connection not
// attached to the session. So a report that went out before a claim, or over a
// socket since replaced, is not what the agent knows -- and it raised a notice
// for the conversation on screen until the next focus change.
describe('saying it again', () => {
  it('once this account\'s session is claimed, though nothing in front changed', async () => {
    const { deps, said } = rig(true);
    const reporter: FocusReporter = createFocusReporter(deps);
    await reporter.changed();
    await reporter.claimed(7n);
    expect(said).toEqual([
      { session_cid: 7n, peer_cid: null, focused: true },
      { session_cid: 7n, peer_cid: null, focused: true },
    ]);
  });

  it('not for another account\'s claim', async () => {
    const { deps, said } = rig(true);
    const reporter: FocusReporter = createFocusReporter(deps);
    await reporter.changed();
    await reporter.claimed(99n);
    expect(said).toHaveLength(1);
  });

  it('after a report that never left', async () => {
    const { deps, said, state } = rig(true);
    const reporter: FocusReporter = createFocusReporter(deps);
    state.failNext = true;
    await expect(reporter.changed()).rejects.toThrow();
    await reporter.changed();
    expect(said).toEqual([{ session_cid: 7n, peer_cid: null, focused: true }]);
  });
});
