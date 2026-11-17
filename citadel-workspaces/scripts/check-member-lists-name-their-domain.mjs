#!/usr/bin/env node
/**
 * Every subscriber to a member list must check which domain the list is for.
 *
 * The workspace protocol carries no request id, so a `Members` response cannot
 * be attributed to the request that caused it. `is-for-domain.ts` is the check,
 * and its own doc names the four subscribers it exists for — "the sidebar, the
 * admin members tab, the user-search corpus, and the group-call roster" — and
 * says why it lives in one place: *"four copies of a filter is how three of them
 * come to differ."*
 *
 * Three had it. The fourth, `useMemberEventSetup`, writes the GLOBAL
 * `state.members`, which is what `UserSearch.tsx:99` and `UserDirectory.tsx:58`
 * read as "everyone in this workspace". A roster fetched for a room replaced it,
 * and searching for a real workspace member returned "No users found".
 *
 * How the omission survived is the part worth keeping: the comment on the WRONG
 * hook claimed the role. `use-domain-members.ts` said "this hook's members are
 * the corpus the user search searches" — and the user search does not read that
 * hook. Whoever added the guard put it where the comment pointed. A doc comment
 * asserting which consumer a piece of state feeds is not checkable by anything,
 * which is exactly why this gate checks the SUBSCRIPTION instead.
 *
 * The rule: a module subscribing to `'members:loaded'` must call `isForDomain`.
 * Nothing about which domain — that is a judgement the subscriber makes — only
 * that the question is asked at all.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(UI, 'src');
const GUARD_MODULE = join(SRC, 'lib', 'workspace-events', 'is-for-domain.ts');

const EVENT = "'members:loaded'";
const SUBSCRIBES = /\b(?:on|addEventListener|onMemberEvent|on)\s*\(\s*'members:loaded'/;
const CALLS_GUARD = /\bisForDomain\s*\(/;

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { yield* sources(full); continue; }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield full;
  }
}

// The guard must exist, or every "subscriber calls it" answer below is vacuous.
try {
  readFileSync(GUARD_MODULE, 'utf8');
} catch {
  console.error(
    `FAIL: ${relative(UI, GUARD_MODULE)} is gone.\n` +
      'If the check moved, point this gate at its new home — do not delete the gate.',
  );
  process.exit(1);
}

const offenders = [];
let subscribers = 0;

for (const file of sources(SRC)) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes(EVENT)) continue;
  // Naming the event in a comment or a type union is not subscribing to it.
  if (!SUBSCRIBES.test(text)) continue;
  subscribers += 1;
  if (!CALLS_GUARD.test(text)) {
    offenders.push(
      `${relative(UI, file)}: subscribes to members:loaded without asking which domain the ` +
        'list is for',
    );
  }
}

// Vacuity floor: the guard's own doc names four subscribers.
if (subscribers < 4) {
  console.error(
    `FAIL: found ${subscribers} subscriber(s) to members:loaded; is-for-domain.ts names four.\n` +
      'The subscription shape changed — fix the match rather than leaving this reporting\n' +
      'over nothing.',
  );
  process.exit(1);
}

if (offenders.length > 0) {
  for (const o of offenders) console.error(`::error::${o}`);
  console.error(`\nFAIL: ${offenders.length} member-list subscriber(s) accept any list that arrives.\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    '\nThe protocol carries no request id, so a `Members` response cannot be attributed to\n' +
      'the request that caused it. Call `isForDomain(payload.domainId, <the domain you asked\n' +
      "about>)` and return early otherwise.\n" +
      '\nThe last subscriber to miss this wrote the global `state.members`, which the user\n' +
      'search reads as "everyone in this workspace" — so a room roster replaced it and a\n' +
      'search for a real member returned "No users found".',
  );
  process.exit(1);
}

console.log(
  `check-member-lists-name-their-domain: ${subscribers} subscriber(s) to members:loaded; ` +
    'all ask which domain the list is for.',
);
