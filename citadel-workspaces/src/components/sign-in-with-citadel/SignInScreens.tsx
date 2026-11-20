/**
 * The sign-in page's non-dialog screens: looking for the agent, no agent, a refused link, a stopped
 * sign-in, cancelled, and on the way back to the app.
 */
import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import { AgentSetup } from '@/components/agent-setup/AgentSetup';
import { Button } from '@/components/ui/button';
import { explain, type Explanation } from '@/lib/sign-in-with-citadel/messages';

export function Busy({ label, testId }: { label: string; testId: string }): JSX.Element {
  return (
    <div role="status" aria-busy="true" className="flex items-center gap-3 text-sm text-muted-foreground" data-testid={testId}>
      <Loader2 className="h-5 w-5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** No agent answered: the one install component, and Retry. Nothing has been sent to the issuer. */
export function NoAgentScreen({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <section aria-labelledby="sign-in-no-agent-title" className="space-y-4" data-testid="sign-in-no-agent">
      <div className="flex items-start gap-3">
        <Download className="mt-0.5 h-5 w-5 shrink-0 text-primary-accent" aria-hidden="true" />
        <div>
          <h2 id="sign-in-no-agent-title" className="text-lg font-semibold">Install the Citadel Agent</h2>
          <p className="text-sm text-muted-foreground">
            Your Citadel identity lives in the Citadel Agent on this computer, and none answered. Install it or start it, then press Retry.
          </p>
        </div>
      </div>
      <Button type="button" onClick={onRetry} data-testid="sign-in-retry">Retry</Button>
      <AgentSetup layout="full" navigatorRef={navigator} />
    </section>
  );
}

export function Stopped({ code, testId, action }: { code: string; testId: string; action?: { label: string; run: () => void } }): JSX.Element {
  const said: Explanation = explain(code);
  return (
    <section role="alert" aria-labelledby={`${testId}-title`} className="space-y-3" data-testid={testId} data-code={code}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive-emphasis" aria-hidden="true" />
        <div>
          <h2 id={`${testId}-title`} className="text-lg font-semibold">{said.title}</h2>
          <p className="text-sm text-muted-foreground">{said.body}</p>
        </div>
      </div>
      {action && <Button type="button" onClick={action.run} data-testid={`${testId}-action`}>{action.label}</Button>}
    </section>
  );
}

export function Cancelled(): JSX.Element {
  return (
    <section aria-labelledby="sign-in-cancelled-title" className="space-y-2" data-testid="sign-in-cancelled">
      <h2 id="sign-in-cancelled-title" className="text-lg font-semibold">Sign-in cancelled</h2>
      <p className="text-sm text-muted-foreground">Nothing was shared with the app. You can close this tab.</p>
    </section>
  );
}
