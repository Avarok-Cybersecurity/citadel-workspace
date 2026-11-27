/**
 * The steps every vendored wasm-bindgen module shares (scripts/build-photo-decode.mjs): read the
 * wasm-bindgen version from the crate's lockfile and refuse a CLI of any other, build the crate
 * reproducibly for wasm32-unknown-unknown (pinned toolchain, --locked, remapped paths, its own
 * target directory), run wasm-bindgen, pin the glue's binary URL to one stable served path, and
 * either write the files or (--check) compare them with what is committed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { remapFlags, rustToolchain } from './remap-paths.mjs';

export const WASM_TARGET = 'wasm32-unknown-unknown';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function failer(tag) {
  return (message) => {
    console.error(`${tag}: ${message}`);
    process.exit(1);
  };
}

function run(fail, cmd, args, opts) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) fail(`${cmd} ${args[0]} exited ${r.status ?? r.signal}.`);
}

/** The lockfile's wasm-bindgen version, after checking the installed CLI is exactly it. */
export function requireBindgen(lockPath, fail) {
  const lock = readFileSync(lockPath, 'utf8');
  const version = /\[\[package\]\]\nname = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1];
  if (!version) fail(`${lockPath} names no wasm-bindgen.`);
  const cli = spawnSync('wasm-bindgen', ['--version'], { encoding: 'utf8' });
  const installed = cli.stdout?.trim().split(' ')[1];
  if (installed !== version) {
    fail(`the wasm-bindgen CLI is ${installed ?? 'not installed'}; this build needs ${version}: cargo install wasm-bindgen-cli --locked --version ${version}`);
  }
  return version;
}

/**
 * Builds `pkg` in `crateDir` and runs wasm-bindgen on it. Returns the glue (with its binary URL
 * pinned to `wasmUrl`), its types and the binary, as Buffers.
 */
export function buildGlue({ root, crateDir, pkg, name, wasmUrl, fail }) {
  delete process.env.RUSTUP_TOOLCHAIN;
  delete process.env.RUSTFLAGS;
  delete process.env.CARGO_ENCODED_RUSTFLAGS;
  const remaps = remapFlags({ root, toolchain: rustToolchain(crateDir) });
  const target = join(root, 'target', pkg);
  const flags = `target.${WASM_TARGET}.rustflags=${JSON.stringify(remaps)}`;
  run(fail, 'cargo', ['build', '--release', '--locked', '--target', WASM_TARGET, '-p', pkg, '--config', flags], {
    cwd: crateDir,
    env: { ...process.env, CARGO_TARGET_DIR: target },
  });
  const out = mkdtempSync(join(tmpdir(), `${pkg}-`));
  try {
    run(fail, 'wasm-bindgen', ['--target', 'web', '--out-name', name, '--out-dir', out, join(target, WASM_TARGET, 'release', `${name}.wasm`)]);
    // The default binary URL is relative to the module, which Vite would bundle as a hashed
    // asset beside the chunk; the binary is served (and precached) at one stable URL instead.
    const relative = `new URL('${name}_bg.wasm', import.meta.url)`;
    const module = readFileSync(join(out, `${name}.js`), 'utf8');
    if (module.split(relative).length !== 2) fail("the glue's default binary URL changed shape; update scripts/lib/wasm-glue-vendor.mjs.");
    return {
      glue: Buffer.from(module.replace(relative, JSON.stringify(wasmUrl))),
      dts: readFileSync(join(out, `${name}.d.ts`)),
      wasm: readFileSync(join(out, `${name}_bg.wasm`)),
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Writes `files` ({absolute path: Buffer}), or with `check` fails naming each that differs. */
export function writeOrCheck({ root, files, check, fail, tag, rebuild }) {
  if (check) {
    const differ = Object.entries(files)
      .filter(([path, bytes]) => !existsSync(path) || !readFileSync(path).equals(bytes))
      .map(([path]) => path.slice(root.length + 1));
    if (differ.length) fail(`the committed files differ from what the source builds:\n  ${differ.join('\n  ')}\nRun ${rebuild} and commit them.`);
    console.log(`${tag}: ${Object.keys(files).length} committed file(s) match the source.`);
    return;
  }
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
}
