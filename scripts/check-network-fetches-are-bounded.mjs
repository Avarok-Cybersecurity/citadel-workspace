#!/usr/bin/env node
/**
 * A retry bounds failures. A timeout bounds hangs. Neither substitutes.
 *
 * Two jobs were killed by their budgets in consecutive runs, both in steps that
 * already retried:
 *
 *   - `test:notifications`, 55 minutes on `playwright install` (round 440);
 *   - `test:settings-controls`, on `pull-base-images.sh`, orphan process
 *     `docker` (round 456).
 *
 * The retry loops were correct and useless. A fetch that FAILS comes back and
 * the loop tries again; a fetch that STALLS sits on attempt one until something
 * outside kills the job — and the log says nothing, because nothing failed.
 *
 * So every network fetch in a build or a CI script needs a bound as well as a
 * retry. `curl` waits for ever by default; `docker pull` waits for ever; npm
 * does not, which is why npm is deliberately not checked here.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'docker/sync/Dockerfile',
  'docker/ui/Dockerfile',
  'docker/internal-service/Dockerfile',
  'docker/workspace-server/Dockerfile',
  'scripts/pull-base-images.sh',
];

const problems = [];
let checked = 0;

for (const rel of FILES) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) {
    problems.push([rel, 'listed here but not present; this check is out of date']);
    continue;
  }
  readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return;

    // A curl that fetches, as opposed to `apt-get install ... curl`.
    if (/\bcurl\s+[^|;]*https?:\/\//.test(trimmed)) {
      checked += 1;
      if (!/--max-time\s+\d+/.test(trimmed)) {
        problems.push([`${rel}:${i + 1}`, `curl with no --max-time: ${trimmed.slice(0, 70)}`]);
      }
    }

    // `docker pull` outside a `timeout`.
    if (/\bdocker\s+pull\b/.test(trimmed)) {
      checked += 1;
      if (!/\btimeout\s+["$\w]/.test(trimmed)) {
        problems.push([`${rel}:${i + 1}`, `docker pull with no timeout: ${trimmed.slice(0, 70)}`]);
      }
    }
  });
}

if (problems.length > 0) {
  console.error('\n  Network fetches that can hang for ever:\n');
  for (const [where, why] of problems) console.error(`::error::${where} — ${why}`);
  console.error(
    '\n  Add a bound: `--max-time` for curl, `timeout <n>` before docker pull.\n' +
    '  A retry loop around a stalled fetch never gets to retry -- it holds the\n' +
    '  job until the budget kills it, and the log shows no failure at all.\n',
  );
  process.exit(1);
}

console.log(`  Network fetches: ${checked} bounded fetch(es) across ${FILES.length} file(s)  ok`);
