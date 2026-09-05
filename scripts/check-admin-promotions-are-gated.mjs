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
// Two shapes, because the gate previously saw only the first and reported "all 3 promotions
// are gated" while the door everyone actually walks through was the second. `user.role = role`
// in write_user_role_locked is reached from add_user_to_domain and update_workspace_member_role;
// a deleted `ensure_may_grant_role` above either of them left this check green.
const PROMOTION = /\.role\s*=\s*(?:UserRole::(?:Admin|Owner)\b|\w*role\b)/;
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
// The gate must CONTROL the assignment, not merely appear near it.
//
// This used to ask whether a gate name appeared anywhere in the 60 lines above,
// over raw lines including comments. Two of the three promotion sites mention
// their own gate token more than once — `async_kernel.rs` tests
// `outcome == FirstMemberOutcome::Promote` twice, and the FIRST block closes
// twenty lines before the promotion. So `if outcome == ...Promote {` at the
// promotion could be changed to `if true {`, leaving every first-connecting
// account a global Admin, and this gate stayed green on the earlier, unrelated
// test. It was reading "this function knows about the gate", which is not the
// property.
//
// Two shapes count, and only these:
//   - an ENCLOSING conditional: its block is still open where the assignment is
//   - a guard CLAUSE: `if <gate> { return ... }` above it
// Both are established by brace depth, not proximity.
const BRANCHES = /\b(if|match|while)\b/;

/// The conditionals whose blocks are open at `target`, outermost last.
///
/// Walks up from the assignment tracking brace depth: a line that leaves the
/// depth below where we started is a block we are inside.
function enclosingConditionals(lines, target) {
  const out = [];
  let depth = 0;
  for (let i = target - 1; i >= 0; i--) {
    const code = lines[i].replace(/\/\/.*$/, '');
    depth += (code.match(/\}/g) || []).length - (code.match(/\{/g) || []).length;
    if (depth < 0) {
      out.push(code);
      depth = 0;
    }
  }
  return out;
}

/// `if <gate> { return ... }` — a refusal above the assignment rather than a
/// block around it. Kept to the window, since a guard clause far enough away is
/// no longer obviously about this write.
function guardClauses(lines, target, window) {
  const out = [];
  for (let i = Math.max(0, target - window); i < target; i++) {
    const code = lines[i].replace(/\/\/.*$/, '');
    if (!BRANCHES.test(code)) continue;
    const body = lines.slice(i, Math.min(i + 4, target)).join('\n');
    if (/\breturn\b/.test(body)) out.push(code);
  }
  return out;
}

/// The `async fn name(` / `fn name(` enclosing a line, with the range of its body.
function enclosingFunction(lines, target) {
  for (let i = target; i >= 0; i--) {
    const m = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)\s*[(<]/.exec(lines[i]);
    if (!m) continue;
    let depth = 0;
    for (let j = i; j < lines.length; j++) {
      const code = lines[j].replace(/\/\/.*$/, '');
      depth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
      if (depth === 0 && j > i) return { name: m[1], start: i, end: j };
    }
    return { name: m[1], start: i, end: lines.length - 1 };
  }
  return null;
}

/// Lines that call `name(` from outside its own body.
function callSites(lines, name, start, end) {
  const out = [];
  const call = new RegExp(`\\b${name}\\s*\\(`);
  lines.forEach((line, i) => {
    if (i >= start && i <= end) return;
    const code = line.replace(/\/\/.*$/, '');
    if (/\bfn\s+[A-Za-z0-9_]+\s*[(<]/.test(code)) return;
    if (call.test(code)) out.push(i);
  });
  return out;
}

/// Every call site that reaches `target` without a gate, following helpers up to `depth`
/// levels. `[]` means every path is gated; `null` means the write is not in a function this
/// can follow, so the caller reports the write itself.
///
/// The gate window is the enclosing FUNCTION BODY up to the call, not a fixed number of
/// lines: `ensure_may_grant_role` sits ~70 lines above the write it protects in
/// add_user_to_domain, and a line window silently called that ungated.
function ungatedCallers(lines, target, depth) {
  const fn = enclosingFunction(lines, target);
  if (!fn) return null;
  const bodyGated = (from, to) =>
    GATES.some((g) => lines.slice(from, to).some((l) => l.replace(/\/\/.*$/, '').includes(g)));
  const callers = callSites(lines, fn.name, fn.start, fn.end);
  if (callers.length === 0) return null;
  const bad = [];
  for (const c of callers) {
    const outer = enclosingFunction(lines, c);
    if (outer && bodyGated(outer.start, c)) continue;
    if (depth > 1) {
      const deeper = ungatedCallers(lines, c, depth - 1);
      if (deeper !== null) { bad.push(...deeper); continue; }
    }
    bad.push(c);
  }
  return bad;
}

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
    const controlling = [
      ...enclosingConditionals(lines, i),
      ...guardClauses(lines, i, WINDOW),
    ].filter((l) => BRANCHES.test(l));
    if (GATES.some((g) => controlling.some((l) => l.includes(g)))) return;
    // The write may sit in a private helper whose CALLERS hold the gate — which is how the
    // real promotion path is built: `write_user_role_locked` is reached through
    // `write_user_role` from add_user_to_domain and update_workspace_member_role, each gated
    // by ensure_may_grant_role. Following the callers (two levels, since there is a wrapper)
    // is what makes this check able to fail: matching only the enclosing function reported
    // "all 3 gated" while the door everyone walks through was not examined at all.
    const ungated = ungatedCallers(lines, i, 2);
    if (ungated === null) {
      problems.push({ file, line: i + 1, code: code.trim().slice(0, 80) });
      return;
    }
    ungated.forEach((c) =>
      problems.push({
        file,
        line: c + 1,
        code: `reaches a role write with no gate above it: ${lines[c].trim().slice(0, 60)}`,
      }),
    );
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
