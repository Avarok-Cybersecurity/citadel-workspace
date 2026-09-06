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
 * All three now read the same file. build.rs does it with `include_str!`, which
 * embeds the list at compile time, so it must ALSO carry a `rerun-if-changed` for
 * the list itself -- otherwise adding a tree would not take effect until something
 * else invalidated the build.
 *
 * This gate previously required build.rs to NAME each directory, and that was the
 * only thing holding the copies together. It duly failed the first time the list
 * grew (intersession-layer-messaging), and the right response was not to add a
 * fourth hand-maintained copy but to delete the duplication: build.rs reads the
 * file. So the rule here is now "read the list, or name every entry", with reading
 * preferred, and the gate is a redundancy check rather than the sole guarantee.
 *
 * When they did NOT agree, an edit to the connector's messenger (the P2P send
 * path) rebuilt nothing locally AND left the stamp unchanged, so the gate reported
 * a match over a binary containing none of the change.
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

const buildRsRaw = readFileSync(BUILD_RS, 'utf8');

/**
 * Comments stripped before anything is searched for.
 *
 * The name-matching fallback below asked whether the file CONTAINS each
 * directory, and this file's own comments name several of them while explaining
 * the rule. So a build.rs that had stopped triggering on a tree still passed,
 * because the sentence about that tree was still there. Found by a negative
 * control that removed the trigger and watched the gate stay green — the same
 * shape as the bug it exists to catch, which is why the copy gate strips
 * comments too.
 */
const buildRs = buildRsRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * Reading the list is stronger than naming its entries: it cannot drift.
 *
 * Both halves are required. `include_str!` alone embeds a stale copy at compile
 * time; the `rerun-if-changed` alone watches a file nothing consumes.
 */
const readsTheList = buildRs.includes('include_str!("../scripts/wasm-source-trees.txt")');
const watchesTheList = buildRs.includes('rerun-if-changed=../scripts/wasm-source-trees.txt');

if (readsTheList && !watchesTheList) {
  console.error(
    '::error file=citadel-workspace-internal-service/build.rs::reads the tree list but does not watch it',
  );
  console.error(
    '\nFAIL: build.rs embeds scripts/wasm-source-trees.txt with `include_str!` but has no\n' +
      '`cargo:rerun-if-changed` for it, so adding a tree to that file changes nothing until\n' +
      'some unrelated edit invalidates the build.',
  );
  process.exit(1);
}

const missing = readsTheList ? [] : declared.filter((dir) => !buildRs.includes(dir));

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
    (readsTheList
      ? 'trigger a rebuild via build.rs reading the list directly, which it also watches.'
      : 'are named individually in build.rs.'),
);
