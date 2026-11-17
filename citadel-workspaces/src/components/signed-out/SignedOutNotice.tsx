/**
 * A small, non-blocking line on the landing page naming the accounts the server
 * signed out while no page was open. Signing in again happens in Manage Accounts.
 */
import { LogOut } from 'lucide-react';
import type { SignedOutAccount } from '@/types/session-types';
import { signedOutNotice } from './signed-out-copy';
import { useSignedOutAccounts } from './use-signed-out-accounts';

export function SignedOutNotice(): JSX.Element | null {
  const accounts: SignedOutAccount[] = useSignedOutAccounts();
  if (accounts.length === 0) return null;
  return (
    <p role="status" data-testid="signed-out-notice" className="mt-4 flex items-start gap-2 text-sm text-warning-emphasis">
      <LogOut className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{signedOutNotice(accounts.map((a: SignedOutAccount) => a.username))}</span>
    </p>
  );
}
