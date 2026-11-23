/**
 * A session that could not come back because of its resume credential is sent to that
 * account's sign-in with the reason that applies: its time ran out, or the account's sign-in
 * changed. Neither is the plain "could not reconnect", and neither is the service's failure.
 *
 * Control: drop the two codes from `LINK_REASONS` (types/agent-reconnect.ts), and both read as
 * a give-up with no reason.
 */
import { describe, expect, it } from 'vitest';
import { handleServerReconnectEvent, signInAfterLoss, type OwnSession, type ServerReconnectIO } from '../server-reconnect';
import { readAgentReconnectEvent, type AgentReconnectEvent } from '@/types/agent-reconnect';
import { parseAccountLink } from '@/lib/onboarding/account-link';
import { RESUME_ENDED_COPY } from '@/lib/resume/copy';
import type { Outage } from '../outage';

const OWN: OwnSession = { cid: 42n, username: 'alice', server: 'acme.example' };

function failed(reasonCode: string): unknown {
  return { ServerReconnectFailed: { cid: 42n, reason: 'the server refused the reconnect', request_id: null, reason_code: reasonCode } };
}

async function after(message: unknown): Promise<{ signIns: Array<[string, string]>; pages: Outage[] }> {
  const signIns: Array<[string, string]> = [];
  const pages: Outage[] = [];
  const io: ServerReconnectIO = {
    ownSession: async (): Promise<OwnSession | null> => OWN,
    setReconnecting: (): void => undefined,
    resumePeers: async (): Promise<void> => undefined,
    reloadWorkspace: async (): Promise<void> => undefined,
    signInAgain: (path: string, text: string): void => { signIns.push([path, text]); },
    outage: { begin: (): void => undefined, now: (next: Outage): void => { pages.push(next); }, end: (): void => undefined },
  };
  const event: AgentReconnectEvent | null = readAgentReconnectEvent(message);
  if (event === null) throw new Error('not a reconnect event');
  await handleServerReconnectEvent(event, io);
  return { signIns, pages };
}

describe('a reconnect the server refused over the resume credential', () => {
  for (const code of ['resume_credential_expired', 'resume_credential_revoked'] as const) {
    it(`${code}: goes to that account’s sign-in with its own words, not the outage page`, async () => {
      const { signIns, pages } = await after(failed(code));
      expect(pages).toEqual([]);
      expect(signIns).toHaveLength(1);
      const [path, message] = signIns[0];
      expect(parseAccountLink(new URL(path, 'https://work.example').searchParams)).toMatchObject({ username: 'alice', server: 'acme.example' });
      expect(message).toBe(RESUME_ENDED_COPY[code]('acme.example'));
    });
  }

  it('says different things for the two', () => {
    const expired: string = signInAfterLoss('alice', 'acme.example', null, 'resume_credential_expired').message;
    const revoked: string = signInAfterLoss('alice', 'acme.example', null, 'resume_credential_revoked').message;
    expect(expired).not.toBe(revoked);
    expect(expired).toMatch(/run out/);
    expect(revoked).toMatch(/changed/);
  });
});
