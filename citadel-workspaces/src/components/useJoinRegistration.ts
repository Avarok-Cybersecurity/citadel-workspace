import { useHeldUsername } from './join/use-held-username';
import { UsernameHeldElsewhere } from '@/lib/sessions/known-accounts';
import { useState } from "react";
import { joinFieldErrors } from './join-field-errors';
import type { JoinRegistration } from './join-registration-shape';
import { focusFirstInvalidField } from './join-first-error';
import { DEFAULT_SECURITY_SETTINGS } from './security-settings-defaults';
import { useToast } from "@/hooks/use-toast";
import type { SecuritySettingsValues } from "./SecuritySettings";
import { websocketService } from "@/lib/websocket-service";
import { eventEmitter } from "@/lib/event-emitter";
import { ConnectionManager } from "@/lib/connection";
import { getUserFriendlyErrorMessage, getErrorTitle } from "@/lib/error-messages";
import { mapSecuritySettings } from "@/lib/security-utils";
import type { ConnectStatus } from "./LoadingModal";
import { debugLog } from '@/lib/debug-config';
import { createRegistrationResponseHandler } from './registration-response-handler';
import { startSignupFollowUps } from '@/lib/signup-follow-ups';
import type { SignupProfileFields } from '@/lib/signup-profile';
import type { SignupConsentFields } from '@/lib/signup-consent';
import { BLANK_JOIN_FORM } from './join-form-blank';
import { serverPasswordMismatchMessage } from '@/lib/server-password-error';
import { describeFailure } from '@/lib/failure-message';
import type { AdmissionGate } from './admission/useAdmissionGate';
import { RegisteredAwaitingSignIn } from '@/lib/admission/refusal';
import { connectAfterRegistration } from './sign-in/connect-after-registration';
import type { HostedTerms } from './use-hosted-terms';

/** The required credentials plus the optional profile fields sent after registration. */
export interface JoinFormData extends SignupProfileFields, SignupConsentFields {
  fullName: string;
  username: string;
  password: string;
  confirmPassword: string;
}

export function useJoinRegistration(
  onBack: () => void,
  /** Given the new account's CID once it exists; what follows is the caller's, as after a login. */
  onJoined: (cid: string) => void,
  serverAddress: string,
  serverPassword: string,
  /** The workspace's human check, if it asks for one: a fresh token per attempt. */
  admission: AdmissionGate,
  providedSecuritySettings: SecuritySettingsValues | undefined,
  /**
   * The profile the user has already typed, and where to keep it.
   *
   * This step unmounts when the user goes Back to security, so its state died
   * with it: stepping back to check one setting and forward again cleared the
   * name, the username and both passwords, with no warning and nothing to
   * recover them from. The address survived (it lives a step up) and the
   * security settings survived (they are lifted for the same reason), which made
   * the loss look like a glitch rather than the rule.
   */
  draft: { initial: JoinFormData; onChange: (next: JoinFormData) => void } | undefined,
  /** Avarok's Terms of Use, asked for after the form is valid and before anything is sent. */
  terms: HostedTerms,
): JoinRegistration {
  const { toast } = useToast();
  const [isRegistering, setIsRegistering] = useState(false);
  const [showNotInitializedModal, setShowNotInitializedModal] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>("connecting");
  const [registeredCid, setRegisteredCid] = useState<string | null>(null);
  /** Shown once by the caller, then gone: never stored, never logged. */
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>([]);
  /** Registered on a workspace that checks, and the follow-up connect still needs a fresh check. */
  const [awaitingSignIn, setAwaitingSignIn] = useState<bigint | null>(null);

  const [formData, setFormData] = useState<JoinFormData>(
    draft?.initial ?? BLANK_JOIN_FORM,
  );

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const focusFirstProblem = (): void => focusFirstInvalidField(formData, rawErrors);

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>): void => {
    setTouched((prev) => ({ ...prev, [e.target.name]: true }));
  };

  const held: string | null = useHeldUsername(formData.username, serverAddress);
  const { rawErrors, fieldErrors } = joinFieldErrors(formData, touched, submitAttempted, held);

  // Passed in, not read from the query cache.
  //
  // It used to be `queryClient.getQueryData(['securitySettings'])`, and nothing
  // anywhere observes that key — no useQuery for it exists. An unobserved cache
  // entry is garbage-collected after React Query's default five-minute gcTime,
  // so a user who raised their security level and then spent five minutes on
  // the profile step (a password manager, a Back and a Next) registered with
  // the defaults instead, permanently, with nothing said. Landing already
  // lifted the server address out of the cache for exactly this reason and did
  // not carry the fix here.
  const securitySettings: SecuritySettingsValues | { readonly securityLevel: "Standard"; readonly secrecyMode: "BestEffort"; readonly encryptionAlgorithm: "AES_GCM_256"; readonly kemAlgorithm: "MlKem"; readonly sigAlgorithm: "None"; readonly headerObfuscatorSettings: {}; readonly enrolPasskey: false; } = providedSecuritySettings ?? DEFAULT_SECURITY_SETTINGS;

  const setField = <K extends keyof JoinFormData>(name: K, value: JoinFormData[K]): void => {
    setFormData(prev => {
      const next: JoinFormData = { ...prev, [name]: value };
      // Reported up as it is typed, so a step back does not take it with it.
      draft?.onChange(next);
      return next;
    });
  };
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void =>
    setField(e.target.name as Exclude<keyof JoinFormData, 'avatarData' | keyof SignupConsentFields>, e.target.value);

  const handleConnectSuccess = async (
    data: Record<string, unknown>,
    resolve: (value: { cid: string }) => void,
    reject: (reason: Error) => void
  ): Promise<void> => {
    debugLog('Join', 'ConnectSuccess CID:', (data.cid as bigint | undefined)?.toString());
    try {
      await ConnectionManager.getInstance().handleAuthSuccess({
        username: formData.username,
        fullName: formData.fullName, serverAddress: serverAddress,
        securitySettings: mapSecuritySettings(securitySettings),
        cid: data.cid as bigint,
      });
      resolve({ cid: String(data.cid) });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    setSubmitAttempted(true);

    // Refused submits are reported by the FIELD (inline, announced, focused), not also by a toast.
    const missingField: boolean =
      !formData.fullName || !formData.username || !formData.password || !formData.confirmPassword;
    const firstError: string | null =
      rawErrors.fullName ?? rawErrors.username ?? rawErrors.password ?? rawErrors.confirmPassword;
    if (missingField || firstError) {
      focusFirstProblem();
      return;
    }
    if (terms.required && !(await terms.ask())) return; // Cancelled: nothing has been sent.
    const admissionToken: string | null | 'missing' = admission.take();
    if (admissionToken === 'missing') return;

    setIsRegistering(true);
    setShowConnectModal(true);
    setConnectStatus("connecting");

    try {
      debugLog('Join', "Registering user:", formData.username, "to", serverAddress);
      const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();

      const responsePromise: Promise<{ cid: string; }> = new Promise<{ cid: string }>((resolve, reject): void => {
        let handler: ((raw: unknown) => void) | null = null;

        const timeout: NodeJS.Timeout = setTimeout((): void => {
          if (handler) eventEmitter.off('websocket-message', handler);
          reject(new Error('Registration timed out after 30 seconds'));
        }, 30000);

        const cleanup = (): void => {
          clearTimeout(timeout);
          if (handler) eventEmitter.off('websocket-message', handler);
        };

        handler = createRegistrationResponseHandler(requestId, resolve, reject, cleanup, {
          handleConnectSuccess, setShowNotInitializedModal, onRecoveryCodes: setRecoveryCodes, username: formData.username,
        });
        eventEmitter.on('websocket-message', handler);
      });

      await websocketService.register(
        requestId, formData.username, formData.password, formData.fullName,
        serverAddress, admissionToken, serverPassword || "",
        mapSecuritySettings(securitySettings)
      );

      debugLog('Join', 'Registration request sent with ID:', requestId);
      setConnectStatus("authenticating");

      const response: { cid: string; } = await responsePromise;
      // No "loading" step: it was set here and replaced two statements later,
      // so the "Fetching your workspace data..." bar described work that had
      // already finished and was visible for a single frame.
      debugLog('Join', "Register Response:", response);
      // After, never instead: the account exists whatever happens to these.
      startSignupFollowUps({ ...formData, termsAccepted: terms.required || formData.termsAccepted });

      toast({ title: "Registration Successful", description: "Your account has been registered. Connecting to workspace...", variant: "default" });
      setRegisteredCid(response.cid);
      setConnectStatus("ready");
    } catch (error: unknown) {
      debugLog('Join', 'Registration Error:', error);
      setShowConnectModal(false);
      if (error instanceof RegisteredAwaitingSignIn) { setAwaitingSignIn(error.cid); return; } // Not a failure: see PostRegistrationSteps.
      if (admission.settle(error)) return; // Shown on the human check itself.
      if (error instanceof UsernameHeldElsewhere) { toast({ title: 'Username already on this device', description: error.message, variant: 'destructive' }); return; }
      const wrongServerPassword: string | null = serverPasswordMismatchMessage(describeFailure(error, ''), Boolean(serverPassword));
      toast({ title: wrongServerPassword ? 'Wrong server password' : getErrorTitle(error), description: wrongServerPassword ?? getUserFriendlyErrorMessage(error), variant: "destructive" });
    } finally {
      setIsRegistering(false);
    }
  };

  // The caller's, not a navigate to /workspace: the switcher is already there, so its wizard stayed up.
  const handleConnectModalComplete = (): void => {
    setShowConnectModal(false);
    if (registeredCid !== null) onJoined(registeredCid);
  };

  const handleReturnToLogin = (): void => {
    setShowNotInitializedModal(false);
    onBack();
  };

  return {
    formData,
    isRegistering,
    showNotInitializedModal,
    showConnectModal,
    connectStatus,
    handleInputChange,
    // Sound: JoinFormData extends both field sets, so the keys agree; tsc cannot see it through the generic.
    handleOptionalChange: setField as JoinRegistration['handleOptionalChange'],
    handleBlur,
    fieldErrors,
    handleSubmit,
    handleConnectModalComplete,
    handleReturnToLogin,
    recoveryCodes,
    awaitingSignIn,
    finishSignIn: async (admissionToken: string): Promise<bigint> => {
      const cid: bigint = await connectAfterRegistration(formData.username, serverAddress, formData.password, admissionToken, mapSecuritySettings(securitySettings));
      await new Promise<void>((done, fail) => { void handleConnectSuccess({ cid }, (): void => done(), fail); });
      startSignupFollowUps({ ...formData, termsAccepted: terms.required || formData.termsAccepted });
      return cid;
    },
  };
}
