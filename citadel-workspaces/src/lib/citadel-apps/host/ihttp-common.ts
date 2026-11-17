/**
 * What both directions of the internal-HTTP router share: the actions it decides on, a call's
 * verdict, head checks (R4.4 limits) and how a caller is keyed. Frame types are the generated ones.
 */
import type { Address } from '../sdk/generated/Address';
import type { Caller } from '../sdk/generated/Caller';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import type { RequestHead } from '../sdk/generated/RequestHead';
import type { Transport } from '../sdk/generated/Transport';
import type { IhttpLimits } from './limits';
import { appReason, type HostCancelReason } from './ihttp-reasons';
import type { Refused } from './ports';

export type RouterAction =
  /** Hand this frame to the app (as AppEvent `{ihttp: {from, frame}}`). */
  | { readonly kind: 'deliver'; readonly peer: Caller; readonly frame: IhttpFrame }
  /** Send this frame to the peer (IhttpPort.respond). */
  | { readonly kind: 'reply'; readonly peer: Caller; readonly frame: IhttpFrame }
  /** Send this frame on a call the app made (IhttpPort.IhttpCall), addressed as the app addressed it. */
  | { readonly kind: 'call'; readonly to: Address; readonly frame: IhttpFrame; readonly transport: Transport };

/** What closing the instance sends: a Cancel to each caller it serves, and on each call it made. */
export type ClosingAction = Exclude<RouterAction, { kind: 'deliver' }>;

/** The Cancel reason closing sends (citadel-ihttp-types CancelReason::Closed). */
export const CLOSED_REASON: HostCancelReason = 'closed';

/** A guest call the router gated: refused or not, with the frames that decision produced. */
export type Verdict =
  | { readonly ok: true; readonly actions: readonly RouterAction[] }
  | { readonly ok: false; readonly refused: Refused; readonly actions: readonly RouterAction[] };

export const allow = (actions: readonly RouterAction[]): Verdict => ({ ok: true, actions });
export const deny = (refused: Refused, actions: readonly RouterAction[]): Verdict => ({ ok: false, refused, actions });

export const IHTTP_METHODS: ReadonlySet<string> = new Set<string>(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH']);

/** A caller as the session knows it: its CID and install, never anything the app asserted. */
export const peerKey = (peer: Caller): string => `${peer.cid.toString()}/${peer.install_id}`;

/** Credit a peer may accumulate; more is clamped, so a counter cannot be inflated without bound. */
export const MAX_CREDIT: number = 1024;

export function frame(stream: bigint, kind: IhttpFrame['kind']): IhttpFrame {
  return { v: 1, stream, kind };
}

/** A Cancel to the peer, naming the guard; the wire narrows it (ihttp-reasons.ts). */
export const cancel = (peer: Caller, stream: bigint, reason: HostCancelReason): Extract<RouterAction, { kind: 'reply' }> =>
  ({ kind: 'reply', peer, frame: frame(stream, { Cancel: { reason } }) });

/** The app's side of a Cancel the host made: the wire's word, as the relay would hand it over. */
export const cancelToApp = (peer: Caller, stream: bigint, reason: HostCancelReason): RouterAction =>
  ({ kind: 'deliver', peer, frame: frame(stream, { Cancel: { reason: appReason(reason) } }) });

/** Cancels a stream both ways: to the peer, and to the app. */
export const abortBoth = (peer: Caller, stream: bigint, reason: HostCancelReason): RouterAction[] =>
  [cancel(peer, stream, reason), cancelToApp(peer, stream, reason)];

/** A stream's deadline (E2): 30 s from its open, moved on by every Body or Credit, never past 60 s from it. */
export const nextDeadline = (opened: number, now: number, limits: IhttpLimits): number =>
  Math.min(now + limits.streamTimeoutMs, opened + limits.streamingTimeoutMs);

export function headersProblem(headers: readonly (readonly [string, string])[], limits: IhttpLimits): HostCancelReason | null {
  if (headers.length > limits.maxHeaders) return 'too_many_headers';
  const enc: TextEncoder = new TextEncoder();
  const tooBig: boolean = headers.some(([k, v]: readonly [string, string]) => enc.encode(k).byteLength + enc.encode(v).byteLength > limits.maxHeaderBytes);
  return tooBig ? 'header_too_large' : null;
}

export function requestHeadProblem(head: RequestHead, limits: IhttpLimits): HostCancelReason | null {
  if (!IHTTP_METHODS.has(head.method)) return 'method';
  if (new TextEncoder().encode(head.path + head.query).byteLength > limits.maxPathBytes) return 'path_too_long';
  if (head.body_len !== null && head.body_len > BigInt(limits.maxRequestBodyBytes)) return 'request_body_too_large';
  return headersProblem(head.headers, limits);
}
