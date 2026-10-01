#!/usr/bin/env node
// Remove the Rust function names from a built WASM module, in place.
//
// The "name" custom section is debug data: function names for stack traces.
// For the WASM client it was 1.9 MB of a 4.8 MB binary that every user
// downloads on first load (multi-window mw4, measured with twiggy), and
// wasm-opt -- which would drop it -- is disabled for CI determinism.
//
// Run after wasm-bindgen, on its output, and touching nothing else: stripping
// at link time instead (`-C strip=symbols`) also removes the target-features
// section wasm-bindgen reads, which silently changed the generated JS glue to
// the pre-reference-types ABI. Removing one custom section here is
// byte-deterministic and leaves the module and its glue exactly as built.
//
// Lost: function names in JS stack traces through WASM frames. A Rust panic
// still reports its message and file:line via console_error_panic_hook.
//
//   node scripts/strip-wasm-names.mjs <file.wasm>
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: strip-wasm-names.mjs <file.wasm>');
  process.exit(2);
}
const bytes = readFileSync(file);
if (bytes.readUInt32BE(0) !== 0x0061736d) {
  console.error(`${file} is not a WASM module`);
  process.exit(1);
}

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

const kept = [bytes.subarray(0, 8)];
let removed = 0;
let at = 8;
while (at < bytes.length) {
  const start = at;
  const id = bytes[at++];
  const [size, body] = uleb(at);
  const end = body + size;
  let drop = false;
  if (id === 0) {
    const [nameLength, nameAt] = uleb(body);
    drop = bytes.subarray(nameAt, nameAt + nameLength).toString('utf8') === 'name';
  }
  if (drop) removed += end - start;
  else kept.push(bytes.subarray(start, end));
  at = end;
}
writeFileSync(file, Buffer.concat(kept));
console.log(`strip-wasm-names: removed ${(removed / 1e6).toFixed(2)} MB from ${file}`);
