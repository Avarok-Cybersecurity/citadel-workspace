/** Shared by the server identity tests: C0's copy, the document's route, and the signed-by check. */
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { expect } from "vitest";
import { SERVER_KEY_SEED_KEY } from "../control/tenant-identity.mjs";
import { violation } from "./json-schema.mjs";
import { publicKeyOf, serverPublicKey, signatureVerifies, toHex } from "./well-known-verify.mjs";

/** C0's schema, fixtures (by file name) and server known answers (vitest.config.mjs). */
export const C0 = JSON.parse(env.CONTRACT_WELL_KNOWN);
export const fixture = (name) => JSON.parse(C0.fixtures[name]);

export const wellKnownAt = (host) => SELF.fetch(`https://${host}/.well-known/citadel`);
export const storedSeed = (object) => runInDurableObject(object, (_i, state) => state.storage.get(SERVER_KEY_SEED_KEY));

/** Asserts `doc` is a C0 document whose signature verifies under the key `seed` derives. */
export function expectSignedBy(doc, seed) {
  expect(violation(C0.schema, doc)).toBeNull();
  const key = serverPublicKey(new Uint8Array(seed));
  expect(toHex(publicKeyOf(doc))).toBe(toHex(key));
  expect(signatureVerifies(doc, key)).toBe(true);
}
