import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

// The real Worker (worker.mjs: control plane + tenant Durable Object with its wasm server) under
// Miniflare, with a local D1 migrated from control/migrations.
const migrations = await readD1Migrations("./control/migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./worker.mjs",
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          // Test-only values. The Turnstile secret is Cloudflare's always-pass testing secret; the
          // tests answer siteverify themselves at the fetch boundary, so it never leaves the process.
          TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
          TURNSTILE_HOSTNAMES: "example.com",
          STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
          STRIPE_WEBHOOK_SECRET: "whsec_vitest_only",
          TENANT_PATH_ROUTING: "on",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.mjs"],
    testTimeout: 60000,
  },
});
