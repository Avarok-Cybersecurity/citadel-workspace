import { useState } from 'react';
import type { SecuritySettingsValues } from './SecuritySettings';
import type { JoinFormData } from './useJoinRegistration';
import { DEFAULT_SECURITY_SETTINGS } from './security-settings-defaults';
import { useProfileDraft } from '@/pages/use-profile-draft';

/**
 * What a user has chosen so far in a registration wizard: the security the
 * account will be created with, and the profile they have typed.
 *
 * Held above the steps, because each step unmounts when the user moves on or
 * goes Back. `SecurityAndProfileSteps` is the only thing that reads it, so the
 * security step and the registration it configures cannot be wired apart.
 */
export interface RegistrationChoices {
  securitySettings: SecuritySettingsValues;
  setSecuritySettings: (chosen: SecuritySettingsValues) => void;
  profileDraft: JoinFormData;
  setProfileDraft: (next: JoinFormData) => void;
  clearProfileDraft: () => void;
}

export function useRegistrationChoices(): RegistrationChoices {
  const [securitySettings, setSecuritySettings] = useState<SecuritySettingsValues>(DEFAULT_SECURITY_SETTINGS);
  const { draft, setDraft, clear } = useProfileDraft();
  return {
    securitySettings,
    setSecuritySettings,
    profileDraft: draft,
    setProfileDraft: setDraft,
    clearProfileDraft: clear,
  };
}
