/**
 * The record of which accounts the user deliberately signed out of.
 *
 * Auto-reconnect reads it before scheduling anything, so an entry here is the
 * only thing standing between a stored session with a remembered password and
 * being signed back in on the next boot. `persistUserDisconnectedSessions`
 * refuses to write the set when it was never successfully read, for that
 * reason — see persistence.ts.
 *
 * Split out of `service.ts` when it passed the 250-line cap: the key format
 * is the one spelling of it, where it was written by hand at
 * three sites before this.
 */
/**
 * How a session is named in this set.
 *
 * `username@serverAddress`, matching `getSessionKey` in reconnect-logic and
 * the keys the poll compares against. One spelling, because a mismatch here
 * does not fail loudly — it silently reconnects an account the user left.
 */
export function signOutKey(username: string, serverAddress: string): string {
  return `${username}@${serverAddress}`;
}
