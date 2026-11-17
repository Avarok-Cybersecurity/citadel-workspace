/**
 * The server a sign-in is for, when the way in knows it, and what follows from it:
 * the rows offered under the username, how many saved accounts are on it, and
 * whether the typed username is known only on a different server.
 *
 * The accounts come from the agent (each with its host), the browser's saved
 * sessions and this device's sign-in hints; known-accounts.ts decides from them.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { browserAccountHosts, type AccountHost } from '@/lib/admission';
import { connectionManager } from '@/lib/connection';
import type { SignInHint } from '@/lib/sign-in';
import {
  accountsOnServer, checkTypedAccount, knownAccounts, offeredRows, type KnownAccount, type TypedAccountCheck,
} from '@/lib/sessions/known-accounts';

export interface SignInScope {
  /** The server being signed in to, or null when the form is not scoped to one. */
  server: string | null;
  choose: (server: string) => void;
  /** The passkey rows, each with its server; only this server's when scoped. */
  rows: KnownAccount[];
  /** How many accounts this device knows on the scoped server. */
  onServer: number;
  typed: TypedAccountCheck;
}

/** `server`/`choose`: the scope, held by the login handler, which names it on the Connect. */
export function useSignInScope(
  server: string | null, choose: (server: string) => void,
  username: string, offered: readonly string[], hints: readonly SignInHint[], legacy: readonly string[],
): SignInScope {
  const [agent, setAgent] = useState<AccountHost[]>([]);
  useEffect((): (() => void) => {
    let live: boolean = true;
    browserAccountHosts().then((found: AccountHost[]): void => { if (live) setAgent(found); }, (): void => undefined);
    return (): void => { live = false; };
  }, []);
  const known: KnownAccount[] = useMemo((): KnownAccount[] => knownAccounts({
    agent, stored: connectionManager.getStoredSessions().sessions, hints, device: legacy,
  }), [agent, hints, legacy]);
  return {
    server,
    choose,
    rows: offeredRows(offered, hints, legacy, known, server),
    onServer: server === null ? 0 : accountsOnServer(known, server).length,
    typed: checkTypedAccount(known, username, server),
  };
}

/**
 * The form's submit. While the typed username is known only on another server it is
 * refused -- submitting would sign in THERE -- and focus goes to the notice's choice.
 */
export function scopedSubmit(scope: SignInScope, submit: (event: FormEvent) => Promise<void>): (event: FormEvent<HTMLFormElement>) => void {
  return (event: FormEvent<HTMLFormElement>): void => {
    if (scope.typed.kind !== 'elsewhere') { void submit(event); return; }
    event.preventDefault();
    document.querySelector<HTMLButtonElement>('#login-wrong-server button')?.focus();
  };
}

/** What describes the username field: the scope, the wrong-server notice, the error. */
export function scopeDescribedBy(scope: SignInScope, error: string | null | undefined): string | undefined {
  const ids: string[] = [];
  if (scope.server !== null) ids.push('login-scope');
  if (scope.typed.kind === 'elsewhere') ids.push('login-wrong-server');
  if (error) ids.push('login-error');
  return ids.length > 0 ? ids.join(' ') : undefined;
}
