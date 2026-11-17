/**
 * Opens the sign-in for an account whose stored record could not reconnect: no
 * server was recorded for it and the agent could not say which it is on
 * (lib/connection/stored-server.ts). Nothing is retried and nothing guessed; the
 * form opens with the username filled in, unscoped, and names the server the
 * agent reports when the user signs in.
 */
import { useSyncExternalStore } from 'react';
import { LazyTakeoverSignIn as TakeoverSignIn } from './LazyTakeoverSignIn';
import { signInNeededFor } from '@/lib/sessions/sign-in-needed';
import { signedOutSignIn } from '@/lib/sessions/sign-in-request';

export function SignInNeededWatcher(): JSX.Element | null {
  const username: string | null = useSyncExternalStore(signInNeededFor.subscribe, signInNeededFor.get);
  return <TakeoverSignIn request={username === null ? null : signedOutSignIn(username, '')} onClose={() => signInNeededFor.set(null)} />;
}
