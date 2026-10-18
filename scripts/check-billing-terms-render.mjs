#!/usr/bin/env node
/**
 * The terms people accept state billing/policy.json's grace days, termination rules and alert
 * thresholds. Rendering is a step somebody runs (scripts/render-billing-terms.mjs), so a policy
 * change without a re-render, or a hand edit inside a billing-policy block, would leave the terms
 * promising one thing while the Worker does another. This re-renders both documents from the
 * policy, in memory and through the renderer's own code, and fails when either committed text
 * differs from its rendering.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBillingTerms } from './lib/billing-terms.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let rendered;
try {
  rendered = renderBillingTerms((path) => readFileSync(join(ROOT, path), 'utf8'));
} catch (error) {
  console.error(`check-billing-terms-render: ${error.message}`);
  process.exit(1);
}

const stale = rendered.filter(({ before, after }) => before !== after);
for (const { path, before, after } of stale) {
  const was = before.split('\n');
  const now = after.split('\n');
  const line = now.findIndex((text, i) => text !== was[i]);
  console.error(`${path} is not what billing/policy.json renders. First difference, line ${line + 1}:`);
  console.error(`  committed: ${was[line] ?? '(end of file)'}`);
  console.error(`  rendered:  ${now[line] ?? '(end of file)'}`);
}
if (stale.length) {
  console.error('\nRun `node scripts/render-billing-terms.mjs`, copy both texts to citadel-workspaces/src/lib/terms/documents/,');
  console.error('and bump the terms versions. Edit billing wording in scripts/lib/billing-terms-wording.mjs, never inside a block.');
  process.exit(1);
}
const blocks = rendered.reduce((sum, r) => sum + r.blocks, 0);
console.log(`The billing terms match billing/policy.json: ${blocks} blocks in ${rendered.length} documents compared.`);
