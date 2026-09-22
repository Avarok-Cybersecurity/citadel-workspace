/**
 * Serves the tenant worker under `wrangler dev` with the named tenants created through the
 * control plane, for proofs that drive it from outside (proof.mjs, the agent's
 * over_websocket_endpoint test, the kernel's hosted-tenant claim test):
 *
 *   PROOF_PORT=8827 [PROOF_LOCAL_PROTOCOL=https] \
 *     node serve-tenants.mjs <persist-dir> <claims-file> <slug>...
 *
 * Writes `{"<slug>": "<claim code>"}` to <claims-file> (mode 0600) and prints only each code's
 * SHA-256 prefix; prints SERVING once every tenant is active, then serves until SIGINT/SIGTERM
 * and stops wrangler's whole process group. <persist-dir> must be fresh: the slugs are created in it.
 */
import { writeFileSync } from "node:fs";
import { DEV_OVERRIDES, HTTP_BASE, provision, startWrangler, stopWrangler } from "./proof-lib.mjs";

const [persistTo, claimsFile, ...slugs] = process.argv.slice(2);
if (!persistTo || !claimsFile || slugs.length === 0) {
  console.error("usage: node serve-tenants.mjs <persist-dir> <claims-file> <slug>...");
  process.exit(2);
}

const wrangler = await startWrangler(persistTo, DEV_OVERRIDES);
let stopping = false;
const stop = async (code) => {
  if (stopping) return;
  stopping = true;
  await stopWrangler(wrangler);
  process.exit(code);
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

try {
  const claims = {};
  for (const slug of slugs) {
    claims[slug] = await provision(slug);
    const prefix = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(claims[slug]))).toString("hex").slice(0, 8);
    console.log(`PROVISIONED ${slug}: active, object holds the claim code (sha256 ${prefix}…)`);
  }
  writeFileSync(claimsFile, JSON.stringify(claims), { mode: 0o600 });
  console.log(`SERVING ${HTTP_BASE} tenants=${slugs.join(",")}`);
} catch (e) {
  console.error(`serve-tenants failed: ${e?.stack ?? e}`);
  if (process.env.PROOF_VERBOSE === undefined) console.error(wrangler.output().slice(-4000));
  await stop(1);
}
