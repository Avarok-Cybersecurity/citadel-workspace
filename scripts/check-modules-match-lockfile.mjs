#!/usr/bin/env node
/**
 * The installed node_modules matches package-lock.json, before any gate runs against it.
 *
 * A merge brought a new lockfile (react-router 7, vitest 4) into a clone without a root `npm ci`; the
 * next push ran 236 checks for 33 minutes and failed one on the stale packages. This says so in a line,
 * first. CI always installs with `npm ci`, so it holds there by construction.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDrift } from './lib/installed-modules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hidden = join(ROOT, 'node_modules', '.package-lock.json');
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
const installed = existsSync(hidden) ? JSON.parse(readFileSync(hidden, 'utf8')) : null;
const { drifted, examples } = installDrift(lock, installed);
if (drifted) {
  console.error(`FAIL: node_modules is not what package-lock.json describes (${examples.length} package(s)), e.g.:`);
  for (const line of examples.slice(0, 5)) console.error(`  - ${line}`);
  console.error('  fix: npm ci   (at the repo root)');
  process.exit(1);
}
const entries = Object.keys(lock.packages ?? {}).filter((path) => path !== '').length;
console.log(`node_modules matches package-lock.json: ${entries} lockfile entries compared.`);
