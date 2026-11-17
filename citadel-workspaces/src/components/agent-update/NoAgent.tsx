import { Download } from 'lucide-react';
import { AgentSetup } from '@/components/agent-setup/AgentSetup';

/** Both tabs when no agent answers: the existing install steps, under the sentence that says why they are here. */
export function NoAgent(): JSX.Element {
  return (
    <section aria-labelledby="agent-missing-title" className="space-y-4" data-testid="agent-missing">
      <div className="flex items-start gap-3">
        <Download className="mt-0.5 h-5 w-5 shrink-0 text-primary-accent" aria-hidden="true" />
        <div>
          <h2 id="agent-missing-title" className="text-lg font-semibold">Install the Citadel Agent to see its version and updates</h2>
          <p className="text-sm text-muted-foreground">
            This page talks to the Citadel Agent running on this computer, and none answered. If it is installed but older than
            0.8.7, installing the current one adds update checks.
          </p>
        </div>
      </div>
      <AgentSetup layout="full" navigatorRef={navigator} />
    </section>
  );
}

/** While the first answer is awaited: a named, busy placeholder rather than a blank page or a false "not installed". */
export function LookingForAgent(): JSX.Element {
  return (
    <div role="status" aria-busy="true" className="space-y-3" data-testid="agent-looking">
      <p className="text-sm text-muted-foreground">Looking for the Citadel Agent on this computer…</p>
      <div className="h-24 rounded-lg bg-surface motion-safe:animate-pulse" aria-hidden="true" />
    </div>
  );
}
