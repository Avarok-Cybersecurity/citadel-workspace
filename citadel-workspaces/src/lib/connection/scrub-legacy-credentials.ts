/**
 * Retiring plaintext "Remember credentials".
 *
 * Earlier builds could write the account password and the workspace PSK into
 * `citadel_sessions` in the clear, on the agent's CID-0 store that any local
 * process can read. Passkey unlock replaces that: the password is kept, if at
 * all, only as AEAD ciphertext that needs the user's authenticator to open.
 *
 * So every stored session is scrubbed of both fields as it is read, keeping
 * who and where (username, server, CID) so the account list survives.
 */
import type { StoredSession, StoredSessions } from '@/types/session-types';

export interface ScrubResult {
  sessions: StoredSessions;
  /** How many entries carried a plaintext secret; > 0 means write back. */
  scrubbed: number;
}

export function scrubLegacyCredentials(stored: StoredSessions): ScrubResult {
  let scrubbed: number = 0;
  const sessions: StoredSession[] = stored.sessions.map((session) => {
    if (session.password === undefined && session.serverPassword === undefined) return session;
    scrubbed++;
    const { password: _password, serverPassword: _serverPassword, ...rest } = session;
    return rest;
  });
  return { sessions: { ...stored, sessions }, scrubbed };
}
