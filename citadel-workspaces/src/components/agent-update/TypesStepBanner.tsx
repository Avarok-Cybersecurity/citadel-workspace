import { useSyncExternalStore } from 'react';
import { AlertTriangle } from 'lucide-react';
import { agentFacts, type AgentFacts } from '@/lib/agent-update/agent-facts';
import { pageTypesHash, typesStep, type TypesStep } from '@/lib/agent-update/types-step';

/**
 * "The agent and this page are out of step": said as soon as the greeting and the WASM client
 * disagree on the wire types (types-step.ts), so a decode failure later has its cause on screen.
 * Not dismissible: nothing the page does makes the two match except an update and a reload.
 */
export function useTypesStep(): TypesStep | null {
  const facts: AgentFacts = useSyncExternalStore(agentFacts.subscribe, agentFacts.get);
  const page: string | null = useSyncExternalStore(pageTypesHash.subscribe, pageTypesHash.get);
  return typesStep(facts, page);
}

export function TypesStepBanner({ step }: { step: TypesStep | null }): JSX.Element | null {
  if (step === null || step.kind === 'in-step') return null;
  return (
    <div role="alert" data-testid="types-step-banner" data-kind={step.kind}
      className="flex items-center justify-center gap-2 px-4 py-2 text-sm bg-muted text-foreground border-b border-surface">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{step.text}</span>
    </div>
  );
}
