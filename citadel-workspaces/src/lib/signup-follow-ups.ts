/**
 * Everything a new account sends once its session is in the workspace: the optional profile and
 * the Terms / diagnostics choices. One call, so the two registration paths cannot drift apart.
 */
import type { SignupProfileFields } from '@/lib/signup-profile';
import { applySignupConsent, type SignupConsentFields } from '@/lib/signup-consent';
import { startSignupProfile, nextWorkspaceLoad, SIGNUP_PROFILE_WORKSPACE_WAIT_MS } from '@/lib/signup-profile-io';
import { telemetryApi } from '@/lib/telemetry/telemetry-api';
import { trackSignupConsent } from '@/lib/telemetry/signup-consent-pending';
import { toast } from '@/hooks/use-toast';
import { debugLog } from '@/lib/debug-config';

export function startSignupFollowUps(fields: SignupProfileFields & SignupConsentFields): void {
  startSignupProfile({ avatarData: fields.avatarData, email: fields.email, title: fields.title });
  trackSignupConsent(applySignupConsent(fields, {
    waitForWorkspace: () => nextWorkspaceLoad(SIGNUP_PROFILE_WORKSPACE_WAIT_MS),
    getTerms: () => telemetryApi.getTerms(),
    acceptTerms: (platform, workspace) => telemetryApi.acceptTerms(platform, workspace),
    setDiagnostics: (enabled) => telemetryApi.setConsent(enabled),
    reportFailure: (description: string): void => {
      debugLog('SignupConsent', 'Consent not saved:', description);
      toast({ title: 'Terms and diagnostics not saved', description, variant: 'destructive' });
    },
  }));
}
