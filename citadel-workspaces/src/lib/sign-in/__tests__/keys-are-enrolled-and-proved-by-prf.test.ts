// @vitest-environment node
/**
 * A key is enrolled by the server and proved by its PRF output, never by a
 * signature, and one that cannot give a PRF output is refused with the reason.
 *
 * Doubled: the agent (fake-agent.ts) and the authenticator (passkey fakes) --
 * the socket and navigator.credentials. The challenge watch, the answer, the
 * management request and the enrolment run for real.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PasskeyError } from '@/lib/passkey/authenticator';
import { addSecurityKey } from '../enrol-key';
import { CANCELLED_REASON, NO_PRF_REASON } from '../key-answer';
import { manageSignIn, SignInManagementError } from '../management';
import { openChallenges, watchKeyChallenges } from '../challenge-watch';
import type { FakeAccount } from './fake-agent';
import { eventEmitter } from '@/lib/event-emitter';
import { variants, world, type World } from './helpers';

let w: World;
afterEach(() => w.stop());

const PASSWORD_STEP_UP: { password: number[]; security_key: boolean } =
  { password: Array.from(new TextEncoder().encode('correct horse battery')), security_key: true };

async function enrolled(account: FakeAccount): Promise<number> {
  return (await addSecurityKey(w.deps, {
    account: { tenant: 'bench.work.avarok.net', cid: account.cid, username: account.username },
    label: 'YubiKey', existingCredentialIds: [],
  }, PASSWORD_STEP_UP)).id;
}

describe('adding a security key', () => {
  it('is enrolled with the PRF output the Enrol challenge asked for', async () => {
    w = world(true);
    const alice: FakeAccount = w.agent.account('alice');
    const id: number = await enrolled(alice);
    expect(alice.keys.map((k) => [k.id, k.label])).toEqual([[id, 'YubiKey']]);
    expect(variants(w)).toEqual(['SignInManagement', 'SecurityKeyAnswer']);
    // The answer carries the PRF output and the credential id, and nothing a signature check would need.
    const answer: Record<string, unknown> = w.agent.sent[1][1];
    expect(Object.keys(answer).sort()).toEqual(['challenge_id', 'credential_id', 'prf_output', 'request_id']);
    expect((answer.prf_output as number[]).length).toBe(32);
  });

  it('refuses a key without PRF before the agent hears of it', async () => {
    w = world(true);
    const alice: FakeAccount = w.agent.account('alice');
    w.authenticator.prfMode = 'none';
    await expect(enrolled(alice)).rejects.toEqual(new PasskeyError('unsupported'));
    expect(w.agent.sent).toEqual([]);
    expect(w.authenticator.signalled).toHaveLength(1);
  });

  it('shows the server refusing it, word for word', async () => {
    w = world(true);
    const alice: FakeAccount = w.agent.account('alice', 'KeyOnly');
    await expect(enrolled(alice)).rejects.toEqual(new SignInManagementError('A step-up proof is required'));
  });
});

describe('answering a challenge', () => {
  it('declines, with the reason, a key that gives no PRF output at sign-in', async () => {
    w = world(true);
    const alice: FakeAccount = w.agent.account('alice');
    await enrolled(alice);
    alice.policy = 'PasswordAndKey';
    w.authenticator.prfMode = 'none';
    await expect(manageSignIn(w.deps.send, alice.cid, 'RegenerateRecoveryCodes', PASSWORD_STEP_UP))
      .rejects.toEqual(new SignInManagementError(NO_PRF_REASON));
    expect(variants(w).slice(-2)).toEqual(['SignInManagement', 'SecurityKeyDecline']);
  });

  it('declines as cancelled when the user dismisses the prompt', async () => {
    w = world(true);
    const alice: FakeAccount = w.agent.account('alice');
    await enrolled(alice);
    alice.policy = 'PasswordAndKey';
    w.authenticator.cancelNext = true;
    await expect(manageSignIn(w.deps.send, alice.cid, 'RegenerateRecoveryCodes', PASSWORD_STEP_UP))
      .rejects.toEqual(new SignInManagementError(CANCELLED_REASON));
  });

  it('is refused for another key\'s PRF output (the wrong key)', async () => {
    w = world(true);
    const alice: FakeAccount = w.agent.account('alice');
    await enrolled(alice);
    alice.policy = 'PasswordAndKey';
    alice.keys[0].prf = 'not-this-keys-prf';
    await expect(manageSignIn(w.deps.send, alice.cid, 'RegenerateRecoveryCodes', PASSWORD_STEP_UP))
      .rejects.toEqual(new SignInManagementError('authentication failed'));
  });
});

describe('which window shows a challenge', () => {
  it('only the one whose request asked', async () => {
    w = world(false);
    const unwatch: () => void = watchKeyChallenges('my-connect');
    const challenge = (requestId: string): Record<string, unknown> => ({ SecurityKeyChallengeNotification: {
      cid: 0n, request_id: requestId, challenge_id: `c-${requestId}`, purpose: 'SignIn',
      allowed_credential_ids: [[1]], prf_salt: [2], expires_in_ms: 60000n,
    } });
    eventEmitter.emit('websocket-message', challenge('another-windows-connect'));
    expect(openChallenges()).toEqual([]);
    eventEmitter.emit('websocket-message', challenge('my-connect'));
    expect(openChallenges().map((c) => c.request_id)).toEqual(['my-connect']);
    unwatch();
    expect(openChallenges()).toEqual([]);
  });
});
