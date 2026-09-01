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
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const STAMP = 'citadel-workspace-client-ts/pkg/.wasm-source-tree';
const SUBMODULE = 'citadel-internal-service';
const SOURCE_DIR = 'citadel-internal-service-wasm-client/src';

function currentSourceTree() {
  try {
    return execSync(`git -C ${SUBMODULE} rev-parse HEAD:${SOURCE_DIR}`, { encoding: 'utf8' }).trim();
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
