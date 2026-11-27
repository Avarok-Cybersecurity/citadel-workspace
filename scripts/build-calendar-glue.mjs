#!/usr/bin/env node
/**
 * Builds the Calendar's glue (apps/first-party/calendar/glue, Calendar design 3.2) for the page and
 * vendors it into the UI as Citadel Docs is vendored: the module and its types under
 * citadel-workspaces/vendor/calendar/, the binary at its stable URL under public/calendar/, and
 * PROVENANCE.json with each file's sha256, and the binary's sha256 and size into the app's
 * manifest.json (what the deploy signs and provisioning installs). It also copies calendar-core's TypeScript bindings
 * (written by `cargo test -p calendar-core --features ts`) to src/lib/calendar/generated/.
 *
 *   node scripts/build-calendar-glue.mjs            rebuild; write the vendored files and bindings
 *   node scripts/build-calendar-glue.mjs --check    rebuild and compare; write nothing
 *
 * Reproducible for the reasons build-first-party-apps.mjs gives: the app's rust-toolchain.toml
 * pins the compiler, --locked the lockfile, absolute paths are remapped, and the build has its
 * own target directory. wasm-bindgen's CLI must be exactly the crate's version, which is read
 * from the lockfile, so the two cannot drift apart.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withArtifact } from './lib/first-party-manifest.mjs';
import { bindgenVersionFor, buildAndBind, failer, moduleServedFrom, sha256, writeOrCheck } from './lib/vendored-wasm.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'first-party', 'calendar');
const UI = join(ROOT, 'citadel-workspaces');
const VENDOR = join(UI, 'vendor', 'calendar');
const PUBLIC = join(UI, 'public', 'calendar');
const BINDINGS = join(APP, 'core', 'bindings');
const GENERATED = join(UI, 'src', 'lib', 'calendar', 'generated');
const NAME = 'calendar_glue';
/** CALENDAR_WASM_URL in src/lib/calendar/asset-urls.ts, which the vendored-pair test holds to this. */
const WASM_URL = `/calendar/${NAME}_bg.wasm`;
const check = process.argv.includes('--check');
const fail = failer('build-calendar-glue');

const bindgenVersion = bindgenVersionFor(join(APP, 'Cargo.lock'), fail);

buildAndBind({
  root: ROOT,
  cwd: APP,
  cargoArgs: ['-p', 'calendar-glue'],
  targetDir: join(ROOT, 'target', 'calendar-glue'),
  wasmFile: `${NAME}.wasm`,
  name: NAME,
  fail,
}, (out) => {
  const files = {
    [join(VENDOR, `${NAME}.js`)]: moduleServedFrom(out, NAME, WASM_URL, fail),
    [join(VENDOR, `${NAME}.d.ts`)]: readFileSync(join(out, `${NAME}.d.ts`)),
    [join(PUBLIC, `${NAME}_bg.wasm`)]: readFileSync(join(out, `${NAME}_bg.wasm`)),
  };
  const provenance = {
    source: 'apps/first-party/calendar/glue',
    wasm_bindgen_version: bindgenVersion,
    wasm_sha256: sha256(files[join(PUBLIC, `${NAME}_bg.wasm`)]),
    wasm_bytes: files[join(PUBLIC, `${NAME}_bg.wasm`)].length,
    glue_sha256: sha256(files[join(VENDOR, `${NAME}.js`)]),
    dts_sha256: sha256(files[join(VENDOR, `${NAME}.d.ts`)]),
  };
  files[join(VENDOR, 'PROVENANCE.json')] = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);
  const manifestPath = join(APP, 'manifest.json');
  files[manifestPath] = Buffer.from(withArtifact(readFileSync(manifestPath, 'utf8'), provenance.wasm_sha256, provenance.wasm_bytes));

  if (!existsSync(BINDINGS)) fail(`${BINDINGS} is missing: run cargo test -p calendar-core --features ts in ${APP}.`);
  const bindings = readdirSync(BINDINGS).filter((f) => f.endsWith('.ts')).sort();
  for (const file of bindings) files[join(GENERATED, file)] = readFileSync(join(BINDINGS, file));
  const stale = existsSync(GENERATED)
    ? readdirSync(GENERATED).filter((f) => f.endsWith('.ts') && !bindings.includes(f)).map((f) => join(GENERATED, f))
    : [];

  const wrote = writeOrCheck({ root: ROOT, files, check, stale, label: 'build-calendar-glue', rebuild: 'node scripts/build-calendar-glue.mjs', fail });
  if (wrote) console.log(`build-calendar-glue: ${provenance.wasm_sha256}  ${NAME}_bg.wasm (${provenance.wasm_bytes} bytes)`);
});
