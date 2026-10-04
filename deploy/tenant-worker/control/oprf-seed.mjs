/**
 * The tenant's OPRF seed: the server key of post-quantum sign-in's password hardening
 * (docs/plans/pq-sign-in.md). Every account's OPRF key is derived from it, so a stolen copy of the
 * accounts alone cannot drive an offline password guess: the guesser needs this too.
 *
 * It lives in the object's key-value storage under its own key, apart from the node's `citadel_*`
 * SQL rows and from the provisioning record, and is never logged, never reported by stats and
 * never sent anywhere but into the node. 32 bytes from the platform CSPRNG.
 */

export const OPRF_SEED_KEY = "control:oprf-seed";
export const OPRF_SEED_BYTES = 32;

function checked(seed) {
  // ArrayBuffer.isView, not instanceof: a typed array from another realm fails instanceof.
  if (!ArrayBuffer.isView(seed) || seed.byteLength !== OPRF_SEED_BYTES) {
    // Never repaired by generating another: a new seed silently locks out every post-quantum
    // account, which is worse than a node that refuses to start.
    throw new Error(`the stored OPRF seed is not ${OPRF_SEED_BYTES} bytes; refusing to start sign-in`);
  }
  return new Uint8Array(seed.buffer, seed.byteOffset, seed.byteLength);
}

async function generate(storage, random) {
  const seed = random.getRandomValues(new Uint8Array(OPRF_SEED_BYTES));
  await storage.put(OPRF_SEED_KEY, seed);
  return seed;
}

/**
 * The stored seed, generated and stored first if there is none: at provisioning, and on the first
 * boot of a build that has this for an object provisioned before it. Idempotent: a seed once
 * stored is the seed for good. `random` is the CSPRNG (`crypto`).
 */
export async function ensureOprfSeed(storage, random) {
  const stored = await storage.get(OPRF_SEED_KEY);
  if (stored !== undefined) return checked(stored);
  return generate(storage, random);
}

/**
 * A fresh seed for an object handed to a new tenant (a slug freed by a reservation that never
 * started, Provisioning.provision): it has no accounts, and one tenant's secret is not another's.
 */
export async function replaceOprfSeed(storage, random) {
  return generate(storage, random);
}
