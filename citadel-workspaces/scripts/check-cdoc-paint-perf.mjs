#!/usr/bin/env node
/**
 * Prints the Citadel Docs paint-path numbers on the 100-page golden: decode, first-page paint,
 * atlas hit rate. A measurement, not a gate: it asserts no time, so it never fails on a busy
 * machine. Timing-sensitive CI belongs on GitHub runners, never the shared Mac.
 *
 *   node scripts/check-cdoc-paint-perf.mjs [runs=15] [zoom=1] [dpr=2]
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const [runs, zoom, dpr] = process.argv.slice(2);
const args = [String(Number(runs ?? 15)), String(Number(zoom ?? 1)), String(Number(dpr ?? 2))];
const result = spawnSync('npx', ['vite-node', '--root', UI, join(UI, 'src/lib/cdoc/__tests__/perf/paint-perf-cli.ts'), ...args], { cwd: UI, stdio: 'inherit' });
process.exit(result.status ?? 1);
