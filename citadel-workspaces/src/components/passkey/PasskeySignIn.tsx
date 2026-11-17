import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PASSKEY_COPY } from '@/lib/passkey/copy';
import type { KnownAccount } from '@/lib/sessions/known-accounts';

/** Where a row's account is, in words: two `alice` rows differ only here. */
export function serverOfRow(account: KnownAccount): string {
  return account.server ?? PASSKEY_COPY.serverUnknown;
}

/**
 * Offered first when an account has a working passkey here: the typed one, or,
 * before anything is typed, each account enrolled on this device. Every row names
 * its server, in its visible text and so in its accessible name. The password
 * field stays below it: it is the fallback for every failure and the recovery
 * path if every key is lost.
 */
export function PasskeySignIn({ accounts, onUse, disabled }: {
  accounts: readonly KnownAccount[];
  onUse: (account: string) => void;
  disabled: boolean;
}): JSX.Element {
  const several: boolean = accounts.length > 1;
  return (
    <div className="space-y-3">
      {several && <p className="text-xs text-muted-foreground">{PASSKEY_COPY.chooseAccount}</p>}
      {accounts.map((account: KnownAccount) => (
        <Button
          key={`${account.username}@${account.server ?? ''}`}
          type="button"
          data-testid={several ? 'login-passkey-account' : 'login-passkey'}
          className="w-full h-auto min-h-11 justify-start rounded-lg gap-2 py-2"
          disabled={disabled}
          onClick={() => onUse(account.username)}
        >
          <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex min-w-0 flex-col items-start text-left leading-tight">
            <span className="max-w-full truncate" data-testid="login-passkey-name">{several ? account.username : PASSKEY_COPY.signInButton}</span>
            <span className="max-w-full truncate text-xs font-normal opacity-80" data-testid="login-passkey-server" title={serverOfRow(account)}>
              {several ? serverOfRow(account) : `${account.username} · ${serverOfRow(account)}`}
            </span>
          </span>
        </Button>
      ))}
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        {PASSKEY_COPY.orPassword}
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
