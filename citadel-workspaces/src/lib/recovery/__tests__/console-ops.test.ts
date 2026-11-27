/**
 * The recovery console's changes, against the fake agent's console rules: each one reaches the server
 * as the SignInManagement op the SDK allows a recovery session, with no password step-up, and an
 * op a console may not make is refused rather than faked.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeAgent, type FakeAccount } from '@/lib/sign-in/__tests__/fake-agent';
import { listCredentials, regeneratePhrase, RECOVERY_STEP_UP, removeCredential, setNewPassword, setPolicy } from '../console-ops';
import { manageSignIn } from '@/lib/sign-in/management';
import { RECOVERY_ONLY } from '@/lib/sign-in/__tests__/fake-agent-recovery';

let agent: FakeAgent;
let alice: FakeAccount;
const ops = (): unknown[] => agent.sent.filter(([v]) => v === 'SignInManagement').map(([, b]) => b.op);

beforeEach(() => {
  agent = new FakeAgent();
  alice = agent.account('alice');
  alice.keys.push({ id: 11, credentialId: new Uint8Array([1, 2]), label: 'Lost key', prf: 'x' }, { id: 12, credentialId: new Uint8Array([3, 4]), label: 'Spare', prf: 'y' });
  agent.recoverySessions.add(alice.cid);
});

describe('the recovery console', () => {
  it('sets a new password with no old one, and it works at once', async () => {
    await setNewPassword(agent.send, alice.cid, 'new pass 12');
    expect(alice.password).toBe('new pass 12');
    expect(ops()).toEqual([{ SetPassword: { new_password: new TextEncoder().encode('new pass 12') } }]);
    expect(agent.sent[0][1].step_up).toEqual(RECOVERY_STEP_UP);
    expect(RECOVERY_STEP_UP.password).toBeNull();
  });

  it('lists every sign-in method, the phrase included', async () => {
    const { policy, credentials } = await listCredentials(agent.send, alice.cid);
    expect(policy).toBe('Password');
    expect(credentials.map((c) => c.kind)).toEqual(['Password', 'SecurityKey', 'SecurityKey', 'RecoveryPhrase']);
  });

  it('removes a lost key and changes the policy', async () => {
    await removeCredential(agent.send, alice.cid, 11);
    expect(alice.keys.map((k) => k.label)).toEqual(['Spare']);
    await setPolicy(agent.send, alice.cid, 'KeyOnly');
    expect(alice.policy).toBe('KeyOnly');
  });

  it('carries the server\'s refusal of a removal the policy cannot spare', async () => {
    alice.policy = 'KeyOnly';
    alice.keys.splice(0, 1);
    await expect(removeCredential(agent.send, alice.cid, 12)).rejects.toThrow(/no way to satisfy/);
    expect(alice.keys).toHaveLength(1);
  });

  it('makes a new phrase, and the old one stops working', async () => {
    const old: string[] = [...alice.phrase];
    const fresh: string[] = await regeneratePhrase(agent.send, alice.cid, RECOVERY_STEP_UP);
    expect(fresh).toHaveLength(24);
    expect(fresh).not.toEqual(old);
    expect(alice.phrase).toEqual(fresh);
  });

  it('cannot rename a key: the server refuses, and the label is unchanged', async () => {
    await expect(manageSignIn(agent.send, alice.cid, { RenameCredential: { id: 12, label: 'Mine' } }, RECOVERY_STEP_UP)).rejects.toThrow(RECOVERY_ONLY);
    expect(alice.keys[1].label).toBe('Spare');
  });

  it('says what the server did not do when it answers with another outcome', async () => {
    const send = async (request: Record<string, unknown>): Promise<void> => {
      const body: Record<string, unknown> = request.SignInManagement as Record<string, unknown>;
      const { eventEmitter } = await import('@/lib/event-emitter');
      queueMicrotask(() => eventEmitter.emit('websocket-message', { SignInManagementSuccess: { cid: body.cid, request_id: body.request_id, outcome: 'Renamed' } }));
    };
    await expect(setNewPassword(send, alice.cid, 'new pass 12')).rejects.toThrow('The server did not set the password.');
    await expect(setPolicy(send, alice.cid, 'Password')).rejects.toThrow('The server did not change how you sign in.');
  });
});
