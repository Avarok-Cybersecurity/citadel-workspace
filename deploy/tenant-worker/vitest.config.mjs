import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { unstable_readConfig } from "wrangler";
import { readdirSync, readFileSync } from "node:fs";

// The real Worker (worker.mjs: control plane + tenant Durable Object with its wasm server) under
// Miniflare, with a local D1 migrated from control/migrations.
const migrations = await readD1Migrations("./control/migrations");
// wrangler.toml as wrangler itself reads it -- the configuration `wrangler deploy` would ship --
// for the tests that hold production to its promises (test/production-config.test.mjs). The
// bindings below override some of these vars for every other test; this copy is untouched.
const production = unstable_readConfig({ config: "./wrangler.toml" });
const PRODUCTION_CONFIG = JSON.stringify({ vars: production.vars, routes: production.routes, assets: production.assets });
// Batch 1116's frozen contract (lane C0): the /.well-known/citadel schema, its fixtures and the
// server known answers, read where C0 publishes them, so the tests hold the Worker to that copy.
const C0 = "../../docs/contracts/batch-1116";
const c0 = (path) => readFileSync(`${C0}/${path}`, "utf8");
const CONTRACT_WELL_KNOWN = JSON.stringify({
  schema: JSON.parse(c0("well-known-citadel.schema.json")),
  fixtures: Object.fromEntries(readdirSync(`${C0}/fixtures/well-known-citadel`).map((f) => [f, c0(`fixtures/well-known-citadel/${f}`)])),
  servers: JSON.parse(c0("identity-kat.json")).servers,
});
// "Sign in with Citadel": the schema's $defs, every fixture (by "<Def>/<file>"), the known answers,
// and identity B's public key (the forged-proof case swaps it in).
const SIGN_IN_FIXTURES = `${C0}/fixtures/sign-in-with-citadel`;
const CONTRACT_SIGN_IN = JSON.stringify({
  defs: JSON.parse(c0("sign-in-with-citadel.schema.json")).$defs,
  fixtures: Object.fromEntries(
    readdirSync(SIGN_IN_FIXTURES).flatMap((def) =>
      readdirSync(`${SIGN_IN_FIXTURES}/${def}`).map((f) => [`${def}/${f}`, c0(`fixtures/sign-in-with-citadel/${def}/${f}`)]),
    ),
  ),
  kat: JSON.parse(c0("sign-in-kat.json")),
  identityB: JSON.parse(c0("identity-kat.json")).identities.B.pk_b64url,
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./worker.mjs",
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          PRODUCTION_CONFIG,
          CONTRACT_WELL_KNOWN,
          CONTRACT_SIGN_IN,
          // The contract's TEST issuer seed (sign-in-kat.json issuer.key.seed_hex) and its issuer-only
          // document's issued_at, so the control host reproduces valid-issuer-only.json; never production's.
          CONTROL_SERVER_KEY_SEED: JSON.parse(c0("sign-in-kat.json")).issuer.key.seed_hex,
          CONTROL_SERVER_KEY_ISSUED_AT: String(JSON.parse(c0("fixtures/well-known-citadel/valid-issuer-only.json")).issued_at),
          // Test-only values. The Turnstile secret is Cloudflare's always-pass testing secret; the
          // tests answer siteverify themselves at the fetch boundary, so it never leaves the process.
          TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
          TURNSTILE_HOSTNAMES: "example.com",
          // Cloudflare's always-pass testing site key: public, and never rendered here.
          TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
          STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
          STRIPE_PORTAL_CONFIGURATION: "bpc_test_citadel",
          STRIPE_WEBHOOK_SECRET: "whsec_vitest_only",
          // Answered in-process by test/helpers.mjs outbound(); never sent to Cloudflare.
          TURN_KEY_ID: "turn_key_vitest",
          TURN_KEY_API_TOKEN: "turn_token_vitest",
          // The test support key's public half (test/support.test.mjs): its signed fixtures verify.
          CITADEL_SUPPORT_MLDSA_PUBLIC_KEY: JSON.parse(readFileSync("./test/fixtures/support-requests.json", "utf8")).public_key,
          TENANT_PATH_ROUTING: "on",
          TENANT_DIAGNOSTICS: "on",
        },
        // The UI is test/fixture-ui (the shape of a build: index.html's three empty meta tags, a
        // hashed bundle, sw.js, the manifest, a wasm binary), not ui-dist, which only a UI build makes.
        assets: {
          directory: "./test/fixture-ui",
          binding: "ASSETS",
          routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true },
          assetConfig: { not_found_handling: "single-page-application" },
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.mjs"],
    testTimeout: 60000,
  },
});
