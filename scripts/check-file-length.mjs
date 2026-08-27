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
 * Files that pre-date the cap and already exceeded it, WITH the length each was
 * at when it was exempted. A file here may shrink; it may not grow.
 *
 * The exemption used to be a bare name, which is an allowance without a bound:
 * `components/ui/sidebar.tsx` is at 764 lines, three times the cap, and nothing
 * would have objected at 1500. That is the opposite of what the cap is for --
 * the exempt files are the ones most likely to keep accreting, because they are
 * the ones nobody is asked to split.
 *
 * Ratcheting also self-cleans: drop a file under the limit and the entry stops
 * being needed, and the check below says so rather than letting a dead
 * exemption sit there shielding a future violation.
 */
const SKIP = new Map([
  ['components/ui/sidebar.tsx', 764],
  ['components/layout/sidebar/TreeNodesSection.tsx', 356],
  ['components/p2p/ChatSettingsPanel.tsx', 330],
  ['lib/file-transfer/service.ts', 324],
  ['pages/Landing.tsx', 311],
  ['types/messaging-layer.ts', 605],
  ['types/workspace-protocol.ts', 355],
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
const grown = [];
const shrunk = [];
const seen = new Set();
let checked = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  const lines = readFileSync(file, 'utf8').split('\n').length - 1;

  const allowance = SKIP.get(rel);
  if (allowance !== undefined) {
    seen.add(rel);
    if (lines > allowance) grown.push({ rel, lines, allowance });
    else if (lines <= LIMIT) shrunk.push({ rel, lines });
    continue;
  }

  checked += 1;
  if (lines > LIMIT) violations.push({ rel, lines });
}

// An exemption for a file that no longer exists is an exemption waiting to
// shield a new file that takes the same path.
const missing = [...SKIP.keys()].filter((rel) => !seen.has(rel));

if (grown.length > 0) {
  for (const { rel, lines, allowance } of grown) {
    console.error(
      `::error file=citadel-workspaces/src/${rel}::${rel} is exempt at ${allowance} lines and has grown to ${lines}`,
    );
  }
  console.error(`\nFAIL: ${grown.length} exempt file(s) grew.`);
  console.error('An exemption is a ceiling, not a licence. Extract something, or');
  console.error("raise the entry in check-file-length.mjs and say why in the PR.");
  process.exit(1);
}

if (shrunk.length > 0) {
  for (const { rel, lines } of shrunk) {
    console.error(`${rel} is down to ${lines} lines and no longer needs its exemption.`);
  }
  console.error(`\nFAIL: remove ${shrunk.length} stale entr(y/ies) from SKIP.`);
  process.exit(1);
}

if (missing.length > 0) {
  for (const rel of missing) console.error(`${rel} is exempted but does not exist.`);
  console.error('\nFAIL: drop the dead entr(y/ies) from SKIP.');
  process.exit(1);
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

console.log(
  `All ${checked} TypeScript files are within the ${LIMIT}-line limit ` +
    `(${SKIP.size} pre-existing files held at their current length).`,
);
