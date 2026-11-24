/**
 * The `AppSession*` wire as the page writes and reads it (citadel-session-abi §3): the three
 * requests, the agent's three answers for this member's session and install, and its closed
 * `AppSessionFailure.reason`s as the refusal the app reads. `cid` is the member's workspace
 * session (the routing key, as in `AppFetch*`); `server_cid` the agent-held account's on the
 * external server. Values as the WASM client hands them over: u64 a bigint, `None` undefined.
 */
import type { Refused } from '../host/ports';
import { SESSION_INVALID } from '../host/session-rules';
import type { SessionStatus } from '../sdk/generated/SessionStatus';
import { bytesOf, variantOf, type Json } from './agent-link';

/** Whose sessions these are: the member's session, the install, and who is acting. */
export interface SessionTarget {
  readonly cid: bigint;
  readonly appId: string;
  readonly installId: string;
  readonly actingUsername: string;
}

/**
 * `app_session_reason` (citadel-internal-service-types app_session.rs): every name but these
 * three is the agent's own trouble, read as `{unavailable: <reason>}`. `no_identity` among them is
 * how a guest learns to fall back to `net.host`.
 */
const UNAVAILABLE_REASONS: ReadonlySet<string> = new Set<string>(['no_identity', 'identity_locked', 'not_configured', 'session', 'authority', 'unavailable']);

export function sessionRefusal(reason: unknown): Refused {
  if (reason === 'ungranted') return 'ungranted';
  if (reason === 'limit') return { limit: 'session' };
  if (reason === 'invalid') return SESSION_INVALID;
  return typeof reason === 'string' && UNAVAILABLE_REASONS.has(reason) ? { unavailable: reason } : { unavailable: 'agent_reply' };
}

export const openRequest = (t: SessionTarget, server: string) => (request_id: string): Json =>
  ({ AppSessionOpen: { request_id, cid: t.cid, app_id: t.appId, install_id: t.installId, acting_username: t.actingUsername, server } });

export const sendRequest = (t: SessionTarget, session: number, body: Uint8Array) => (request_id: string): Json =>
  ({ AppSessionSend: { request_id, cid: t.cid, install_id: t.installId, session, body: Array.from(body) } });

export const closeRequest = (t: SessionTarget, session: number) => (request_id: string): Json =>
  ({ AppSessionClose: { request_id, cid: t.cid, install_id: t.installId, session } });

export function statusOf(value: unknown): SessionStatus | null {
  if (value === 'connecting' || value === 'connected') return value;
  const closed: Json | undefined = typeof value === 'object' && value !== null ? variantOf(value, 'closed') : undefined;
  return closed !== undefined && typeof closed.reason === 'string' ? { closed: { reason: closed.reason } } : null;
}

/** One agent answer for this target, read; undefined when the message is not one. */
export type SessionWire =
  | { readonly kind: 'state'; readonly requestId: string | null; readonly session: number; readonly serverCid: bigint; readonly state: SessionStatus }
  | { readonly kind: 'message'; readonly session: number; readonly body: Uint8Array }
  | { readonly kind: 'failure'; readonly requestId: string | null; readonly refused: Refused };

const requestIdOf = (body: Json): string | null => (typeof body.request_id === 'string' ? body.request_id : null);
const isSession = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export function readSessionWire(message: unknown, t: SessionTarget): SessionWire | undefined {
  const mine = (body: Json | undefined): body is Json => body !== undefined && body.cid === t.cid && body.install_id === t.installId;
  const state: Json | undefined = variantOf(message, 'AppSessionState');
  if (mine(state)) {
    const status: SessionStatus | null = statusOf(state.state);
    if (!isSession(state.session) || typeof state.server_cid !== 'bigint' || status === null) return undefined;
    return { kind: 'state', requestId: requestIdOf(state), session: state.session, serverCid: state.server_cid, state: status };
  }
  const got: Json | undefined = variantOf(message, 'AppSessionMessage');
  if (mine(got)) {
    const body: Uint8Array | null = bytesOf(got.body);
    return isSession(got.session) && body !== null ? { kind: 'message', session: got.session, body } : undefined;
  }
  const failed: Json | undefined = variantOf(message, 'AppSessionFailure');
  return mine(failed) ? { kind: 'failure', requestId: requestIdOf(failed), refused: sessionRefusal(failed.reason) } : undefined;
}
