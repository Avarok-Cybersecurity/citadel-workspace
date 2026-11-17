/**
 * What the sign-in form says about accounts and servers: the server it is scoped to,
 * that no saved account is on it, that the typed username belongs to another server
 * (with the way to sign in there instead), and the passkey rows, each named with its
 * server.
 */
import { Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasskeySignIn } from '../passkey/PasskeySignIn';
import type { SignInScope } from './useSignInScope';

export const SCOPE_COPY: Readonly<{
  scope: (host: string) => string; none: (host: string) => string;
  elsewhere: (user: string, other: string, host: string) => string; goThere: (other: string) => string; stay: (host: string) => string;
}> = {
  scope: (host: string): string => `Signing in to ${host}`,
  none: (host: string): string => `No account for ${host} is saved on this device. Type the username you use there.`,
  elsewhere: (user: string, other: string, host: string): string => `${user} is an account on ${other}, not ${host}.`,
  goThere: (other: string): string => `Sign in to ${other} instead`,
  stay: (host: string): string => `Or type the username you use on ${host}.`,
};

/** Above the username: which server this sign-in is for. The username field is described by it. */
export function SignInScopeLine({ scope }: { scope: SignInScope }): JSX.Element | null {
  if (scope.server === null) return null;
  return (
    <div className="space-y-1">
      <p id="login-scope" data-testid="login-scope" className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Server className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 break-words">{SCOPE_COPY.scope(scope.server)}</span>
      </p>
      {scope.onServer === 0 && <p data-testid="login-scope-empty" className="text-xs text-muted-foreground">{SCOPE_COPY.none(scope.server)}</p>}
    </div>
  );
}

/** Below the username: the wrong-server notice, else the rows to sign in with. */
export function SignInAccounts({ scope, onUse, disabled }: { scope: SignInScope; onUse: (account: string) => void; disabled: boolean }): JSX.Element | null {
  if (scope.typed.kind === 'elsewhere' && scope.server !== null) {
    const { username, servers } = scope.typed;
    return (
      <div id="login-wrong-server" role="alert" data-testid="login-wrong-server" className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
        <p className="break-words">{SCOPE_COPY.elsewhere(username, servers.join(' and '), scope.server)}</p>
        {servers.map((other: string) => (
          <Button key={other} type="button" variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2" data-testid="login-switch-server" onClick={() => scope.choose(other)}>
            {SCOPE_COPY.goThere(other)}
          </Button>
        ))}
        <p className="break-words text-xs text-muted-foreground">{SCOPE_COPY.stay(scope.server)}</p>
      </div>
    );
  }
  return scope.rows.length > 0 ? <PasskeySignIn accounts={scope.rows} onUse={onUse} disabled={disabled} /> : null;
}
