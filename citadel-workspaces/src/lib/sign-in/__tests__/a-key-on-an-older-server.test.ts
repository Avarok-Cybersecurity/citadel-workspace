// @vitest-environment node
/**
 * A workspace server at protocol 0.12.2 names no relying party and cannot
 * enrol a key whose credential this page creates. Its keys still sign in,
 * under this page's own relying party as every page used then; adding one is
 * refused before anything is made, and said as "the server must be updated".
 *
 * Doubled at the I/O seams only: the agent (fake-agent.ts) and the
 * authenticator (passkey fakes).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { keyFailureCopy, SERVER_CANNOT_ENROL_KEYS } from '../copy';
import { manageSignIn, SignInManagementError } from '../management';
import { addSecurityKey } from '../enrol-key';
import { FAKE_RP_ID } from './fake-ceremony';
import type { FakeAccount } from './fake-agent';
import { enrolKey, world, type World } from './helpers';

let w: World;
afterEach(() => w.stop());

const STEP_UP: { password: number[]; security_key: boolean } =
  { password: Array.from(new TextEncoder().encode('correct horse battery')), security_key: true };

describe('a server at 0.12.2', () => {
  it('refuses adding a key, before any is made, as a server that must be updated', async () => {
    w = world(true);
    const alice: FakeAccount = w.agent.account('alice');
    w.agent.serverAt0122 = true;
    const failure: unknown = await addSecurityKey(w.deps, {
      account: { tenant: 'bench.work.avarok.net', cid: alice.cid, username: 'alice' }, label: 'YubiKey',
    }, STEP_UP).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SignInManagementError);
    expect((failure as SignInManagementError).reason).toBe('server_cannot_enrol_security_keys');
    expect(keyFailureCopy(failure)).toBe(SERVER_CANNOT_ENROL_KEYS);
    expect(w.authenticator.createCalls).toEqual([]);
    expect(alice.keys).toEqual([]);
  });

  it('asks its keys under this page\'s relying party, which names none', async () => {
    w = world(true);
    const alice: FakeAccount = w.agent.account('alice');
    await enrolKey(w, alice);
    w.agent.serverAt0122 = true;
    w.deps.rpId = 'localhost';
    alice.policy = 'PasswordAndKey';
    await manageSignIn(w.deps.send, alice.cid, 'RegenerateRecoveryCodes', STEP_UP);
    // One get() per ceremony: the enrolment's, under the relying party the server named, then the
    // step-up's, under this page's because a 0.12.2 server names none.
    const asked: string[] = w.authenticator.getCalls.map((g) => g.rpId);
    expect(asked).toEqual([FAKE_RP_ID, 'localhost']);
  });

  it('any other refusal reads in the agent\'s own words', () => {
    expect(keyFailureCopy(new SignInManagementError('Session 7 not found', null))).toBe('Session 7 not found');
  });
});
