#!/usr/bin/env node
/**
 * The "Validation passed" job must depend on every other job in validate.yml,
 * and must run even when one of them fails.
 *
 * Branch protection requires that ONE check, by name, instead of ~75 matrix
 * names. That makes it a single point of truth — and a single point of silent
 * failure, in two ways this guards against:
 *
 *   1. A job added to validate.yml but not to the aggregate's `needs:` is
 *      simply not required. It can go red on every PR and nothing blocks a
 *      merge. The aggregate stays green because it never asked.
 *
 *   2. Without `if: always()`, a failed dependency makes the aggregate
 *      SKIPPED, and GitHub counts a skipped required check as passing.
 *
 * Before this existed, master's only required check was a seconds-long
 * secrets scan, and auto-merge landed PRs before their tests had run.
 *
 * Parsed by indentation rather than with a YAML library, like the other
 * workflow checks here: job keys are the two-space-indented keys under the
 * top-level `jobs:`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, '.github/workflows/validate.yml');
const AGGREGATE = 'all-green';

const lines = readFileSync(FILE, 'utf8').split('\n');
const jobsAt = lines.findIndex((l) => l === 'jobs:');
if (jobsAt < 0) {
  console.error(`FAIL: no top-level 'jobs:' in ${FILE}`);
  process.exit(1);
}

const jobs = [];
for (let i = jobsAt + 1; i < lines.length; i++) {
  const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
  if (m) jobs.push({ name: m[1], at: i });
}
// A guard that finds nothing must fail, not report "nothing is missing".
if (jobs.length < 2) {
  console.error(`FAIL: found ${jobs.length} job(s) in ${FILE}; the parser is not seeing the file`);
  process.exit(1);
}

const agg = jobs.find((j) => j.name === AGGREGATE);
if (!agg) {
  console.error(`FAIL: validate.yml has no '${AGGREGATE}' job; branch protection requires it by name`);
  process.exit(1);
}
const next = jobs.find((j) => j.at > agg.at);
const body = lines.slice(agg.at + 1, next ? next.at : lines.length);

const needs = [];
const needsAt = body.findIndex((l) => /^ {4}needs:\s*$/.test(l));
if (needsAt >= 0) {
  for (let i = needsAt + 1; i < body.length; i++) {
    const m = /^ {6}- ([A-Za-z0-9_-]+)\s*$/.exec(body[i]);
    if (!m) break;
    needs.push(m[1]);
  }
}

const problems = [];
const others = jobs.map((j) => j.name).filter((n) => n !== AGGREGATE);
const missing = others.filter((n) => !needs.includes(n));
const extra = needs.filter((n) => !others.includes(n));
if (missing.length) problems.push(`not in '${AGGREGATE}' needs, so NOT required to pass: ${missing.join(', ')}`);
if (extra.length) problems.push(`in '${AGGREGATE}' needs but not a job: ${extra.join(', ')}`);
if (!body.some((l) => /^ {4}if: always\(\)\s*$/.test(l))) {
  problems.push(`'${AGGREGATE}' has no 'if: always()' — a failed dependency would make it SKIPPED, which branch protection counts as passing`);
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL: ${p}`);
  process.exit(1);
}
console.log(`'${AGGREGATE}' requires all ${others.length} validation jobs and runs even when one fails.`);
