import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { unstable_readConfig } from "wrangler";

// The real Worker (worker.mjs: control plane + tenant Durable Object with its wasm server) under
// Miniflare, with a local D1 migrated from control/migrations.
const migrations = await readD1Migrations("./control/migrations");
// wrangler.toml as wrangler itself reads it -- the configuration `wrangler deploy` would ship --
// for the tests that hold production to its promises (test/production-config.test.mjs). The
// bindings below override some of these vars for every other test; this copy is untouched.
const production = unstable_readConfig({ config: "./wrangler.toml" });
const PRODUCTION_CONFIG = JSON.stringify({ vars: production.vars, routes: production.routes, assets: production.assets });

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./worker.mjs",
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          PRODUCTION_CONFIG,
          // Test-only values. The Turnstile secret is Cloudflare's always-pass testing secret; the
          // tests answer siteverify themselves at the fetch boundary, so it never leaves the process.
          TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
          TURNSTILE_HOSTNAMES: "example.com",
          STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
          STRIPE_PORTAL_CONFIGURATION: "bpc_test_citadel",
          STRIPE_WEBHOOK_SECRET: "whsec_vitest_only",
          // Answered in-process by test/helpers.mjs outbound(); never sent to Cloudflare.
          TURN_KEY_ID: "turn_key_vitest",
          TURN_KEY_API_TOKEN: "turn_token_vitest",
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
