#!/usr/bin/env node
/**
 * Builds the first-party apps (apps/first-party/<app>/, each its own Cargo workspace whose
 * module crate is `app/`) for wasm32-unknown-unknown, writes <app>/wasm/<app>.wasm and the
 * artifact's sha256 and size into <app>/manifest.json, or, with --check, rebuilds and fails unless
 * both committed files are exactly what the source builds.
 *
 *   node scripts/build-first-party-apps.mjs            rebuild; write wasm/ and the manifest's artifact
 *   node scripts/build-first-party-apps.mjs --check    rebuild and compare; write nothing
 *   node scripts/build-first-party-apps.mjs --sign <out> [--throwaway-key | --ci-key]
 *        sign the apps every workspace is provisioned with into <out> (lib/sign-first-party-apps.mjs),
 *        with the seed in CITADEL_APP_SIGNING_SEED_HEX; --throwaway-key for a seed that is not
 *        first-party (PR CI); --ci-key with the published CI seed instead, for the integration
 *        image's kernel (the only one that trusts it). Builds nothing: it signs the committed
 *        manifests and modules.
 *
 * The reproducibility rules are build-app-fixtures.mjs's, for the same reason (committed bytes
 * are trustworthy only if anyone can rebuild them): the compiler is pinned by each app's
 * rust-toolchain.toml, the lockfile is --locked, absolute paths a panic could embed are remapped,
 * the SDK is reached through the app's sdk/ symlinks inside its workspace root, and each app
 * builds in its own target directory under target/.
 *
 * The manifest is committed unsigned: its publisher key is a placeholder. Signing is `--sign`, the
 * deploy's step (apps/first-party/signer), with a key that never enters the repository.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withArtifact } from './lib/first-party-manifest.mjs';
import { remapFlags, rustToolchain } from './lib/remap-paths.mjs';
import { PROVISIONED_APPS, signFirstPartyApps } from './lib/sign-first-party-apps.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = join(ROOT, 'apps', 'first-party');
const TARGET = 'wasm32-unknown-unknown';
const check = process.argv.includes('--check');

const signAt = process.argv.indexOf('--sign');
if (signAt !== -1) {
  const out = process.argv[signAt + 1];
  if (!out || out.startsWith('--')) {
    console.error('build-first-party-apps: --sign takes the directory to write the signed apps to.');
    process.exit(1);
  }
  const flags = ['--throwaway-key', '--ci-key'].filter((f) => process.argv.includes(f));
  if (flags.length > 1) {
    console.error('build-first-party-apps: --throwaway-key and --ci-key are two different seeds; pass one.');
    process.exit(1);
  }
  const mode = { '--throwaway-key': 'throwaway', '--ci-key': 'ci' }[flags[0]] ?? 'deploy';
  const problems = signFirstPartyApps(ROOT, resolve(out), mode);
  if (problems.length) {
    console.error(`build-first-party-apps: not signed:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`build-first-party-apps: signed ${PROVISIONED_APPS.length} provisioned app(s) into ${out}.`);
  process.exit(0);
}

const apps = readdirSync(APPS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(APPS, d.name, 'app', 'Cargo.toml')))
  .map((d) => d.name)
  .sort();
if (apps.length === 0) {
  console.error('build-first-party-apps: no app under apps/first-party/*/app/.');
  process.exit(1);
}

// The pin and each app's .cargo/config.toml win over the caller's environment.
delete process.env.RUSTUP_TOOLCHAIN;
delete process.env.RUSTFLAGS;
delete process.env.CARGO_ENCODED_RUSTFLAGS;

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The module crate's package name, from app/Cargo.toml. */
function crateName(dir) {
  const toml = readFileSync(join(dir, 'app', 'Cargo.toml'), 'utf8');
  const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!name) throw new Error(`${dir}/app/Cargo.toml names no package`);
  return name;
}

const problems = [];
for (const app of apps) {
  const dir = join(APPS, app);
  const name = crateName(dir);
  const target = join(ROOT, 'target', 'first-party-apps', app);
  // Each app pins its own compiler, so each maps its own toolchain's std sources.
  const remaps = remapFlags({ root: ROOT, toolchain: rustToolchain(dir) });
  const flags = `target.${TARGET}.rustflags=${JSON.stringify(remaps)}`;
  const args = ['build', '--release', '--locked', '--target', TARGET, '-p', name, '--config', flags];
  const r = spawnSync('cargo', args, { cwd: dir, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target } });
  if (r.status !== 0) {
    console.error(`build-first-party-apps: ${app} failed (cargo exited ${r.status ?? r.signal}).`);
    process.exit(1);
  }
  const built = join(target, TARGET, 'release', `${name.replaceAll('-', '_')}.wasm`);
  const wasm = readFileSync(built);
  const digest = sha(wasm);
  const out = join(dir, 'wasm', `${app}.wasm`);
  const manifestPath = join(dir, 'manifest.json');
  const manifestText = readFileSync(manifestPath, 'utf8');
  const wantManifest = withArtifact(manifestText, digest, wasm.length);
  if (check) {
    if (!existsSync(out) || sha(readFileSync(out)) !== digest) problems.push(`${app}: wasm/${app}.wasm`);
    if (manifestText !== wantManifest) problems.push(`${app}: manifest.json's artifact`);
  } else {
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(built, out);
    writeFileSync(manifestPath, wantManifest);
  }
  console.log(`${digest}  ${app}.wasm (${wasm.length} bytes)`);
}
if (problems.length) {
  console.error(
    `build-first-party-apps: the committed files differ from what the source builds: ${problems.join(', ')}.\n` +
      'Run `node scripts/build-first-party-apps.mjs` and commit the app\'s wasm/ and manifest.json.',
  );
  process.exit(1);
}
console.log(check ? 'build-first-party-apps: every committed app matches its source.' : `build-first-party-apps: built ${apps.length} app(s).`);
