/**
 * The accounts that can sign in with a passkey on this device, before any
 * username is typed.
 *
 * "Use passkey" appeared only once a username with keys had been typed, so a
 * person who enrolled a key precisely to stop typing had to type anyway.
 */
import { useEffect, useState } from 'react';
import { debugLog } from '@/lib/debug-config';
import { browserPasskeyDeps, listPasskeyAccounts, passkeysAvailableHere, type PasskeyDeps } from '@/lib/passkey';

export function usePasskeyAccounts(): string[] {
  const available: boolean = passkeysAvailableHere();
  const [accounts, setAccounts] = useState<string[]>([]);

  useEffect(() => {
    if (!available) return undefined;
    let cancelled: boolean = false;
    const deps: PasskeyDeps = browserPasskeyDeps();
    listPasskeyAccounts(deps.store, deps.rpId)
      .then((names: string[]): void => { if (!cancelled) setAccounts(names); })
      .catch((error: unknown): void => { debugLog('Passkey', 'Could not list passkey accounts', error); });
    return (): void => { cancelled = true; };
  }, [available]);

  return accounts;
}

/**
 * Which accounts the form offers a passkey for: the typed one when it has keys,
 * or, before anything is typed, every account enrolled on this device.
 */
export function passkeyChoices(typed: string, typedHasKeys: boolean, deviceAccounts: string[]): string[] {
  const name: string = typed.trim();
  if (name) return typedHasKeys ? [name] : [];
  return deviceAccounts;
}
