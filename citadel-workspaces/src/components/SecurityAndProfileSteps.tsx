import { SecuritySettings, type SecuritySettingsValues } from './SecuritySettings';
import { Join } from './Join';
import type { RegistrationChoices } from './registration-choices';

/**
 * The security and profile steps of a registration wizard, wired to each other.
 *
 * The one place where "the security the user chose" becomes "the security the
 * account is registered with". Landing and the workspace switcher each wired
 * `SecuritySettings` and `Join` themselves, and the switcher's copy passed
 * neither `onComplete` nor `securitySettings`: an account added there at "High"
 * was registered at the defaults, silently. Callers now say only where each
 * step leads; they cannot drop the settings on the way.
 */
export interface SecurityAndProfileStepsProps {
  step: 'security' | 'join';
  choices: RegistrationChoices;
  serverAddress: string;
  serverPassword: string;
  defaultWorkspace?: string;
  onSecurityBack: () => void;
  onSecurityChosen: () => void;
  onJoinBack: () => void;
  onJoined: (cid: string) => void;
}

export function SecurityAndProfileSteps({
  step,
  choices,
  serverAddress,
  serverPassword,
  defaultWorkspace,
  onSecurityBack,
  onSecurityChosen,
  onJoinBack,
  onJoined,
}: SecurityAndProfileStepsProps): JSX.Element {
  if (step === 'security') {
    return (
      <SecuritySettings
        onNext={onSecurityChosen}
        onBack={onSecurityBack}
        onComplete={(chosen: SecuritySettingsValues): void => {
          choices.setSecuritySettings(chosen);
          onSecurityChosen();
        }}
        initialValues={choices.securitySettings}
      />
    );
  }
  return (
    <Join
      onNext={(cid: string): void => {
        // Half of the draft is passwords: it must not outlive its registration.
        choices.clearProfileDraft();
        onJoined(cid);
      }}
      onBack={onJoinBack}
      defaultWorkspace={defaultWorkspace}
      serverAddress={serverAddress}
      serverPassword={serverPassword}
      securitySettings={choices.securitySettings}
      profileDraft={{ initial: choices.profileDraft, onChange: choices.setProfileDraft }}
    />
  );
}
