import { useEffect, useState, type JSX } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CitadelMark } from '@/components/brand/CitadelMark';
import type { ControlPlane, TenantStatus } from '@/lib/onboarding/control-plane-client';
import { workspaceHostFor } from '@/lib/onboarding/slug';
import { PROVISIONING_POLL, abortableSleep, pollUntilActive, type PollOutcome } from '@/lib/onboarding/status-poll';
import { StepHeading } from './StepHeading';

export interface ProvisioningStepProps {
  readonly api: ControlPlane;
  readonly slug: string;
  readonly sessionId: string;
  readonly onActive: (workspaceHost: string, claimCode: string | undefined) => void;
  readonly onStartOver: () => void;
}

type Waiting = { readonly kind: 'polling' } | Exclude<PollOutcome, { kind: 'active' } | { kind: 'aborted' }>;

/**
 * Back from Stripe: wait for the workspace to exist.
 *
 * Polling stops on its own when the page is left (the effect aborts it), and
 * the two ways it can end without success each say what to do next: a timeout
 * offers to keep checking -- the payment went through, provisioning is merely
 * slow -- while a refusal says what was refused.
 */
export function ProvisioningStep({ api, slug, sessionId, onActive, onStartOver }: ProvisioningStepProps): JSX.Element {
  const [waiting, setWaiting] = useState<Waiting>({ kind: 'polling' });
  const [round, setRound] = useState<number>(0);
  const host: string = workspaceHostFor(slug);

  useEffect(() => {
    const controller: AbortController = new AbortController();
    setWaiting({ kind: 'polling' });
    void pollUntilActive({
      ...PROVISIONING_POLL,
      signal: controller.signal,
      now: () => Date.now(),
      sleep: abortableSleep,
      fetchStatus: (signal: AbortSignal): Promise<TenantStatus> => api.tenantStatus(slug, sessionId, signal),
    }).then((outcome: PollOutcome) => {
      if (outcome.kind === 'aborted') return;
      if (outcome.kind === 'active') onActive(outcome.workspaceHost ?? host, outcome.claimCode);
      else setWaiting(outcome);
    });
    return (): void => controller.abort();
  }, [api, slug, sessionId, round, host, onActive]);

  if (waiting.kind === 'polling') {
    return (
      <div className="text-center" data-testid="provisioning">
        <div className="mb-6 flex justify-center">
          <CitadelMark size={56} label={null} />
        </div>
        <StepHeading title="Setting up your workspace">
          Payment received. We are preparing <span className="font-medium text-foreground">{host}</span> — this usually takes a few seconds.
        </StepHeading>
        <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Provisioning…
        </p>
      </div>
    );
  }

  const timedOut: boolean = waiting.kind === 'timed-out';
  return (
    <div data-testid={timedOut ? 'provisioning-timeout' : 'provisioning-failed'}>
      <StepHeading title={timedOut ? 'This is taking longer than usual' : 'We could not confirm your workspace'}>
        {timedOut
          ? `Your payment went through, but ${host} is not ready yet. It is safe to keep waiting.`
          : 'Nothing further will be charged by retrying.'}
      </StepHeading>
      {waiting.kind === 'failed' && (
        <div role="alert" className="mb-6 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-emphasis">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{waiting.error.message}</span>
        </div>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row justify-between">
        <Button type="button" variant="ghost" size="lg" onClick={onStartOver} className="h-11">
          Start over
        </Button>
        <Button type="button" size="lg" onClick={() => setRound((n) => n + 1)} data-testid="provisioning-retry" className="h-11 gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Check again
        </Button>
      </div>
    </div>
  );
}
