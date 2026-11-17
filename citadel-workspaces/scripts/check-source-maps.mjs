#!/usr/bin/env node
/**
 * Every emitted JS chunk ships a usable source map.
 *
 * Lighthouse has a `valid-source-maps` audit, but it fetches each map over the
 * network and reports "missing" when the fetch does not land — so on a loaded
 * CI runner it fails intermittently against a build whose maps are perfectly
 * correct. That is a measurement of the runner, not of the artefact.
 *
 * This asks the same question of the files on disk, where the answer cannot
 * flicker: for every chunk, is there a `sourceMappingURL`, does the map it
 * names exist, and does that map carry `sourcesContent` (without which a stack
 * trace still cannot be resolved back to source)?
 *
 * Run after `npm run build`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(__dirname, '..', 'dist', 'assets');

if (!existsSync(ASSETS)) {
  console.error('\n  No dist/assets — run `npm run build` first.\n');
  process.exit(1);
}

const failures = [];
let checked = 0;

for (const file of readdirSync(ASSETS).filter((f) => f.endsWith('.js'))) {
  checked += 1;
  const js = readFileSync(join(ASSETS, file), 'utf8');
  const ref = /\/\/# sourceMappingURL=(\S+)/.exec(js);
  if (!ref) {
    failures.push(`${file}: no sourceMappingURL comment`);
    continue;
  }

  const mapPath = join(ASSETS, ref[1]);
  if (!existsSync(mapPath)) {
    failures.push(`${file}: names ${ref[1]}, which does not exist`);
    continue;
  }

  let map;
  try {
    map = JSON.parse(readFileSync(mapPath, 'utf8'));
  } catch {
    failures.push(`${file}: ${ref[1]} is not valid JSON`);
    continue;
  }

  // sourcesContent is the part that matters for triage: without it the map
  // resolves to file NAMES the browser cannot fetch, and a production stack
  // trace stays unreadable.
  const sources = map.sources?.length ?? 0;
  const contents = map.sourcesContent?.length ?? 0;
  if (sources === 0 || contents < sources) {
    failures.push(`${file}: ${ref[1]} has ${sources} sources but ${contents} sourcesContent`);
  }
}

console.log(`\n  Source maps — ${checked} JavaScript chunk(s) in dist/assets\n`);

// A run over zero chunks passes, and looks exactly like a run over a clean
// build. That is how a renamed output directory, a build that emitted nothing,
// or a checkout with no dist/ at all turns this gate green while checking
// nothing. A production app has many chunks; a handful means something is
// wrong with the inputs, not with the maps.
const MIN_CHUNKS = 5;
if (checked < MIN_CHUNKS) {
  console.error(
    `  Only ${checked} chunk(s) found in ${ASSETS}. A real build emits many more,\n` +
      '  so this run checked nothing meaningful — failing rather than reporting\n' +
      '  a clean result over an empty or wrong directory.\n',
  );
  process.exit(1);
}

if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.error(`\n  ${failures.length} chunk(s) cannot be mapped back to source.\n`);
  process.exit(1);
}
console.log('  ok    every chunk names a map that exists and carries its sources\n');
