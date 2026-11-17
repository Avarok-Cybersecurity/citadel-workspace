import { useCallback, useEffect } from 'react';
import { useServiceHealth } from '@/hooks/use-service-health';
import { askWhyTheAgentIsUnreachable } from '@/lib/agent-attention';

/**
 * Nothing on the landing screen works without the agent, so nothing on it opens
 * without asking.
 *
 * The page is served from the workspace host; the agent runs on the visitor's
 * own machine. Until they install it, `wss://local.<host>:12345` refuses — which
 * makes "no agent" the FIRST-RUN state of the hosted UI, not an edge case.
 *
 * `ConnectionRetryModal` is the surface that matters in that state: it alone
 * carries the download links and the command to run the agent. Anything else
 * opening on top of it is a second modal focus trap over one condition, and
 * `WorkspaceApp` already declines to stack the retry dialog on `OfflineBanner`
 * for the device-offline case with the same reasoning written beside it.
 *
 * WHY THIS IS A HOOK. Round 635 applied that reasoning to "Create Account" and
 * not to "Sign In", the button immediately beside it. Two handlers, one rule,
 * and the rule reached one of them — this repository's most common defect,
 * committed by the fix for another instance of it. Owning the rule in one place
 * is what stops a third door being added without it.
 *
 * `isOnline` is NOT this condition. That reports the DEVICE's connectivity; the
 * agent is on localhost and can be dead while the browser is perfectly online,
 * which is exactly the hosted case.
 *
 * LIMIT, stated because a guard whose reach is assumed wider than it is stops
 * anyone looking again: `useServiceHealth` starts optimistic and learns
 * otherwise from a 10-second poll, so a click in the first seconds of a page
 * load still gets through. `closeWhenUnreachable` is what covers that window —
 * the flow closes when health arrives rather than staying open under the retry
 * dialog.
 */
/**
 * A handler that enters `step` only when the agent is answering, and retreats to
 * `closedStep` if the agent goes away while that step is open.
 *
 * One call rather than a guard plus an effect at every call site: the two halves
 * cover different moments -- refuse to open, and retreat once open -- and
 * splitting them across the caller is how one of them comes to be applied and
 * the other forgotten.
 */
export function useAgentGatedStep<T extends string>(
  setStep: (update: (step: T) => T) => void,
  step: T,
  closedStep: T,
): () => void {
  const { isHealthy } = useServiceHealth();

  useEffect((): void => {
    if (!isHealthy) setStep((current: T): T => (current === step ? closedStep : current));
    // `setStep` is a state setter and stable; `step`/`closedStep` are literals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHealthy]);

  return useCallback((): void => {
    // Deliberately not a fallthrough to some other flow: everything behind this
    // screen needs the agent, and the retry dialog is the surface that says so,
    // with the download link and the command to run it.
    //
    // But "already on screen" was an assumption, and it is false exactly when
    // it matters. The dialog is dismissible and a dismissal STICKS -- see
    // connection-retry-visibility, where that is deliberate, because retries
    // failing again are not new information. After the user puts it away, this
    // `return` left two buttons on the landing screen that did nothing at all:
    // no dialog, no message, no navigation. The banner across the top still
    // named the state, but a control that answers a click with silence reads as
    // broken software, and this repository has met that failure under several
    // other names.
    //
    // So the refusal now points somewhere. Asking for a door that needs the
    // agent is a request to see what is wrong.
    if (!isHealthy) {
      askWhyTheAgentIsUnreachable();
      return;
    }
    setStep((): T => step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHealthy]);
}
