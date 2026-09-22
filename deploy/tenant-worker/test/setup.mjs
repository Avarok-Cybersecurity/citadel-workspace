import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, vi } from "vitest";

await applyD1Migrations(env.CONTROL_DB, env.TEST_MIGRATIONS);
afterEach(() => vi.restoreAllMocks());
