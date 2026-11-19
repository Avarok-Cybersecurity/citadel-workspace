#!/usr/bin/env node
/**
 * No browser gate serves on a fixed port (lib/fixed-ports.mjs).
 *
 * check:a11y, check:ui-sweep and the rest each had a fixed port with --strictPort, so concurrent
 * runs -- two lanes, a gate and its control -- collided on 4198 and 4203 and the second died.
 * Scans every script here and under lib/. lib/bench-harness/serve.mjs is the one exemption: a
 * manual tool whose port is its caller's required --port argument, not a gate's choice.
 * Test files are not scanned: lib/fixed-ports.test.mjs holds the old fixed-port shapes as its
 * fixtures, and no test serves a gate's page.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixedPorts } from './lib/fixed-ports.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const EXEMPT = new Set(['lib/bench-harness/serve.mjs']);

const files = readdirSync(SCRIPTS, { recursive: true })
  .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && !f.includes('node_modules'))
  .map((f) => relative(SCRIPTS, join(SCRIPTS, f)));
const problems = [];
let serving = 0;
for (const file of files) {
  if (EXEMPT.has(file)) continue;
  const source = readFileSync(join(SCRIPTS, file), 'utf8');
  if (/freePort\(|port: 0\b/.test(source)) serving += 1;
  for (const { line, text, why } of fixedPorts(source)) problems.push(`${file}:${line}: ${why}: ${text}`);
}
if (serving === 0) problems.push('no gate chooses a port per run: this check found nothing to measure');
if (problems.length) {
  console.error(`Browser gates on a fixed port:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`  ${serving} script(s) choose their server's port per run; none is fixed  ok`);
