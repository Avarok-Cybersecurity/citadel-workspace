#!/usr/bin/env node
/**
 * Builds the Citadel app sandbox fixtures (apps/sdk-fixtures) for wasm32-unknown-unknown and
 * writes them to apps/sdk-fixtures/wasm/<name>.wasm, or, with --check, rebuilds them and fails
 * unless every committed file is byte-for-byte what the source builds.
 *
 *   node scripts/build-app-fixtures.mjs            rebuild and write wasm/
 *   node scripts/build-app-fixtures.mjs --check    rebuild and compare; write nothing
 *
 * The .wasm files are committed because the TypeScript host's tests load them and must not
 * need a Rust toolchain. Committed binaries are only trustworthy if they are reproducible, so:
 *  - the compiler is pinned (apps/sdk-fixtures/rust-toolchain.toml) and the lockfile is --locked;
 *  - every absolute path a panic location could embed is remapped (the checkout, CARGO_HOME), so
 *    the bytes do not depend on where the repo or the cargo cache lives;
 *  - the SDK is reached through apps/sdk-fixtures/sdk/'s symlinks, inside the fixtures'
 *    workspace root, so Cargo hashes its identity by a relative path (see that Cargo.toml);
 *  - the build uses its own target directory under target/, never a shared one.
 *
 * `linker-start` is hello-canvas linked with ONLY --import-memory (RUSTFLAGS replaces the
 * fixtures' config): wasm-ld then adds a start function, which the ABI refuses. It is the
 * negative control for the link flags in apps/sdk-fixtures/.cargo/config.toml.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'apps', 'sdk-fixtures');
const OUT = join(FIXTURES, 'wasm');
const TARGET = 'wasm32-unknown-unknown';
const check = process.argv.includes('--check');

const manifest = JSON.parse(readFileSync(join(FIXTURES, 'fixtures.json'), 'utf8'));
const names = Object.keys(manifest.fixtures);
if (names.length < 10) {
  console.error(`build-app-fixtures: fixtures.json lists ${names.length} fixtures; there are at least 10.`);
  process.exit(1);
}

const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
const remaps = [
  `--remap-path-prefix=${ROOT}=/citadel-workspace`,
  `--remap-path-prefix=${cargoHome}=/cargo`,
];

function cargo(args, env, label) {
  const r = spawnSync('cargo', args, { cwd: FIXTURES, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`build-app-fixtures: ${label} failed (cargo exited ${r.status ?? r.signal}).`);
    process.exit(1);
  }
}

// RUSTUP_TOOLCHAIN would override rust-toolchain.toml and produce other bytes, and RUSTFLAGS
// would replace the fixtures' link flags: the pin and the config win.
const base = {};
delete process.env.RUSTUP_TOOLCHAIN;
delete process.env.RUSTFLAGS;
delete process.env.CARGO_ENCODED_RUSTFLAGS;
const build = ['build', '--release', '--locked', '--target', TARGET];

const mainTarget = join(ROOT, 'target', 'app-fixtures');
const flags = `target.${TARGET}.rustflags=${JSON.stringify(remaps)}`;
cargo([...build, '--workspace', '--exclude', 'fixture-report', '--config', flags],
  { ...base, CARGO_TARGET_DIR: mainTarget }, 'the fixtures');

const startTarget = join(ROOT, 'target', 'app-fixtures-linker-start');
const onlyImport = ['-C', 'link-arg=--import-memory=citadel_app_abi_1,memory', ...remaps].join(' ');
cargo([...build, '-p', 'hello-canvas'], { ...base, CARGO_TARGET_DIR: startTarget, RUSTFLAGS: onlyImport }, 'linker-start');

const built = (name) => name === 'linker-start'
  ? join(startTarget, TARGET, 'release', 'hello_canvas.wasm')
  : join(mainTarget, TARGET, 'release', `${name.replaceAll('-', '_')}.wasm`);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

mkdirSync(OUT, { recursive: true });
const stale = [];
for (const name of names) {
  const from = built(name);
  if (!existsSync(from)) {
    console.error(`build-app-fixtures: ${name} built nothing at ${from}.`);
    process.exit(1);
  }
  const to = join(OUT, `${name}.wasm`);
  if (check) {
    if (!existsSync(to) || sha(to) !== sha(from)) stale.push(name);
  } else {
    copyFileSync(from, to);
  }
  console.log(`${sha(from)}  ${name}.wasm`);
}
const extra = readdirSync(OUT).filter((f) => f.endsWith('.wasm') && !names.includes(f.slice(0, -5)));
if (extra.length) {
  console.error(`build-app-fixtures: wasm/ holds files no fixture builds: ${extra.join(', ')}`);
  process.exit(1);
}
if (stale.length) {
  console.error(
    `build-app-fixtures: committed wasm differs from what the source builds: ${stale.join(', ')}.\n` +
      'Run `node scripts/build-app-fixtures.mjs` and commit apps/sdk-fixtures/wasm/.',
  );
  process.exit(1);
}
console.log(check ? 'build-app-fixtures: every committed fixture matches its source.' : `build-app-fixtures: wrote ${names.length} fixtures to apps/sdk-fixtures/wasm/.`);
