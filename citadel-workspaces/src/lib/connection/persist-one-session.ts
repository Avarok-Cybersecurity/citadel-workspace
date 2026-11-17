/**
 * Writing ONE session without overwriting the others.
 *
 * `citadel_sessions` is a single LocalDB key holding every remembered account,
 * and each tab holds its own `ConnectionState` with its own `_storedSessions`
 * array, loaded once at init. Both writers pushed that whole in-memory array to
 * the shared key — so a tab persisted its view of the world over everyone
 * else's.
 *
 * That is not a rare race. `updateSessionRole` runs on every `members:loaded`,
 * which fires at boot and on every node open, so:
 *
 *   tab 1 boots, memory [A]
 *   tab 2 boots (loads [A]), signs in B  -> disk [A, B]
 *   tab 1 opens any node -> members:loaded -> writes ITS [A] -> disk [A]
 *
 * B's stored credentials are gone. Next launch, B is not remembered and not
 * auto-reconnected, and nothing reported anything. The multi-tab flow is the
 * documented way to use and test this app, so the collision is the normal case
 * rather than an edge.
 *
 * The fix is to make the two operations mean what they say: upsert one session,
 * delete one session. Each re-reads the key, applies its single change, and
 * writes back — so entries a tab has never heard of survive.
 *
 * Merging on write alone would have been wrong: it would make removal
 * impossible, because a delete would be undone by the next tab's upsert. Both
 * halves have to go through the same read-modify-write.
 *
 * The peer-registration store solved the same collision by giving each account
 * its own key. That is the better shape and a migration; this is the same
 * correctness with no format change.
 */
import type { StoredSession, StoredSessions } from '@/types/session-types';
import type { ConnectionIO } from './io';
import { debugLog } from '@/lib/debug-config';
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import { markSessionsRead } from './sessions-read-state';

/**
 * Sessions currently on disk.
 *
 * `null` means the key is genuinely ABSENT -- nothing has been stored yet --
 * which is a real answer and the base for a first write. A read that FAILED is
 * rethrown, and the callers below do not write at all.
 *
 * That distinction is the whole point of this module, and the first version of
 * it got it backwards: it caught every rejection and fell back to this tab's
 * in-memory list, which is precisely the whole-list write the file exists to
 * remove. A timeout would have clobbered the very accounts it is meant to
 * protect, while reporting success.
 *
 * Not writing costs the ability to reconnect automatically next time, which is
 * what `storeSession`'s own contract already says it may cost: "It does not
 * cost the session that was just authenticated." Writing the wrong list costs
 * somebody else's stored account, permanently, with no signal.
 */
async function onDisk(io: ConnectionIO): Promise<StoredSessions | null> {
  try {
    return await io.loadSessionsFromLocalDB();
  } catch (error) {
    if (isGenuinelyAbsent(error)) {
      debugLog('ConnectionIO', 'No sessions stored yet; this is the first write');
      // Genuine absence is a complete picture of nothing, so the write that
      // follows is allowed to land. Says so explicitly rather than leaving
      // storeSessionsToLocalDB's guard to infer it.
      markSessionsRead();
      return null;
    }
    throw error;
  }
}

const sameAccount = (a: StoredSession, username: string, serverAddress: string): boolean =>
  a.username === username && a.serverAddress === serverAddress;

/**
 * Upsert one session into the shared key.
 *
 * `fallback` is this tab's in-memory list, used only when the key cannot be
 * read at all: writing one tab's view is worse than losing nothing, but losing
 * the session the user just authenticated is worse still.
 */
export async function persistSessionUpsert(
  session: StoredSession, fallback: StoredSessions, io: ConnectionIO,
): Promise<void> {
  const current: StoredSessions | null = await onDisk(io);
  // Absent means nothing is stored, so this tab's list is the whole truth.
  // A FAILED read never reaches here -- `onDisk` rethrows it.
  const base: StoredSession[] = current ? [...current.sessions] : [...fallback.sessions];

  const index: number = base.findIndex((s) => sameAccount(s, session.username, session.serverAddress));
  if (index >= 0) base[index] = session;
  else base.push(session);

  await io.storeSessionsToLocalDB({ sessions: base });
}

/** Delete one session from the shared key, leaving every other entry alone. */
export async function persistSessionRemoval(
  username: string, serverAddress: string, fallback: StoredSessions, io: ConnectionIO,
): Promise<void> {
  const current: StoredSessions | null = await onDisk(io);
  const base: StoredSession[] = current ? current.sessions : fallback.sessions;

  await io.storeSessionsToLocalDB({
    sessions: base.filter((s) => !sameAccount(s, username, serverAddress)),
  });
}
