/**
 * The accounts this device knows, each identified by (username, server), and the one
 * answer to "which of them belong to server X".
 *
 * A username is unique only on its server, so a name alone cannot say which account
 * is meant. The sources, in order of authority: the agent's own accounts
 * (GetAccountInformation's server_host), the browser's saved sessions, and this
 * device's sign-in hints; an old passkey record carries a name and no server.
 */
import { dialledHost, sameAddress } from './same-server';

export interface KnownAccount {
  readonly username: string;
  /** The server's host, or null when nothing on this device records it. */
  readonly server: string | null;
}

export interface AccountSources {
  agent: readonly { username: string; server: string }[];
  stored: readonly { username: string; serverAddress: string }[];
  hints: readonly { username: string; tenant: string }[];
  /** Names with no server recorded (old passkey records). */
  device: readonly string[];
}

const hostOf = (address: string): string | null => (address.trim() === '' ? null : dialledHost(address));

function byNameThenServer(a: KnownAccount, b: KnownAccount): number {
  if (a.username !== b.username) return a.username.localeCompare(b.username);
  if (a.server === null || b.server === null) return a.server === null ? (b.server === null ? 0 : 1) : -1;
  return a.server.localeCompare(b.server);
}

function dedupe(entries: readonly KnownAccount[]): KnownAccount[] {
  const out: KnownAccount[] = [];
  for (const entry of entries) {
    const same = (k: KnownAccount): boolean => k.username === entry.username
      && (k.server === null ? entry.server === null : entry.server !== null && sameAddress(k.server, entry.server));
    if (!out.some(same)) out.push(entry);
  }
  // An unplaced name is dropped where another entry says where that account is.
  const placed = (name: string): boolean => out.some((k: KnownAccount) => k.username === name && k.server !== null);
  return out.filter((k: KnownAccount) => k.server !== null || !placed(k.username)).sort(byNameThenServer);
}

export function knownAccounts(sources: AccountSources): KnownAccount[] {
  return dedupe([
    ...sources.agent.map((a) => ({ username: a.username, server: hostOf(a.server) })),
    ...sources.stored.map((s) => ({ username: s.username, server: hostOf(s.serverAddress) })),
    ...sources.hints.map((h) => ({ username: h.username, server: hostOf(h.tenant) })),
    ...sources.device.map((name: string) => ({ username: name, server: null })),
  ]);
}

/** The accounts on `server`. An account whose server is unrecorded is never counted as on it. */
export function accountsOnServer(accounts: readonly KnownAccount[], server: string): KnownAccount[] {
  return accounts.filter((a: KnownAccount) => a.server !== null && sameAddress(a.server, server));
}

export type TypedAccountCheck =
  | { readonly kind: 'fine' }
  /** Known on other servers only: signing in with it would reach one of those, not `server`. */
  | { readonly kind: 'elsewhere'; readonly username: string; readonly servers: readonly string[] };

export function checkTypedAccount(accounts: readonly KnownAccount[], typed: string, server: string | null): TypedAccountCheck {
  const username: string = typed.trim();
  if (server === null || username === '') return { kind: 'fine' };
  const named: KnownAccount[] = accounts.filter((a: KnownAccount) => a.username === username);
  if (named.some((a: KnownAccount) => a.server === null || sameAddress(a.server, server))) return { kind: 'fine' };
  const servers: string[] = named.map((a: KnownAccount) => a.server as string);
  return servers.length === 0 ? { kind: 'fine' } : { kind: 'elsewhere', username, servers };
}

/**
 * The passkey rows for the offered names, one per (username, server): a sign-in hint
 * names its server; an old passkey record takes the servers the account is known on.
 * With a server chosen, only its rows: an unplaced row could be the wrong account.
 */
export function offeredRows(
  offered: readonly string[], hints: readonly { username: string; tenant: string }[], device: readonly string[],
  accounts: readonly KnownAccount[], server: string | null,
): KnownAccount[] {
  const rows: KnownAccount[] = offered.flatMap((name: string): KnownAccount[] => {
    const hinted: KnownAccount[] = hints.filter((h) => h.username === name).map((h) => ({ username: name, server: hostOf(h.tenant) }));
    if (!device.includes(name)) return hinted;
    const where: KnownAccount[] = accounts.filter((a: KnownAccount) => a.username === name);
    return [...hinted, ...(where.length > 0 ? where : [{ username: name, server: null }])];
  });
  const all: KnownAccount[] = dedupe(rows);
  return server === null ? all : accountsOnServer(all, server);
}

/**
 * This device's account named `typed` on another server than `server`, or null. One device
 * holds one account per username (the agent stores accounts by username), so registering it
 * on `server` would overwrite that account; the agent refuses it too.
 */
export function heldForAnotherServer(accounts: readonly KnownAccount[], typed: string, server: string): KnownAccount | null {
  const username: string = typed.trim();
  if (username === '' || server.trim() === '') return null;
  return accounts.find((a: KnownAccount) => a.username === username && a.server !== null && !sameAddress(a.server, server)) ?? null;
}

export function heldUsernameCopy(username: string, server: string): string {
  return `This device already has an account named ${username} on ${server}. One device can hold one account per username: ` +
    `choose another username, or sign in to ${username} on ${server} instead.`;
}

/** The agent refused a registration: this device holds the name for another server. */
export class UsernameHeldElsewhere extends Error {
  constructor(username: string, server: string) {
    super(heldUsernameCopy(username, server));
    this.name = 'UsernameHeldElsewhere';
  }
}
