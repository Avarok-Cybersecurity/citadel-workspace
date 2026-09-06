/**
 * What triggers a WASM rebuild must be what the staleness stamp covers.
 *
 * Three things have to agree about which trees the WASM binary is built from:
 *
 *   - `scripts/wasm-source-trees.txt`, the list;
 *   - `sync-wasm-clients.sh`, which stamps the built artefact;
 *   - `citadel-workspace-internal-service/build.rs`, whose `rerun-if-changed`
 *     decides whether a local `cargo build` rebuilds at all.
 *
 * The first two now read the same file. build.rs cannot -- cargo reads it at
 * compile time -- so this asserts it lists the same directories. When it did
 * not, an edit to the connector's messenger (the P2P send path) rebuilt
 * nothing locally AND left the stamp unchanged, so the gate reported a match
 * over a binary containing none of the change.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = join(ROOT, 'scripts', 'wasm-source-trees.txt');
const BUILD_RS = join(ROOT, 'citadel-workspace-internal-service', 'build.rs');

for (const [label, path] of [['tree list', LIST], ['build.rs', BUILD_RS]]) {
  if (!existsSync(path)) {
    console.error(`FAIL: ${label} not found at ${path}; nothing can be compared.`);
    process.exit(1);
  }
}

const declared = readFileSync(LIST, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

if (declared.length === 0) {
  console.error('FAIL: the tree list is empty, so this gate would compare nothing.');
  process.exit(1);
}

const buildRs = readFileSync(BUILD_RS, 'utf8');
const missing = declared.filter((dir) => !buildRs.includes(dir));

if (missing.length > 0) {
  for (const m of missing) {
    console.error(
      `::error file=citadel-workspace-internal-service/build.rs::${m} is stamped but does not appear in build.rs`,
    );
  }
  console.error(
    `\nFAIL: ${missing.length} source tree(s) are covered by the stamp but do not\n` +
      'trigger a rebuild:\n',
  );
  for (const m of missing) console.error(`  ${m}`);
  console.error(
    '\nA tree the stamp covers but build.rs ignores means a local `cargo build`\n' +
      'silently keeps the old binary while the gate reports the source as fresh.\n' +
      'Add it to the rerun-if-changed list in build.rs.',
  );
  process.exit(1);
}

console.log(
  `check-wasm-rebuild-triggers-match-the-stamp: all ${declared.length} stamped tree(s) ` +
    'also trigger a rebuild in build.rs.',
);
