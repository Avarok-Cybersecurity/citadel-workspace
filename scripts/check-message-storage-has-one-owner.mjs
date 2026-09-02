#!/usr/bin/env node
// A room's message keys are built in exactly one module.
//
// Paging split a room's history across `…group_messages.{gid}.page.{n}` plus an
// index, with the pre-paging `…group_messages.{gid}` surviving as the migration
// source. Three key shapes now describe one thing, and the migration is only
// safe while every reader goes through `BackendTransactionManager`.
//
// A second site that formats one of these keys is how a migration silently
// half-lands: the new writer pages, the forgotten reader still opens the old
// blob, and the room looks empty to one code path and full to another. Nothing
// would fail — it would just disagree with itself.
//
// This is not a style rule. It is the only cheap way to keep "one owner" true
// for a key shape that now has three variants and a migration between them.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = 'citadel-workspace-server-kernel/src';
const OWNER = 'kernel/transaction/group_message_pages.rs';
const KEY = 'citadel_workspace.group_messages';

let files;
try {
  files = execSync(`find ${ROOT} -name '*.rs'`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch {
  console.error(`FAIL: cannot scan ${ROOT}.`);
  process.exit(1);
}

const problems = [];
let owned = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    // The KEY inside a format string or a literal — a comment mentioning it is
    // documentation, and a test naming one is asserting against the real shape.
    if (!code.includes(KEY)) return;
    if (file.endsWith(OWNER)) {
      owned++;
      return;
    }
    if (/_tests?\.rs$/.test(file) || file.includes('/tests/')) return;
    problems.push({ file, line: i + 1, code: code.trim().slice(0, 90) });
  });
}

if (owned < 3) {
  console.error(`FAIL: ${OWNER} builds only ${owned} of the 3 key shapes — the pattern has gone stale.`);
  console.error('A gate that has lost its subject reports a safety it never measured.');
  process.exit(1);
}

for (const p of problems) {
  console.error(`::error file=${p.file},line=${p.line}::${p.file}:${p.line} builds a group-message key outside ${OWNER} — ${p.code}`);
}

if (problems.length) {
  console.error(`\nFAIL: ${problems.length} site(s) build a group-message key outside ${OWNER}.`);
  console.error('Go through BackendTransactionManager. A second reader of the pre-paging blob');
  console.error('is how the migration half-lands: one path pages, the other still opens the old key.');
  process.exit(1);
}
console.log(`OK: group-message keys are built only in ${OWNER} (${owned} shapes).`);
