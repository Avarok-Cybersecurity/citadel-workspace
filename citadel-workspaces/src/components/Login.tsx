import { CitadelLogo } from '@/components/brand/CitadelLogo';
import { useDialogOverlay } from '@/hooks/use-dialog-overlay';
import { LoginAdvancedOptions } from "./LoginAdvancedOptions";
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { ChevronLeft, Loader2, User, LogIn } from "lucide-react";
import { SecuritySettings, SecuritySettingsValues } from "./SecuritySettings";
import { useLoginHandler, type LoginHandler } from "./useLoginHandler";
import { SignInAccounts, SignInScopeLine } from "./sign-in/SignInAccounts";
import { scopeDescribedBy, scopedSubmit, useSignInScope, type SignInScope } from "./sign-in/useSignInScope";
import { usePasskeyAccounts } from "./passkey/usePasskeyAccounts";
import { PASSWORD_THEN_KEY, passkeyAction, passkeyOffer, type PasskeyAction } from "./passkey/passkey-offer";
import { LoginFactorFields } from "./LoginFactorFields";
import { AddSecurityKeyCard } from "./sign-in/AddSecurityKeyCard";
import { RecoverySessionScreen } from "./sign-in/RecoverySessionScreen";
import { useSignInHints } from "./sign-in/useSignInHints";
import { websocketService } from "@/lib/websocket-service";
import { passkeysAvailableHere } from "@/lib/passkey";
import type { SignInHint } from "@/lib/sign-in";
import { SIGN_IN_COPY } from "@/lib/sign-in/copy";
import { AdmissionCheck } from "./admission/AdmissionCheck";
import { useAdmissionGate, type AdmissionGate } from "./admission/useAdmissionGate";
import { useAccountServer } from "./admission/useAccountServer";
import { useSignInLevel } from "./security/useSignInLevel";
import { ADMISSION_ACTION } from "@/lib/admission/copy";
import { useSignedOutAccounts } from "./signed-out/use-signed-out-accounts";
import type { SignedOutAccount } from "@/types/session-types";

interface LoginProps {
  onNext: (connectionId: string) => void;
  onCancel: () => void;
  /** A username to start with (from an account link); the password is still typed. */
  initialUsername: string | undefined;
  /** Why this sign-in opened, in plain words: given only when there is something to explain. */
  notice?: string;
  /** The server this sign-in is for, when the way in knows it: rows and usernames are held to it. */
  scope?: string;
}

export function Login({ onNext, onCancel, initialUsername, notice, scope: scopedTo }: LoginProps): JSX.Element {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [showSecuritySettings, setShowSecuritySettings] = useState(false);

  // The account names its server, which only the agent knows: the check binds to it once it
  // says, and an account the server signed out is told so.
  const [accountServer, setAccountServer] = useState<string | undefined>(undefined);
  const [typed, setTyped] = useState<string>(initialUsername ?? '');
  const signedOut: SignedOutAccount[] = useSignedOutAccounts();
  const admission: AdmissionGate = useAdmissionGate(ADMISSION_ACTION.signIn, {
    serverAddress: accountServer, reauth: signedOut.some((a) => a.username === typed), accountNamed: typed !== '',
  });
  const h: LoginHandler = useLoginHandler({ onNext, initialUsername, initialServer: scopedTo ?? null, admission });
  const hints: SignInHint[] = useSignInHints();
  const knownServer: string | undefined = useAccountServer(h.username, hints);
  const signInLevel: number | undefined = useSignInLevel(h.username);
  const {
    username, setUsername, error, invalidField, loading, securitySettings, setSecuritySettings,
    handleLogin, passkey, handlePasskeyLogin, handleKeyLogin, keyOffer, recoverySession, mode,
  } = h;

  // Offered before a username is typed: option-A passkeys and this device's sign-in hints (passkey-offer.ts).
  const legacyAccounts: string[] = usePasskeyAccounts();
  const passkeyAccounts: string[] = passkeyOffer(username, mode, passkey.hasKeys, legacyAccounts, hints);
  const scope: SignInScope = useSignInScope(h.server, h.setServer, username, passkeyAccounts, hints, legacyAccounts);
  // A known server is the one the check binds to; a scoped sign-in is for that server.
  useEffect((): void => { setAccountServer(scope.server ?? knownServer); setTyped(h.username.trim()); }, [scope.server, knownServer, h.username]);
  const elsewhere: boolean = scope.typed.kind === 'elsewhere';
  const [keyNext, setKeyNext] = useState<string | null>(null);
  const signInAs = (account: string): void => {
    const action: PasskeyAction = passkeyAction(account, legacyAccounts, hints);
    if (action === 'legacy') void handlePasskeyLogin(account);
    else if (action === 'key-first') void handleKeyLogin(account);
    else { setUsername(account); setKeyNext(account); setTimeout((): void => { document.getElementById('password')?.focus(); }, 0); }
  };

  const handleSecuritySettingsComplete = (values: SecuritySettingsValues): void => {
    // The same fields; enrolment is off unless the panel turned it on (it is Login-only there).
    setSecuritySettings({ ...values, enrolPasskey: values.enrolPasskey ?? false });
    // SecuritySettings calls onComplete INSTEAD of onNext, so this is where Save closes the
    // panel; without it Save stored the values and left the user stranded on it.
    setShowSecuritySettings(false);
  };

  const { ref: dialogRef, dialogProps } = useDialogOverlay({
    label: 'Sign in',
    onDismiss: onCancel,
    // SecuritySettings brings its own dialog treatment when shown.
    enabled: !showSecuritySettings,
  });

  // Declared after the overlay's own first-field focus so it runs later: with
  // the username already known, the field left to fill is the password.
  useEffect((): void => {
    if (initialUsername) document.getElementById('password')?.focus();
  }, [initialUsername]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 p-4" ref={dialogRef} {...dialogProps}>
      {recoverySession ? (
        <Card className="bg-background border-border shadow-2xl shadow-black/40 w-full max-w-md">
          <CardContent className="pt-6">
            <RecoverySessionScreen
              account={recoverySession}
              signOut={async (): Promise<void> => { await websocketService.disconnect(recoverySession.cid); h.endRecoverySession(); }}
            />
          </CardContent>
        </Card>
      ) : keyOffer ? (
        <Card className="bg-background border-border shadow-2xl shadow-black/40 w-full max-w-md" data-testid="passkey-enrol">
          <CardContent className="pt-6">
            <AddSecurityKeyCard account={keyOffer.account} stepUp={keyOffer.stepUp} title={keyOffer.title} body={keyOffer.body} onFinished={keyOffer.finish} />
          </CardContent>
        </Card>
      ) : showSecuritySettings ? (
        <SecuritySettings
          onNext={() => setShowSecuritySettings(false)}
          onBack={() => setShowSecuritySettings(false)}
          onComplete={handleSecuritySettingsComplete}
          initialValues={{
            securityLevel: securitySettings.securityLevel,
            secrecyMode: securitySettings.secrecyMode,
            encryptionAlgorithm: securitySettings.encryptionAlgorithm,
            kemAlgorithm: securitySettings.kemAlgorithm,
            sigAlgorithm: securitySettings.sigAlgorithm,
            headerObfuscatorSettings: securitySettings.headerObfuscatorSettings,
            enrolPasskey: securitySettings.enrolPasskey,
          }}
          isFromLogin={true}
          maxSecurityLevel={signInLevel}
        />
      ) : (
        <Card className="bg-background border-border shadow-2xl shadow-black/40 w-full max-w-md">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <Button
                onClick={onCancel}
                variant="ghost"
                size="icon"
                aria-label="Back"
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary-accent/15 rounded-lg"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <div>
                <CitadelLogo variant="mark" height={30} className="mb-3" />
                <h2 className="text-xl font-bold text-foreground">Login to Workspace</h2>
                <p className="text-sm text-muted-foreground mt-0.5" data-testid={notice === undefined ? undefined : 'login-notice'}>
                  {notice ?? 'Enter your credentials to connect'}
                </p>
              </div>
            </div>
          </CardHeader>

          <form onSubmit={scopedSubmit(scope, handleLogin)}>
            <CardContent className="space-y-4 max-h-[calc(100dvh-16rem)] overflow-y-auto">
              <SignInScopeLine scope={scope} />
              {/* Username */}
              <div className="space-y-1.5">
                <label htmlFor="username" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                  Username
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="username"
                    autoComplete="username"
                    aria-invalid={invalidField === 'username' || elsewhere ? true : undefined}
                    aria-describedby={scopeDescribedBy(scope, error)}
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="bg-input border-border text-foreground pl-10 h-11 rounded-lg placeholder:text-muted-foreground focus:border-primary-accent focus:ring-1 focus:ring-ring/30 transition-all"
                  />
                </div>
              </div>

              <SignInAccounts scope={scope} onUse={signInAs} disabled={loading} />
              {keyNext !== null && keyNext === username.trim() && mode === 'password' && (
                <p className="text-sm text-muted-foreground" data-testid="login-key-next">{PASSWORD_THEN_KEY}</p>
              )}

              {/* How the account is proved: password, key alone, or recovery code */}
              <LoginFactorFields h={h} keysHere={passkeysAvailableHere()} />
              {/* No Server Address field.
                  Signing in does not need one and never did: the SDK pins the
                  server in the account's CNAC at registration, and `connect`
                  takes no address at all. The field was collected, stored as
                  metadata, and never used to reach anything -- so a user who
                  typed the wrong address still signed in to wherever their
                  account lives, and a user whose account was somewhere else
                  waited out a 30s timeout with the box on screen implying it
                  was the thing to correct. Registration still asks, because
                  that is the one moment the address is genuinely needed. */}

              <LoginAdvancedOptions
                isOpen={isAdvancedOpen}
                onToggle={() => setIsAdvancedOpen(!isAdvancedOpen)}
                onConfigureSecurity={() => setShowSecuritySettings(true)}
                securitySettings={securitySettings}
                setSecuritySettings={setSecuritySettings}
                passkey={passkey}
              />

              <AdmissionCheck gate={admission} />

              {/* Error */}
              {error && (
                <div
                  id="login-error"
                  role="alert"
                  className="flex items-center gap-2 text-destructive-emphasis text-sm p-3 bg-destructive/10 rounded-lg border border-destructive/20"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />
                  {error}
                </div>
              )}
            </CardContent>

            <CardFooter className="pt-2">
              <Button
                type="submit"
                data-testid="login-submit"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-11 rounded-lg shadow-lg shadow-primary-accent/20 transition-all gap-2"
                // Not disabled for another server's username: Enter or a press then moves to the notice's choice.
                disabled={loading}
                aria-describedby={elsewhere ? 'login-wrong-server' : undefined}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    {mode === 'recovery' ? SIGN_IN_COPY.recoverySubmit : mode === 'key' ? 'Continue with security key' : 'Sign In'}
                  </>
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}
    </div>
  );
}
