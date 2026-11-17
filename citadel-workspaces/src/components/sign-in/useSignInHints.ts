/**
 * The accounts this device remembers for key-first sign-in (lib/sign-in/hints.ts),
 * read once when the form opens. A failed read offers none: the username field
 * and every way of signing in are still there.
 */
import { useEffect, useState } from 'react';
import { debugLog } from '@/lib/debug-config';
import { passkeysAvailableHere } from '@/lib/passkey';
import { browserSignInDeps, listHints, type SignInHint } from '@/lib/sign-in';

export function useSignInHints(): SignInHint[] {
  const available: boolean = passkeysAvailableHere();
  const [hints, setHints] = useState<SignInHint[]>([]);
  useEffect(() => {
    if (!available) return undefined;
    let cancelled: boolean = false;
    listHints(browserSignInDeps().store)
      .then((found: SignInHint[]): void => { if (!cancelled) setHints(found); })
      .catch((error: unknown): void => { debugLog('SignIn', 'Could not read sign-in hints', error); });
    return (): void => { cancelled = true; };
  }, [available]);
  return hints;
}
