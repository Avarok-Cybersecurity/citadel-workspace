/**
 * The sign-in dialog's recovery side: "Recover account" (username and phrase) and the recovery
 * console a phrase or code sign-in lands in. Both are loaded only when opened: neither, nor the
 * 2048-word list the phrase is checked against, is on the landing path.
 */
import { lazy, Suspense, useState, type LazyExoticComponent } from 'react';
import type { RecoverAccountForm as RecoverAccountFormComponent } from './RecoverAccountForm';
import type { RecoveryConsole as RecoveryConsoleComponent } from './RecoveryConsole';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { browserSignInDeps, tenantOf } from '@/lib/sign-in';
import type { AccountRef } from '@/lib/sign-in/types';
import { websocketService } from '@/lib/websocket-service';
import { mapSecuritySettings } from '@/lib/security-utils';
import { readDefaultWorkspaceServer } from '@/lib/default-workspace-server';
import type { LoginHandler } from '../useLoginHandler';
import type { RecoveredAccount } from './RecoverAccountForm';

const RecoverAccountForm: LazyExoticComponent<typeof RecoverAccountFormComponent> = lazy(() => import('./RecoverAccountForm').then((m) => ({ default: m.RecoverAccountForm })));
const RecoveryConsole: LazyExoticComponent<typeof RecoveryConsoleComponent> = lazy(() => import('./RecoveryConsole').then((m) => ({ default: m.RecoveryConsole })));

export interface AccountRecovery {
  /** The "Recover account" form is open. */
  recovering: boolean;
  start: () => void;
  cancel: () => void;
  /** A phrase recovery's console session, once the agent has signed it in. */
  recovered: RecoveredAccount | null;
  setRecovered: (recovered: RecoveredAccount | null) => void;
}

export function useAccountRecovery(): AccountRecovery {
  const [recovering, setRecovering] = useState<boolean>(false);
  const [recovered, setRecovered] = useState<RecoveredAccount | null>(null);
  return {
    recovering, recovered, setRecovered,
    start: (): void => setRecovering(true),
    cancel: (): void => { setRecovering(false); setRecovered(null); },
  };
}

/** Whether the dialog shows the recovery side instead of the sign-in form. */
export const showsRecovery = (h: LoginHandler, recovery: AccountRecovery): boolean =>
  h.recoverySession !== null || recovery.recovering || recovery.recovered !== null;

const Loading = (): JSX.Element => (
  <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading…</p>
);

export function LoginRecoveryCard({ h, recovery, scope }: { h: LoginHandler; recovery: AccountRecovery; scope: string | null }): JSX.Element {
  const consoleFor: { account: AccountRef; devicesSignedOut: boolean } | null = recovery.recovered
    ? { account: { tenant: tenantOf(recovery.recovered.serverAddress), cid: recovery.recovered.cid, username: recovery.recovered.username }, devicesSignedOut: recovery.recovered.devicesSignedOut }
    : h.recoverySession ? { account: h.recoverySession, devicesSignedOut: false } : null;
  const end = async (cid: bigint): Promise<void> => {
    await websocketService.disconnect(cid);
    recovery.cancel();
    if (h.recoverySession !== null) h.endRecoverySession();
  };

  return (
    <Card className="bg-background border-border shadow-2xl shadow-black/40 w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto">
      <CardContent className="pt-6">
        <Suspense fallback={<Loading />}>
          {consoleFor !== null ? (
            <RecoveryConsole
              account={consoleFor.account} serverAddress={consoleFor.account.tenant} devicesSignedOut={consoleFor.devicesSignedOut}
              send={browserSignInDeps().send}
              signOut={(): Promise<void> => end(consoleFor.account.cid)}
              signInWith={async (password: string): Promise<void> => {
                await end(consoleFor.account.cid);
                await h.signInWithNewPassword(consoleFor.account.username, password);
              }}
            />
          ) : (
            <RecoverAccountForm
              initialUsername={h.username.trim()}
              initialServer={scope ?? (typeof document === 'undefined' ? undefined : readDefaultWorkspaceServer(document)) ?? ''}
              securitySettings={mapSecuritySettings(h.securitySettings)}
              onRecovered={recovery.setRecovered}
              onCancel={recovery.cancel}
            />
          )}
        </Suspense>
      </CardContent>
    </Card>
  );
}
