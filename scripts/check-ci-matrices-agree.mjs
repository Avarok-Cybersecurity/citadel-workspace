#!/usr/bin/env node
/**
 * The UI submodule's integration matrix must cover everything the parent's does.
 *
 * All UI work lands through submodule PRs. When the parent grew thirteen
 * integration legs that the submodule's own workflow never gained —
 * file-manager, both revfs suites, all six tree suites, office and room chat,
 * peer-group, native-file-picker — those suites did not run on the PR that
 * changed the code they cover. They ran later, on the parent's pointer bump,
 * against a change that had already been reviewed and merged.
 *
 * That is the worst place for a gap: the checks exist, they are green on the
 * PR page, and the ones missing are invisible precisely because nothing lists
 * them.
 *
 * The parent may legitimately run MORE than the submodule (it owns the Rust
 * side), so this is a subset check in one direction only.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PARENT = join(ROOT, '.github/workflows/validate.yml');
const CHILD = join(ROOT, 'citadel-workspaces/.github/workflows/validate.yml');

/** The `- test: test:<name>` legs of an integration matrix. */
function legs(path) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    console.error(`check-ci-matrices-agree: cannot read ${path}, so nothing was compared.`);
    process.exit(1);
  }
  const found = [...source.matchAll(/-\s*test:\s*(test:[\w:-]+)/g)].map((m) => m[1]);
  return new Set(found);
}

const parent = legs(PARENT);
const child = legs(CHILD);

// A scan that finds nothing looks exactly like a scan that passes.
if (parent.size < 10) {
  console.error(
    `check-ci-matrices-agree: only ${parent.size} legs found in the parent workflow — ` +
      'its matrix changed shape, so this comparison cannot be trusted.',
  );
  process.exit(1);
}

const missing = [...parent].filter((leg) => !child.has(leg)).sort();

if (missing.length > 0) {
  console.error(
    `The UI submodule's workflow is missing ${missing.length} integration leg(s) the parent runs:\n`,
  );
  for (const leg of missing) console.error(`  ${leg}`);
  console.error(
    '\nUI changes land through submodule PRs, so these suites would not run on the' +
      '\nPR that changes the code they cover. Add them to' +
      '\ncitadel-workspaces/.github/workflows/validate.yml.',
  );
  process.exit(1);
}

console.log(
  `The UI submodule runs all ${parent.size} integration legs the parent does ` +
    `(${child.size - parent.size} additional).`,
);
