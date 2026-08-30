#!/usr/bin/env node
/**
 * Every `playwright install` in CI retries, and each attempt is bounded.
 *
 * `test:notifications` spent 55 minutes on this step in run 33300992291 and was
 * killed by its job budget without running a single test. The log's last lines
 * name it: `Terminate orphan process: npm exec playwright install chromium
 * --with-deps`. It is a CDN download with no retry and no timeout of its own,
 * so a stalled connection eats the whole job.
 *
 * npm is not in the same position and is deliberately not checked here: it
 * retries its own fetches. This download does not, which is why it is the one
 * that hung.
 *
 * The check exists because the fix did not propagate on its own. Three steps in
 * the parent workflow were wrapped, and the submodule's workflow had three more
 * that would have shipped unwrapped -- the shape this repo's notes call "a
 * correct fix applied in ONE place".
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const WORKFLOWS = [
  '.github/workflows/validate.yml',
  '.github/workflows/publish-images.yml',
  'citadel-workspaces/.github/workflows/validate.yml',
];

const problems = [];
let checked = 0;

for (const rel of WORKFLOWS) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) {
    problems.push([rel, 'listed here but not present; this check is out of date']);
    continue;
  }
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!/playwright\s+install/.test(trimmed)) return;
    // Prose about the rule is not a call site.
    if (trimmed.startsWith('#') || trimmed.startsWith('*')) return;
    checked += 1;
    // A bare `run:` invocation is the unbounded form. Inside a retry loop the
    // call is preceded by `timeout <n>` on the same line.
    const bounded = /\btimeout\s+\d+\s+npx\s+playwright\s+install/.test(trimmed);
    const isRunLine = /^run:\s*npx\s+playwright\s+install/.test(trimmed);
    if (isRunLine || (!bounded && /^npx\s+playwright\s+install/.test(trimmed))) {
      problems.push([`${rel}:${i + 1}`, `unbounded: ${trimmed.slice(0, 80)}`]);
    }
  });
}

if (problems.length > 0) {
  console.error('\n  Browser installs with no retry and no timeout:\n');
  for (const [where, why] of problems) console.error(`::error::${where} — ${why}`);
  console.error(
    '\n  Wrap it: `until timeout 600 npx playwright install ...; do` with a\n' +
    '  three-attempt cap that exits non-zero. A stalled download otherwise\n' +
    '  consumes the whole job budget and reports nothing.\n',
  );
  process.exit(1);
}

console.log(`  Browser installs: ${checked} call site(s) across ${WORKFLOWS.length} workflow(s), all bounded  ok`);
