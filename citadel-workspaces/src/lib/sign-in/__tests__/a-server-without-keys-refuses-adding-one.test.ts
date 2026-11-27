// @vitest-environment node
/**
 * A workspace server that has not enabled security keys cannot enrol one: adding a key is
 * refused before any credential is made, and said as such.
 *
 * Doubled at the I/O seams only: the agent (fake-agent.ts) and the
 * authenticator (passkey fakes).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { keyFailureCopy, SERVER_CANNOT_ENROL_KEYS } from '../copy';
import { SignInManagementError } from '../management';
import { addSecurityKey } from '../enrol-key';
import type { FakeAccount } from './fake-agent';
import { world, type World } from './helpers';

let w: World;
afterEach(() => w.stop());

const STEP_UP: { password: Uint8Array; security_key: boolean } =
  { password: new TextEncoder().encode('correct horse battery'), security_key: true };

describe('a server without security keys', () => {
  it('refuses adding a key, before any is made, as a server that has not enabled them', async () => {
    w = world(true);
    const alice: FakeAccount = w.agent.account('alice');
    w.agent.keysDisabled = true;
    const failure: unknown = await addSecurityKey(w.deps, {
      account: { tenant: 'bench.work.avarok.net', cid: alice.cid, username: 'alice' }, label: 'YubiKey',
    }, STEP_UP).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SignInManagementError);
    expect((failure as SignInManagementError).reason).toBe('server_cannot_enrol_security_keys');
    expect(keyFailureCopy(failure)).toBe(SERVER_CANNOT_ENROL_KEYS);
    expect(w.authenticator.createCalls).toEqual([]);
    expect(alice.keys).toEqual([]);
  });

  it('any other refusal reads in the agent\'s own words', () => {
    expect(keyFailureCopy(new SignInManagementError('Session 7 not found', null))).toBe('Session 7 not found');
  });
});
