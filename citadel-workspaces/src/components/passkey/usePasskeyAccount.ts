/**
 * Whether the sign-in form should offer "Use passkey or security key" for the
 * username in it: this browser can run WebAuthn, and this agent holds a
 * passkey envelope for that account under this page's RP ID.
 *
 * Without both, the form offers the password only. PRF support itself cannot
 * be known in advance -- it is judged when a key is enrolled -- so an account
 * has records here only if a key already proved it works.
 */
import { useEffect, useState } from 'react';
import { debugLog } from '@/lib/debug-config';
import { browserPasskeyDeps, hasPasskeyLogin, passkeysAvailableHere, type PasskeyDeps } from '@/lib/passkey';

export interface PasskeyAccount {
  /** WebAuthn exists in this browser on this page. */
  available: boolean;
  /** This account has a working passkey envelope on this agent. */
  hasKeys: boolean;
}

const LOOKUP_DEBOUNCE_MS: 250 = 250;

export function usePasskeyAccount(username: string): PasskeyAccount {
  const available: boolean = passkeysAvailableHere();
  const [hasKeys, setHasKeys] = useState<boolean>(false);

  useEffect(() => {
    const name: string = username.trim();
    setHasKeys(false);
    if (!available || !name) return undefined;
    let cancelled: boolean = false;
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      const deps: PasskeyDeps = browserPasskeyDeps();
      hasPasskeyLogin(deps.store, deps.rpId, name)
        .then((has: boolean): void => { if (!cancelled) setHasKeys(has); })
        .catch((error: unknown): void => { debugLog('Passkey', 'Could not read passkey records', error); });
    }, LOOKUP_DEBOUNCE_MS);
    return (): void => { cancelled = true; clearTimeout(timer); };
  }, [available, username]);

  return { available, hasKeys };
}
