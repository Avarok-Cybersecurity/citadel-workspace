/**
 * The highest security level the typed account can sign in at (account-levels.ts),
 * as the SDK's byte value. Asked of the agent once per form; `undefined` until it
 * answers, and for an account this agent does not store, so nothing is disabled.
 */
import { useEffect, useState } from 'react';
import { browserAccountLevels } from '@/lib/stored-accounts';

export function useSignInLevel(username: string): number | undefined {
  const [levels, setLevels] = useState<ReadonlyMap<string, number>>(new Map<string, number>());
  useEffect((): (() => void) => {
    let live: boolean = true;
    browserAccountLevels().then((found: ReadonlyMap<string, number>): void => { if (live) setLevels(found); }, (): void => undefined);
    return (): void => { live = false; };
  }, []);
  return levels.get(username.trim());
}
