#!/usr/bin/env node
/**
 * Builds the first-party apps (apps/first-party/<app>/, each its own Cargo workspace whose
 * module crate is `app/`) for wasm32-unknown-unknown, writes <app>/wasm/<app>.wasm and the
 * artifact's sha256 and size into <app>/manifest.json, or, with --check, rebuilds and fails unless
 * both committed files are exactly what the source builds.
 *
 *   node scripts/build-first-party-apps.mjs            rebuild; write wasm/ and the manifest's artifact
 *   node scripts/build-first-party-apps.mjs --check    rebuild and compare; write nothing
 *
 * The reproducibility rules are build-app-fixtures.mjs's, for the same reason (committed bytes
 * are trustworthy only if anyone can rebuild them): the compiler is pinned by each app's
 * rust-toolchain.toml, the lockfile is --locked, absolute paths a panic could embed are remapped,
 * the SDK is reached through the app's sdk/ symlinks inside its workspace root, and each app
 * builds in its own target directory under target/.
 *
 * The manifest is committed unsigned: its publisher key is a placeholder. Signing is a separate
 * step (apps/first-party/signer) with a key that never enters the repository.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = join(ROOT, 'apps', 'first-party');
const TARGET = 'wasm32-unknown-unknown';
const check = process.argv.includes('--check');

const apps = readdirSync(APPS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(APPS, d.name, 'app', 'Cargo.toml')))
  .map((d) => d.name)
  .sort();
if (apps.length === 0) {
  console.error('build-first-party-apps: no app under apps/first-party/*/app/.');
  process.exit(1);
}

const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
const remaps = [`--remap-path-prefix=${ROOT}=/citadel-workspace`, `--remap-path-prefix=${cargoHome}=/cargo`];
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

/** The manifest text with `artifact.sha256` and `.bytes` set; every other byte as it was. */
function withArtifact(text, digest, bytes) {
  const manifest = JSON.parse(text);
  manifest.artifact.sha256 = digest;
  manifest.artifact.bytes = bytes;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

const problems = [];
for (const app of apps) {
  const dir = join(APPS, app);
  const name = crateName(dir);
  const target = join(ROOT, 'target', 'first-party-apps', app);
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
