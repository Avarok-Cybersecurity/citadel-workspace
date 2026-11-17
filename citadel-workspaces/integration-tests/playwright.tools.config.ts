/**
 * Config for the one-off tools in `src/tools/`.
 *
 * They are not tests and must never run as part of the suite, so the main
 * config's `testDir` deliberately excludes them. That left them unrunnable:
 * naming a file outside `testDir` on the command line matches nothing, and
 * Playwright reports "No tests found" rather than saying the path is out of
 * scope — so the invocation documented in each tool's header silently listed
 * zero tests.
 *
 * Run a tool with:
 *   npx playwright test --config=playwright.tools.config.ts src/tools/<name>.spec.ts
 */

import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testDir: './src/tools',
  // Tools capture and report; a retry would silently overwrite the artefact the
  // first attempt produced.
  retries: 0,
});
