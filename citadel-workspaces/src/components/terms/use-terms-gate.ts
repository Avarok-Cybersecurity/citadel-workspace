import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { CurrentTerms, MyConsent } from 'citadel-workspace-client-ts';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { telemetryApi } from '@/lib/telemetry/telemetry-api';
import { onServerConsent } from '@/lib/telemetry/consent-feed';
import { signupConsentSettled } from '@/lib/telemetry/signup-consent-pending';
import { debugLog } from '@/lib/debug-config';
import { describeFailure } from '@/lib/failure-message';

export interface TermsGate {
  /** The terms to accept, or null when nothing is owed. */
  owed: CurrentTerms | null;
  accept: () => Promise<void>;
  /** Why the last acceptance failed. */
  problem: string | null;
  accepting: boolean;
}

/**
 * Asks the server once per signed-in member whether they have accepted the CURRENT terms (the
 * platform's, and the workspace's if it has any). Owed terms are returned; nothing is assumed
 * when the question cannot be answered, which is logged -- an older server has no such question.
 */
export function useTermsGate(): TermsGate {
  const { state } = useWorkspace();
  const member: string | undefined = state.currentUser?.id;
  const workspace: string | undefined = state.workspace?.id;
  const [owed, setOwed] = useState<CurrentTerms | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<boolean>(false);
  const fetching: MutableRefObject<boolean> = useRef<boolean>(false);

  useEffect((): (() => void) | void => {
    if (member === undefined || workspace === undefined) return;
    let current: boolean = true;
    const settle = async (consent: MyConsent): Promise<void> => {
      if (consent.terms_current) { setOwed(null); return; }
      if (fetching.current) return;
      fetching.current = true;
      try {
        const terms: CurrentTerms = await telemetryApi.getTerms();
        if (current) setOwed(terms);
      } finally { fetching.current = false; }
    };
    const report = (error: unknown): void => debugLog('TermsGate', 'Could not check the terms:', describeFailure(error, 'unknown'));
    const ask = async (): Promise<void> => {
      await signupConsentSettled();
      const consent: MyConsent = await telemetryApi.getMyConsent();
      if (current) await settle(consent);
    };
    ask().catch(report);
    // The agent's own GetMyConsent answer, and this gate's, arrive here too: follow the server.
    const unfollow: () => void = onServerConsent((consent: MyConsent): void => {
      signupConsentSettled().then((): unknown => (current ? settle(consent) : undefined)).catch(report);
    });
    return (): void => { current = false; unfollow(); };
  }, [member, workspace]);

  const accept = async (): Promise<void> => {
    if (owed === null) return;
    setAccepting(true);
    setProblem(null);
    try {
      await telemetryApi.acceptTerms(owed.platform.version, owed.workspace?.version ?? null);
      setOwed(null);
    } catch (error: unknown) {
      setProblem(describeFailure(error, 'The terms could not be accepted.'));
    } finally {
      setAccepting(false);
    }
  };

  return { owed, accept, problem, accepting };
}
