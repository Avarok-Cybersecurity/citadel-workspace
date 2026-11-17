/**
 * Run operations that read-modify-write the same record one at a time.
 *
 * The shape this exists for: load a record, mutate it in memory, save it back —
 * with awaits in between. Two of those running at once for the same key both
 * read the same value, each applies its own change to its own copy, and the
 * second save silently discards the first.
 *
 * It was extracted from `p2p/peer-write-lock`, where a received message
 * disappeared exactly that way — delivered, acknowledged, added to the cache,
 * and then written over. The RE-VFS tree has the identical shape and had no
 * lock, so a bulk delete under `Promise.all` had each operation capture the same
 * base tree: the last write resurrected everything the others had removed,
 * locally, as nodes whose backend bytes were already gone — while the peer,
 * which received each removal op separately, dropped them all. Silent
 * divergence between two trees that both believed they were correct.
 *
 * Keys are opaque strings. Different keys still proceed concurrently, because
 * the record they contend for is per-key and there is nothing to gain by
 * serialising across them.
 *
 * This is a lock on OUR writes, not a transaction: IndexedDB gives no
 * cross-await atomicity, and these operations span several stores.
 */
const chains: Map<string, Promise<unknown>> = new Map<string, Promise<unknown>>();

export function withSerialLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  // Two catches, doing two different jobs.
  //
  // This one keeps a failed operation from cancelling everything queued behind
  // it: without it, one rejection ends the chain for that key and every later
  // write silently never runs.
  const run: Promise<T> = (chains.get(key) ?? Promise.resolve()).catch((): undefined => undefined).then(operation);

  // And this one keeps a rejected promise from sitting in the map with nobody
  // awaiting it, which is an unhandled rejection. The caller still receives the
  // real rejection through `run` below — this is a second handle on the same
  // promise, not a swallow.
  chains.set(key, run.catch(() => undefined));

  return run;
}
