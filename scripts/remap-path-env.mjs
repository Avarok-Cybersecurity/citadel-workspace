#!/usr/bin/env node
/**
 * Prints `NAME=VALUE`: the cargo environment variable that adds this repository's
 * --remap-path-prefix flags (scripts/lib/remap-paths.mjs) for one target, for builders that are
 * not node scripts (sync-wasm-clients.sh, the tenant worker's build.sh, the agent's release build,
 * build.rs, sync-cdoc-wasm.sh).
 *
 *   node scripts/remap-path-env.mjs <target-triple> [<dir>=<label> ...]
 *
 * Each extra `<dir>=<label>` maps another source root the build compiles from (citadel-docs).
 * In bash, assign before exporting, so a failure here stops a `set -e` script:
 *   remap="$(node scripts/remap-path-env.mjs wasm32-unknown-unknown)"; export "$remap"
 */
import { remapFlags, targetRustflagsEnv } from './lib/remap-paths.mjs';

const [triple, ...rest] = process.argv.slice(2);
if (!triple) {
  console.error('usage: remap-path-env.mjs <target-triple> [<dir>=<label> ...]');
  process.exit(1);
}
try {
  const extra = rest.map((pair) => {
    const at = pair.lastIndexOf('=');
    if (at <= 0 || !pair.slice(at + 1).startsWith('/')) throw new Error(`'${pair}' is not <dir>=</label>`);
    return [pair.slice(0, at), pair.slice(at + 1)];
  });
  const { name, value } = targetRustflagsEnv(triple, remapFlags({ extra }));
  process.stdout.write(`${name}=${value}\n`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
