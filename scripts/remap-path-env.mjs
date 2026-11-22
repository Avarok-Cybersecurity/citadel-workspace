#!/usr/bin/env node
/**
 * Prints `NAME=VALUE`: the cargo environment variable that adds this repository's
 * --remap-path-prefix flags (scripts/lib/remap-paths.mjs) for one target, for builders that are
 * not node scripts (sync-wasm-clients.sh, the tenant worker's build.sh, the agent's release build,
 * build.rs, sync-cdoc-wasm.sh).
 *
 *   node scripts/remap-path-env.mjs [--cflags|--cxxflags] <target-triple> [<dir>=<label> ...]
 *
 * Bare, it prints the rustc variable. --cflags and --cxxflags print the C and C++ compilers'
 * (CFLAGS_<triple>, CXXFLAGS_<triple>), mapping the same roots in the C code the `cc` and `cmake`
 * crates compile: a builder that compiles C exports all three.
 *
 * Each extra `<dir>=<label>` maps another source root the build compiles from (citadel-docs).
 * In bash, assign before exporting, so a failure here stops a `set -e` script:
 *   remap="$(node scripts/remap-path-env.mjs wasm32-unknown-unknown)"; export "$remap"
 */
import { cFlags, remapFlags, targetCompilerFlagsEnv, targetRustflagsEnv } from './lib/remap-paths.mjs';

const COMPILER_VARIABLES = { '--cflags': 'CFLAGS', '--cxxflags': 'CXXFLAGS' };
const args = process.argv.slice(2);
const compilerVariable = COMPILER_VARIABLES[args[0]];
if (compilerVariable) args.shift();
const [triple, ...rest] = args;
if (!triple || triple.startsWith('--')) {
  console.error('usage: remap-path-env.mjs [--cflags|--cxxflags] <target-triple> [<dir>=<label> ...]');
  process.exit(1);
}
try {
  const extra = rest.map((pair) => {
    const at = pair.lastIndexOf('=');
    if (at <= 0 || !pair.slice(at + 1).startsWith('/')) throw new Error(`'${pair}' is not <dir>=</label>`);
    return [pair.slice(0, at), pair.slice(at + 1)];
  });
  const { name, value } = compilerVariable
    ? targetCompilerFlagsEnv(compilerVariable, triple, cFlags(triple, { extra }))
    : targetRustflagsEnv(triple, remapFlags({ extra }));
  process.stdout.write(`${name}=${value}\n`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
