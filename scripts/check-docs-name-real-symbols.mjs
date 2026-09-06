#!/usr/bin/env node
// CLAUDE.md and ARCHITECTURE.md are loaded into every session. When they name a
// protocol operation that does not exist, the cost is not a stale doc -- it is
// an agent writing code against a fiction, or "fixing" working code to match
// one.
//
// Found on 2026-09-05, all four in guidance an agent would follow:
//   * `CreateOffice` / `ListOffices` / `CreateRoom` / `ListRooms` as
//     WorkspaceProtocol operations. The hierarchy is nodes; those names appear
//     nowhere in citadel-workspace-types.
//   * a "triple-nested" P2P chat envelope with a `WorkspaceProtocol::Message`
//     layer that does not exist in the send path.
//   * `NodeResult::Disconnect` discriminated by `v_conn_type` on
//     `LocalGroupPeer` / `ExternalGroupPeer`. The field is `conn_type`, and
//     since SDK v0.13.1 P2P disconnects are a different event entirely.
//   * six `Permission` variants (`UpdateOffice`, `DeleteRoom`, ...) that the
//     enum does not have.
//
// Rule: a backticked CamelCase token in these docs must appear somewhere in the
// source tree. Exclusions are narrow and deliberate -- see below.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['CLAUDE.md', 'ARCHITECTURE.md'];

const sources = execSync(
  `find . citadel-internal-service citadel-workspaces -type f ` +
    `\\( -name '*.rs' -o -name '*.ts' -o -name '*.tsx' \\) ` +
    `-not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/.git/*' ` +
    `-not -path '*/pkg/*' 2>/dev/null | sort -u`,
  { cwd: root, encoding: 'utf8', maxBuffer: 5e8 },
)
  .trim()
  .split('\n')
  .filter(Boolean);

if (sources.length < 500) {
  throw new Error(`only ${sources.length} source files found -- submodules not checked out?`);
}

const known = new Set();
for (const f of sources) {
  let text;
  try {
    text = readFileSync(join(root, f), 'utf8');
  } catch {
    continue;
  }
  for (const [, id] of text.matchAll(/\b([A-Z][A-Za-z0-9]{5,})\b/g)) known.add(id);
}

const failures = [];
for (const doc of DOCS) {
  const lines = readFileSync(join(root, doc), 'utf8').split('\n');
  let proposal = false;
  lines.forEach((line, i) => {
    // A "Future Enhancements" section proposes names that do not exist yet.
    if (/^#{1,6}\s/.test(line)) proposal = /future|proposed|roadmap|not yet/i.test(line);
    if (proposal) return;

    // A blockquote is where this file records what an earlier revision got
    // wrong. Naming the fiction in order to retract it must not trip the gate.
    if (/^\s*>/.test(line)) return;

    for (const [, tok] of line.matchAll(/`([A-Z][a-zA-Z]{5,})`/g)) {
      if (known.has(tok)) continue;
      if (existsSync(join(root, tok))) continue; // a real path, e.g. Tiltfile
      failures.push(
        `${doc}:${i + 1}  \`${tok}\` appears in no source file. ` +
          `Code written against it will not compile.\n      ${line.trim().slice(0, 110)}`,
      );
    }
  });
}

if (failures.length) {
  console.error('Docs name symbols that do not exist:\n');
  for (const f of failures) console.error('  ' + f + '\n');
  console.error(
    'These files are loaded into every session. Either fix the name, or move ' +
      'the\nclaim into a blockquote that says it was wrong.',
  );
  process.exit(1);
}

console.log(
  `OK: every backticked symbol in ${DOCS.join(' and ')} exists in the tree ` +
    `(${sources.length} source files, ${known.size} identifiers).`,
);
