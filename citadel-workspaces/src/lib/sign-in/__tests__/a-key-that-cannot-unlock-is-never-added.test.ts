/**
 * A key whose authenticator gives no PRF output cannot derive the account's
 * post-quantum key, so it can never sign in. Live (2026-10-04, Windows): Windows
 * Hello made the passkey, reported no PRF, and the user read one sentence about
 * an "extension". It must be refused before anything is enrolled, before the
 * passkey is even made when the browser already says it has no PRF, and with a
 * reason and a next step the user can act on.
 *
 * Doubled at the I/O seams only: the agent (fake-agent.ts) and the
 * authenticator (passkey fakes), as in keys-are-enrolled-and-proved-by-prf.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PasskeyError } from '@/lib/passkey/authenticator';
import { addSecurityKey } from '../enrol-key';
import { keyFailureCopy, PRF_COPY } from '../copy';
import { world, type World } from './helpers';
import type { FakeAccount } from './fake-agent';

let w: World;
let alice: FakeAccount;
const add = (): Promise<unknown> => addSecurityKey(w.deps, {
  account: { tenant: 'bench.work.avarok.net', cid: alice.cid, username: 'alice' }, label: 'Windows Hello', existingCredentialIds: [],
}, { password: Array.from(new TextEncoder().encode(alice.password)), security_key: true });

beforeEach(() => { w = world(true); alice = w.agent.account('alice'); });
afterEach(() => w.stop());

describe('a key that cannot give PRF output', () => {
  it('is not made at all when the browser says it has no PRF', async () => {
    w.authenticator.browserHasNoPrf = true;
    await expect(add()).rejects.toEqual(new PasskeyError('unsupported'));
    expect(w.authenticator.createCalls).toEqual([]);
    expect(w.agent.sent).toEqual([]);
  });

  it('is refused after the ceremony, never enrolled, and the browser is asked to forget it', async () => {
    w.authenticator.prfMode = 'none';
    await expect(add()).rejects.toEqual(new PasskeyError('unsupported'));
    expect(w.authenticator.createCalls).toHaveLength(1);
    expect(w.authenticator.signalled).toHaveLength(1);
    expect(w.agent.sent).toEqual([]);
    expect(alice.keys).toEqual([]);
  });

  it('is explained with what happened and what to do next', () => {
    const said: string = keyFailureCopy(new PasskeyError('unsupported'));
    expect(said).toBe(PRF_COPY.notAdded);
    // What happened, that nothing was added, that the password still works, and what does work.
    expect(said).toMatch(/PRF/);
    expect(said).toMatch(/not added/i);
    expect(said).toMatch(/password still works/i);
    expect(said).toMatch(/security key/i);
    // Windows, where it was refused live: the options that work there today.
    expect(said).toMatch(/Windows 11 with the February 2026 update/);
  });
});
