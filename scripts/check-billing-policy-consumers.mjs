#!/usr/bin/env node
/**
 * No billing code carries its own copy of a billing/policy.json value.
 *
 * Every time limit and threshold in billing -- the termination TTL, the grace and reminder days,
 * the alert percentages, steps and countdowns -- lives in billing/policy.json, and the Worker,
 * the emails, the UI and the terms render it from there (docs/plans/billing-automation.md G).
 * A copy is how they drift: the file says 72 hours, an email still says 48. So this reads
 * deploy/tenant-worker/control and billing/ (code and comments, not tests or data files) and
 * fails on any line that names a time or a threshold -- hours, days, percent, %, TTL, grace,
 * reminder, countdown, threshold -- next to a number equal to one of the policy's values.
 *
 * A line that has such a number for another reason (a percentage computed as a ratio, an hour
 * in milliseconds) says so: `not-policy: <reason>`. A marker with no reason is itself a failure.
 * 0 is not matched: it means "none" in too many places to tell a copy from an absence.
 *
 * Dependency-free (node: builtins only), so it runs in the job that installs nothing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY = 'billing/policy.json';
const SCANNED = ['deploy/tenant-worker/control', 'billing'];

/** Every number in the policy, at any depth, but for its comments. */
function numbersIn(value, found = new Set()) {
  if (typeof value === 'number') found.add(value);
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, found));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (k !== '$comment') numbersIn(v, found);
  }
  return found;
}

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (name.endsWith('.mjs') && !name.endsWith('.test.mjs')) out.push(path);
  }
  return out;
}

const values = numbersIn(JSON.parse(readFileSync(join(ROOT, POLICY), 'utf8')));
values.delete(0);
if (values.size < 5) {
  console.error(`check-billing-policy-consumers: ${POLICY} holds only ${values.size} non-zero numbers; the file moved or changed shape, so nothing can be checked.`);
  process.exit(1);
}

const NAMES_A_LIMIT = /\b(hours?|days?|percent(ages?|s)?|ttl|grace|reminders?|countdowns?|thresholds?)\b|%/i;
const NUMBER = /(?<![\w.$])\d+(?:\.\d+)?(?![\w.])/g;
const MARKER = /not-policy:(.*)$/;

const files = SCANNED.flatMap((d) => sources(join(ROOT, d)));
if (files.length < 10) {
  console.error(`check-billing-policy-consumers: only ${files.length} source files under ${SCANNED.join(', ')}; the layout moved.`);
  process.exit(1);
}

const failures = [];
let lines = 0;
let marked = 0;
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    lines += 1;
    const where = `${relative(ROOT, file)}:${i + 1}`;
    const marker = MARKER.exec(line);
    if (marker) {
      if (marker[1].trim().length < 3) failures.push(`${where}: a not-policy marker with no reason`);
      else marked += 1;
      return;
    }
    if (!NAMES_A_LIMIT.test(line)) return;
    const copies = [...line.matchAll(NUMBER)].map((m) => Number(m[0])).filter((n) => values.has(n));
    if (copies.length) failures.push(`${where}: ${copies.join(', ')} next to a time or threshold -- read it from ${POLICY}\n      ${line.trim()}`);
  });
}

if (failures.length) {
  console.error(`\ncheck-billing-policy-consumers: ${failures.length} line(s) carry their own copy of a policy value:\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(`\n  Import the value (deploy/tenant-worker/control/policy.mjs, or hand billing/ code the policy),\n  or mark a number that is not a policy value with \`not-policy: <reason>\`.\n`);
  process.exit(1);
}
console.log(
  `check-billing-policy-consumers: ${files.length} files, ${lines} lines checked against ${values.size} policy values ` +
    `(${[...values].sort((a, b) => a - b).join(', ')}); ${marked} line(s) marked not-policy.`,
);
