#!/usr/bin/env node
// Every assignment that makes somebody an administrator must sit behind a gate.
//
// `user.role` is a single GLOBAL field: `is_admin` reads it and never asks which
// workspace. So one ungated `user.role = UserRole::Admin` is a workspace-wide
// privilege escalation, and three of them existed at once — reached through the
// role door, the permission door, and workspace creation — because nothing kept
// the promotion sites consistent with each other. Each was found by hand, one
// round apart.
//
// A gate is one of:
//   - `is_bootstrap` / `root_exists`  — there is no workspace yet, so this
//     account IS the administrator by definition
//   - `FirstMemberOutcome`            — the operator asked for it by name, via
//     WORKSPACE_ALLOW_FIRST_CONNECT_ADMIN
//   - `ensure_may_grant_role` / `ensure_may_grant_permissions` — containment:
//     you cannot hand out authority you do not hold
//
// Demotions are not promotions: assigning Member, Guest or Banned only takes
// authority away and needs nothing.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = 'citadel-workspace-server-kernel/src';
const PROMOTION = /\.role\s*=\s*UserRole::(Admin|Owner)\b/;
const GATES = [
  'is_bootstrap',
  'root_exists',
  'FirstMemberOutcome',
  'ensure_may_grant_role',
  'ensure_may_grant_permissions',
];
// How far above the assignment the gate may sit. Generous, because the gate is
// often an early `return` at the top of the function.
const WINDOW = 60;

let files;
try {
  files = execSync(`find ${ROOT} -name '*.rs'`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch {
  console.error(`FAIL: cannot scan ${ROOT}.`);
  process.exit(1);
}

const problems = [];
let checked = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (!PROMOTION.test(code)) return;
    // A struct literal building a fresh user is not a promotion of an existing
    // one; those are covered by the gate on whatever writes the record.
    if (/^\s*role:/.test(code)) return;
    checked++;
    const from = Math.max(0, i - WINDOW);
    const near = lines.slice(from, i + 1).join('\n');
    if (!GATES.some((g) => near.includes(g))) {
      problems.push({ file, line: i + 1, code: code.trim().slice(0, 80) });
    }
  });
}

if (!checked) {
  console.error('FAIL: found no administrator promotions at all — the pattern has gone stale.');
  console.error('A gate that matches nothing reports a safety it never measured.');
  process.exit(1);
}

for (const p of problems) {
  console.error(`::error file=${p.file},line=${p.line}::${p.file}:${p.line} promotes without a gate — ${p.code}`);
}

if (problems.length) {
  console.error(`\nFAIL: ${problems.length} of ${checked} promotion(s) are ungated.`);
  console.error(`Gate it with one of: ${GATES.join(', ')}.`);
  console.error('user.role is global — an ungated promotion is workspace-wide.');
  process.exit(1);
}
console.log(`OK: all ${checked} administrator promotion(s) sit behind a gate.`);
