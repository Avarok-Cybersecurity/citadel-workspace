/**
 * The server a Connect for a stored session names.
 *
 * The agent signs in only the account of that username on the server a Connect
 * names, so a reconnect from a stored record must name one. Older records have
 * none (`serverAddress: ''`). The agent knows every account's server
 * (GetAccountInformation's server_host, the resolver its Connect check uses), so a
 * record without one takes the agent's, and is backfilled so the next read has it.
 * When the agent cannot say either, nothing is guessed and nothing is retried:
 * the account is handed to a sign-in (sessions/sign-in-needed.ts), and the attempt ends with
 * StoredServerUnknown, which the reconnect paths treat as final.
 */
import type { StoredSession } from '@/types/session-types';
import type { AccountHost } from '@/lib/admission/account-servers';
import { debugLog } from '@/lib/debug-config';

/** The record's server, else the agent's account of that name's; null when neither says. */
export function serverOfStored(session: StoredSession, agent: readonly AccountHost[] | null): string | null {
  const recorded: string = session.serverAddress.trim();
  if (recorded !== '') return recorded;
  return agent?.find((a: AccountHost) => a.username === session.username)?.server ?? null;
}

/** No server is known for this record: retrying cannot help, only a sign-in can. */
export class StoredServerUnknown extends Error {
  readonly username: string;
  constructor(username: string) {
    super(`No server is recorded for ${username}, and the Citadel agent could not say which it is on`);
    this.name = 'StoredServerUnknown';
    this.username = username;
  }
}

export const isStoredServerUnknown = (error: unknown): error is StoredServerUnknown => error instanceof StoredServerUnknown;

export interface StoredServerIO {
  agentAccounts: () => Promise<readonly AccountHost[]>;
  /** Replace the record without a server by `filled`. */
  backfill: (filled: StoredSession) => Promise<void>;
  signInNeeded: (username: string) => void;
}

/** The server to name; backfills a record that had none. Throws StoredServerUnknown, having asked for a sign-in. */
export async function storedSessionServer(session: StoredSession, io: StoredServerIO): Promise<string> {
  const recorded: string = session.serverAddress.trim();
  if (recorded !== '') return recorded;
  let agent: readonly AccountHost[] | null = null;
  try {
    agent = await io.agentAccounts();
  } catch (error: unknown) {
    debugLog('ConnectionService', `The agent could not say which server ${session.username} is on`, error);
  }
  const server: string | null = serverOfStored(session, agent);
  if (server === null) {
    io.signInNeeded(session.username);
    throw new StoredServerUnknown(session.username);
  }
  await io.backfill({ ...session, serverAddress: server });
  // After the backfill, which removes the record by its old (empty) server: what the
  // caller stores from here on carries the server.
  session.serverAddress = server;
  return server;
}
