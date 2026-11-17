/** A cached grant as the `turn` field of a request. Loaded lazily; see lazy-turn-source. */
import type { IceServersGrant, TurnConfig, TurnPolicy } from '@/types/ice-servers';
import type { IceServersCache } from './cache';
import type { TurnSource } from './peer-connect-turn';

/** Relay only when a direct path cannot be found. */
export const PEER_CONNECT_TURN_POLICY: TurnPolicy = 'fallback';

export function turnConfigFrom(grant: IceServersGrant | null): TurnConfig | null {
  if (grant === null || grant.ice_servers.length === 0) return null;
  return {
    policy: PEER_CONNECT_TURN_POLICY,
    ice_servers: grant.ice_servers,
    expires_at: grant.expires_at,
  };
}

export function turnSourceFrom(cache: IceServersCache): TurnSource {
  return async (cid: bigint): Promise<TurnConfig | null> => turnConfigFrom(await cache.get(cid));
}
