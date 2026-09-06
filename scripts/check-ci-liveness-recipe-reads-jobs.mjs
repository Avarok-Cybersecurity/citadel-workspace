/**
 * No document may recommend the run-level CI liveness check.
 *
 * A workflow run's `status` stays `queued` until every job finishes. So
 * `gh api "repos/<r>/actions/runs?status=in_progress"` returns 0 while dozens
 * of jobs execute, and `gh run list --json status` shows `queued` for a run
 * whose jobs have already failed.
 *
 * This repository's own record recommended the first form, under a heading
 * asking "are any jobs actually in progress". It misled three times: into
 * concluding the org queue was wedged, into cancelling other runs to free
 * slots that were never blocked, and into reporting CI as starved for hours
 * while a run had been completing with readable failures throughout.
 *
 * The rule: a doc may MENTION the run-level form — the record has to be able
 * to describe the mistake — but not present it as the way to check. A mention
 * must sit within a few lines of the job-level answer, so a reader cannot take
 * the wrong half away on its own.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = 'scripts/ci-jobs.mjs';

if (!existsSync(join(ROOT, HELPER))) {
  console.error(
    `FAIL: ${HELPER} is missing. The docs point at it as the way to read CI\n` +
      'liveness; without it the only recipe left is the one that lies.',
  );
  process.exit(1);
}

/** Docs a person follows. */
const DIRS = ['docs', '.claude/agents'];
const FILES = ['CLAUDE.md', 'README.md', 'ARCHITECTURE.md'];

const targets = [...FILES.map((f) => join(ROOT, f))];
for (const dir of DIRS) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) continue;
  for (const entry of readdirSync(full)) {
    if (entry.endsWith('.md')) targets.push(join(full, entry));
  }
}

if (targets.length === 0) {
  console.error('FAIL: no documents found — this gate would pass by reading nothing.');
  process.exit(1);
}

/** The run-level forms that cannot answer "is anything running". */
const RUN_LEVEL = /runs\?status=in_progress|gh run list[^\n]*--json[^\n]*status/;
/** The job-level answer, in any of its spellings. */
const JOB_LEVEL = /ci-jobs\.mjs|actions\/runs\/[^\s]*\/jobs|run view[^\n]*--json[^\n]*jobs/;

const problems = [];
let scanned = 0;

for (const file of targets) {
  const lines = readFileSync(file, 'utf8').split('\n');
  scanned += 1;
  lines.forEach((line, i) => {
    if (!RUN_LEVEL.test(line)) return;
    // Within six lines either way — close enough that a reader takes both.
    const nearby = lines.slice(Math.max(0, i - 6), i + 7).join('\n');
    if (JOB_LEVEL.test(nearby)) return;
    problems.push(`${file.slice(ROOT.length + 1)}:${i + 1}  ${line.trim().slice(0, 90)}`);
  });
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error file=${p.split(':')[0]}::${p}`);
  console.error(`\nFAIL: ${problems.length} run-level CI check(s) presented without the job-level answer.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    `\nA run reports "queued" until every job finishes, so this form returns 0\n` +
      'while jobs execute and hides failures that have already happened. Cite\n' +
      `\`node ${HELPER} <owner/repo> <branch|run-id>\` beside it, or instead of it.`,
  );
  process.exit(1);
}

console.log(
  `check-ci-liveness-recipe-reads-jobs: ${scanned} document(s) scanned; every run-level ` +
    'CI check sits beside the job-level answer.',
);
