/**
 * The check an admission refusal publishes (`admission_challenge`) is taken
 * only when every field is what Turnstile accepts; anything else is none.
 */
import { describe, expect, it } from 'vitest';
import { admissionChallengeOf } from '../refusal';

const of = (admission_challenge: unknown): ReturnType<typeof admissionChallengeOf> => admissionChallengeOf({ admission_challenge });

describe('a published check', () => {
  it('is read with its identity, or with none', () => {
    expect(of({ provider: 'turnstile', site_key: '0x4AAA-key_1', identity: 'acme' })).toEqual({ siteKey: '0x4AAA-key_1', identity: 'acme' });
    expect(of({ provider: 'turnstile', site_key: 'k', identity: null })).toEqual({ siteKey: 'k', identity: null });
    expect(of({ provider: 'turnstile', site_key: 'k' })).toEqual({ siteKey: 'k', identity: null });
  });

  it('is none when absent, as the WASM client and JSON each say it', () => {
    expect(of(undefined)).toBeNull();
    expect(of(null)).toBeNull();
    expect(admissionChallengeOf(undefined)).toBeNull();
  });

  it('is none for anything not exactly a Turnstile check', () => {
    for (const bad of [
      'turnstile', 7, [], {},
      { provider: 'Turnstile', site_key: 'k' },
      { provider: 'recaptcha', site_key: 'k' },
      { provider: 'turnstile', site_key: '' },
      { provider: 'turnstile', site_key: 'a b' },
      { provider: 'turnstile', site_key: 'k'.repeat(256) },
      { provider: 'turnstile', site_key: 7 },
      { provider: 'turnstile', site_key: 'k', identity: 'work.example.com' },
      { provider: 'turnstile', site_key: 'k', identity: 7 },
    ]) {
      expect(of(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
