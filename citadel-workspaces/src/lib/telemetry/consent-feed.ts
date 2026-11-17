/**
 * The server's `Consent` answers as they arrive, whoever asked: the agent asks `GetMyConsent` on
 * every connect and reconnect, and the answer reaches this tab as well. Screens that show consent
 * subscribe here so they follow the server; nobody is told it was theirs.
 */
import type { MyConsent } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { answerOf } from '@/lib/workspace-service/telemetry-operations';

interface TelemetryEvent { answer: unknown }

/** Calls `listener` with each consent the server sends; returns the unsubscribe. */
export function onServerConsent(listener: (consent: MyConsent) => void): () => void {
  return eventEmitter.on('workspace:telemetry', (event: TelemetryEvent | undefined): void => {
    const consent: MyConsent | null = answerOf(event?.answer, 'Consent');
    if (consent !== null) listener(consent);
  });
}
