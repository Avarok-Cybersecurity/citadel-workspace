#!/usr/bin/env node
/**
 * Every wasm-bindgen init call passes the single object the glue expects (scripts/lib/wasm-init-shape.mjs).
 *
 * The UI printed "using deprecated parameters for the initialization function; pass a single
 * object instead" on every load, from the client package's loader in the agent submodule. Hand-
 * written sources only, submodules included; generated glue (pkg/, vendor/, public/) is the callee.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deprecatedInitCalls } from './lib/wasm-init-shape.mjs';
import { ROOT } from './lib/remap-paths.mjs';

const SOURCE = /\.(?:[cm]?js|tsx?)$/;
const GENERATED = /(?:^|\/)(?:node_modules|pkg|vendor|public|dist|target)\/|\.d\.ts$/;
const files = execFileSync('git', ['ls-files', '-z', '--recurse-submodules'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  // Its own test holds the deprecated shapes as fixtures.
  .filter((f) => SOURCE.test(f) && !GENERATED.test(f) && f !== 'scripts/lib/wasm-init-shape.test.mjs');
if (!files.some((f) => f.endsWith('typescript-client/src/wasm-module.ts'))) {
  console.error('The agent submodule is not checked out: the client loader was not scanned.');
  process.exit(1);
}
const problems = [];
for (const file of files) {
  for (const { line, call } of deprecatedInitCalls(readFileSync(join(ROOT, file), 'utf8'))) problems.push(`${file}:${line}: ${call}…`);
}
if (problems.length) {
  console.error(`wasm-bindgen init with the deprecated signature:\n  ${problems.join('\n  ')}`);
  console.error('\nPass one object: default({ module_or_path }) or initSync({ module }).');
  process.exit(1);
}
console.log(`wasm-bindgen init takes the object form in all ${files.length} hand-written source(s).`);
