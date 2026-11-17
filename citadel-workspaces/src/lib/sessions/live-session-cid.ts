import { sessionIsOnServer } from './same-server';
import type { ActiveSession } from '@/types/session-types';

/**
 * The CID the agent holds for this account right now, if it holds one.
 *
 * The stored record's CID is a copy, and copies go stale -- a boot used to
 * erase them all. The agent's live list is the authority the landing page
 * resumes from; matched by username and by the typed host, since behind the
 * edge `server_address` is the resolved address (see same-server).
 *
 * A session whose address cannot be read as a host at all (no `server_host`, and
 * a bare IP for `server_address`) cannot be judged by server. It is taken only
 * when it is the one live session with that username; a readable, different
 * host stays a mismatch, because taking it would switch to another account.
 * The same holds for a stored record with no server at all, which older sign-ins
 * wrote (see session-label): measured live as an unreachable held account.
 */
export function liveSessionCid(
  live: readonly ActiveSession[],
  account: { username: string; serverAddress: string },
): bigint | undefined {
  const named: ActiveSession[] = live.filter((s: ActiveSession) => s.username === account.username);
  const onServer: ActiveSession | undefined = named.find((s: ActiveSession) => sessionIsOnServer(s, account.serverAddress));
  if (onServer) return onServer.cid;
  const unknowable: boolean = account.serverAddress.trim() === '' || (named.length === 1 && addressIsOpaque(named[0]));
  return named.length === 1 && unknowable ? named[0].cid : undefined;
}

const IP_LITERAL: RegExp = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?$/i;

function addressIsOpaque(session: ActiveSession): boolean {
  return !session.server_host && IP_LITERAL.test(session.server_address.trim());
}
