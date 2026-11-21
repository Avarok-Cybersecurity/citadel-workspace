import { KeyRound } from "lucide-react";
import { SIGN_IN_COPY } from "@/lib/sign-in/copy";
import { RECOVER_COPY } from "@/lib/recovery/copy";
import { LoginPasswordField } from "./LoginPasswordField";
import type { LoginHandler, SignInMode } from "./useLoginHandler";

const linkClass: string =
  "tap-target text-xs text-primary-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring rounded";

/**
 * The part of the sign-in form that depends on how the user signs in: a
 * password (the server asks for a key touch too if the account's policy says
 * so), or a key alone with no password field. A lost password or key is
 * recovered with the recovery phrase ("Recover your account").
 */
export function LoginFactorFields({ h, keysHere, onRecover }: { h: LoginHandler; keysHere: boolean; onRecover: () => void }): JSX.Element {
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
      </div>
      <button type="button" className={linkClass} onClick={onRecover} data-testid="login-recover-account">
        {RECOVER_COPY.link}
      </button>
    </>
  );
}
