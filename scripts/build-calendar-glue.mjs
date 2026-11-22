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
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withArtifact } from './lib/first-party-manifest.mjs';
import { remapFlags, rustToolchain } from './lib/remap-paths.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'first-party', 'calendar');
const UI = join(ROOT, 'citadel-workspaces');
const VENDOR = join(UI, 'vendor', 'calendar');
const PUBLIC = join(UI, 'public', 'calendar');
const BINDINGS = join(APP, 'core', 'bindings');
const GENERATED = join(UI, 'src', 'lib', 'calendar', 'generated');
const TARGET = 'wasm32-unknown-unknown';
const NAME = 'calendar_glue';
/** CALENDAR_WASM_URL in src/lib/calendar/asset-urls.ts, which the vendored-pair test holds to this. */
const WASM_URL = `/calendar/${NAME}_bg.wasm`;
const check = process.argv.includes('--check');

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => {
  console.error(`build-calendar-glue: ${message}`);
  process.exit(1);
};
const run = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) fail(`${cmd} ${args[0]} exited ${r.status ?? r.signal}.`);
};

const lock = readFileSync(join(APP, 'Cargo.lock'), 'utf8');
const bindgenVersion = /\[\[package\]\]\nname = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1];
if (!bindgenVersion) fail('Cargo.lock names no wasm-bindgen.');
const cli = spawnSync('wasm-bindgen', ['--version'], { encoding: 'utf8' });
const cliVersion = cli.stdout?.trim().split(' ')[1];
if (cliVersion !== bindgenVersion) {
  fail(`the wasm-bindgen CLI is ${cliVersion ?? 'not installed'}; the glue needs ${bindgenVersion}: cargo install wasm-bindgen-cli --locked --version ${bindgenVersion}`);
}

delete process.env.RUSTUP_TOOLCHAIN;
delete process.env.RUSTFLAGS;
delete process.env.CARGO_ENCODED_RUSTFLAGS;
const remaps = remapFlags({ root: ROOT, toolchain: rustToolchain(APP) });
const target = join(ROOT, 'target', 'calendar-glue');
const flags = `target.${TARGET}.rustflags=${JSON.stringify(remaps)}`;
run('cargo', ['build', '--release', '--locked', '--target', TARGET, '-p', 'calendar-glue', '--config', flags], {
  cwd: APP,
  env: { ...process.env, CARGO_TARGET_DIR: target },
});

const out = mkdtempSync(join(tmpdir(), 'calendar-glue-'));
try {
  run('wasm-bindgen', ['--target', 'web', '--out-name', NAME, '--out-dir', out, join(target, TARGET, 'release', `${NAME}.wasm`)]);
  // The module's default binary URL is relative to itself, which Vite would bundle as a hashed
  // asset beside the chunk; the binary is served (and precached) at one stable URL instead.
  const relative = `new URL('${NAME}_bg.wasm', import.meta.url)`;
  const module = readFileSync(join(out, `${NAME}.js`), 'utf8');
  if (module.split(relative).length !== 2) fail("the glue's default binary URL changed shape; update this script.");
  const files = {
    [join(VENDOR, `${NAME}.js`)]: Buffer.from(module.replace(relative, JSON.stringify(WASM_URL))),
    [join(VENDOR, `${NAME}.d.ts`)]: readFileSync(join(out, `${NAME}.d.ts`)),
    [join(PUBLIC, `${NAME}_bg.wasm`)]: readFileSync(join(out, `${NAME}_bg.wasm`)),
  };
  const provenance = {
    source: 'apps/first-party/calendar/glue',
    wasm_bindgen_version: bindgenVersion,
    wasm_sha256: sha(files[join(PUBLIC, `${NAME}_bg.wasm`)]),
    wasm_bytes: files[join(PUBLIC, `${NAME}_bg.wasm`)].length,
    glue_sha256: sha(files[join(VENDOR, `${NAME}.js`)]),
    dts_sha256: sha(files[join(VENDOR, `${NAME}.d.ts`)]),
  };
  files[join(VENDOR, 'PROVENANCE.json')] = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);
  const manifestPath = join(APP, 'manifest.json');
  files[manifestPath] = Buffer.from(withArtifact(readFileSync(manifestPath, 'utf8'), provenance.wasm_sha256, provenance.wasm_bytes));

  if (!existsSync(BINDINGS)) fail(`${BINDINGS} is missing: run cargo test -p calendar-core --features ts in ${APP}.`);
  const bindings = readdirSync(BINDINGS).filter((f) => f.endsWith('.ts')).sort();
  for (const file of bindings) files[join(GENERATED, file)] = readFileSync(join(BINDINGS, file));
  const stale = existsSync(GENERATED) ? readdirSync(GENERATED).filter((f) => f.endsWith('.ts') && !bindings.includes(f)) : [];

  if (check) {
    const differ = Object.entries(files)
      .filter(([path, bytes]) => !existsSync(path) || !readFileSync(path).equals(bytes))
      .map(([path]) => path.slice(ROOT.length + 1));
    differ.push(...stale.map((f) => `${GENERATED.slice(ROOT.length + 1)}/${f} (no longer generated)`));
    if (differ.length) fail(`the committed files differ from what the source builds:\n  ${differ.join('\n  ')}\nRun node scripts/build-calendar-glue.mjs and commit them.`);
    console.log(`build-calendar-glue: ${Object.keys(files).length} committed file(s) match the source.`);
  } else {
    for (const [path, bytes] of Object.entries(files)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    }
    for (const file of stale) rmSync(join(GENERATED, file));
    console.log(`build-calendar-glue: ${provenance.wasm_sha256}  ${NAME}_bg.wasm (${provenance.wasm_bytes} bytes)`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
