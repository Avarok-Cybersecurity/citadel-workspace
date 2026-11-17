/**
 * The one place a `PeerConnect` or `PeerConnectAccept` gains its `turn` field.
 *
 * Both are built in `P2POperations`: `openP2PConnection` (the ordinary
 * initiator, the leader initiating on behalf of the other same-browser session,
 * the forced initiator after a ClaimSession) and `acceptPeerConnect` (the side
 * that answers). Each asks for its OWN session's relay servers. With none, the
 * field is left off entirely rather than sent as null, so an agent that
 * predates it sees exactly the request it always has.
 *
 * Only `withTurn` lives here: it is on the eager request path. Turning a grant
 * into a config is in turn-source.ts, which only the lazy relay lookup loads.
 */
import type { TurnConfig } from '@/types/ice-servers';

/** Resolves the `turn` field for a request sent by `cid`, or null. */
export type TurnSource = (cid: bigint) => Promise<TurnConfig | null>;

/** The request body with `turn` attached when there is one, and untouched when not. */
export function withTurn<T extends object>(body: T, turn: TurnConfig | null): T | (T & { turn: TurnConfig }) {
  return turn === null ? body : { ...body, turn };
}
