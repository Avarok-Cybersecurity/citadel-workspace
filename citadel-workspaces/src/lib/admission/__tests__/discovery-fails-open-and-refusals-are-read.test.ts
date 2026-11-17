// @vitest-environment node
/**
 * Discovery fails OPEN (any failure is "unknown", and the form shows as usual)
 * and refusals are read exactly. Doubled: fetch, the control-plane round trip.
 */
import { describe, expect, it } from 'vitest';
import { ADMISSION_PATH, discoverAdmission, parseAdmission } from '../discovery';
import { admissionReasonOf } from '../refusal';

const answering = (status: number, body: unknown): ((url: string) => Promise<Response>) =>
  async (): Promise<Response> => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('discovery', () => {
  it('reads the control plane\'s answer for this workspace', async () => {
    const asked: string[] = [];
    const fetchFn = async (url: string): Promise<Response> => { asked.push(url); return answering(200, { turnstile: { required: true, siteKey: '1x00000000000000000000AA' } })(url); };
    expect(await discoverAdmission(fetchFn, '/api', 'acme')).toEqual({ required: true, siteKey: '1x00000000000000000000AA' });
    expect(await discoverAdmission(fetchFn, '/api', undefined)).toEqual({ required: true, siteKey: '1x00000000000000000000AA' });
    // The workspace's own answer when its slug is known; the control plane's, without one.
    expect(asked).toEqual([`/api${ADMISSION_PATH}/acme`, `/api${ADMISSION_PATH}`]);
  });

  it('is unknown, never "not required", when it cannot be answered', async () => {
    expect(await discoverAdmission(answering(200, {}), undefined, 'acme')).toBeNull();
    expect(await discoverAdmission(answering(503, { turnstile: { required: false, siteKey: '' } }), '/api', 'acme')).toBeNull();
    expect(await discoverAdmission(answering(404, { error: 'not-found' }), '/api', 'acme')).toBeNull();
    expect(await discoverAdmission(async () => { throw new TypeError('offline'); }, '/api', undefined)).toBeNull();
    expect(await discoverAdmission(async () => new Response('<html>', { status: 200 }), '/api', 'acme')).toBeNull();
  });

  it('refuses a half-formed answer', () => {
    expect(parseAdmission({ turnstile: { required: 'yes', siteKey: 'k' } })).toBeNull();
    expect(parseAdmission({ turnstile: { required: true, siteKey: '  ' } })).toBeNull();
    expect(parseAdmission({ turnstile: { required: false, siteKey: '' } })).toEqual({ required: false, siteKey: '' });
  });
});

describe('refusals', () => {
  it('names only the two admission reasons', () => {
    expect(admissionReasonOf({ reason_code: 'admission_required' })).toBe('admission_required');
    expect(admissionReasonOf({ reason_code: 'admission_failed' })).toBe('admission_failed');
    expect(admissionReasonOf({ reason_code: 'bad_password' })).toBeNull();
    expect(admissionReasonOf({ message: 'admission_required' })).toBeNull();
  });
});
