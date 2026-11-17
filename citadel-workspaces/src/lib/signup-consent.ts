/**
 * What a new account agreed to on the wizard's Profile step: the Terms (put to the person at Join on
 * an Avarok-hosted server, so `termsAccepted` is true only there) and sharing diagnostic logs with
 * the workspace's admins (optional, off unless ticked; the server decides whether it may be on).
 *
 * The server records both, and only once the session exists, so they are sent after sign-in like
 * the profile (`signup-profile.ts`). Acceptance is recorded only for terms the user was shown:
 * the wizard shows the platform terms of `SHOWN_PLATFORM_TERMS_VERSION` and cannot show a
 * workspace's own (they need a session). When the server's current terms are anything else, no
 * acceptance is invented -- the re-acceptance prompt shows them and asks.
 */
import type { CurrentTerms } from 'citadel-workspace-client-ts';
import { SHOWN_PLATFORM_TERMS_VERSION } from '@/lib/terms/platform-terms';
import { describeFailure } from '@/lib/failure-message';

export interface SignupConsentFields {
  termsAccepted: boolean;
  shareDiagnostics: boolean;
}

export interface SignupConsentEffects {
  waitForWorkspace: () => Promise<void>;
  getTerms: () => Promise<CurrentTerms>;
  acceptTerms: (platformVersion: number, workspaceVersion: number | null) => Promise<unknown>;
  setDiagnostics: (enabled: boolean) => Promise<unknown>;
  reportFailure: (description: string) => void;
}

export const CONSENT_RETRY_HINT: string = 'You will be asked again, and can change diagnostics in Settings > Privacy.';

/** Whether the server's terms are exactly the ones the wizard showed. */
export function termsMatchWhatWasShown(terms: CurrentTerms): boolean {
  return terms.platform.version === SHOWN_PLATFORM_TERMS_VERSION && terms.workspace === null;
}

/** Never rejects: every failure is reported through `reportFailure`. */
export async function applySignupConsent(fields: SignupConsentFields, effects: SignupConsentEffects): Promise<void> {
  if (!fields.termsAccepted && !fields.shareDiagnostics) return;
  try {
    await effects.waitForWorkspace();
    if (fields.termsAccepted) {
      const terms: CurrentTerms = await effects.getTerms();
      if (!termsMatchWhatWasShown(terms)) return;
      await effects.acceptTerms(terms.platform.version, null);
    }
    if (fields.shareDiagnostics) await effects.setDiagnostics(true);
  } catch (error: unknown) {
    const reason: string = describeFailure(error, 'no reason was given');
    effects.reportFailure(`Your account was created, but your choices about the Terms and diagnostic logs were not saved (${reason}). ${CONSENT_RETRY_HINT}`);
  }
}
