/**
 * A 32-byte secret a tenant's object keeps in its own key-value storage, under its own key, apart
 * from the node's `citadel_*` SQL rows and from the provisioning record: the OPRF seed
 * (oprf-seed.mjs) and the server identity key seed (tenant-identity.mjs). Never logged, never
 * reported by stats, never sent anywhere but into the node.
 */

export const SEED_BYTES = 32;

/** `what` names the secret in refusals; `key` is its storage key. */
export function storedSeed(key, what) {
  const checked = (seed) => {
    // ArrayBuffer.isView, not instanceof: a typed array from another realm fails instanceof.
    if (!ArrayBuffer.isView(seed) || seed.byteLength !== SEED_BYTES) {
      // Never repaired by generating another: a replaced secret is worse than a node that refuses.
      throw new Error(`the stored ${what} is not ${SEED_BYTES} bytes; refusing to start`);
    }
    return new Uint8Array(seed.buffer, seed.byteOffset, seed.byteLength);
  };
  return {
    key,
    /** The stored seed, or null when there is none. Never generates one. */
    async read(storage) {
      const stored = await storage.get(key);
      return stored === undefined ? null : checked(stored);
    },
    /** A new seed from `random` (the CSPRNG, `crypto`), stored, replacing any before it. */
    async generate(storage, random) {
      const seed = random.getRandomValues(new Uint8Array(SEED_BYTES));
      await storage.put(key, seed);
      return seed;
    },
  };
}
