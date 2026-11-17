#!/usr/bin/env node
/**
 * Every `use*EventSetup` hook must appear in the unsubscribe test's table.
 *
 * Three of these hooks subscribed to workspace events and returned no cleanup,
 * so every remount left another set of live listeners behind. The first pass
 * fixed two of the three -- a correct fix applied in one place, which is this
 * repository's most productive defect class. The test now runs over a table of
 * hooks; this gate makes joining that table mandatory, so the fourth sibling
 * cannot be written without being covered.
 *
 * Node 18-compatible on purpose: the lint jobs run the oldest supported Node.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HOOK_DIR = 'src/components/hooks';
const TEST = join(HOOK_DIR, '__tests__/event-setups-let-go-on-unmount.test.tsx');

/**
 * `useMessageEventSetup` is deliberately absent: it tears down with
 * `cleanupAllListeners()`, which removes every listener in the application
 * rather than its own, so the per-hook counter the test uses cannot measure it.
 * That is a separate finding, recorded in ROBUSTNESS.md, not an exemption from
 * cleaning up.
 */
const EXEMPT = new Map([
  ['useMessageEventSetup', 'tears down via cleanupAllListeners(), not its own unsubscribes'],
]);

const hooks = readdirSync(HOOK_DIR)
  .filter((f) => /^use[A-Za-z]*EventSetup\.tsx?$/.test(f))
  .map((f) => f.replace(/\.tsx?$/, ''));

if (hooks.length === 0) {
  console.error('::error::found no use*EventSetup hooks -- this gate is looking in the wrong place');
  process.exit(1);
}

let test;
try {
  test = readFileSync(TEST, 'utf8');
} catch {
  console.error(`::error::${TEST} is missing -- the unsubscribe coverage it provides is gone`);
  process.exit(1);
}

const missing = [];
for (const hook of hooks) {
  if (EXEMPT.has(hook)) continue;
  if (!test.includes(`name: '${hook}'`)) missing.push(hook);
}

if (missing.length > 0) {
  for (const hook of missing) {
    console.error(
      `::error file=citadel-workspaces/${HOOK_DIR}/${hook}.ts::${hook} is not in the SETUPS table in ${TEST}. ` +
        'Add it there (name, use, event, payload) so its unsubscribe is proven, or list it in EXEMPT with a reason.',
    );
  }
  process.exit(1);
}

const covered = hooks.length - EXEMPT.size;
console.log(`  Event setups: ${covered} hook(s) proven to unsubscribe, ${EXEMPT.size} exempt  ok`);
