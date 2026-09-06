#!/usr/bin/env node
// `String == String` in Rust compares lengths and then runs `memcmp`, which
// returns as soon as two bytes differ. The time it takes is a function of how
// many leading bytes matched, so an attacker who can submit guesses and time
// the answers recovers the secret one byte at a time instead of searching the
// whole space.
//
// The workspace master password is what makes somebody an administrator, and it
// was compared with `==` at five sites, four of them reachable from a request
// (async_domain_server_ops.rs:1043,1069,1231,1307). Use
// `kernel::secret_eq::secrets_match`, which compares SHA-256 digests with
// `subtle` -- constant time, and no length leak either.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every Rust service that handles a request. Submodule paths are included when
// present; a missing one is skipped rather than silently narrowing the scan to
// nothing -- the count is reported so a shrinking scope is visible.
const ROOTS = [
  'citadel-workspace-server-kernel/src',
  'citadel-workspace-internal-service/src',
  'citadel-internal-service/citadel-internal-service/src',
];

const SECRET = /\b\w*(password|passphrase|secret|api_key|master_key)\w*\b/i;

function* rustFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* rustFiles(p);
    else if (entry.endsWith('.rs')) yield p;
  }
}

const failures = [];
let scanned = 0;
const scannedRoots = [];

for (const r of ROOTS) {
  const abs = join(root, r);
  if (!existsSync(abs)) continue;
  scannedRoots.push(r);
  for (const file of rustFiles(abs)) {
    scanned++;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        // A line of prose about the defect is not the defect.
        if (/^\s*(\/\/|\*)/.test(line)) return;
        // `!=`/`==` only; `>=`, `<=` are not equality on a secret.
        if (!/[^<>!=]==|!=/.test(line)) return;
        if (!SECRET.test(line)) return;
        failures.push(
          `${relative(root, file)}:${i + 1}\n      ${line.trim().slice(0, 110)}`,
        );
      });
  }
}

if (scannedRoots.length === 0) {
  throw new Error(`none of the service source roots exist: ${ROOTS.join(', ')}`);
}

if (failures.length) {
  console.error('A secret is compared with `==`, which returns early:\n');
  for (const f of failures) console.error('  ' + f + '\n');
  console.error(
    'Use `kernel::secret_eq::secrets_match`. It compares SHA-256 digests with\n' +
      '`subtle`: constant time, and it does not leak the length either.',
  );
  process.exit(1);
}

console.log(
  `OK: no secret compared with \`==\` in ${scanned} Rust files across ` +
    `${scannedRoots.length}/${ROOTS.length} service roots (${scannedRoots.join(', ')}).`,
);
