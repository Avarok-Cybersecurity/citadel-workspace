/**
 * The Terms and diagnostics choices of a new account: Terms are accepted only if they were put to
 * the person, diagnostics go out only when ticked, and acceptance is recorded only for the terms that were
 * shown. Doubled: the five effects (wire, wait, toast); the rules are production.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CurrentTerms } from 'citadel-workspace-client-ts';
import { applySignupConsent, type SignupConsentEffects } from '../signup-consent';
import { SHOWN_PLATFORM_TERMS_VERSION } from '../terms/platform-terms';

const TERMS: CurrentTerms = { platform: { version: SHOWN_PLATFORM_TERMS_VERSION, text: 't' }, workspace: null };

type RecordedEffects = SignupConsentEffects & { calls: string[] };

function effects(terms: CurrentTerms = TERMS): RecordedEffects {
  const calls: string[] = [];
  return {
    calls,
    waitForWorkspace: vi.fn(async () => { calls.push('wait'); }),
    getTerms: vi.fn(async () => { calls.push('getTerms'); return terms; }),
    acceptTerms: vi.fn(async (p: number, w: number | null) => { calls.push(`accept ${p} ${w}`); }),
    setDiagnostics: vi.fn(async (on: boolean) => { calls.push(`diagnostics ${on}`); }),
    reportFailure: vi.fn(),
  };
}

describe('applySignupConsent', () => {
  it('sends nothing when neither the Terms nor diagnostics were chosen', async () => {
    const e: RecordedEffects = effects();
    await applySignupConsent({ termsAccepted: false, shareDiagnostics: false }, e);
    expect(e.calls).toEqual([]);
  });

  it('on a server whose Terms were never put to the person, diagnostics alone are asked for and no terms are accepted', async () => {
    const e: RecordedEffects = effects();
    await applySignupConsent({ termsAccepted: false, shareDiagnostics: true }, e);
    expect(e.calls).toEqual(['wait', 'diagnostics true']);
    expect(e.acceptTerms).not.toHaveBeenCalled();
  });

  it('accepts the shown terms and leaves diagnostics off by default', async () => {
    const e: RecordedEffects = effects();
    await applySignupConsent({ termsAccepted: true, shareDiagnostics: false }, e);
    expect(e.calls).toEqual(['wait', 'getTerms', `accept ${SHOWN_PLATFORM_TERMS_VERSION} null`]);
    expect(e.setDiagnostics).not.toHaveBeenCalled();
  });

  it('turns diagnostics on, after the acceptance it depends on, only when ticked', async () => {
    const e: RecordedEffects = effects();
    await applySignupConsent({ termsAccepted: true, shareDiagnostics: true }, e);
    expect(e.calls.slice(-2)).toEqual([`accept ${SHOWN_PLATFORM_TERMS_VERSION} null`, 'diagnostics true']);
  });

  it('does not accept terms it never showed: a newer platform version or workspace terms', async () => {
    for (const terms of [
      { platform: { version: SHOWN_PLATFORM_TERMS_VERSION + 1, text: 'new' }, workspace: null },
      { platform: TERMS.platform, workspace: { version: 1, text: 'ours' } },
    ] as CurrentTerms[]) {
      const e: RecordedEffects = effects(terms);
      await applySignupConsent({ termsAccepted: true, shareDiagnostics: true }, e);
      expect(e.acceptTerms).not.toHaveBeenCalled();
      expect(e.setDiagnostics).not.toHaveBeenCalled();
      expect(e.reportFailure).not.toHaveBeenCalled();
    }
  });

  it('reports a refusal instead of throwing', async () => {
    const e: RecordedEffects = effects();
    e.acceptTerms = vi.fn(async () => { throw new Error('Terms version is not current'); });
    await applySignupConsent({ termsAccepted: true, shareDiagnostics: true }, e);
    expect(e.reportFailure).toHaveBeenCalledWith(expect.stringContaining('Terms version is not current'));
    expect(e.setDiagnostics).not.toHaveBeenCalled();
  });
});
