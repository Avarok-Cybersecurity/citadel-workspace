/**
 * The tenant's OPRF seed: the server key of post-quantum sign-in's password hardening
 * (docs/plans/pq-sign-in.md). Every account's OPRF key is derived from it, so a stolen copy of the
 * accounts alone cannot drive an offline password guess: the guesser needs this too.
 *
 * Kept as stored-seed.mjs keeps every object secret: its own key, never logged, never reported by
 * stats, never sent anywhere but into the node. 32 bytes from the platform CSPRNG.
 */
import { SEED_BYTES, storedSeed } from "./stored-seed.mjs";

export const OPRF_SEED_KEY = "control:oprf-seed";
export const OPRF_SEED_BYTES = SEED_BYTES;

// A malformed seed is never repaired by generating another: a new seed silently locks out every
// post-quantum account, which is worse than a node that refuses to start.
const OPRF_SEED = storedSeed(OPRF_SEED_KEY, "OPRF seed");

/**
 * The stored seed, generated and stored first if there is none: at provisioning, and on the first
 * boot of a build that has this for an object provisioned before it. Idempotent: a seed once
 * stored is the seed for good. `random` is the CSPRNG (`crypto`).
 */
export async function ensureOprfSeed(storage, random) {
  return (await OPRF_SEED.read(storage)) ?? OPRF_SEED.generate(storage, random);
}

/**
 * A fresh seed for an object handed to a new tenant (a slug freed by a reservation that never
 * started, Provisioning.provision): it has no accounts, and one tenant's secret is not another's.
 */
export async function replaceOprfSeed(storage, random) {
  return OPRF_SEED.generate(storage, random);
}
