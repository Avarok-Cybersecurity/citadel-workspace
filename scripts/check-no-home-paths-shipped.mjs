#!/usr/bin/env node
/**
 * No artefact we ship carries a build machine's home directory.
 *
 * The committed WASM client printed `/Users/nologik/.cargo/registry/...` in the browser console of
 * every user (ws_stream_wasm's warnings carry their source location), and the released agent held
 * 6,318 `/Users/runner/.cargo/...` strings. rustc embeds source paths unless told to map them;
 * every builder now passes the flags in scripts/lib/remap-paths.mjs, and this is what proves it.
 *
 *   node scripts/check-no-home-paths-shipped.mjs            every tracked shipped artefact
 *   node scripts/check-no-home-paths-shipped.mjs <file>...  these files (a release build's output)
 *   ... [--allow-under <dir>]... <file>...                    except whole paths under <dir>
 *
 * --allow-under is for a path a C build compiled in, which no rustc flag can map: the agent's
 * vendored OpenSSL holds its build directory as ENGINESDIR/MODULESDIR. Only explicit files take it.
 *
 * Tracked and shipped: every .wasm, and the JavaScript beside the WASM the UI serves (the client
 * package, the vendored glue, public/). Files given explicitly must exist: a scan of nothing
 * reports a cleanliness it never checked.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homePathsIn } from './lib/home-paths.mjs';
import { ROOT } from './lib/remap-paths.mjs';

const SHIPPED_JS = /^(citadel-workspace-client-ts\/pkg|citadel-workspaces\/vendor|citadel-workspaces\/public)\/.*\.m?js$/;

function trackedArtefacts() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f.endsWith('.wasm') || SHIPPED_JS.test(f))
    .map((f) => join(ROOT, f));
}

const allowUnder = [];
const given = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] !== '--allow-under') given.push(process.argv[i]);
  else if (process.argv[i + 1]) allowUnder.push(process.argv[++i]);
  else {
    console.error('--allow-under takes a directory');
    process.exit(1);
  }
}
if (allowUnder.length && !given.length) {
  console.error('--allow-under applies to files named explicitly, never to the tracked artefacts');
  process.exit(1);
}
const files = given.length ? given : trackedArtefacts();
const problems = [];
for (const file of files) {
  if (!existsSync(file)) {
    problems.push(`${file}: does not exist`);
    continue;
  }
  const found = homePathsIn(readFileSync(file), { allowUnder });
  if (found.length) problems.push(`${file}: ${found.join(', ')}`);
}
if (files.length === 0) problems.push('no artefact to check; the scan would have measured nothing');

if (problems.length) {
  console.error(`Build-machine home paths in ${problems.length} shipped artefact(s):\n  ${problems.join('\n  ')}`);
  console.error('\nBuild it with the flags in scripts/lib/remap-paths.mjs (scripts/remap-path-env.mjs for shell builders).');
  process.exit(1);
}
console.log(`No home-directory path in ${files.length} shipped artefact(s).`);
