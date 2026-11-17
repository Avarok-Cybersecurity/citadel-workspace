import { ServerConnect } from "@/components/ServerConnect";
import { SecurityAndProfileSteps } from "@/components/SecurityAndProfileSteps";
import { Login } from "@/components/Login";
import type { RegistrationChoices } from "@/components/registration-choices";

/**
 * The registration and login overlays, by step.
 *
 * Split out of `Landing.tsx` when that file - already carrying a length
 * exemption - grew past it again. An exact piecewise move: the markup is
 * unchanged and every value it uses arrives as a prop, so this decides nothing
 * that the page did not decide before.
 */
export interface LandingStepsProps {
  currentStep: 'none' | 'server' | 'security' | 'join' | 'login';
  setCurrentStep: (step: 'none' | 'server' | 'security' | 'join' | 'login') => void;
  serverAddress: string;
  serverPassword: string;
  choices: RegistrationChoices;
  handleServerNext: (address: string, password: string) => void;
  handleSecurityBack: () => void;
  handleJoinNext: (cid: string) => void;
  handleJoinBack: () => void;
  handleLoginNext: (cid: string) => void;
  /** Pre-filled by an account link; undefined for an ordinary sign-in. */
  loginUsername: string | undefined;
  /** The server an account link named: the sign-in is scoped to it. */
  loginScope: string | undefined;
}

export function LandingSteps({
  currentStep,
  setCurrentStep,
  serverAddress,
  serverPassword,
  choices,
  handleServerNext,
  handleSecurityBack,
  handleJoinNext,
  handleJoinBack,
  handleLoginNext,
  loginUsername,
  loginScope,
}: LandingStepsProps): JSX.Element {
  return (
    <>
      {currentStep === 'server' && (
        <ServerConnect
          onNext={handleServerNext}
          onCancel={() => setCurrentStep('none')}
          initialAddress={serverAddress}
          initialPassword={serverPassword}
        />
      )}
      {(currentStep === 'security' || currentStep === 'join') && (
        <SecurityAndProfileSteps
          step={currentStep}
          choices={choices}
          serverAddress={serverAddress}
          serverPassword={serverPassword}
          onSecurityBack={handleSecurityBack}
          onSecurityChosen={() => setCurrentStep('join')}
          onJoinBack={handleJoinBack}
          onJoined={handleJoinNext}
        />
      )}
      {currentStep === 'login' && (
        <Login onNext={handleLoginNext} onCancel={() => setCurrentStep('none')} initialUsername={loginUsername} scope={loginScope} />
      )}

    </>
  );
}
