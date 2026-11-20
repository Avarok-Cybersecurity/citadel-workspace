/**
 * The browser adapters: the issuer over a recorded fetch, the agent's answers from frames captured
 * from a real agent, and the return POST as the form it builds.
 *
 * Mock, justified: `HTMLFormElement.prototype.submit` is replaced in the return test because jsdom
 * does not implement navigation (it logs "not implemented" and does nothing); the form the adapter
 * builds is asserted as built, and the spy only records that it was submitted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpIssuer, ISSUER_PATHS } from '../issuer-http';
import { identityAnswer } from '../agent-socket';
import { formReturner } from '../return-form';
import { ALLOWLIST, BEGUN, LINK } from './fake-ports';
import type { SignInBeginRequest } from '../issuer-wire';

type Recorded = { input: string; init: RequestInit };

function fetchAnswering(status: number, body: unknown): { fetchFn: (input: string, init: RequestInit) => Promise<Response>; seen: Recorded[] } {
  const seen: Recorded[] = [];
  const fetchFn = async (input: string, init: RequestInit): Promise<Response> => {
    seen.push({ input, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchFn, seen };
}

describe('the issuer adapter', () => {
  it('POSTs the begin body as JSON to /sign-in/begin and returns the shaped answer', async () => {
    const { fetchFn, seen } = fetchAnswering(200, BEGUN);
    const body: SignInBeginRequest = { v: 1, client: LINK.client, challenge: LINK.challenge, state: LINK.state, return: LINK.return };
    expect(await httpIssuer(fetchFn).begin(body)).toEqual({ ok: true, value: BEGUN });
    expect(seen[0].input).toBe(ISSUER_PATHS.begin);
    expect(seen[0].init.method).toBe('POST');
    expect(JSON.parse(seen[0].init.body as string)).toEqual(body);
  });

  it("reads a refusal's reason code", async () => {
    const { fetchFn } = fetchAnswering(400, { error: 'attempt_expired', detail: 'this sign-in attempt has expired; start again' });
    expect(await httpIssuer(fetchFn).prove({ v: 1, attempt: BEGUN.attempt, proof: 'AQ' })).toEqual({ ok: false, code: 'attempt_expired' });
  });

  it('says unreachable when the fetch itself fails, and unexpected_answer for a body of the wrong shape', async () => {
    const down = async (): Promise<Response> => { throw new TypeError('Failed to fetch'); };
    expect(await httpIssuer(down).allowlist()).toEqual({ ok: false, code: 'unreachable' });
    const { fetchFn } = fetchAnswering(200, { ...ALLOWLIST, extra: true });
    expect(await httpIssuer(fetchFn).allowlist()).toEqual({ ok: false, code: 'unexpected_answer' });
  });
});

describe("the agent's answers, from captured frames", () => {
  const id: string = 'dec0912b-5466-4ee8-87ac-64ac6fc51e35';
  it('IdentitySuccess wrapped in Response', () => {
    const frame: Record<string, unknown> = JSON.parse(`{"Response":{"IdentitySuccess":{"cid":0,"request_id":"${id}","outcome":{"Status":{"state":"None"}}}}}`);
    expect(identityAnswer(frame, id)).toEqual({ ok: true, outcome: { Status: { state: 'None' } } });
  });

  it('IdentityFailure, and nothing for another request', () => {
    const frame: Record<string, unknown> = JSON.parse(`{"Response":{"IdentityFailure":{"cid":0,"request_id":"${id}","reason":"no_identity","message":"this agent holds no identity"}}}`);
    expect(identityAnswer(frame, id)).toEqual({ ok: false, reason: 'no_identity', message: 'this agent holds no identity' });
    expect(identityAnswer(frame, 'another')).toBeUndefined();
  });
});

describe('the return adapter', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('submits {code, state} form-encoded to the return, in the body and not the URL', () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    formReturner(document).post(LINK.return, { code: 'K7QM-2XRA', state: LINK.state });
    const form: HTMLFormElement | null = document.querySelector('form');
    expect(form?.method).toBe('post');
    expect(form?.action).toBe(LINK.return);
    expect(form?.enctype).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new FormData(form as HTMLFormElement))).toEqual({ code: 'K7QM-2XRA', state: LINK.state });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
