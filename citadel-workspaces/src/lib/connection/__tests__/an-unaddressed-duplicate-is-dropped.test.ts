/**
 * A saved account written without a server is dropped once the same account is saved with one.
 *
 * Older sign-ins stored `serverAddress: ""` (see session-label). Sessions are keyed by
 * username AND server, so the later, correct record sat beside the empty one: Manage
 * Accounts listed bob0924 twice (measured live), one row with no server at all.
 */
import { describe, it, expect } from 'vitest';
import { dropUnaddressedDuplicates } from '../drop-unaddressed-duplicates';
import type { StoredSession } from '@/types/session-types';

const at = (username: string, serverAddress: string): StoredSession => ({ username, serverAddress, fullName: username, lastConnected: 1 } as StoredSession);

describe('stored sessions read from the agent', () => {
  it('drop the serverless copy of an account that also has an addressed one', () => {
    const { sessions, removed } = dropUnaddressedDuplicates([at('bob', ''), at('bob', 'bench.work.avarok.net'), at('ann', 'bench.work.avarok.net')]);
    expect(sessions.map((s: StoredSession) => `${s.username}@${s.serverAddress}`)).toEqual(['bob@bench.work.avarok.net', 'ann@bench.work.avarok.net']);
    expect(removed).toBe(1);
  });

  it('keep a serverless record that is the only one for its account', () => {
    const { sessions, removed } = dropUnaddressedDuplicates([at('nia', ''), at('bob', 'x.example')]);
    expect(sessions).toHaveLength(2);
    expect(removed).toBe(0);
  });
});
