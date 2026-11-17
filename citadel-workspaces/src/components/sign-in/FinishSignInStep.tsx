import { useEffect, useRef, useState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ADMISSION_ACTION, ADMISSION_COPY } from '@/lib/admission/copy';
import { describeFailure } from '@/lib/failure-message';
import { AdmissionCheck } from '@/components/admission/AdmissionCheck';
import { useAdmissionGate, type AdmissionGate } from '@/components/admission/useAdmissionGate';

/**
 * After registering on a workspace that checks: the account exists, but its
 * register token was spent, so signing in takes one more check. Presented as
 * the next step, not as a failure.
 */
export function FinishSignInStep({ tenantAddress, signIn, onSignedIn }: {
  tenantAddress: string;
  signIn: (admissionToken: string) => Promise<bigint>;
  onSignedIn: (cid: bigint) => void;
}): JSX.Element {
  const gate: AdmissionGate = useAdmissionGate(ADMISSION_ACTION.signIn, { serverAddress: tenantAddress, reauth: false, accountNamed: false });
  const [busy, setBusy] = useState<boolean>(false);
  const [problem, setProblem] = useState<string | null>(null);
  const headingRef: React.RefObject<HTMLHeadingElement> = useRef<HTMLHeadingElement>(null);
  const required: () => void = gate.require;
  useEffect(() => { required(); }, [required]);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const finish = (): void => {
    const token: string | null | 'missing' = gate.take();
    if (token === 'missing' || token === null) return;
    setBusy(true);
    setProblem(null);
    signIn(token)
      .then(onSignedIn)
      .catch((error: unknown): void => { if (!gate.settle(error)) setProblem(describeFailure(error, 'Signing in did not work. Try again.')); })
      .finally((): void => setBusy(false));
  };

  return (
    <section className="space-y-4" data-testid="finish-sign-in" aria-labelledby="finish-sign-in-title">
      <h2 id="finish-sign-in-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-foreground outline-none">{ADMISSION_COPY.finishTitle}</h2>
      <p className="text-sm text-muted-foreground">{ADMISSION_COPY.finishBody}</p>
      <AdmissionCheck gate={gate} />
      {problem && <p role="alert" className="text-sm text-destructive-emphasis">{problem}</p>}
      <Button type="button" className="w-full gap-2" disabled={busy} onClick={finish} data-testid="finish-sign-in-continue">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
        Sign in
      </Button>
    </section>
  );
}
