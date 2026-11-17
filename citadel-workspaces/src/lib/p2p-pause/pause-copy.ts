/**
 * What a pause is called, and what it says, everywhere it is offered.
 *
 * One copy, so the row menu, the chat settings and the banner cannot describe
 * the same action three ways.
 */
import type { PauseStatus } from './pause-rules';

export const PAUSE_COPY: {
  readonly pause: string;
  readonly resume: string;
  readonly statusLabel: string;
  readonly banner: string;
  readonly composerPlaceholder: string;
  readonly callReason: string;
  readonly fileReason: string;
  readonly unreadable: string;
  readonly pauseFailed: string;
  readonly resumeFailed: string;
} = {
  pause: 'Pause connection',
  resume: 'Resume connection',
  statusLabel: 'Paused',
  banner: 'Paused — messages will be delivered when you resume',
  composerPlaceholder: 'Paused — your message will wait until you resume',
  callReason: 'The connection is paused. Resume it to call.',
  fileReason: 'The connection is paused. Resume it to send files.',
  unreadable: 'Could not check whether this connection is paused. Try again shortly.',
  pauseFailed: 'Could not pause the connection',
  resumeFailed: 'Could not resume the connection',
};

/** Plain words for what pausing does, and what it does not. */
export function pauseExplanation(peerName: string, status: PauseStatus): string {
  return status === 'paused'
    ? `The live connection to ${peerName} is closed. ${peerName} stays a contact, and anything you send waits until you resume.`
    : `Closes the live connection without removing or blocking anyone. ${peerName} stays a contact, and anything you send waits until you resume.`;
}

/** A paused link cannot carry a call; otherwise the browser's own answer stands. */
export function callCapabilityWhile(
  status: PauseStatus | 'loading',
  capability: { supported: boolean; reason?: string },
): { supported: boolean; reason?: string } {
  return status === 'paused' ? { supported: false, reason: PAUSE_COPY.callReason } : capability;
}
