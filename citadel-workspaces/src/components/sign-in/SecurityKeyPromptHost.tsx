import { lazy, Suspense, useSyncExternalStore } from 'react';
import { openChallenges, subscribeChallenges } from '@/lib/sign-in/challenge-watch';
import type { SecurityKeyChallengeNotification } from '@/lib/sign-in/types';

/** The prompt itself, fetched only when a challenge first needs it: no landing visit pays for it. */
const SecurityKeyPrompt: React.LazyExoticComponent<() => JSX.Element | null> = lazy(
  async (): Promise<{ default: () => JSX.Element | null }> =>
    ({ default: (await import('./SecurityKeyPrompt')).SecurityKeyPrompt }),
);

/**
 * Mounted once, in App: renders "Touch your security key" while this window
 * has a challenge to answer. Only the challenge watch is eager, and it is a
 * few hundred bytes; the dialog and the WebAuthn code load on the first touch
 * (scripts/check-bundle-budget.mjs holds the landing page to its budget).
 */
export function SecurityKeyPromptHost(): JSX.Element | null {
  const open: readonly SecurityKeyChallengeNotification[] = useSyncExternalStore(subscribeChallenges, openChallenges);
  if (open.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <SecurityKeyPrompt />
    </Suspense>
  );
}
