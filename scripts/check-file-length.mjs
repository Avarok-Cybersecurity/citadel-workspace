#!/usr/bin/env node
/**
 * The 250-line cap on UI source files.
 *
 * This lived only as inline bash inside validate.yml, so there was no way to run
 * it locally without hand-copying the loop and the skip list. That is not a
 * hypothetical cost: the cap was pushed over and committed three separate times,
 * twice AFTER the failure was recorded, because the local loop ran tsc, eslint
 * and vitest and had no way to run this.
 *
 * A CI gate with no runnable local form is a gate that will be broken by
 * whoever cannot run it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'citadel-workspaces', 'src');
const LIMIT = 250;

/**
 * Files that pre-date the cap and already exceeded it. The cap was introduced
 * after they were written, so they are tracked as known violations rather than
 * refactored in whatever PR happens to touch them.
 */
const SKIP = new Set([
  'components/ui/sidebar.tsx',
  'components/layout/sidebar/TreeNodesSection.tsx',
  'components/p2p/ChatSettingsPanel.tsx',
  'lib/file-transfer/service.ts',
  'pages/Landing.tsx',
  'types/messaging-layer.ts',
  'types/workspace-protocol.ts',
]);

if (!statSync(SRC, { throwIfNoEntry: false })) {
  console.error('check-file-length: citadel-workspaces/src is missing, so nothing was checked.');
  process.exit(1);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Tests are excluded on purpose. The cap exists to stop a MODULE
      // accreting responsibilities; a test file's length measures how many
      // cases are covered, which is the opposite signal.
      if (entry !== '__tests__' && entry !== 'node_modules') yield* walk(full);
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.bak')) {
      yield full;
    }
  }
}

const violations = [];
let checked = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  if (SKIP.has(rel)) continue;
  checked += 1;
  const lines = readFileSync(file, 'utf8').split('\n').length - 1;
  if (lines > LIMIT) violations.push({ rel, lines });
}

if (violations.length > 0) {
  for (const { rel, lines } of violations.sort((a, b) => b.lines - a.lines)) {
    console.error(`::error file=citadel-workspaces/src/${rel}::${rel} has ${lines} lines (limit: ${LIMIT})`);
  }
  console.error(`\nFAIL: ${violations.length} file(s) exceed the ${LIMIT}-line limit.`);
  console.error('Extract a cohesive unit rather than compressing prose — and note that');
  console.error('rewriting a comment at the same length does not reduce the count.');
  process.exit(1);
}

console.log(`All ${checked} TypeScript files are within the ${LIMIT}-line limit.`);
