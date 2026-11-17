import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useDialogOverlay } from '@/hooks/use-dialog-overlay';
import { stringToBytes } from '@/lib/utils/encoding-utils';
import { SIGN_IN_COPY } from '@/lib/sign-in/copy';
import { tenantOf } from '@/lib/sign-in/factors';
import type { AccountRef } from '@/lib/sign-in/types';
import { AddSecurityKeyCard } from './AddSecurityKeyCard';
import { RecoveryCodesPanel } from './RecoveryCodesPanel';
import { FinishSignInStep } from './FinishSignInStep';

type Step = 'key' | 'codes' | 'sign-in';

/**
 * The steps, in order. Signed in: an optional key, then the codes. Registered
 * but not signed in (a workspace that checks spent the register token): the
 * codes first, then the sign-in with a fresh check, then the key -- which needs
 * the session. A server without post-quantum sign-in sends no codes and has no
 * keys to enrol, so only the sign-in, if any, is left.
 */
export function stepsFor(signedIn: boolean, hasCodes: boolean): Step[] {
  if (!hasCodes) return signedIn ? [] : ['sign-in'];
  return signedIn ? ['key', 'codes'] : ['codes', 'sign-in', 'key'];
}

/**
 * Right after an account is created: an optional security key and the recovery
 * codes (shown once), and on a workspace that asks for a human check, the
 * sign-in its spent register token could not make.
 */
export function PostRegistrationSteps({ session, username, serverAddress, password, recoveryCodes, signIn, onDone }: {
  /** The new account's session, or null while its sign-in still needs a fresh check. */
  session: bigint | null;
  username: string;
  serverAddress: string;
  /** The password just chosen: the step-up for the new account's first key. */
  password: string;
  recoveryCodes: readonly string[];
  signIn: (admissionToken: string) => Promise<bigint>;
  onDone: (cid: bigint) => void;
}): JSX.Element | null {
  const [steps] = useState<Step[]>(() => stepsFor(session !== null, recoveryCodes.length > 0));
  const [at, setAt] = useState<number>(0);
  const [cid, setCid] = useState<bigint | null>(session);
  const { ref, dialogProps } = useDialogOverlay({ label: 'Secure your account' });
  const step: Step | undefined = steps[at];
  const next = (): void => setAt((n: number) => n + 1);

  // Once: the caller's onDone opens the workspace, and a re-render must not open it again.
  const finished: React.MutableRefObject<boolean> = useRef<boolean>(false);
  useEffect(() => {
    if (step !== undefined || cid === null || finished.current) return;
    finished.current = true;
    onDone(cid);
  }, [step, cid, onDone]);
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
          {step === 'codes' && <RecoveryCodesPanel codes={recoveryCodes} account={username} onDone={next} />}
          {step === 'sign-in' && (
            <FinishSignInStep tenantAddress={serverAddress} signIn={signIn} onSignedIn={(signed: bigint) => { setCid(signed); next(); }} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
