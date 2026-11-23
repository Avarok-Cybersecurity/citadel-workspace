/**
 * `citadel.session`'s rules (citadel-session-abi §1 "Rules"), decided before the agent is asked:
 *
 * - an open to a server the manifest's `servers` does not name is `ungranted`, and nothing is sent;
 * - a second open to a server returns the session already open to it;
 * - a send over `limits.session.max_msg_bytes` is `{limit: session_bytes}`, one over
 *   `max_msgs_per_s` (a token bucket per session, burst = the limit) `{limit: session_rate}`;
 * - a send or close naming a session this instance does not hold open is `{policy: invalid}`.
 *
 * The grant and the limits are the install's manifest's, never defaults. The agent holds its own
 * copy of each rule (kernel/apps/session/rules.rs); this one answers the app at once. Pure: the
 * caller passes `now` (ms) and carries every message.
 */
import type { SessionLimits } from 'citadel-workspace-client-ts';
import { LIMIT_SESSION_BYTES, LIMIT_SESSION_RATE } from '../sdk/generated/AbiConstants';
import type { SessionState } from '../sdk/generated/SessionState';
import type { SessionStatus } from '../sdk/generated/SessionStatus';
import type { Refused } from './ports';
import { TokenBucket } from './token-bucket';

/** The agent's name for it (`app_session_reason::INVALID`): no such open session, or not a server name. */
export const SESSION_INVALID: Refused = { policy: 'invalid' };

/** What the install may open: the manifest's `servers` for `citadel.session`, and its `limits.session`. */
export interface SessionGrant {
  readonly servers: readonly string[];
  readonly limits: SessionLimits;
}

export type OpenDecision =
  | { readonly kind: 'refused'; readonly refused: Refused }
  | { readonly kind: 'existing'; readonly state: SessionState }
  | { readonly kind: 'dial' };

interface Held {
  readonly server: string;
  state: SessionState;
  readonly bucket: TokenBucket;
}

/** The state a session the app closed is held in here. */
const CLOSED_BY_APP: SessionStatus = { closed: { reason: 'closed_by_app' } };

export const isClosed = (status: SessionStatus): boolean => typeof status === 'object' && 'closed' in status;

export class SessionRules {
  private readonly held: Map<number, Held> = new Map<number, Held>();

  constructor(private readonly grant: SessionGrant) {}

  private live(session: number): Held | undefined {
    const h: Held | undefined = this.held.get(session);
    return h === undefined || isClosed(h.state.state) ? undefined : h;
  }

  open(server: string): OpenDecision {
    if (!this.grant.servers.includes(server)) return { kind: 'refused', refused: 'ungranted' };
    const open: Held | undefined = [...this.held.values()].find((h: Held) => h.server === server && !isClosed(h.state.state));
    return open === undefined ? { kind: 'dial' } : { kind: 'existing', state: open.state };
  }

  /** The agent's answer to an open of `server`: the session it holds from now on. */
  opened(server: string, state: SessionState, now: number): void {
    this.held.set(state.session, { server, state, bucket: new TokenBucket(this.grant.limits.max_msgs_per_s, now) });
  }

  /** A later change of a session; false when it is not one this instance opened. */
  changed(session: number, status: SessionStatus): boolean {
    const h: Held | undefined = this.held.get(session);
    if (h === undefined) return false;
    h.state = { ...h.state, state: status };
    return true;
  }

  /** Whether a message on `session` is for this instance: one it holds open. */
  hears(session: number): boolean {
    return this.live(session) !== undefined;
  }

  /** Null: send it. A refused send takes no token. */
  send(session: number, body: Uint8Array, now: number): Refused | null {
    const h: Held | undefined = this.live(session);
    if (h === undefined) return SESSION_INVALID;
    if (body.byteLength > this.grant.limits.max_msg_bytes) return { limit: LIMIT_SESSION_BYTES };
    return h.bucket.take(now) ? null : { limit: LIMIT_SESSION_RATE };
  }

  /** Null: close it (it is closed here from now on, whatever the agent answers). */
  close(session: number): Refused | null {
    const h: Held | undefined = this.live(session);
    if (h === undefined) return SESSION_INVALID;
    h.state = { ...h.state, state: CLOSED_BY_APP };
    return null;
  }

  /** The sessions still open, which the instance's end closes. */
  openSessions(): number[] {
    return [...this.held.keys()].filter((s: number) => this.live(s) !== undefined);
  }
}
