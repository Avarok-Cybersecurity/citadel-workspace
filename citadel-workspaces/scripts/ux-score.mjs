/**
 * The UX score of this build (RECOVERY-DESIGN.md §4.2), and a ratchet: it may not fall below
 * scripts/ux-score.baseline.json. The score's history is that file's git log.
 *
 * The maths is src/lib/recovery-route/score.ts and the plans are the surface registry, both
 * TypeScript, bundled here with esbuild so this script holds no second copy of either. The
 * dead-end candidates, and which surfaces a screen actually draws, come from the same scan the
 * dead-end gate uses: a plan in the registry that nothing draws does not count.
 *
 *   node scripts/ux-score.mjs            check against the baseline
 *   node scripts/ux-score.mjs --write    record the current score
 *   node scripts/ux-score.mjs --json F   also write the score to F (the CI artifact)
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanApp } from './lib/recovery-sinks.mjs';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = resolve(APP, 'scripts', 'ux-score.baseline.json');

const entry = `
import { SURFACES } from '@/lib/recovery-route/surfaces';
import { uxScore } from '@/lib/recovery-route/score';
export const score = (drawn, deadEnds) => uxScore({ plans: drawn.filter((id) => id in SURFACES).map((id) => SURFACES[id]), deadEnds });
`;
const bundle = await esbuild.build({
  stdin: { contents: entry, resolveDir: APP, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  alias: { '@': resolve(APP, 'src') },
  external: ['citadel-workspace-client-ts', 'citadel-internal-service-wasm-client'],
});
const { score } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const { deadEnds, drawn } = scanApp(APP);
const candidates = Object.values(deadEnds).reduce((n, c) => n + c, 0);
const result = score(drawn, candidates);

const json = process.argv.indexOf('--json');
if (json !== -1) writeFileSync(process.argv[json + 1], `${JSON.stringify(result, null, 2)}\n`);

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, `${JSON.stringify({ score: result.score }, null, 2)}\n`);
  console.log(`Recorded UX score ${result.score}.`);
  process.exit(0);
}
if (!existsSync(BASELINE)) {
  console.error('  UX score: scripts/ux-score.baseline.json is missing -- run with --write and commit it  FAIL');
  process.exit(1);
}
const floor = JSON.parse(readFileSync(BASELINE, 'utf-8')).score;
if (result.score < floor) {
  console.log(`  UX score fell: ${result.score} < ${floor} (${result.surfaces} drawn surfaces, ${result.deadEnds} dead-end candidates)  FAIL`);
  process.exit(1);
}
console.log(`  UX score ${result.score} (floor ${floor}; ${result.surfaces} drawn surfaces, ${result.deadEnds} dead-end candidates)${result.score > floor ? ' -- raised; record with --write' : ''}  ok`);
