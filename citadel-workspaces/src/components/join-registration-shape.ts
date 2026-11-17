/**
 * What the join form renders and submits with.
 *
 * Its own module because `useJoinRegistration` is at the file-length cap and
 * this is the half a reader wants first: the hook is two hundred lines of flow,
 * and its contract with the form is twelve.
 */

import type { JoinFormData } from './useJoinRegistration';
import type { ConnectStatus } from './LoadingModalConfigs';
import type { JoinFieldErrorsResult } from './join-field-errors';
import type { SignupProfileFields } from '@/lib/signup-profile';
import type { SignupConsentFields } from '@/lib/signup-consent';

export type JoinOptionalFields = SignupProfileFields & SignupConsentFields;

/** Sets one of the optional fields or agreements. */
export type OptionalFieldChange = <K extends keyof JoinOptionalFields>(field: K, value: JoinOptionalFields[K]) => void;

export interface JoinRegistration {
  formData: JoinFormData;
  isRegistering: boolean;
  showNotInitializedModal: boolean;
  showConnectModal: boolean;
  connectStatus: ConnectStatus;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** The optional fields (picture as base64 or null, email, title) and the diagnostics choice. */
  handleOptionalChange: OptionalFieldChange;
  handleBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** Per-field messages, shown only once a field has been touched or submitted. */
  fieldErrors: JoinFieldErrorsResult['fieldErrors'];
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  handleConnectModalComplete: () => void;
  handleReturnToLogin: () => void;
  /** The account's recovery codes from RegisterSuccess; empty from a server without post-quantum sign-in. */
  recoveryCodes: readonly string[];
  /** Registered, but its sign-in needs a fresh human check (the register token was spent). */
  awaitingSignIn: bigint | null;
  /** Sign in with a fresh `sign-in` token, store the session and send the optional profile. Resolves with the CID. */
  finishSignIn: (admissionToken: string) => Promise<bigint>;
}
