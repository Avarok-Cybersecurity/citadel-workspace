#!/usr/bin/env node
// The committed WASM binary must not carry the Rust function names in its "name" section.
//
// wasm-opt is disabled for the client (CI determinism; see the wasm-client's
// Cargo.toml), so the only thing that removes the section is
// scripts/strip-wasm-names.mjs, run by sync-wasm-clients.sh. Without it
// the section was 1.9 MB of a 4.8 MB binary every user downloads on first load
// (multi-window mw4, measured with twiggy), and nothing would notice it coming
// back: the binary still works, it is only 40% larger.
import { readFileSync } from 'node:fs';

const BINARY = process.argv[2] ?? 'citadel-workspace-client-ts/pkg/citadel_internal_service_wasm_client_bg.wasm';
const bytes = readFileSync(BINARY);

if (bytes.readUInt32BE(0) !== 0x0061736d) {
  console.error(`FAIL: ${BINARY} is not a WASM module.`);
  process.exit(1);
}

/** LEB128 unsigned at `at`; returns [value, next offset]. */
function uleb(at) {
  let value = 0;
  let shift = 0;
  for (;;) {
    const byte = bytes[at++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, at];
    shift += 7;
  }
}

const custom = [];
let at = 8;
while (at < bytes.length) {
  const id = bytes[at++];
  const [size, body] = uleb(at);
  if (id === 0) {
    const [nameLength, nameAt] = uleb(body);
    custom.push({ name: bytes.subarray(nameAt, nameAt + nameLength).toString('utf8'), size });
  }
  at = body + size;
}

const names = custom.find((section) => section.name === 'name');
if (names) {
  console.error(
    `FAIL: ${BINARY} carries a ${(names.size / 1e6).toFixed(2)} MB "name" section of ${(bytes.length / 1e6).toFixed(2)} MB.\n` +
      'scripts/strip-wasm-names.mjs was not run on it;\n' +
      'rebuild with ./sync-wasm-clients.sh.',
  );
  process.exit(1);
}
console.log(`check-wasm-ships-without-names: ${(bytes.length / 1e6).toFixed(2)} MB, no name section.`);
