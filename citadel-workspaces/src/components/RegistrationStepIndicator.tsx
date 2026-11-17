import { StepIndicator } from "@/components/ui/step-indicator";

/**
 * The one list of registration step names.
 *
 * Each wizard step used to pass its own copy, and when the connect card was
 * renamed to "Workspace" (its field is Workspace Address) the security and
 * profile cards kept "Server" -- so step one changed its name the moment the
 * user completed it. Keeping the list here means a rename reaches every step.
 */
export const REGISTRATION_STEP_LABELS: readonly string[] = ["Workspace", "Security", "Profile"];

export type RegistrationStep = 1 | 2 | 3;

export function RegistrationStepIndicator({ currentStep }: { currentStep: RegistrationStep }): JSX.Element {
  return (
    <StepIndicator
      currentStep={currentStep}
      totalSteps={REGISTRATION_STEP_LABELS.length}
      labels={[...REGISTRATION_STEP_LABELS]}
    />
  );
}
