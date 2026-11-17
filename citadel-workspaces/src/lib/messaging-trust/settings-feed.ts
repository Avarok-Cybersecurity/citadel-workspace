/**
 * The server's messaging trust `Settings` answers as they arrive in this tab, whichever screen
 * asked: the admin's section and the member's own row both show them, so a change made in one
 * is shown by the other without a re-read.
 */
import type { MessagingTrustResponse, MessagingTrustSettings } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';

interface MessagingTrustEvent { answer: MessagingTrustResponse }

/** Calls `listener` with each settings answer; returns the unsubscribe. */
export function onServerTrustSettings(listener: (settings: MessagingTrustSettings) => void): () => void {
  return eventEmitter.on('workspace:messaging-trust', (event: MessagingTrustEvent | undefined): void => {
    const answer: MessagingTrustResponse | undefined = event?.answer;
    if (answer && typeof answer === 'object' && 'Settings' in answer) listener(answer.Settings);
  });
}
