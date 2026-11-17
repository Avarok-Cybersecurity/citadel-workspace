/**
 * Whether this device already holds the typed username for another server, said before
 * the user submits (known-accounts.ts heldForAnotherServer). The agent's account list is
 * the authority -- it is what a registration would overwrite -- so it is the one source,
 * and the server is compared as Register will send it (resolveServerAddress).
 */
import { useEffect, useMemo, useState } from 'react';
import { browserAccountHosts, type AccountHost } from '@/lib/admission';
import { resolveServerAddress } from '@/lib/address-resolver';
import { heldForAnotherServer, heldUsernameCopy, knownAccounts, type KnownAccount } from '@/lib/sessions/known-accounts';

/** The message for the username field, or null. */
export function useHeldUsername(username: string, serverAddress: string): string | null {
  const [agent, setAgent] = useState<AccountHost[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  useEffect((): (() => void) => {
    let live: boolean = true;
    browserAccountHosts().then((found: AccountHost[]): void => { if (live) setAgent(found); }, (): void => undefined);
    return (): void => { live = false; };
  }, []);
  useEffect((): (() => void) => {
    let live: boolean = true;
    // An address Register would refuse is reported by Register; there is nothing to compare.
    resolveServerAddress(serverAddress).then((resolved: string): void => { if (live) setTarget(resolved); }, (): void => { if (live) setTarget(null); });
    return (): void => { live = false; };
  }, [serverAddress]);
  const accounts: KnownAccount[] = useMemo(
    (): KnownAccount[] => knownAccounts({ agent, stored: [], hints: [], device: [] }), [agent],
  );
  const held: KnownAccount | null = target === null ? null : heldForAnotherServer(accounts, username, target);
  return held === null || held.server === null ? null : heldUsernameCopy(held.username, held.server);
}
