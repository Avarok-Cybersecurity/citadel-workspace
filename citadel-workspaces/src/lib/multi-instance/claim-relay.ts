/**
 * A session claimed in one tab, heard in every tab.
 *
 * `SESSION_CLAIMED` is emitted on this tab's bus when a ClaimSession succeeds
 * (websocket/session-management.ts). The leader claims its followers' sessions
 * on its own connection, so the tab whose session it is did not make the claim;
 * this carries it over the instance channel. A relayed event is not sent back.
 */
export const SESSION_CLAIMED: 'session:claimed' = 'session:claimed';

export interface ClaimedEvent {
  cid: bigint;
  /** Heard from another tab, not claimed here. */
  relayed?: true;
}

export interface ClaimRelayDeps {
  on: (event: string, handler: (payload: unknown) => void) => void;
  /** Tell every other tab that `cid` was claimed. */
  send: (cid: bigint) => void;
}

export function installClaimRelay(deps: ClaimRelayDeps): void {
  deps.on(SESSION_CLAIMED, (payload: unknown): void => {
    const event: ClaimedEvent = payload as ClaimedEvent;
    if (event.relayed !== true) deps.send(event.cid);
  });
}

/** The event a 'session-claimed' channel message carries, or null for a malformed one. */
export function claimedFromChannel(payload: unknown): ClaimedEvent | null {
  const cid: unknown = (payload as { cid?: unknown } | null | undefined)?.cid;
  return typeof cid === 'bigint' ? { cid, relayed: true } : null;
}
