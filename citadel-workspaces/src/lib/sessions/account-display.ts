/**
 * How the account manager names a workspace and recognises the account in use.
 *
 * It printed the agent's `server_address`, which for a hosted workspace is how
 * the agent DIALLED (`wss://bench.work.avarok.net/`), not what the user typed
 * (`bench.work.avarok.net`), and a "Session 6W1TP1" code nobody can use. It
 * also judged "current" from the global connection, which names nobody in a
 * tab that resumed its session, so the account in use was offered "Switch".
 */
import { sessionIsOnServer, type SessionServer } from './same-server';

interface TypedAddress { username: string; serverAddress: string }

/** The host as the user typed it: the agent's record, the saved account's, or the dialled URL's host. */
export function accountHost(session: SessionServer & { username: string }, saved: TypedAddress[]): string {
  if (session.server_host) return session.server_host;
  const typed: TypedAddress | undefined = saved.find(
    (s: TypedAddress) => s.username === session.username && sessionIsOnServer(session, s.serverAddress),
  );
  if (typed) return typed.serverAddress;
  try {
    const url: URL = new URL(session.server_address);
    if (url.protocol === 'ws:' || url.protocol === 'wss:') return url.host;
  } catch {
    // Not a URL: a bare host[:port], already what was typed.
  }
  return session.server_address;
}

/** This tab's account, by CID when the tab knows it and by username otherwise. */
export interface TabAccount { cid?: bigint; username?: string }

export function isCurrentAccount(tab: TabAccount | null, account: { cid?: bigint; username: string }): boolean {
  if (!tab) return false;
  if (tab.cid !== undefined && account.cid !== undefined) return tab.cid === account.cid;
  return tab.username !== undefined && tab.username === account.username;
}
