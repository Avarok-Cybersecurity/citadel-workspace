import { KeyRound, LifeBuoy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SIGN_IN_COPY } from "@/lib/sign-in/copy";
import { LoginPasswordField } from "./LoginPasswordField";
import type { LoginHandler, SignInMode } from "./useLoginHandler";

const linkClass: string =
  "tap-target text-xs text-primary-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring rounded";

/**
 * The part of the sign-in form that depends on how the user signs in: a
 * password (the server asks for a key touch too if the account's policy says
 * so), a key alone with no password field, or a recovery code.
 */
export function LoginFactorFields({ h, keysHere }: { h: LoginHandler; keysHere: boolean }): JSX.Element {
  const describedBy: string | undefined = h.error ? 'login-error' : undefined;
  const switchTo = (mode: SignInMode, focus: string): void => {
    h.setMode(mode);
    // After React renders the field the mode brings.
    setTimeout((): void => { document.getElementById(focus)?.focus(); }, 0);
  };
  return (
    <>
      {h.mode === 'password' && (
        <LoginPasswordField value={h.password} onChange={h.setPassword} invalid={h.invalidField === 'password'} describedBy={describedBy} />
      )}
      {h.mode === 'key' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="login-key-mode">
          <KeyRound className="h-4 w-4 text-primary-accent" aria-hidden="true" />
          No password needed: you'll touch your security key next.
        </p>
      )}
      {h.mode === 'recovery' && (
        <div className="space-y-1.5">
          <label htmlFor="recovery-code" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
            {SIGN_IN_COPY.recoveryLabel}
          </label>
          <div className="relative">
            <LifeBuoy className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="recovery-code" autoComplete="off" spellCheck={false}
              aria-invalid={h.invalidField === 'recovery-code' ? true : undefined}
              aria-describedby={describedBy ? `recovery-code-hint ${describedBy}` : 'recovery-code-hint'}
              value={h.recoveryCode} onChange={(e) => h.setRecoveryCode(e.target.value)}
              className="bg-input border-border text-foreground pl-10 h-11 rounded-lg font-mono"
            />
          </div>
          <p id="recovery-code-hint" className="text-xs text-muted-foreground">{SIGN_IN_COPY.recoveryHint}</p>
        </div>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        {h.mode !== 'password' ? (
          <button type="button" className={linkClass} onClick={() => switchTo('password', 'password')} data-testid="login-mode-password">
            {SIGN_IN_COPY.usePasswordInstead}
          </button>
        ) : keysHere ? (
          <button type="button" className={linkClass} onClick={() => switchTo('key', 'username')} data-testid="login-mode-key">
            {SIGN_IN_COPY.useKeyInstead}
          </button>
        ) : <span />}
        {h.mode !== 'recovery' && (
          <button type="button" className={linkClass} onClick={() => switchTo('recovery', 'recovery-code')} data-testid="login-mode-recovery">
            {SIGN_IN_COPY.lostKey}
          </button>
        )}
      </div>
    </>
  );
}
