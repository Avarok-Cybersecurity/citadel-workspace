/**
 * The agent's answer when it could not send a message.
 *
 * `MessageSendFailure` is returned by the agent when the peer channel is not
 * there (`requests/message.rs`: "Peer connection for {peer_cid} not found") and
 * when the send times out. Until this module existed, the UI contained no
 * reference to that response ANYWHERE -- not in the routing rules, not in a
 * handler -- so the answer was discarded, the bubble stayed `sent`, and the
 * message went nowhere with nothing said. Measured against the live server: 125
 * such refusals in one session while both directions of a conversation showed
 * `sent` and neither arrived.
 *
 * What this can and cannot do, stated plainly. The failure carries the sender's
 * own `cid`, a human-readable `message`, and a `request_id` that belongs to the
 * transport frame rather than to any one chat message the person typed -- the
 * reliable path wraps sends in the messaging layer, which retries on its own.
 * So this does NOT mark a particular bubble failed: that would need the peer's
 * cid on the response, which is the follow-up. It reports the failure through
 * the one channel a person can see, once per peer-session and not per frame,
 * so a transport that is down stops being invisible.
 */
import { eventEmitter } from '../event-emitter';

/** The shape the agent sends. `peer_cid` is not part of it; see the note above. */
export interface SendFailure {
  cid?: bigint | string;
  message?: string;
  request_id?: string | null;
}

/** Extract the failure from a response envelope, or `null` if it is not one. */
export function readSendFailure(response: unknown): SendFailure | null {
  if (typeof response !== 'object' || response === null) return null;
  const variant: unknown = (response as Record<string, unknown>).MessageSendFailure;
  if (typeof variant !== 'object' || variant === null) return null;
  return variant as SendFailure;
}

/**
 * The reason the agent gave, trimmed to something a person can read.
 *
 * The agent's own wording is kept: "Peer connection for 123 not found" says
 * more than "send failed", and a reason nobody wrote by hand cannot drift from
 * what actually happened.
 */
export function failureReason(failure: SendFailure): string {
  const raw: string = (failure.message ?? '').trim();
  // Except the missing-channel reason, whose only detail is the peer's CID -- a routing
  // number, never something a person can use (see peer-display). The channel reopens
  // on the next send, so that is what the person is told.
  if (NO_CHANNEL.test(raw)) return 'The connection to this contact is not open yet. It reopens on its own; try again in a moment.';
  return raw.length > 0 ? raw : 'The connection service could not send the message.';
}

/** `requests/message.rs`: "Peer connection for {peer_cid} not found". */
const NO_CHANNEL: RegExp = /^Peer connection for \d+ not found$/;

/**
 * How long the same session's failures stay quiet after one is reported.
 *
 * A dead channel produces one of these per frame -- the live-server run
 * produced 125 -- and 125 toasts is not a better experience than silence.
 */
export const REPORT_INTERVAL_MS: number = 15_000;

const lastReported: Map<string, number> = new Map();

/**
 * Who a send is for. A 'background' send is traffic the person did not write --
 * a Live Doc's sync -- whose surface shows its own state. Its failure is not
 * "Message not sent": opening a document with an offline contact said exactly
 * that, with nothing typed (live, 2026-09-29).
 */
export type SendDelivery = 'user' | 'background';

/** Request ids of background sends still awaiting an answer; oldest dropped past the cap. */
const backgroundRequests: Set<string> = new Set();
const BACKGROUND_REQUESTS_KEPT: number = 512;

export function markBackgroundSend(requestId: string): void {
  backgroundRequests.add(requestId);
  if (backgroundRequests.size > BACKGROUND_REQUESTS_KEPT) {
    const oldest: string | undefined = backgroundRequests.values().next().value;
    if (oldest !== undefined) backgroundRequests.delete(oldest);
  }
}

/** Reset the throttle. Tests use this; nothing else should need it. */
export function resetSendFailureThrottle(): void {
  lastReported.clear();
  backgroundRequests.clear();
}

/**
 * Report a send failure once per session per interval.
 *
 * Returns true when it was reported, false when throttled -- so a caller (and a
 * test) can tell the difference between "nothing happened" and "we already
 * said so".
 */
export function reportSendFailure(failure: SendFailure, now: number = Date.now()): boolean {
  const key: string = String(failure.cid ?? 'unknown');
  const previous: number | undefined = lastReported.get(key);
  if (previous !== undefined && now - previous < REPORT_INTERVAL_MS) return false;
  lastReported.set(key, now);
  eventEmitter.emit('p2p:send-failed', { cid: failure.cid, reason: failureReason(failure) });
  return true;
}

/**
 * Read a response and, if it is a send failure, report it.
 *
 * Returns true when the response WAS a failure, so the caller can stop. One
 * call rather than two keeps the handler at its length limit and keeps the
 * decision -- what counts as a failure, how often to speak -- in this file.
 */
export function consumeSendFailure(response: unknown): boolean {
  const failure: SendFailure | null = readSendFailure(response);
  if (!failure) return false;
  // A background send's failure is the sender's to show (the document's sync state).
  if (typeof failure.request_id === 'string' && backgroundRequests.delete(failure.request_id)) return true;
  // The discarded boolean is the RATE LIMIT, not the failure: `false` means this
  // peer's failure was already reported within REPORT_INTERVAL_MS, so the user
  // has the toast on screen. The failure itself is what this function returns,
  // and the caller acts on that.
  reportSendFailure(failure);
  return true;
}
