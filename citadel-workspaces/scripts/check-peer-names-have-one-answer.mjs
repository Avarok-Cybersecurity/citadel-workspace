#!/usr/bin/env node
/**
 * How a peer is named is decided in one module, not restated inline.
 *
 * `src/lib/peer-display.ts` exists so "every surface answers the question
 * identically". It was bypassed twice over:
 *
 *   - Four sites built their own handle from raw CID digits -- the conversation
 *     list and the peer list from the last six, the message notification from
 *     the first eight -- so one peer wore three different names.
 *   - Five sites hand-rolled "is this a placeholder?" with three different
 *     definitions, none covering all of 'Unknown', 'User <digits>' and
 *     'Loading...'. A name one site rejected another preserved, permanently, in
 *     preference to the real one arriving behind it.
 *
 * This gate forbids both shapes outside the authority. It is not a style rule:
 * each copy is a place the answer can drift, and it did.
 *
 * Node 18-compatible on purpose: the lint jobs run the oldest supported Node.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const AUTHORITY = 'src/lib/peer-display.ts';
const ROOT = 'src';

/** Files allowed to name the placeholders, because they define them. */
const ALLOWED = [AUTHORITY];

const FORBIDDEN = [
  {
    // A display name built out of CID digits.
    pattern: /`(?:User|Peer) \$\{[^}]*\.(?:toString\(\)|slice)[^}]*\}`/,
    why: 'builds a peer name out of raw CID digits; call peerDisplayName() instead',
  },
  {
    // "Is this string a placeholder?", restated. Scoped to lines that are
    // talking about a name: 'Unknown' is also a legitimate value elsewhere --
    // a file whose MIME type could not be determined, for one -- and that is a
    // different question with a different right answer.
    pattern: /!==\s*'Unknown'|===\s*'Unknown'|startsWith\('User '\)|!==\s*'Loading\.\.\.'|===\s*'Loading\.\.\.'/,
    onlyWhen: /username|fullName|displayName|\.name\b|peerName/,
    why: "decides for itself which names are placeholders; call isPlaceholderName() instead",
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      out.push(...walk(p));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

let authority;
try {
  authority = readFileSync(AUTHORITY, 'utf8');
} catch {
  console.error(`::error::${AUTHORITY} is missing -- the single answer this gate protects is gone`);
  process.exit(1);
}
for (const required of ['isPlaceholderName', 'peerDisplayName']) {
  if (!authority.includes(`export function ${required}`)) {
    console.error(`::error file=citadel-workspaces/${AUTHORITY}::${required} is gone; every caller this gate redirects has nowhere to go`);
    process.exit(1);
  }
}

const offences = [];
for (const file of walk(ROOT)) {
  const rel = file.split('\\').join('/');
  if (ALLOWED.includes(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
    for (const { pattern, onlyWhen, why } of FORBIDDEN) {
      if (!pattern.test(line)) continue;
      if (onlyWhen && !onlyWhen.test(line)) continue;
      offences.push({ file: rel, line: i + 1, why });
    }
  });
}

if (offences.length > 0) {
  for (const o of offences) {
    console.error(`::error file=citadel-workspaces/${o.file},line=${o.line}::this line ${o.why} (see ${AUTHORITY}).`);
  }
  process.exit(1);
}

console.log('  Peer names: one module answers, no inline copies  ok');
