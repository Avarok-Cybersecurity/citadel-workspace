#!/usr/bin/env node
/**
 * Every consumer of `PeerRegisterFailure` must treat "already registered" as
 * success.
 *
 * CLAUDE.md states the rule under "CID Lifecycle":
 *
 *   Registrations are stored by CID pairs, and the CID never changes. After a
 *   disconnect and reconnect the same registrations exist on the server.
 *   "Peer Already Registered" is NOT an Error — treat this as success.
 *
 * The agent answers `PeerRegisterFailure` for it
 * (`citadel-internal-service/.../requests/peer/register.rs`), so every place
 * that reads that variant has to know the rule. Three did.
 * `peer-registration-store/accept-matcher.ts` did not — and its caller awaits it
 * on the line before `connectToPeer`, so the rejection skipped the connect and
 * no P2P channel was opened at all. Six specs failed on it, and the agent log
 * showed every send going `to SERVER (no peer_cid)` with not one
 * `[PeerChannelCreated]`.
 *
 * The rule is deliberately shallow: a module that reads `PeerRegisterFailure`
 * must mention `already registered` somewhere. It does not check WHAT the module
 * does with it — that is a judgement per call site — only that the case was
 * considered at all. Every instance of this defect so far has been a site where
 * nobody thought about it, not one that thought about it and chose wrongly.
 *
 * ITS LIMIT. This requires the shared predicate to be CALLED; it does not check
 * what the caller then does with the answer. Ignoring the return value would
 * pass. That is the judgement each call site has to make — one resolves a
 * promise, one marks a row registered, one clears an outgoing record — and every
 * instance of this defect so far has been a site that never asked the question
 * at all.
 *
 * An earlier version required the TEXT "already registered" anywhere in the
 * file. A negative control showed a `debugLog` string satisfied it with the
 * guard deleted, so it distinguished prose from code and nothing more. Requiring
 * the call is what a control can actually hold.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(UI, 'src');

/**
 * Reading the variant. Both spellings: the direct property access
 * `msg.PeerRegisterFailure?.…` and the boundary helpers,
 * `getVariant(message, 'PeerRegisterFailure')` / `hasVariant(...)`.
 *
 * Matched against comment-STRIPPED source. Three of the hits in this tree are
 * prose about the variant, including one file that only ever mentions it — and a
 * gate that reads its own subject's comments as usage is a mistake this
 * repository has made twice.
 */
// `msg.PeerRegisterFailure` handed on whole counts too: registration.ts read it
// that way, matched neither alternative, and its substring test went unchecked.
const READS_FAILURE = /\bPeerRegisterFailure\s*[?.[]|'PeerRegisterFailure'|\.PeerRegisterFailure\b/;
/**
 * The shared predicate, `lib/peer-registration-store/already-registered.ts`.
 *
 * Requiring the CALL rather than the phrase is what makes this checkable. The
 * first version required the text "already registered" anywhere in the file, and
 * a negative control showed it was satisfied by a `debugLog` string while the
 * guard itself was gone — it could tell prose from code and nothing more. It
 * also broke the moment the three spellings were unified behind one predicate,
 * which is the correct end state and the one the gate should demand.
 */
const CONSIDERS_IT = /\bisAlreadyRegistered\s*\(/;

/** Source with `//` and block comments removed, so prose cannot satisfy a rule. */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { yield* sources(full); continue; }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield full;
  }
}

/** Every source file, read once, comments stripped. */
const tree = new Map();
for (const file of sources(SRC)) tree.set(file, withoutComments(readFileSync(file, 'utf8')));

/** Modules that call the predicate themselves. */
const asksDirectly = new Set(
  [...tree].filter(([, text]) => CONSIDERS_IT.test(text)).map(([file]) => file),
);

/** Their module names, for resolving `import … from './x'`. */
const askingNames = new Set(
  [...asksDirectly].map((file) => file.replace(/\.tsx?$/, '').split('/').pop()),
);

/** Asks directly, or imports from a module that does. */
function asks(file, text) {
  if (asksDirectly.has(file)) return true;
  for (const [, spec] of text.matchAll(/from\s+'([^']+)'/g)) {
    if (askingNames.has(spec.replace(/\.tsx?$/, '').split('/').pop())) return true;
  }
  return false;
}

const offenders = [];
let readers = 0;

for (const [file, text] of tree) {
  if (!READS_FAILURE.test(text)) continue;
  readers += 1;
  if (!asks(file, text)) {
    offenders.push(
      `${relative(UI, file)}: reads PeerRegisterFailure without considering "already registered"`,
    );
  }
}

// Vacuity floor: several modules read this variant. Zero means the field is
// reached some other way now and this walked past all of them.
if (readers < 3) {
  console.error(
    `FAIL: found ${readers} module(s) reading PeerRegisterFailure; there are more.\n` +
      'The variant is reached some other way now — fix the match rather than leaving this\n' +
      'reporting over nothing.',
  );
  process.exit(1);
}

if (offenders.length > 0) {
  for (const o of offenders) console.error(`::error::${o}`);
  console.error(`\nFAIL: ${offenders.length} consumer(s) of PeerRegisterFailure ignore the rule.\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    '\nCIDs are permanent, so a registration survives every reconnect and the agent answers\n' +
      '`PeerRegisterFailure: "Peer N is already registered"` on the next attempt. CLAUDE.md:\n' +
      '"Peer Already Registered" is NOT an Error — treat this as success.\n' +
      '\nThe last site to miss it rejected a promise that was awaited immediately before\n' +
      '`connectToPeer`, so no P2P channel was ever opened.',
  );
  process.exit(1);
}

console.log(
  `check-already-registered-is-not-a-failure: ${readers} module(s) read PeerRegisterFailure; ` +
    'all consider the already-registered case.',
);
