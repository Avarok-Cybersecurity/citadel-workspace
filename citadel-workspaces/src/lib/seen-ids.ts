/**
 * "Have I already handled this id, under this key?"
 *
 * A reliable transport redelivers, and every consumer of one needs this. It was
 * written first for RE-VFS operations (see revfs/seen-operations.ts for the CI
 * evidence that produced it) and is generic: the mechanism has nothing to do
 * with what the ids name.
 *
 * Bounded, because ids are unbounded. A few hundred per key is far more than a
 * redelivery window and small enough to be free.
 */
const MAX_REMEMBERED: number = 500;

const seen: Map<string, Set<string>> = new Map<string, Set<string>>();

/**
 * True the FIRST time this key sees this id, false afterwards.
 *
 * Keyed, because two sources can mint ids independently and a collision across
 * them would silently drop somebody's message.
 */
export function isNewId(key: string, id: string): boolean {
  let ids: Set<string> | undefined = seen.get(key);
  if (!ids) {
    ids = new Set<string>();
    seen.set(key, ids);
  }
  if (ids.has(id)) return false;
  ids.add(id);
  if (ids.size > MAX_REMEMBERED) {
    // Insertion order: drop the oldest, which is the least likely to be
    // redelivered now.
    const oldest: string | undefined = ids.values().next().value;
    if (oldest !== undefined) ids.delete(oldest);
  }
  return true;
}

/** Test seam: the map outlives a module import. */
export function forgetSeenIds(): void {
  seen.clear();
}

/**
 * Forget one id, so a later arrival is treated as new again.
 *
 * `isNewId` marks on the way in, which is right for a guard that runs before the
 * work. When the work then FAILS, the mark is a lie: the next delivery takes the
 * "already handled" path and is answered with a success it never earned. Undoing
 * the mark is what makes the redelivery a real second attempt.
 */
export function forgetId(key: string, id: string): void {
  seen.get(key)?.delete(id);
}
