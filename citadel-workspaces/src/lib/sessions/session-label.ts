import { sessionHost } from './same-server';
import type { ActiveSession, StoredSession } from '@/types/session-types';

export interface SessionLabel {
  serverAddress: string;
  fullName: string;
}

/**
 * What a signed-in session is filed under: its server and the name to show.
 *
 * The login used to take both from this browser's stored copy, falling back to
 * `''` and to the username. A sign-in from a browser with no copy (a takeover,
 * a new device) therefore stored `serverAddress: ''` -- which no live session
 * matches, so the switcher reported "Session CID not available" for the account
 * -- and replaced the real name with the handle for every browser, since the
 * list is agent-wide. The agent knows the server of the CID it just
 * authenticated; that wins. The stored name survives a password sign-in.
 */
export function sessionLabel(
  cid: bigint,
  username: string,
  live: readonly ActiveSession[],
  stored: StoredSession | undefined,
): SessionLabel {
  const session: ActiveSession | undefined = live.find((s: ActiveSession) => s.cid === cid);
  const serverAddress: string = (session ? sessionHost(session) : '') || stored?.serverAddress || '';
  const fullName: string = stored?.fullName?.trim() || username;
  return { serverAddress, fullName };
}
