/**
 * A second tab of this browser opening an account another tab already shows.
 *
 * It opens there too: the agent hosts the account, every tab holding the
 * session receives what is addressed to it, and none writes the store.
 *
 * Stood in: the agent socket, which answers the claim as the agent does for a
 * session this socket already holds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    claimSession: async (cid: bigint, onlyIfOrphaned: boolean): Promise<void> => {
      if (onlyIfOrphaned) throw new Error(`Session ${cid} is not orphaned`);
    },
    sendRequest: async (): Promise<void> => { throw new Error('nothing is attached here'); },
  },
}));

import { claimSessionForThisTab } from '../claim-session';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';

const ALICE: bigint = 1001n;

beforeEach(() => { instanceManager.registerInstance('the-first-tab', ALICE); });

describe('a second tab on the same account', () => {
  it('opens it too when the agent hosts the account', async () => {
    await greetAs();
    expect(await claimSessionForThisTab(ALICE)).toEqual({ status: 'already-active' });
  });

});
