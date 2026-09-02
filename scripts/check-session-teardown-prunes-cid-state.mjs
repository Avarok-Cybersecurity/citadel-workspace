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
//
// The first pattern used to require the CHAINED form,
// `server_connection_map.write().remove(&cid)`, and to name the binding `cid`.
// Three real removals bind the write guard to a shadowing local first —
// `let mut server_connection_map = this.server_connection_map.write();` and then
// `server_connection_map.remove(&session_cid)` — so the gate could not see them
// and reported "all 5 teardown sites prune" while three did not. It was matching
// a spelling, not a removal.
const TEARDOWN = [
  /\bserver_connection_map\b[\s\S]*?\.remove\s*\(/,
  /\bcleanup_state\s*\(/,
];
// Counted in CODE lines, not raw ones. A comment explaining why the prune is
// there must not push it out of range — that would make the gate reward silence.
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
  const raw = readFileSync(file, 'utf8').split('\n');
  // Comments and doc-comments describe teardown; they do not perform it — and
  // they do not count toward the distance between a removal and its prune.
  const code = [];
  raw.forEach((line, i) => {
    const stripped = line.replace(/\/\/.*$/, '').trim();
    if (!stripped || stripped.startsWith('*')) return;
    code.push({ line: i + 1, text: stripped });
  });

  code.forEach(({ line, text }, k) => {
    if (/^(pub\s+)?fn\s+cleanup_state/.test(text)) return; // the definition
    if (!TEARDOWN.some((re) => re.test(text))) return;
    checked++;
    const near = code
      .slice(Math.max(0, k - WINDOW), k + WINDOW + 1)
      .map((c) => c.text)
      .join('\n');
    if (!near.includes(PRUNE)) {
      problems.push({ file, line, code: text.slice(0, 90) });
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
