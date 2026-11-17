/**
 * A reconnect the workspace's verification check (Turnstile) refused. The agent cannot
 * show the check, so it gives up at once and says why in `reason_code`; the tab sends the
 * user to sign in and tells them the check is what is being asked for, instead of the
 * agent's raw text.
 */
import { describe, it, expect } from 'vitest';
import { handleServerReconnectEvent, type OwnSession, type ServerReconnectIO } from '../server-reconnect';
import { readAgentReconnectEvent, type AgentReconnectEvent } from '@/types/agent-reconnect';
import { parseAccountLink } from '@/lib/onboarding/account-link';

const OWN: OwnSession = { cid: 42n, username: 'alice', server: 'bench.work.avarok.net' };
const RAW: string = 'This workspace needs a verification check before you sign in';

async function signInsFor(wire: unknown): Promise<Array<[string, string]>> {
  const signIns: Array<[string, string]> = [];
  const io: ServerReconnectIO = {
    ownSession: async (): Promise<OwnSession | null> => OWN,
    setReconnecting: (): void => {},
    resumePeers: async (): Promise<void> => {},
    reloadWorkspace: async (): Promise<void> => {},
    signInAgain: (path: string, message: string): void => { signIns.push([path, message]); },
  };
  const event: AgentReconnectEvent | null = readAgentReconnectEvent(wire);
  expect(event).not.toBeNull();
  if (event) await handleServerReconnectEvent(event, io);
  return signIns;
}

describe('a reconnect the verification check refused', () => {
  it('reads the reason code off the wire', () => {
    expect(readAgentReconnectEvent({ ServerReconnectFailed: { cid: 42n, reason: RAW, request_id: null, reason_code: 'admission_required' } }))
      .toEqual({ kind: 'failed', cid: 42n, reason: RAW, reasonCode: 'admission_required' });
  });

  it('asks the user to sign in again and pass the check', async () => {
    const signIns: Array<[string, string]> = await signInsFor({ ServerReconnectFailed: { cid: 42n, reason: RAW, request_id: undefined, reason_code: 'admission_required' } });
    expect(signIns).toHaveLength(1);
    const [path, message] = signIns[0];
    expect(parseAccountLink(new URLSearchParams(path.slice(2)))).toEqual({ username: 'alice', server: 'bench.work.avarok.net' });
    expect(message).toBe('bench.work.avarok.net now asks for a verification check before you sign in. Sign in again and complete the check to continue.');
  });

  it('says the check refused it when the token was not accepted', async () => {
    const signIns: Array<[string, string]> = await signInsFor({ ServerReconnectFailed: { cid: 42n, reason: 'The verification check failed: timeout-or-duplicate', request_id: null, reason_code: 'admission_failed' } });
    expect(signIns[0][1]).toBe("bench.work.avarok.net's verification check did not accept the reconnect. Sign in again and complete the check to continue.");
  });

  // Negative control: the same text without the code (an older agent, or any other give-up)
  // is not mistaken for the check, and an unknown code is not trusted.
  it('without the code, or with one it does not know, says what the agent said', async () => {
    for (const reason_code of [undefined, null, 'rate_limited']) {
      const signIns: Array<[string, string]> = await signInsFor({ ServerReconnectFailed: { cid: 42n, reason: RAW, request_id: null, reason_code } });
      expect(signIns[0][1]).toBe(`Couldn't reconnect to bench.work.avarok.net (${RAW}). Sign in again to continue.`);
    }
  });
});
