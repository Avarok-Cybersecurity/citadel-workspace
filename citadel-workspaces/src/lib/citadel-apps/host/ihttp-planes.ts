/**
 * Which plane an internal-HTTP call or advertisement may use, from what the install holds. The ops
 * admit either plane's capability (AbiConstants OPS); the plane a call NAMES needs its own, read
 * from the generated TRANSPORT_CAPABILITY and SERVE_PLANE_CAPABILITY, so this file restates no
 * capability. Pure.
 */
import { SERVE_PLANE_CAPABILITY, TRANSPORT_CAPABILITY } from '../sdk/generated/AbiConstants';
import type { ServeOn } from '../sdk/generated/ServeOn';
import type { Transport } from '../sdk/generated/Transport';
import type { Via } from '../sdk/generated/Via';
import type { Capability } from './capabilities';

export type Plane = keyof ServeOn;

/** The plane a client capability opens: the one whose serving capability pairs with it. */
const CALL_PLANE: Readonly<Record<string, Plane>> = {
  [TRANSPORT_CAPABILITY.p2p.first]: 'p2p',
  [TRANSPORT_CAPABILITY.relay.first]: 'relay',
};

/** A stream's first plane, and the plane it may fall back to before it opens (null: none). */
export interface CallPlan {
  readonly first: Plane;
  readonly fallback: Plane | null;
}

/** Null: the install holds neither plane this transport names (`ungranted`). */
export function callPlan(transport: Transport, held: ReadonlySet<Capability>): CallPlan | null {
  const t: { readonly first: Capability; readonly fallback: Capability | null } = TRANSPORT_CAPABILITY[transport];
  const first: Plane | null = held.has(t.first) ? CALL_PLANE[t.first] : null;
  const fallback: Plane | null = t.fallback !== null && held.has(t.fallback) ? CALL_PLANE[t.fallback] : null;
  if (first === null) return fallback === null ? null : { first: fallback, fallback: null };
  return { first, fallback };
}

export type ServePlan =
  | { readonly kind: 'none_requested' }
  | { readonly kind: 'ungranted' }
  /** `partial`: a requested plane is not held; the held ones are advertised and the call answers `ungranted`. */
  | { readonly kind: 'serve'; readonly on: ServeOn; readonly partial: boolean };

export function servePlan(on: ServeOn, held: ReadonlySet<Capability>): ServePlan {
  if (!on.relay && !on.p2p) return { kind: 'none_requested' };
  const relay: boolean = on.relay && held.has(SERVE_PLANE_CAPABILITY.relay);
  const p2p: boolean = on.p2p && held.has(SERVE_PLANE_CAPABILITY.p2p);
  if (!relay && !p2p) return { kind: 'ungranted' };
  return { kind: 'serve', on: { relay, p2p }, partial: relay !== on.relay || p2p !== on.p2p };
}

/** Whether a stream that arrived `via` this plane reaches an app serving on `on`. Topics never do. */
export function servesVia(on: ServeOn, via: Via): boolean {
  return via === 'group' ? false : on[via];
}
