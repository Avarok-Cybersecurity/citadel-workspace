#!/usr/bin/env node
// The committed WASM binary must have been built from the committed source.
//
// `citadel-workspace-client-ts/pkg/*.wasm` is a TRACKED binary, and CI sets
// SKIP_WASM_BUILD=1 because no wasm-pack is installed there. So CI never
// rebuilds it: whatever binary is committed is the one the browser loads, and a
// change to the wasm-client Rust source does nothing until somebody rebuilds and
// commits the artefact by hand.
//
// That makes every wasm-client source change a candidate for the campaign's most
// productive defect: a fix that is present in the source, reviewed, merged, and
// never actually running. A security fix there would be indistinguishable from a
// working one.
//
// The stamp records the source tree the binary was built from. It is content
// addressed, not a timestamp: git author dates can move without the code
// changing, and can stay put when it does.
//
// Honest limit: this pins the relationship FROM NOW ON. It cannot retroactively
// prove the binary committed before it was built from the source beside it.
//
// Second honest limit, and the reason this stamp is written by
// sync-wasm-clients.sh rather than by hand: the script used to stamp only
// $DEST1 (an UNTRACKED path inside the submodule) and never this tracked copy.
// So a genuine rebuild left the stamp unchanged, the gate failed telling you to
// run the script you had just run, and the only way out was to echo the hash in
// yourself — which is also precisely how you would turn this green over a stale
// binary. The check measured whether somebody typed a hash. It now measures a
// rebuild, because the only thing that writes the stamp is the thing that
// produces the binary beside it.
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const STAMP = 'citadel-workspace-client-ts/pkg/.wasm-source-tree';
const SUBMODULE = 'citadel-internal-service';

/**
 * The trees the binary is built from, read from the file the STAMP WRITER also
 * reads.
 *
 * This used to be a single hard-coded directory,
 * `citadel-internal-service-wasm-client/src`. The WASM client is mostly not
 * that directory -- its lib.rs imports the connector's `connector`,
 * `io_interface` and `messenger` modules, and CLAUDE.md names
 * `connector/src/messenger/mod.rs` as the P2P send path. So an edit to the send
 * path left the stamp unchanged, and this gate -- whose whole purpose is to
 * refuse a committed binary that predates its source -- reported a match over a
 * binary containing none of the change.
 *
 * Keeping the list in a file both readers share is the point: a gate and its
 * stamp disagreeing about what counts as source is the same defect one level up.
 */
function sourceTrees() {
  const listPath = new URL('./wasm-source-trees.txt', import.meta.url);
  return readFileSync(listPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function currentSourceTree() {
  try {
    const trees = sourceTrees();
    if (trees.length === 0) return null;
    // One hash over all of them, in the order the file lists, so adding a tree
    // changes the stamp exactly as editing one does.
    return trees
      .map((dir) =>
        execSync(`git -C ${SUBMODULE} rev-parse HEAD:${dir}`, { encoding: 'utf8' }).trim(),
      )
      .join(' ');
  } catch {
    return null;
  }
}

const actual = currentSourceTree();
if (!actual) {
  console.error(`FAIL: cannot read ${SUBMODULE}/${SOURCE_DIR} — is the submodule populated?`);
  console.error('A check that cannot find its subject must not report success.');
  process.exit(1);
}

if (!existsSync(STAMP)) {
  console.error(`::error file=${STAMP}::missing`);
  console.error(`\nFAIL: no stamp recording which source the committed WASM was built from.`);
  console.error(`Rebuild the client and write the tree hash:\n  ${actual}`);
  process.exit(1);
}

const recorded = readFileSync(STAMP, 'utf8').trim();
if (recorded !== actual) {
  console.error(`::error file=${STAMP}::the committed WASM predates the current wasm-client source`);
  console.error(`\nFAIL: the WASM binary was built from a different source tree.`);
  console.error(`  stamped:  ${recorded}`);
  console.error(`  current:  ${actual}`);
  console.error(`\nCI does not rebuild it (SKIP_WASM_BUILD=1), so the browser is running the`);
  console.error(`older binary and the source change is inert. Run ./sync-wasm-clients.sh,`);
  console.error(`commit the regenerated pkg/, and the stamp updates with it.`);
  process.exit(1);
}
console.log(`OK: the committed WASM matches the wasm-client source (${actual.slice(0, 12)}).`);
