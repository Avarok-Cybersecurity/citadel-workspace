/**
 * The `--remap-path-prefix` flags every Rust artefact we ship is compiled with.
 *
 * rustc writes source paths into the binary: panic locations, `file!()`, debug info. Unmapped,
 * those are the build machine's own paths -- `/Users/<name>/.cargo/registry/...` in the
 * committed WASM client, `/Users/runner/.cargo/...` in the released agent -- which leaks who
 * built it and makes the bytes depend on where it was built. Two prefixes cover what we compile:
 * this checkout (the workspace's and the submodules' own crates) and cargo's home (every
 * registry and git dependency). Each builder passes extra roots it compiles from elsewhere.
 *
 * One list, read by every builder (scripts/remap-path-env.mjs for the shell and build.rs ones),
 * so no two of them can map differently. scripts/check-no-home-paths-shipped.mjs is the gate.
 */
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where cargo itself reads its registry from: CARGO_HOME, else ~/.cargo (cargo's own rule). */
export function cargoHome(env = process.env) {
  return env.CARGO_HOME ?? join(homedir(), '.cargo');
}

/**
 * The flags, in a fixed order: the checkout, cargo's home, then each extra `[dir, label]`.
 * The committed fixtures' bytes depend on this order (build-app-fixtures.mjs --check).
 */
export function remapFlags({ root = ROOT, home = cargoHome(), extra = [] } = {}) {
  const pairs = [[root, '/citadel-workspace'], [home, '/cargo'], ...extra];
  return pairs.map(([dir, label]) => {
    if (!dir) throw new Error(`remap-paths: no directory given for ${label}`);
    return `--remap-path-prefix=${resolve(dir)}=${label}`;
  });
}

/**
 * The environment variable that adds flags for one target. Cargo MERGES it with the
 * `target.<triple>.rustflags` a .cargo/config.toml sets (the getrandom backend for wasm), where
 * RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS would replace them. Cargo splits it on whitespace, so a
 * path containing whitespace is refused rather than silently split.
 */
export function targetRustflagsEnv(triple, flags) {
  if (!/^[a-z0-9_.-]+$/.test(triple)) throw new Error(`remap-paths: '${triple}' is not a target triple`);
  const spaced = flags.find((f) => /\s/.test(f));
  if (spaced) throw new Error(`remap-paths: '${spaced}' contains whitespace, which cargo would split`);
  const name = `CARGO_TARGET_${triple.toUpperCase().replace(/[-.]/g, '_')}_RUSTFLAGS`;
  return { name, value: flags.join(' ') };
}
