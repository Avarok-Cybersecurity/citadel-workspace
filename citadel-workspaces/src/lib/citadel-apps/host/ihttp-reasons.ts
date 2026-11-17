/**
 * Why the host ends an internal-HTTP stream, and what each reason becomes on the wire (R4.4).
 *
 * The host's reasons are finer than the wire's closed CancelReason (citadel-ihttp-types): they
 * name the guard that fired, for this page's own tests and logs. Every one maps to exactly one
 * wire reason through an exhaustive Record, so a new host reason cannot reach the wire unmapped
 * (tsc refuses the table) and nothing falls back to a guess. What the app is handed is the wire
 * reason's word, never the host's detail: the relay can only ever hand over the wire's word, so
 * one cause is one reason on both planes.
 *
 * A Cancel the app itself sends carries free text. A wire word or a host reason is read as that
 * reason; anything else is the app ending the stream, `Caller`, so no free text crosses.
 */
import type { CancelReason } from '../sdk/wire-generated/CancelReason';

export type HostCancelReason =
  // The wire's own words, as the host hands them to an app.
  | 'caller' | 'timeout' | 'too_large' | 'busy' | 'rate_limited' | 'no_route' | 'refused' | 'failed' | 'closed' | 'protocol' | 'unavailable'
  // Sizes.
  | 'body_longer_than_declared' | 'chunk_too_large' | 'request_body_too_large' | 'response_body_too_large'
  | 'path_too_long' | 'too_many_headers' | 'header_too_large'
  // Admission.
  | 'rate' | 'unrouted' | 'caller_concurrency' | 'server_concurrency' | 'wrong_app'
  // Flow: a frame the stream's state does not admit.
  | 'method' | 'stream_id' | 'stream_id_in_use' | 'unknown_stream' | 'credit' | 'body_after_end' | 'body_shorter_than_declared';

export const reasonOut: Readonly<Record<HostCancelReason, CancelReason>> = {
  caller: 'Caller', timeout: 'Timeout', too_large: 'TooLarge', busy: 'Busy', rate_limited: 'RateLimited', no_route: 'NoRoute',
  refused: 'Refused', failed: 'Failed', closed: 'Closed', protocol: 'Protocol', unavailable: 'Unavailable',
  body_longer_than_declared: 'TooLarge', chunk_too_large: 'TooLarge', request_body_too_large: 'TooLarge', response_body_too_large: 'TooLarge',
  path_too_long: 'TooLarge', too_many_headers: 'TooLarge', header_too_large: 'TooLarge',
  rate: 'RateLimited', unrouted: 'NoRoute', caller_concurrency: 'Busy', server_concurrency: 'Busy', wrong_app: 'Refused',
  method: 'Protocol', stream_id: 'Protocol', stream_id_in_use: 'Protocol', unknown_stream: 'Protocol', credit: 'Protocol',
  body_after_end: 'Protocol', body_shorter_than_declared: 'Protocol',
};

/** The word an app is handed for each wire reason (snake case, as the SDK reads it). */
export const WIRE_WORDS: Readonly<Record<CancelReason, HostCancelReason>> = {
  Caller: 'caller', Timeout: 'timeout', TooLarge: 'too_large', Busy: 'busy', RateLimited: 'rate_limited', NoRoute: 'no_route',
  Refused: 'refused', Failed: 'failed', Closed: 'closed', Protocol: 'protocol', Unavailable: 'unavailable',
};

const isHostReason = (text: string): text is HostCancelReason => Object.prototype.hasOwnProperty.call(reasonOut, text);

/** The wire reason a Cancel's text means: a host reason as mapped, any other text the app's own `Caller`. */
export const wireReason = (text: string): CancelReason => (isHostReason(text) ? reasonOut[text] : 'Caller');

/** What the app is handed when the host ends a stream for `reason`: the wire's word, as the relay would hand it. */
export const appReason = (reason: HostCancelReason): string => WIRE_WORDS[reasonOut[reason]];
