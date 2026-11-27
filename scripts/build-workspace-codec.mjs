#!/usr/bin/env node
/**
 * Builds the workspace protocol codec (citadel-workspace-codec) for the page and vendors it as the
 * Calendar's glue is vendored: the module and its types under citadel-workspace-client-ts/codec/
 * (beside the client that loads it), the binary at its stable URL under
 * citadel-workspaces/public/workspace-codec/ (precached with the app shell), and PROVENANCE.json
 * with each file's sha256.
 *
 *   node scripts/build-workspace-codec.mjs            rebuild; write the vendored files
 *   node scripts/build-workspace-codec.mjs --check    rebuild and compare; write nothing
 *
 * Reproducible for the reasons build-calendar-glue.mjs gives: the crate's rust-toolchain.toml pins
 * the compiler, --locked the lockfile, absolute paths are remapped, and the build has its own
 * target directory. The wasm-bindgen CLI must be exactly the crate's version (read from the lock).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindgenVersionFor, buildAndBind, failer, moduleServedFrom, sha256, writeOrCheck } from './lib/vendored-wasm.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = join(ROOT, 'citadel-workspace-codec');
const VENDOR = join(ROOT, 'citadel-workspace-client-ts', 'codec');
const PUBLIC = join(ROOT, 'citadel-workspaces', 'public', 'workspace-codec');
const NAME = 'workspace_codec';
/** WORKSPACE_CODEC_WASM_URL in citadel-workspace-client-ts/src/workspace-codec.ts; its test holds the two together. */
const WASM_URL = `/workspace-codec/${NAME}_bg.wasm`;
const check = process.argv.includes('--check');
const fail = failer('build-workspace-codec');

const bindgenVersion = bindgenVersionFor(join(CRATE, 'Cargo.lock'), fail);

buildAndBind({
  root: ROOT,
  cwd: CRATE,
  cargoArgs: [],
  targetDir: join(ROOT, 'target', 'workspace-codec'),
  wasmFile: 'citadel_workspace_codec.wasm',
  name: NAME,
  fail,
}, (out) => {
  const files = {
    [join(VENDOR, `${NAME}.js`)]: moduleServedFrom(out, NAME, WASM_URL, fail),
    [join(VENDOR, `${NAME}.d.ts`)]: readFileSync(join(out, `${NAME}.d.ts`)),
    [join(PUBLIC, `${NAME}_bg.wasm`)]: readFileSync(join(out, `${NAME}_bg.wasm`)),
  };
  const provenance = {
    source: 'citadel-workspace-codec',
    wasm_bindgen_version: bindgenVersion,
    wasm_sha256: sha256(files[join(PUBLIC, `${NAME}_bg.wasm`)]),
    wasm_bytes: files[join(PUBLIC, `${NAME}_bg.wasm`)].length,
    glue_sha256: sha256(files[join(VENDOR, `${NAME}.js`)]),
    dts_sha256: sha256(files[join(VENDOR, `${NAME}.d.ts`)]),
  };
  files[join(VENDOR, 'PROVENANCE.json')] = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);

  const wrote = writeOrCheck({ root: ROOT, files, check, label: 'build-workspace-codec', rebuild: 'node scripts/build-workspace-codec.mjs', fail });
  if (wrote) console.log(`build-workspace-codec: ${provenance.wasm_sha256}  ${NAME}_bg.wasm (${provenance.wasm_bytes} bytes)`);
});
