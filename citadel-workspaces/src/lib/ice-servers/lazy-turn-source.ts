/**
 * The relay lookup, loaded on the first PeerConnect instead of with the app.
 *
 * The websocket service is on the landing page's critical path and the relay
 * cache is not needed until a peer connection opens, so the service holds only
 * this wrapper. A failed chunk load is not a failed connect: it answers null
 * (connect without a relay) and is retried on the next call.
 */
import { warnLog } from '@/lib/debug-config';
import type { TurnConfig } from '@/types/ice-servers';
import type { TurnSource } from './peer-connect-turn';

export function lazyTurnSource(load: () => Promise<TurnSource>): TurnSource {
  let loading: Promise<TurnSource> | null = null;
  return async (cid: bigint): Promise<TurnConfig | null> => {
    loading ??= load();
    let source: TurnSource;
    try {
      source = await loading;
    } catch (error: unknown) {
      loading = null;
      warnLog('IceServers', 'relay lookup did not load', error);
      return null;
    }
    return source(cid);
  };
}
