/**
 * The end of every sign-in from the form: complete it (hints, the key offer), then open the
 * workspace, or nothing when an existing session was claimed instead. Moved out of
 * `useLoginHandler` (an exact move of its `completeLogin` body) so the recovery console signs in
 * with its new password through the very same path.
 */
import { browserSignInDeps } from '@/lib/sign-in';
import type { SignInFactors } from '@/lib/sign-in/types';
import type { LoginResult } from '../login-with-password';
import { completeSignIn, type Completed, type CompletionDeps } from './complete-sign-in';

export interface FinishLoginDeps {
  login: (name: string, factors: SignInFactors) => Promise<LoginResult>;
  offerKey: CompletionDeps['offerKey'];
  onNext: (connectionId: string) => void;
  toast: (toast: { title: string; description: string; variant?: 'destructive' }) => void;
}

export async function finishLogin(deps: FinishLoginDeps, user: string, factors: SignInFactors, opts: { offerKey: boolean; legacy: boolean }): Promise<void> {
  const done: Completed = await completeSignIn({ login: deps.login, offerKey: deps.offerKey, signIn: browserSignInDeps() }, user, factors, opts);
  if (done.kind === 'redirected') return;
  deps.onNext(done.cid.toString());
  // Not an unconditional "Connected to workspace successfully". The ILM
  // messenger can fail to start while everything else succeeds.
  deps.toast(
    done.messagingReady
      ? { title: 'Login successful', description: 'Connected to workspace successfully' }
      : {
          variant: 'destructive',
          title: 'Signed in, but messaging is unavailable',
          description: 'Your workspace loaded. Messages cannot be sent or received until you reload.',
        },
  );
}
