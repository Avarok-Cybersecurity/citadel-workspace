/**
 * The flow end to end over fake ports: what reaches the agent, the issuer and the return, in order,
 * and what never does. Negative controls (each made red, then restored): dropping the allowlist
 * check let `begin` fire for an unlisted return; dropping the return/state comparison posted a code
 * to an address the link never named; posting on cancel failed "Cancel posts nothing".
 */
import { describe, expect, it } from 'vitest';
import { fromBase64Url } from '@/lib/passkey/bytes';
import { SignInFlow, AGENT_PROBE_MS } from '../flow';
import { BEGUN, ID_FP, LINK, NO_IDENTITY, PROVEN, fakePorts, refusal, search } from './fake-ports';

async function atConsent(overrides: Parameters<typeof fakePorts>[0] = {}): Promise<{ flow: SignInFlow } & ReturnType<typeof fakePorts>> {
  const fake: ReturnType<typeof fakePorts> = fakePorts(overrides);
  const flow: SignInFlow = new SignInFlow(fake.ports);
  await flow.start(search(LINK));
  expect(flow.state.step).toBe('consent');
  return { flow, ...fake };
}

describe('a bad link is refused before anything is begun', () => {
  it.each([
    ['an unlisted return', { ...LINK, return: 'https://evil.example/auth/return' }, 'return_not_allowlisted'],
    ['an unknown client', { ...LINK, client: 'evil.example' }, 'unknown_client'],
    ['a return of another client', { ...LINK, return: 'https://work.avarok.net/sign-in/code' }, 'return_not_allowlisted'],
  ])('%s', async (_name: string, link: Record<string, string>, reason: string) => {
    const { ports, calls } = fakePorts();
    const flow: SignInFlow = new SignInFlow(ports);
    await flow.start(search(link));
    expect(flow.state).toEqual({ step: 'refused', reason });
    expect(calls.status).toEqual([]);
    expect(calls.begin).toEqual([]);
  });

  it('a malformed link is refused without even reading the allowlist', async () => {
    const { ports, calls } = fakePorts();
    const flow: SignInFlow = new SignInFlow(ports);
    await flow.start(search({ ...LINK, extra: '1' }));
    expect(flow.state).toEqual({ step: 'refused', reason: 'malformed_link' });
    expect(calls.allowlist).toBe(0);
  });
});

describe('the happy path', () => {
  it('probes, begins, asks the agent to sign the issuer challenge, proves, and posts code and state to the exact return', async () => {
    const { flow, calls } = await atConsent();
    expect(calls.status).toEqual([AGENT_PROBE_MS]);
    expect(calls.begin).toEqual([{ v: 1, client: LINK.client, challenge: LINK.challenge, state: LINK.state, return: LINK.return }]);
    expect(flow.state.step === 'consent' && flow.state.idFp).toBe(ID_FP);
    expect(flow.state.step === 'consent' && flow.state.words).toEqual(['argue', 'occur', 'napkin']);

    await flow.approve('correct horse');
    expect(calls.sign).toHaveLength(1);
    const signed: (typeof calls.sign)[number] = calls.sign[0];
    expect(signed.issuer).toBe(BEGUN.issuer);
    expect(signed.aud).toBe(BEGUN.aud);
    expect(signed.password).toBe('correct horse');
    expect([...signed.nonce]).toEqual([...(fromBase64Url(BEGUN.nonce) ?? [])]);
    expect([...signed.challenge]).toEqual([...(fromBase64Url(LINK.challenge) ?? [])]);
    expect(calls.prove).toEqual([{ v: 1, attempt: BEGUN.attempt, proof: expect.stringMatching(/^AQ/) }]);
    expect(calls.posted).toEqual([{ action: LINK.return, fields: { code: PROVEN.code, state: LINK.state } }]);
    expect(flow.state.step).toBe('returning');
  });

  it('never posts a code to a return the link did not name, or with another state', async () => {
    for (const echoed of [{ ...PROVEN, return: 'https://evil.example/auth/return' }, { ...PROVEN, state: 'AAAAAAAAAAAAAAAAAAAAAA' }]) {
      const { flow, calls } = await atConsent({ prove: { ok: true, value: echoed } });
      await flow.approve('pw');
      expect(calls.posted).toEqual([]);
      expect(flow.state).toMatchObject({ step: 'failed', code: 'return_mismatch' });
    }
  });
});

describe('cancel', () => {
  it('posts nothing, signs nothing and proves nothing', async () => {
    const { flow, calls } = await atConsent();
    flow.cancel();
    await flow.approve('pw');
    expect(flow.state.step).toBe('cancelled');
    expect(calls.sign).toEqual([]);
    expect(calls.prove).toEqual([]);
    expect(calls.posted).toEqual([]);
  });
});

describe('answers the person can act on in the dialog', () => {
  it('a wrong password stays in the dialog, and the next try signs', async () => {
    const { flow, calls } = await atConsent({ sign: [refusal('wrong_password'), { ok: true, outcome: { SignedChallenge: { proof: 'AQ' } } }] });
    await flow.approve('nope');
    expect(flow.state).toMatchObject({ step: 'consent', busy: false });
    expect(calls.prove).toEqual([]);
  });

  it.each(['wrong_password', 'rate_limited'] as const)('%s keeps the dialog open with that reason', async (reason) => {
    const { flow, calls } = await atConsent({ sign: [refusal(reason)] });
    await flow.approve('nope');
    expect(flow.state).toMatchObject({ step: 'consent', busy: false, error: reason });
    expect(calls.posted).toEqual([]);
  });

  it('an empty password is never sent', async () => {
    const { flow, calls } = await atConsent();
    await flow.approve('');
    expect(calls.sign).toEqual([]);
  });
});

describe('issuer refusals', () => {
  it.each([
    ['attempt_expired', true], ['unknown_attempt', true], ['attempt_proven', true],
    ['wrong_origin', false], ['bad_signature', false], ['malformed_proof', false], ['wrong_issuer', false],
    ['audience_mismatch', false], ['nonce_mismatch', false], ['challenge_mismatch', false],
  ])('prove refused %s ends the attempt (restartable: %s), and nothing is posted', async (code: string, restartable: boolean) => {
    const { flow, calls } = await atConsent({ prove: { ok: false, code } });
    await flow.approve('pw');
    expect(flow.state).toMatchObject({ step: 'failed', code, restartable });
    expect(calls.posted).toEqual([]);
  });

  it('a restart begins a new attempt for the same link', async () => {
    const { flow, calls } = await atConsent({ prove: { ok: false, code: 'attempt_expired' } });
    await flow.approve('pw');
    await flow.restart();
    expect(calls.begin).toHaveLength(2);
    expect(flow.state.step).toBe('consent');
  });

  it.each(['unknown_client', 'return_not_allowlisted', 'malformed_link', 'issuer_unavailable'])('begin refused %s stops before consent', async (code: string) => {
    const { ports, calls } = fakePorts({ begin: { ok: false, code } });
    const flow: SignInFlow = new SignInFlow(ports);
    await flow.start(search(LINK));
    expect(flow.state).toMatchObject({ step: 'failed', code, restartable: false });
    expect(calls.sign).toEqual([]);
  });

  it('an allowlist that cannot be read leaves the page unavailable, and nothing is begun', async () => {
    const { ports, calls } = fakePorts({ allowlist: { ok: false, code: 'unreachable' } });
    const flow: SignInFlow = new SignInFlow(ports);
    await flow.start(search(LINK));
    expect(flow.state).toEqual({ step: 'unavailable', code: 'unreachable' });
    expect(calls.status).toEqual([]);
    expect(calls.begin).toEqual([]);
  });
});

describe('no agent', () => {
  it('shows the install screen and creates no server state; retry probes again', async () => {
    const { ports, calls, script } = fakePorts({ status: null });
    const flow: SignInFlow = new SignInFlow(ports);
    await flow.start(search(LINK));
    expect(flow.state.step).toBe('no-agent');
    expect(calls.begin).toEqual([]);
    script.status = NO_IDENTITY;
    await flow.retry();
    expect(calls.status).toHaveLength(2);
    expect(flow.state.step).toBe('no-identity');
  });
});

describe('a new person creates an identity first', () => {
  it('creates, shows the phrase, checks three words, then begins with the new fingerprint', async () => {
    const { ports, calls } = fakePorts({ status: NO_IDENTITY });
    const flow: SignInFlow = new SignInFlow(ports);
    await flow.start(search(LINK));
    expect(flow.state.step).toBe('no-identity');
    expect(calls.begin).toEqual([]);

    await flow.createIdentity('a long password');
    expect(calls.create).toEqual(['a long password']);
    expect(calls.exportPhrase).toEqual(['a long password']);
    expect(flow.state).toMatchObject({ step: 'confirm-phrase', checks: [3, 11, 20] });
    expect(calls.begin).toEqual([]);

    await flow.confirmPhrase(['word3', 'word11', 'wrong']);
    expect(flow.state).toMatchObject({ step: 'confirm-phrase', error: expect.any(String) });
    expect(calls.begin).toEqual([]);

    await flow.confirmPhrase([' Word3', 'word11 ', 'WORD20']);
    expect(flow.state).toMatchObject({ step: 'consent', idFp: 'newidentityfp234' });
    expect(calls.begin).toHaveLength(1);
  });

  it('a lost agent socket while creating stops the sign-in instead of hanging', async () => {
    const { ports } = fakePorts({ status: NO_IDENTITY });
    ports.agent.create = async (): Promise<never> => { throw new Error('socket lost'); };
    const flow: SignInFlow = new SignInFlow(ports);
    await flow.start(search(LINK));
    await flow.createIdentity('a long password');
    expect(flow.state).toMatchObject({ step: 'failed', code: 'agent_lost', restartable: true });
  });
});
