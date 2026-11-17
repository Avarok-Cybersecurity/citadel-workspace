/**
 * Merging two lists of messages, with the conflict winner stated.
 *
 * There were two functions called `mergeMessages`, over the same `P2PMessage`
 * type, resolving a duplicate id in OPPOSITE directions:
 *
 *   useP2PMessages-types   the existing copy wins; incoming duplicates are
 *                          filtered out, and the previous array reference is
 *                          returned unchanged when nothing is new
 *   p2p-messaging-adapter  the incoming copy wins, because there it meant
 *                          "in-memory state, which is newer than storage"
 *
 * Both were right for their own call site and neither said so. A maintainer
 * fixing "the merge" would have found one of them.
 *
 * That adapter has since been deleted -- it was an unwired layer duplicating
 * logic both chats implement in their own hooks. The winner stays an argument
 * regardless: the reason it is one is that a merge without a stated direction
 * is a coin toss the reader cannot see, which is true with one caller too.
 *
 * So the winner is now an argument. The difference between the two call sites
 * is a sentence at each, rather than a fact you can only learn by reading both
 * bodies and noticing they disagree.
 *
 * Note the asymmetry that is NOT a bug: the existing-wins caller returns the
 * same array reference when nothing changed, because React re-renders on
 * reference inequality and a chat thread re-sorts on every keystroke otherwise.
 * That optimisation only makes sense when incoming duplicates are discarded.
 */

export interface HasId {
  id: string;
  timestamp: number;
}

export type ConflictWinner = 'existing' | 'incoming';

/**
 * `existing` and `incoming` merged by id, sorted by timestamp.
 *
 * With `winner: 'existing'` the previous array REFERENCE is returned when
 * nothing new arrived — callers rely on that for render stability.
 */
export function mergeById<T extends HasId>(
  existing: T[],
  incoming: T[],
  winner: ConflictWinner,
): T[] {
  if (winner === 'existing') {
    if (existing.length === 0) return [...incoming];

    const seen: Set<string> = new Set(existing.map((m) => m.id));
    const fresh: ReturnType<typeof incoming.filter> = incoming.filter((m): boolean => !seen.has(m.id));
    if (fresh.length === 0) return existing;

    return [...existing, ...fresh].sort((a, b) => a.timestamp - b.timestamp);
  }

  const byId: Map<string, T> = new Map<string, T>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);

  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
}
