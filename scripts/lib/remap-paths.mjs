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

/** The roots every builder maps, in a fixed order: the checkout, cargo's home, then each extra. */
function remapPairs({ root = ROOT, home = cargoHome(), extra = [] } = {}) {
  const pairs = [[root, '/citadel-workspace'], [home, '/cargo'], ...extra];
  for (const [dir, label] of pairs) if (!dir) throw new Error(`remap-paths: no directory given for ${label}`);
  return pairs.map(([dir, label]) => [resolve(dir), label]);
}

/**
 * The flags, in a fixed order: the checkout, cargo's home, then each extra `[dir, label]`.
 * The committed fixtures' bytes depend on this order (build-app-fixtures.mjs --check).
 */
export function remapFlags(roots = {}) {
  return remapPairs(roots).map(([dir, label]) => `--remap-path-prefix=${dir}=${label}`);
}

/**
 * The same roots for the C and C++ compilers the `cc` and `cmake` crates drive, which rustc's
 * flag never reaches: their `__FILE__` strings (aws-lc's error records, for one) carry the path
 * each source was compiled from. GCC and Clang take `-ffile-prefix-map`, mapped to the same
 * labels. MSVC's cl has no remapping flag, only `/d1trimfile`, which cuts the prefix off
 * `__FILE__`; aws-lc-sys maps its own directory for GCC and Clang and nothing for cl, which is how
 * the Windows agent alone shipped `C:\Users\<name>\.cargo\registry\...\aws-lc-sys-*` paths.
 * Only the agent's builders apply these: the WASM builds link no C, and the gate covers them.
 */
export function cFlags(triple, roots = {}) {
  const pairs = remapPairs(roots);
  if (triple.endsWith('-msvc')) return pairs.map(([dir]) => `/d1trimfile:${dir}`);
  return pairs.map(([dir, label]) => `-ffile-prefix-map=${dir}=${label}`);
}

/**
 * The environment variable that adds flags for one target. Cargo MERGES it with the
 * `target.<triple>.rustflags` a .cargo/config.toml sets (the getrandom backend for wasm), where
 * RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS would replace them. Cargo splits it on whitespace, so a
 * path containing whitespace is refused rather than silently split.
 */
export function targetRustflagsEnv(triple, flags) {
  return { name: `CARGO_TARGET_${envTriple(triple)}_RUSTFLAGS`, value: joined(flags) };
}

/**
 * The variable the `cc` crate adds to every C (`CFLAGS`) or C++ (`CXXFLAGS`) compile for one
 * target, read as well by the `cmake` crate, which takes its flags from `cc`. Split on
 * whitespace like cargo's, so the same refusal applies.
 */
export function targetCompilerFlagsEnv(variable, triple, flags) {
  if (variable !== 'CFLAGS' && variable !== 'CXXFLAGS') throw new Error(`remap-paths: '${variable}' is not CFLAGS or CXXFLAGS`);
  return { name: `${variable}_${envTriple(triple).toLowerCase()}`, value: joined(flags) };
}

function envTriple(triple) {
  if (!/^[a-z0-9_.-]+$/.test(triple)) throw new Error(`remap-paths: '${triple}' is not a target triple`);
  return triple.toUpperCase().replace(/[-.]/g, '_');
}

function joined(flags) {
  const spaced = flags.find((f) => /\s/.test(f));
  if (spaced) throw new Error(`remap-paths: '${spaced}' contains whitespace, which would be split`);
  return flags.join(' ');
}
