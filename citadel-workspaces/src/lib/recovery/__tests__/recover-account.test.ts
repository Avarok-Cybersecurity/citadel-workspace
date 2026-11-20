/**
 * RecoverAccount end to end against the fake agent: the request on the wire, the console session it
 * opens, and every way it is refused. The port is the production message bus with the fake agent
 * in place of the WebSocket (the I/O boundary); a scripted port covers the timeout and a failed send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { getDefaultSecuritySettings } from '@/lib/security-utils';
import { FakeAgent, type FakeAccount } from '@/lib/sign-in/__tests__/fake-agent';
import { FAKE_TOKEN_PREFIX } from '@/lib/sign-in/__tests__/fake-admission';
import { ALREADY_SIGNED_IN, recoverAccount, RecoveryAdmissionRefusal, RecoveryRefusal, type RecoverRequest, type RecoveryConsoleSession } from '../recover-account';
import type { AgentPort } from '../recovery-ports';

let agent: FakeAgent;
let alice: FakeAccount;
const portOf = (a: FakeAgent): AgentPort => ({ send: a.send, listen: (h: (m: unknown) => void): (() => void) => eventEmitter.on('websocket-message', h) });
const request = (overrides: Partial<RecoverRequest>): RecoverRequest => ({
  username: ' alice ', serverAddress: ' bench.work.avarok.net ', phrase: alice.phrase.join(' '), deviceLabel: ' My Mac ',
  admissionToken: null, securitySettings: getDefaultSecuritySettings(), ...overrides,
});
const listeners = (): number => eventEmitter.listenerCount('websocket-message');

beforeEach(() => { agent = new FakeAgent(); alice = agent.account('alice'); });
afterEach(() => { vi.useRealTimers(); });

describe('recovering with the phrase', () => {
  it('sends the phrase as bytes and every field trimmed, and opens a console session', async () => {
    const before: number = listeners();
    const session: RecoveryConsoleSession = await recoverAccount(portOf(agent), request({}), 'r1', 1000);
    expect(session).toEqual({ cid: alice.cid, devicesSignedOut: false });
    const [variant, body] = agent.sent[0];
    expect(variant).toBe('RecoverAccount');
    expect(body).toMatchObject({ request_id: 'r1', username: 'alice', server_addr: 'bench.work.avarok.net', device_label: 'My Mac', admission_token: null, server_password: null });
    expect(new TextDecoder().decode(Uint8Array.from(body.phrase as number[]))).toBe(alice.phrase.join(' '));
    expect(agent.recoverySessions.has(alice.cid)).toBe(true);
    expect(listeners()).toBe(before);
  });

  it('says other devices were signed out when the account was recovered onto this device', async () => {
    alice.heldHere = false;
    expect(await recoverAccount(portOf(agent), request({}), 'r1', 1000)).toEqual({ cid: alice.cid, devicesSignedOut: true });
  });

  it('is refused alike for a wrong phrase and an unknown account, in the agent\'s words', async () => {
    const wrong: string[] = [...alice.phrase];
    wrong[0] = wrong[0] === 'zoo' ? 'abandon' : 'zoo';
    await expect(recoverAccount(portOf(agent), request({ phrase: wrong.join(' ') }), 'r1', 1000)).rejects.toEqual(new RecoveryRefusal('authentication failed', null));
    await expect(recoverAccount(portOf(agent), request({ username: 'bob' }), 'r2', 1000)).rejects.toBeInstanceOf(RecoveryRefusal);
    expect(agent.recoverySessions.size).toBe(0);
  });

  it('ignores answers to another request', async () => {
    const pending: Promise<RecoveryConsoleSession> = recoverAccount({ send: async (): Promise<void> => undefined,
      listen: (h: (m: unknown) => void): (() => void) => eventEmitter.on('websocket-message', h) }, request({}), 'mine', 1000);
    eventEmitter.emit('websocket-message', { RecoverAccountFailure: { cid: 0n, request_id: 'theirs', message: 'no' } });
    eventEmitter.emit('websocket-message', { Response: { RecoverAccountSuccess: { cid: 7n, request_id: 'mine' } } });
    eventEmitter.emit('websocket-message', { Response: { ConnectSuccess: { cid: 7n, request_id: 'mine' } } });
    await expect(pending).resolves.toEqual({ cid: 7n, devicesSignedOut: true });
  });

  it('is refused at once, with its own reason, when this device is already signed in to the account', async () => {
    const pending: Promise<RecoveryConsoleSession> = recoverAccount({ send: async (): Promise<void> => undefined,
      listen: (h: (m: unknown) => void): (() => void) => eventEmitter.on('websocket-message', h) }, request({}), 'mine', 60000);
    const before: number = listeners();
    eventEmitter.emit('websocket-message', { Response: { SessionAlreadyActive: { cid: 7n, username: 'alice', message: 'active', request_id: 'mine' } } });
    await expect(pending).rejects.toEqual(new RecoveryRefusal(ALREADY_SIGNED_IN, 'SessionAlreadyActive'));
    expect(listeners()).toBe(before - 1);
  });
});

describe('on a workspace that asks for a human check', () => {
  const SITE_KEY: '1x00000000000000000000AA' = '1x00000000000000000000AA';
  beforeEach(() => { agent.admission.required = true; alice.heldHere = false; });

  it('a recovery refused for its check is an admission refusal carrying the check it published', async () => {
    agent.admission.challenge = { provider: 'turnstile', site_key: SITE_KEY, identity: 'bench' };
    const refusal: unknown = await recoverAccount(portOf(agent), request({}), 'r1', 1000).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(RecoveryAdmissionRefusal);
    expect(refusal).toMatchObject({ reason: 'admission_required', challenge: { siteKey: SITE_KEY, identity: 'bench' }, devicesSignedOut: false });
    expect(alice.heldHere).toBe(false);
  });

  it('the sign-in after a fresh recovery, refused for its check, says the account was recovered here', async () => {
    const refusal: unknown = await recoverAccount(portOf(agent), request({ admissionToken: `${FAKE_TOKEN_PREFIX}1` }), 'r1', 1000).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(RecoveryAdmissionRefusal);
    expect(refusal).toMatchObject({ reason: 'admission_required', devicesSignedOut: true });
    // The account is held here now: the retry only signs in, with its own token.
    expect(await recoverAccount(portOf(agent), request({ admissionToken: `${FAKE_TOKEN_PREFIX}2` }), 'r2', 1000)).toEqual({ cid: alice.cid, devicesSignedOut: false });
    expect(agent.sent.map(([, b]) => b.admission_token)).toEqual([`${FAKE_TOKEN_PREFIX}1`, `${FAKE_TOKEN_PREFIX}2`]);
  });
});

describe('when the agent does not answer', () => {
  const scripted = (send: AgentPort['send']): { port: AgentPort; stopped: () => boolean } => {
    let stopped: boolean = false;
    return { port: { send, listen: (): (() => void) => (): void => { stopped = true; } }, stopped: (): boolean => stopped };
  };

  it('gives up after the timeout with a reason, and stops listening', async () => {
    vi.useFakeTimers();
    const { port, stopped } = scripted(async (): Promise<void> => undefined);
    const pending: Promise<RecoveryConsoleSession> = recoverAccount(port, request({}), 'r1', 5000);
    const caught: Promise<unknown> = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4999);
    expect(stopped()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await caught).toEqual(new RecoveryRefusal('The Citadel agent did not answer in time. Check your connection and try again.', null));
    expect(stopped()).toBe(true);
  });

  it('rejects at once when the request cannot be sent', async () => {
    const { port, stopped } = scripted(async (): Promise<void> => { throw new Error('socket closed'); });
    await expect(recoverAccount(port, request({}), 'r1', 5000)).rejects.toThrow('socket closed');
    expect(stopped()).toBe(true);
  });
});
