#!/usr/bin/env node
/**
 * Renders billing/policy.json into the marked billing-policy blocks of the Customer Terms and the
 * Terms of Use (citadel-workspace-types/src/{customer,platform}_terms.md). Run it after changing
 * the policy, then copy the two texts to the UI's bundle (citadel-workspaces/src/lib/terms/
 * documents/) and bump the terms versions the change needs.
 *
 * Idempotent: a second run writes nothing. A missing policy key or block marker fails and writes
 * nothing. scripts/check-billing-terms-render.mjs fails CI when the committed texts are stale.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBillingTerms } from './lib/billing-terms.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let rendered;
try {
  rendered = renderBillingTerms((path) => readFileSync(join(ROOT, path), 'utf8'));
} catch (error) {
  console.error(`render-billing-terms: ${error.message}`);
  process.exit(1);
}
let written = 0;
for (const { path, before, after } of rendered) {
  if (after === before) continue;
  writeFileSync(join(ROOT, path), after);
  written += 1;
  console.log(`rendered ${path}`);
}
console.log(`render-billing-terms: ${written} of ${rendered.length} documents changed.`);
