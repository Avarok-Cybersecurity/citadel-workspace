import { useState } from "react";
import { firstFieldToFix } from '@/lib/first-field-to-fix';

/** The login form's fields, in the order they are rendered. */
const LOGIN_FIELD_ORDER: readonly ["username", "password"] = ['username', 'password'] as const;
type LoginField = (typeof LOGIN_FIELD_ORDER)[number];
import { DEFAULT_SECURITY_SETTINGS } from './security-settings-defaults';
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyErrorMessage, getErrorTitle } from "@/lib/error-messages";
import { redirectToExistingSession } from './login-session-redirect';
import { loginWithPassword, type LoginResult } from './login-with-password';
import { SignInServerRefusal } from '@/lib/sessions/sign-in-server';
import { passkeysAvailableHere } from '@/lib/passkey';
import type { SignInFactors } from '@/lib/sign-in/types';
import { finishLogin } from './sign-in/finish-login';
import { useKeyOffer, type KeyOffer } from './sign-in/useKeyOffer';
import type { AdmissionGate } from './admission/useAdmissionGate';
import type {
  SecurityLevel, SecrecyMode, EncryptionAlgorithm, KemAlgorithm, SigAlgorithm,
} from "@/types";

export interface SecuritySettingsState {
  securityLevel: SecurityLevel;
  secrecyMode: SecrecyMode;
  encryptionAlgorithm: EncryptionAlgorithm;
  kemAlgorithm: KemAlgorithm;
  sigAlgorithm: SigAlgorithm;
  headerObfuscatorSettings: Record<string, string>;
  /** Offer to add a security key after this sign-in. Replaces plaintext "Remember credentials". */
  enrolPasskey: boolean;
}

/** Password (and a key, if the account's policy asks); or a key alone. */
export type SignInMode = 'password' | 'key';

interface UseLoginHandlerParams {
  onNext: (connectionId: string) => void;
  /** The username the form starts with; undefined starts it empty. */
  initialUsername: string | undefined;
  /** The server the way in is scoped to, or null: the Connect names the server this resolves to. */
  initialServer: string | null;
  /** The workspace's human check, if it asks for one: a fresh token per attempt. */
  admission: AdmissionGate;
}

/** Everything the sign-in form renders and submits with. */
export interface LoginHandler {
  username: string;
  setUsername: React.Dispatch<React.SetStateAction<string>>;
  password: string;
  setPassword: React.Dispatch<React.SetStateAction<string>>;
  mode: SignInMode;
  setMode: (mode: SignInMode) => void;
  /** The server this sign-in is scoped to, or null (useSignInScope chooses it). */
  server: string | null;
  setServer: React.Dispatch<React.SetStateAction<string | null>>;
  error: string | null;
  loading: boolean;
  securitySettings: SecuritySettingsState;
  // The setter React gives, not a narrowed one: a caller that passes an updater
  // function is doing the ordinary thing, and narrowing this to a plain value
  // makes the hook's own state harder to use than useState's.
  setSecuritySettings: React.Dispatch<React.SetStateAction<SecuritySettingsState>>;
  handleLogin: (e: React.FormEvent) => Promise<void>;
  /** Which field to mark, so the message lands on the control it is about. */
  invalidField: LoginField | null;
  /** Sign in as `account` with a security key alone. */
  handleKeyLogin: (account: string) => Promise<void>;
  /** Set while the form is offering to add a security key after sign-in. */
  keyOffer: KeyOffer | null;
  /**
   * Sign in with a password the recovery console just set, and open the workspace: the form's own
   * password sign-in, human check included. Never rejects; a failure is shown on the form.
   */
  signInWithNewPassword: (user: string, password: string) => Promise<void>;
}

export function useLoginHandler({ onNext, initialUsername, initialServer, admission }: UseLoginHandlerParams): LoginHandler {
  const [username, setUsername] = useState(initialUsername ?? "");
  const [password, setPassword] = useState("");
  const [mode, setModeState] = useState<SignInMode>('password');
  const [server, setServer] = useState<string | null>(initialServer);
  const [error, setError] = useState<string | null>(null);
  /** The field a refused submit pointed at, so the form can mark it invalid. */
  const [invalidField, setInvalidField] = useState<LoginField | null>(null);
  const [loading, setLoading] = useState(false);
  const [securitySettings, setSecuritySettings] =
    useState<SecuritySettingsState>(DEFAULT_SECURITY_SETTINGS);

  const { toast } = useToast();

  const { offer: keyOffer, offerKey } = useKeyOffer();

  const doRedirect = (session: { cid: bigint; username: string; server_address: string }): Promise<void> =>
    redirectToExistingSession(session, { toast, onNext });

  const setMode = (next: SignInMode): void => { setModeState(next); setError(null); setInvalidField(null); };

  /**
   * Sign in with the given factors and finish. A password lives in this call's
   * scope only, including while the key offer waits; it never enters React state
   * beyond the field it was typed into.
   */
  const completeLogin = (user: string, factors: SignInFactors, opts: { offerKey: boolean }): Promise<void> => finishLogin({
    login: (name: string, f: SignInFactors): Promise<LoginResult> => loginWithPassword({ redirect: doRedirect }, name, f, securitySettings, server),
    offerKey, onNext, toast,
  }, user, factors, opts);

  const reportFailure = (err: unknown): void => {
    // A human check that was missing or failed is shown on the check itself.
    if (admission.settle(err)) return;
    if (err instanceof SignInServerRefusal) { setInvalidField('username'); setError(err.message); return; }
    setError(getUserFriendlyErrorMessage(err));
    toast({ variant: "destructive", title: getErrorTitle(err), description: getUserFriendlyErrorMessage(err) });
  };

  const begin = (): void => { setLoading(true); setError(null); setInvalidField(null); };
  /** This attempt's human-check token; false when the check is still to be done. */
  const admit = (): string | null | false => { const t: string | null | 'missing' = admission.take(); return t === 'missing' ? false : t; };

  const requireUsername = (name: string): boolean => {
    if (name) return true;
    setInvalidField('username');
    setError('Enter your username first');
    document.getElementById('username')?.focus();
    return false;
  };

  const handleKeyLogin = async (account: string): Promise<void> => {
    const name: string = account.trim();
    if (!requireUsername(name)) return;
    setUsername(name);
    const admissionToken: string | null | false = admit(); if (admissionToken === false) return;
    begin();
    try {
      await completeLogin(name, { password: null, securityKey: true, admissionToken }, { offerKey: false });
    } catch (err: unknown) {
      reportFailure(err);
    } finally {
      setLoading(false);
    }
  };

  /** A password sign-in, from the form or from the recovery console's new password. */
  const passwordLogin = async (name: string, secret: string, offerKey: boolean): Promise<void> => {
    const admissionToken: string | null | false = admit(); if (admissionToken === false) return;
    begin();
    try {
      // No pre-emptive claim on a username match: Connect goes to the server with the
      // credentials, and a live session answers SessionAlreadyActive (the redirect).
      // `securityKey`: this window can answer a PasswordAndKey account's mid-Connect touch.
      const available: boolean = passkeysAvailableHere();
      await completeLogin(name, { password: secret, securityKey: available, admissionToken }, { offerKey: offerKey && available });
    } catch (err: unknown) {
      reportFailure(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (mode === 'key') { await handleKeyLogin(username); return; }
    if (!username.trim() || !password.trim()) {
      setError("Username and password are required");
      // And take them to the field, which announcing alone does not (round 230).
      const field: "username" | "password" | null = firstFieldToFix(LOGIN_FIELD_ORDER, { username, password });
      setInvalidField(field);
      if (field) document.getElementById(field)?.focus();
      return;
    }
    await passwordLogin(username, password, securitySettings.enrolPasskey);
  };

  return {
    username, setUsername, password, setPassword, mode, setMode, server, setServer,
    error, loading, securitySettings, setSecuritySettings, handleLogin, invalidField,
    handleKeyLogin, keyOffer,
    signInWithNewPassword: (user: string, secret: string): Promise<void> => {
      // On the form, as if typed: a human check it asks for, or a failure, is answered from there.
      setMode('password'); setUsername(user); setPassword(secret);
      return passwordLogin(user, secret, false);
    },
  };
}
