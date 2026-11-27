import { lazy, Suspense, useEffect, useRef, useState, type LazyExoticComponent } from 'react';
import type { RecoveryPhrasePanel as RecoveryPhrasePanelComponent } from '@/components/recovery/RecoveryPhrasePanel';
import { Card, CardContent } from '@/components/ui/card';
import { useDialogOverlay } from '@/hooks/use-dialog-overlay';
import { stringToBytes } from '@/lib/utils/encoding-utils';
import { SIGN_IN_COPY } from '@/lib/sign-in/copy';
import { tenantOf } from '@/lib/sign-in/factors';
import type { AccountRef } from '@/lib/sign-in/types';
import { AddSecurityKeyCard } from './AddSecurityKeyCard';
import type { RecoveryPhrase } from '@/lib/recovery/secret';
import { FinishSignInStep } from './FinishSignInStep';
import { recordPhraseCheck } from '@/lib/recovery/phrase-unchecked';
import { errorLog } from '@/lib/debug-config';

// Its own chunk: the phrase panel is met once per account, never on the landing path.
const RecoveryPhrasePanel: LazyExoticComponent<typeof RecoveryPhrasePanelComponent> = lazy(() => import('@/components/recovery/RecoveryPhrasePanel').then((m) => ({ default: m.RecoveryPhrasePanel })));

type Step = 'key' | 'phrase' | 'sign-in';

/**
 * The steps, in order. Signed in: an optional key, then the recovery phrase.
 * Registered but not signed in (a workspace that checks spent the register
 * token): the phrase first, then the sign-in with a fresh check, then the key --
 * which needs the session.
 */
export function stepsFor(signedIn: boolean): Step[] {
  return signedIn ? ['key', 'phrase'] : ['phrase', 'sign-in', 'key'];
}

/**
 * Right after an account is created: an optional security key and the recovery
 * phrase (shown once, then three of its words checked), and on a workspace that
 * asks for a human check, the sign-in its spent register token could not make.
 */
export function PostRegistrationSteps({ session, username, serverAddress, password, recoveryPhrase, signIn, onDone }: {
  /** The new account's session, or null while its sign-in still needs a fresh check. */
  session: bigint | null;
  username: string;
  serverAddress: string;
  /** The password just chosen: the step-up for the new account's first key. */
  password: string;
  recoveryPhrase: RecoveryPhrase;
  signIn: (admissionToken: string) => Promise<bigint>;
  onDone: (cid: bigint) => void;
}): JSX.Element | null {
  const [steps] = useState<Step[]>(() => stepsFor(session !== null));
  const [at, setAt] = useState<number>(0);
  const [cid, setCid] = useState<bigint | null>(session);
  const { ref, dialogProps } = useDialogOverlay({ label: 'Secure your account' });
  const step: Step | undefined = steps[at];
  const next = (): void => setAt((n: number) => n + 1);

  // Once: the caller's onDone opens the workspace, and a re-render must not open it again.
  const finished: React.MutableRefObject<boolean> = useRef<boolean>(false);
  // Remembered once the account's CID is known: on the check-first path the phrase comes before it.
  const phraseChecked: React.MutableRefObject<boolean> = useRef<boolean>(false);
  useEffect(() => {
    if (step !== undefined || cid === null || finished.current) return;
    finished.current = true;
    recordPhraseCheck({ tenant: tenantOf(serverAddress), cid }, phraseChecked.current)
      .catch((error: unknown): void => errorLog('Recovery', 'Could not remember whether the phrase was checked', error));
    onDone(cid);
  }, [step, cid, onDone, serverAddress]);
  if (step === undefined) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" ref={ref} {...dialogProps}>
      <Card className="bg-background border-border shadow-2xl shadow-black/40 w-full max-w-md" data-testid="post-registration">
        <CardContent className="pt-6">
          {step === 'key' && cid !== null && (
            <AddSecurityKeyCard
              account={{ tenant: tenantOf(serverAddress), cid, username } satisfies AccountRef}
              stepUp={{ password: stringToBytes(password), security_key: true }}
              title={SIGN_IN_COPY.addKeyTitle}
              body={SIGN_IN_COPY.addKeyBody}
              onFinished={next}
            />
          )}
          {step === 'phrase' && (
            <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
              <RecoveryPhrasePanel words={recoveryPhrase} account={username} server={serverAddress}
                onDone={(checked: boolean): void => { phraseChecked.current = checked; next(); }} />
            </Suspense>
          )}
          {step === 'sign-in' && (
            <FinishSignInStep tenantAddress={serverAddress} signIn={signIn} onSignedIn={(signed: bigint) => { setCid(signed); next(); }} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
