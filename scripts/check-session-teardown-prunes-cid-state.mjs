#!/usr/bin/env node
// Every place a session leaves `server_connection_map` must also prune the
// CID-keyed kernel maps (pending peer signals, username cache). They outlive
// the session otherwise: an ignored peer request stayed for the life of the
// process and survived even deregistration, where it could later be matched
// against a request the sender had long abandoned.
//
// The helper existing is not the property worth checking — it is that every
// teardown site actually calls it. That wiring is what silently rots.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = 'citadel-internal-service/citadel-internal-service/src';
const PRUNE = 'prune_cid_scoped_state';
// A teardown is one of these; each must have a prune within WINDOW lines.
const TEARDOWN = [
  /server_connection_map\s*\.write\(\)\s*\.remove\(&cid\)/,
  /\bcleanup_state\s*\(/,
];
const WINDOW = 6;

let files;
try {
  files = execSync(`find ${ROOT} -name '*.rs'`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch {
  console.error(`FAIL: cannot scan ${ROOT} — is the submodule populated?`);
  process.exit(1);
}

const problems = [];
let checked = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Comments and doc-comments describe teardown; they do not perform it.
    const code = line.replace(/\/\/.*$/, '').trim();
    if (!code || code.startsWith('*')) return;
    if (/^(pub\s+)?fn\s+cleanup_state/.test(code)) return; // the definition
    if (!TEARDOWN.some((re) => re.test(code))) return;
    checked++;
    const from = Math.max(0, i - WINDOW);
    const near = lines.slice(from, i + WINDOW + 1).join('\n');
    if (!near.includes(PRUNE)) {
      problems.push({ file, line: i + 1, code: code.slice(0, 90) });
    }
  });
}

if (!checked) {
  console.error('FAIL: found no session-teardown sites at all — the patterns have gone stale.');
  console.error('A gate that matches nothing reports safety it never measured.');
  process.exit(1);
}

for (const p of problems) {
  console.error(`::error file=${p.file},line=${p.line}::${p.file}:${p.line} tears a session down without ${PRUNE} nearby — ${p.code}`);
}

if (problems.length) {
  console.error(`\nFAIL: ${problems.length} of ${checked} teardown site(s) leave CID-keyed kernel state behind.`);
  console.error(`Call this.${PRUNE}(cid, peer_cid) alongside the removal.`);
  process.exit(1);
}
console.log(`OK: all ${checked} session-teardown site(s) prune CID-keyed kernel state.`);
