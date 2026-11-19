#!/usr/bin/env node
// The content identity of the committed WASM pkg: SHA3-256 over every file in
// it except the stamp, by sorted name, each as `<name>\0<bytes>\0`.
//
// Shared by the stamp writer (sync-wasm-clients.sh calls this as a CLI) and the
// gate (check-wasm-matches-its-source.mjs imports it), so the two cannot hash
// different things. The source half of the stamp says which source the binary
// was built FROM; this half says the binary beside it is the one that build
// produced. Without it a hand-edited .js, a binary from build.rs, or a stamp
// typed in by hand all passed.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STAMP_NAME = '.wasm-source-tree';
export const CONTENT_PREFIX = 'pkg-sha3-256 ';

export function pkgContentHash(dir) {
  const names = readdirSync(dir)
    .filter((name) => name !== STAMP_NAME && statSync(join(dir, name)).isFile())
    .sort();
  if (names.length === 0) throw new Error(`${dir} holds no pkg files to hash`);
  const hash = createHash('sha3-256');
  for (const name of names) {
    hash.update(name);
    hash.update('\0');
    hash.update(readFileSync(join(dir, name)));
    hash.update('\0');
  }
  return `${CONTENT_PREFIX}${hash.digest('hex')}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: pkg-content-hash.mjs <pkg dir>');
    process.exit(2);
  }
  console.log(pkgContentHash(dir));
}
