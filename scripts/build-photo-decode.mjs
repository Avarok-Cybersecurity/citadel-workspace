#!/usr/bin/env node
/**
 * Builds the photo decoder (crates/photo-decode) for the page and vendors it into the UI as the
 * Calendar's glue is: the module and its types under citadel-workspaces/vendor/photo/, the binary
 * at its stable URL under public/photo/, and PROVENANCE.json with each file's sha256.
 *
 *   node scripts/build-photo-decode.mjs            rebuild; write the vendored files
 *   node scripts/build-photo-decode.mjs --check    rebuild and compare; write nothing
 *
 * Reproducible: the crate's rust-toolchain.toml pins the compiler, --locked the lockfile,
 * absolute paths are remapped, and the build has its own target directory (target/photo-decode).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGlue, failer, requireBindgen, sha256, writeOrCheck } from './lib/wasm-glue-vendor.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = join(ROOT, 'crates', 'photo-decode');
const UI = join(ROOT, 'citadel-workspaces');
const VENDOR = join(UI, 'vendor', 'photo');
const PUBLIC = join(UI, 'public', 'photo');
const NAME = 'photo_decode';
/** PHOTO_DECODE_WASM_URL in src/lib/photo-decode/asset-urls.ts, which the vendored-pair test holds to this. */
const WASM_URL = `/photo/${NAME}_bg.wasm`;
const TAG = 'build-photo-decode';
const fail = failer(TAG);
const check = process.argv.includes('--check');

const bindgenVersion = requireBindgen(join(CRATE, 'Cargo.lock'), fail);
const built = buildGlue({ root: ROOT, crateDir: CRATE, pkg: 'photo-decode', name: NAME, wasmUrl: WASM_URL, fail });
const files = {
  [join(VENDOR, `${NAME}.js`)]: built.glue,
  [join(VENDOR, `${NAME}.d.ts`)]: built.dts,
  [join(PUBLIC, `${NAME}_bg.wasm`)]: built.wasm,
};
const provenance = {
  source: 'crates/photo-decode',
  heic_rs_version: /\[\[package\]\]\nname = "heic-rs"\nversion = "([^"]+)"/.exec(readFileSync(join(CRATE, 'Cargo.lock'), 'utf8'))?.[1] ?? fail('Cargo.lock names no heic-rs.'),
  wasm_bindgen_version: bindgenVersion,
  wasm_sha256: sha256(built.wasm),
  wasm_bytes: built.wasm.length,
  glue_sha256: sha256(built.glue),
  dts_sha256: sha256(built.dts),
};
files[join(VENDOR, 'PROVENANCE.json')] = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);
writeOrCheck({ root: ROOT, files, check, fail, tag: TAG, rebuild: 'node scripts/build-photo-decode.mjs' });
if (!check) console.log(`${TAG}: ${provenance.wasm_sha256}  ${NAME}_bg.wasm (${provenance.wasm_bytes} bytes)`);
