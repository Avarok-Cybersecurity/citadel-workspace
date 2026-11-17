/**
 * The human check on one form (sign-in or registration).
 *
 * It asks discovery on open, shows the check when the workspace requires it,
 * and hands each attempt one fresh token: Turnstile tokens are single-use, so a
 * token is taken once and the widget is reset for the next attempt whatever
 * the outcome. A server refusal overrides discovery in both directions --
 * `admission_required` reveals the check even if discovery said no (or could
 * not answer), `admission_failed` resets it with a retry message. When the
 * refusal publishes its check (a self-hosted server, which has no discovery),
 * the widget is rendered with that site key and bound to that identity.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserDiscoverAdmission, isAdmissionRefusal, type Admission, type AdmissionChallenge } from '@/lib/admission';
import { ADMISSION_COPY } from '@/lib/admission/copy';
import { hostedWorkspaceSlug } from '@/lib/onboarding/billing-portal';

export interface AdmissionContext {
  /** The workspace the form is for: discovery asks for it and the token is bound to its slug. */
  serverAddress: string | undefined;
  /** The server signed this account out (a reconnect it refused): the check says "sign in again". */
  reauth: boolean;
  /** An account is named, so a check with no workspace to bind to asks for its address. */
  accountNamed: boolean;
}

export interface AdmissionGate {
  /** The check is on screen. */
  visible: boolean;
  /** Null while unknown; with `visible`, the check cannot load until it is known. */
  siteKey: string | null;
  action: string;
  /** The workspace the token is bound to (its slug), which the server requires; null when unknown. */
  cData: string | null;
  resetSignal: number;
  message: string | null;
  onToken: (token: string | undefined) => void;
  /** This attempt's token: null when none is needed, 'missing' when the check is not done yet. */
  take: () => string | null | 'missing';
  /** After an attempt. True when the failure was an admission refusal, now shown on the check. */
  settle: (error: unknown) => boolean;
  /** Show the check without a refusal: the form already knows the workspace asks for one. */
  require: () => void;
  /** The account's workspace is unknown: the check asks for its address before it can bind. */
  needsWorkspace: boolean;
  /** What the user typed for it, and why it is not one yet (null when it is, or nothing is typed). */
  workspace: { value: string; error: string | null; set: (value: string) => void };
}

export function useAdmissionGate(action: string, context: AdmissionContext): AdmissionGate {
  const [admission, setAdmission] = useState<Admission | null>(null);
  /** The check the server's last `admission_required` refusal published: it outranks discovery. */
  const [published, setPublished] = useState<AdmissionChallenge | null>(null);
  const [forced, setForced] = useState<boolean>(false);
  const [resetSignal, setResetSignal] = useState<number>(0);
  const [message, setMessage] = useState<string | null>(null);
  const token: React.MutableRefObject<string | null> = useRef<string | null>(null);
  const [typedWorkspace, setTypedWorkspace] = useState<string>('');
  const named: string | undefined = hostedWorkspaceSlug(typedWorkspace.trim()) === undefined ? undefined : typedWorkspace.trim();
  const serverAddress: string | undefined = context.serverAddress ?? named;

  /** Ask the control plane; `onUnknown` runs when it cannot say. */
  const discover: (onUnknown: () => void) => void = useCallback((onUnknown: () => void): void => {
    browserDiscoverAdmission(serverAddress)
      .then((found: Admission | null): void => { if (found) setAdmission(found); else onUnknown(); })
      // discoverAdmission never rejects; this is the composition root failing, which is no answer either.
      .catch(onUnknown);
  }, [serverAddress]);
  // On open, an unknown answer fails open: the form is shown as usual.
  useEffect(() => { discover((): void => undefined); }, [discover]);

  const visible: boolean = forced || admission?.required === true;
  const siteKey: string | null = published?.siteKey ?? (admission?.siteKey || null);
  const cData: string | null = published?.identity ?? hostedWorkspaceSlug(serverAddress) ?? null;

  // An account the server signed out is told plainly, above anything else the check would say.
  const shown: string | null = context.reauth && visible && (message === null || message === ADMISSION_COPY.required)
    ? ADMISSION_COPY.signInAgain : message;
  const require: () => void = useCallback((): void => {
    setForced(true);
    // Required, but its site key is unknown: ask again, and say so if there is still no answer.
    if (siteKey === null) discover((): void => setMessage(ADMISSION_COPY.unavailable));
  }, [siteKey, discover]);
  // Only a workspace nobody knows: a self-hosted server's address is known and binds nothing.
  const needsWorkspace: boolean = visible && context.accountNamed && context.serverAddress === undefined && (published?.identity ?? null) === null;
  const unbound: boolean = needsWorkspace && named === undefined;
  return {
    require, needsWorkspace,
    workspace: {
      value: typedWorkspace,
      error: typedWorkspace.trim() !== '' && named === undefined ? ADMISSION_COPY.workspaceInvalid : null,
      set: setTypedWorkspace,
    },
    visible, siteKey, action, cData, resetSignal, message: shown,
    onToken: (next: string | undefined): void => {
      token.current = next ?? null;
      if (next) setMessage(null);
    },
    take: (): string | null | 'missing' => {
      if (!visible) return null;
      // Never an unbound token: the server refuses it, and the user would only be told to retry.
      if (unbound) { setMessage(ADMISSION_COPY.workspaceNeeded); return 'missing'; }
      const taken: string | null = token.current;
      if (taken === null) { setMessage(ADMISSION_COPY.completeFirst); return 'missing'; }
      // Spent by this attempt whatever happens to it.
      token.current = null;
      setResetSignal((n: number) => n + 1);
      return taken;
    },
    settle: (error: unknown): boolean => {
      if (!isAdmissionRefusal(error)) return false;
      if (error.reason === 'admission_required') {
        // A published check needs no discovery: asking would only race it with "unavailable".
        if (error.challenge) { setPublished(error.challenge); setForced(true); } else require();
        setMessage(ADMISSION_COPY.required);
      } else {
        // The widget was already reset when this attempt took its token (take above).
        setMessage(ADMISSION_COPY.failed);
      }
      return true;
    },
  };
}
