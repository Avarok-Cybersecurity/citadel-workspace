/**
 * Building a wasm-bindgen module the page vendors (the Calendar's glue, the workspace codec):
 * a reproducible cargo build, wasm-bindgen with exactly the crate's version, the binary's URL
 * pinned to a stable served path, and the vendored files written or compared byte for byte.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { remapFlags, rustToolchain } from './remap-paths.mjs';

export const WASM_TARGET = 'wasm32-unknown-unknown';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function failer(label) {
  return (message) => {
    console.error(`${label}: ${message}`);
    process.exit(1);
  };
}

function runner(fail) {
  return (cmd, args, opts) => {
    const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
    if (r.status !== 0) fail(`${cmd} ${args[0]} exited ${r.status ?? r.signal}.`);
  };
}

/** The wasm-bindgen version the lockfile pins, after checking the CLI on PATH is exactly it. */
export function bindgenVersionFor(lockPath, fail) {
  const lock = readFileSync(lockPath, 'utf8');
  const version = /\[\[package\]\]\nname = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1];
  if (!version) fail('Cargo.lock names no wasm-bindgen.');
  const cli = spawnSync('wasm-bindgen', ['--version'], { encoding: 'utf8' });
  const cliVersion = cli.stdout?.trim().split(' ')[1];
  if (cliVersion !== version) {
    fail(`the wasm-bindgen CLI is ${cliVersion ?? 'not installed'}; this build needs ${version}: cargo install wasm-bindgen-cli --locked --version ${version}`);
  }
  return version;
}

/**
 * `cargo build --release --locked` in `cwd` for wasm32 with the shared path remaps and its own
 * target directory, then wasm-bindgen into a scratch directory. `use(out)` reads the output
 * there; the directory is removed afterwards.
 */
export function buildAndBind({ root, cwd, cargoArgs, targetDir, wasmFile, name, fail }, use) {
  const run = runner(fail);
  delete process.env.RUSTUP_TOOLCHAIN;
  delete process.env.RUSTFLAGS;
  delete process.env.CARGO_ENCODED_RUSTFLAGS;
  const remaps = remapFlags({ root, toolchain: rustToolchain(cwd) });
  const flags = `target.${WASM_TARGET}.rustflags=${JSON.stringify(remaps)}`;
  run('cargo', ['build', '--release', '--locked', '--target', WASM_TARGET, ...cargoArgs, '--config', flags], {
    cwd,
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
  });
  const out = mkdtempSync(join(tmpdir(), `${name}-`));
  try {
    run('wasm-bindgen', ['--target', 'web', '--out-name', name, '--out-dir', out, join(targetDir, WASM_TARGET, 'release', wasmFile)]);
    return use(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/**
 * The module with its default binary URL (relative to itself, which Vite would bundle as a
 * hashed asset beside the chunk) replaced by the stable URL the binary is served and precached at.
 */
export function moduleServedFrom(out, name, wasmUrl, fail) {
  const relative = `new URL('${name}_bg.wasm', import.meta.url)`;
  const module = readFileSync(join(out, `${name}.js`), 'utf8');
  if (module.split(relative).length !== 2) fail("the module's default binary URL changed shape; update scripts/lib/vendored-wasm.mjs.");
  return Buffer.from(module.replace(relative, JSON.stringify(wasmUrl)));
}

/** Writes `files` ({ path: bytes }), or with `check` compares them and fails on any difference. */
export function writeOrCheck({ root, files, check, label, rebuild, fail, stale = [] }) {
  if (check) {
    const differ = Object.entries(files)
      .filter(([path, bytes]) => !existsSync(path) || !readFileSync(path).equals(bytes))
      .map(([path]) => path.slice(root.length + 1));
    differ.push(...stale.map((path) => `${path.slice(root.length + 1)} (no longer generated)`));
    if (differ.length) fail(`the committed files differ from what the source builds:\n  ${differ.join('\n  ')}\nRun ${rebuild} and commit them.`);
    console.log(`${label}: ${Object.keys(files).length} committed file(s) match the source.`);
    return false;
  }
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  for (const path of stale) rmSync(path);
  return true;
}
