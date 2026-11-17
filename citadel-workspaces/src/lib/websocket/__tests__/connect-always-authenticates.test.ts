/**
 * `connect()` must always send Connect. Every time, with the credentials.
 *
 * It used to look up the agent's active sessions by USERNAME alone and, when
 * the local store held no matching CID, claim the session and return — without
 * sending anything. The password the user typed was used by nobody: not here,
 * not by the agent (whose own reuse branch did not check it either), and not by
 * the server, which was never asked.
 *
 * That is the same defect removed from `useLoginHandler` one layer up. Its
 * comment says the decision belongs where it can actually be made; this is what
 * stopped it from being made at all — the repo's own
 * fixes-that-were-never-propagated pattern, on a security check.
 *
 * It also broke the login it silently completed: the claim carries its own
 * request id, so the caller waiting on ITS id waited out 30 seconds and
 * reported a connection timeout for a login that had in fact happened.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { passwordOnly } from '@/lib/sign-in/factors';

const sendRequest: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
const claimSession: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
const disconnect: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
const getActiveSessions: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('../../connection', () => ({
  connectionManager: {
    getActiveSessions: (): unknown => getActiveSessions(),
    getStoredSessions: (): { sessions: never[]; } => ({ sessions: [] }),
  },
}));

const { AuthOperations } = await import('../auth-operations');
/** Any server: these tests are about the factors and ids, not which server is named. */
const SERVER: string = 'citadel.example.com:12349';

function operations(): InstanceType<typeof AuthOperations> {
  return new AuthOperations({
    init: vi.fn().mockResolvedValue(undefined),
    sendRequest,
    claimSession,
    disconnect,
  } as never);
}

describe('connect', () => {
  beforeEach(() => {
    sendRequest.mockClear();
    claimSession.mockClear();
    disconnect.mockClear();
    // The state that used to trigger the front-run: a live session for this
    // username that the local store does not know the CID of.
    getActiveSessions.mockResolvedValue([{ username: 'alice', cid: 42n, server_address: 'x' }]);
  });

  it('sends Connect even when a session for that username is already live', async () => {
    await operations().connect('req-1', 'alice', SERVER, passwordOnly('hunter2'));

    expect(sendRequest).toHaveBeenCalled();
  });

  it('does not claim the session behind the server’s back', async () => {
    await operations().connect('req-1', 'alice', SERVER, passwordOnly('hunter2'));

    // Claiming here is what skipped authentication entirely.
    expect(claimSession).not.toHaveBeenCalled();
  });

  it('does not tear down a live session on an unauthenticated request', async () => {
    // The other branch disconnected first — destroying a working session on the
    // strength of a request that had proved nothing but knowing a username.
    await operations().connect('req-1', 'alice', SERVER, passwordOnly('hunter2'));

    expect(disconnect).not.toHaveBeenCalled();
  });

  it('sends the password the user typed', async () => {
    // Nothing inspected the payload. Ship `password: []` from auth-operations
    // and every test in this file stayed green while every login failed --
    // the register path is checked byte-for-byte and Connect was not, which
    // is the asymmetry that let it through.
    await operations().connect('req-1', 'alice', SERVER, passwordOnly('hunter2'));

    const [request] = sendRequest.mock.calls[0] as [{ Connect: { password: number[] } }];
    expect(request.Connect.password).toEqual(Array.from(new TextEncoder().encode('hunter2')));
  });

  it('does not send an empty password for a non-empty one', async () => {
    // The specific regression: a truthy-looking payload whose credential is
    // gone. Asserting the exact bytes above would catch it, but so would a
    // rename of the field to something the server ignores -- this asserts the
    // field the SERVER reads is populated.
    await operations().connect('req-1', 'alice', SERVER, passwordOnly('hunter2'));

    const [request] = sendRequest.mock.calls[0] as [{ Connect: { password: number[] } }];
    expect(request.Connect.password.length).toBeGreaterThan(0);
  });

  it('sends the username under the name the server reads', async () => {
    await operations().connect('req-1', 'alice', SERVER, passwordOnly('hunter2'));

    const [request] = sendRequest.mock.calls[0] as [{ Connect: { username: string } }];
    expect(request.Connect.username).toBe('alice');
  });

  it('carries the security settings the user chose, not the defaults', async () => {
    // A registration's chosen posture reaching the wire as defaults was a real
    // defect one layer up (round 139); this pins the Connect half of it.
    await operations().connect('req-1', 'alice', SERVER, passwordOnly('hunter2'), {
      security_level: 'Reinforced',
      secrecy_mode: 'Perfect',
      header_obfuscator_settings: {},
      crypto_params: { encryption_algorithm: 'Kyber' },
    } as never);

    const [request] = sendRequest.mock.calls[0] as [
      { Connect: { session_security_settings: { security_level: string; secrecy_mode: string } } },
    ];
    expect(request.Connect.session_security_settings.security_level).toBe('Reinforced');
    expect(request.Connect.session_security_settings.secrecy_mode).toBe('Perfect');
  });

  it('carries the caller’s request id, so the answer can be matched', async () => {
    // The claim used its own id, so the caller's 30s wait for ConnectSuccess /
    // ConnectFailure / SessionAlreadyActive could never be satisfied.
    await operations().connect('req-1', 'alice', SERVER, passwordOnly('hunter2'));

    // The id is passed alongside the request as well as embedded in it; either
    // is enough for the caller to match its own answer.
    expect(sendRequest.mock.calls[0][1]).toBe('req-1');
  });

  it('names the server the account is on, under the name the agent reads', async () => {
    await operations().connect('req-1', 'alice', 'bench.work.avarok.net', passwordOnly('hunter2'));

    const [request] = sendRequest.mock.calls[0] as [{ Connect: { server_address: string } }];
    expect(request.Connect.server_address).toBe('bench.work.avarok.net');
  });

  it('sends nothing when no server is known: the agent would sign in whichever it holds', async () => {
    await expect(operations().connect('req-1', 'alice', ' ', passwordOnly('hunter2'))).rejects.toThrow(/No server is recorded/);
    expect(sendRequest).not.toHaveBeenCalled();
  });
});
