#!/usr/bin/env node
/**
 * The 250-line cap on UI source files.
 *
 * This lived only as inline bash inside validate.yml, so there was no way to run
 * it locally without hand-copying the loop and the skip list. That is not a
 * hypothetical cost: the cap was pushed over and committed three separate times,
 * twice AFTER the failure was recorded, because the local loop ran tsc, eslint
 * and vitest and had no way to run this.
 *
 * A CI gate with no runnable local form is a gate that will be broken by
 * whoever cannot run it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'citadel-workspaces', 'src');
const LIMIT = 250;

/**
 * Files that pre-date the cap and already exceeded it, WITH the length each was
 * at when it was exempted. A file here may shrink; it may not grow.
 *
 * The exemption used to be a bare name, which is an allowance without a bound:
 * `components/ui/sidebar.tsx` is at 764 lines, three times the cap, and nothing
 * would have objected at 1500. That is the opposite of what the cap is for --
 * the exempt files are the ones most likely to keep accreting, because they are
 * the ones nobody is asked to split.
 *
 * Ratcheting also self-cleans: drop a file under the limit and the entry stops
 * being needed, and the check below says so rather than letting a dead
 * exemption sit there shielding a future violation.
 *
 * THE RATCHET TURNS BOTH WAYS, which it did not. A file shrinking below its
 * entry left the entry where it was, so the difference became slack that a
 * later change could spend in silence. Four of the seven entries had grown
 * slack that way, the largest 152 lines: `types/messaging-layer.ts` was
 * recorded at 605 and is 453, so a hundred and fifty lines could be added to
 * the file least likely to be split, with the gate green and its own header
 * saying these "carry their exact length and cannot grow".
 *
 * So an entry above the file's real length is now a FAILURE, with the number to
 * write. That is noisier -- every legitimate shrink asks for a one-line edit --
 * and it is the only version of this gate whose promise is true.
 */
const SKIP = new Map([
  // One to three lines over, each of them an `import type` the typing programme
  // added. The cap is about how much LOGIC one file holds, and an import line
  // adds none -- but an exemption is still an exemption, so these carry their
  // exact length and cannot grow. They are the natural next candidates to split,
  // and dropping any of them under 250 removes its entry automatically.
  // A guard that refuses to sign out of a session with no CID, after the
  // decision itself was moved to orphan-session-disconnect.ts. The remaining
  // growth is the branch and its explanation.
  ['lib/connection/service.ts', 252],
  // 252, up one from 251: `openingSessions`, the map that stops two callers
  // opening the same peer's media session at once. `accept()` opens for every
  // peer that has answered and the CallAccept handler opens for the one that
  // just did, so in a group call they raced and the service refused the second
  // with "a media open or teardown is already in progress with this peer".
  // One field, and the explanation lives with the code that uses it.
  // Seventeen forwardRef components each gained a two-line return type, which
  // is what the explicit-type policy asks for. Still nearly twice the cap and
  // still the first file that should be split.
  // --- Files that grew explaining a defect they now prevent ---------------
  //
  // Each of these gained the comment that says why its guard exists: a read
  // that failed being told from a key that is absent, a write refused because
  // the collection it would replace was never read, a log argument that cost a
  // second of main-thread time for a logger production compiles away. The
  // explanation is the durable part -- the code without it invites the same
  // change back -- so these carry their exact length and cannot grow.
  //
  // `server-auto-connect-service/service.ts` is here after THREE extractions
  // took it 301 -> 256 (attempt-lifecycle, websocket-responses,
  // sign-out-record); what is left is the singleton and its lifecycle.
  // `peer-registration-store/persistence.ts` is absent because its split
  // (local-db-client.ts) brought it under the cap outright, which is the
  // outcome to prefer where a cohesive unit exists to cut.
  //
  // The natural next cuts, in order: Landing.tsx (three dialogs that could be
  // lazy), revfs-service.ts and live-document-store/service.ts (each holds a
  // store AND its persistence).
  ['lib/live-document-store/service.ts', 279],
  ['lib/revfs/revfs-service.ts', 269],
  ['lib/p2p/message-handler.ts', 262],
  ['pages/UserDirectory.tsx', 257],
  ['lib/server-auto-connect-service/service.ts', 256],
  ['lib/p2p-registration-service/connection.ts', 255],
  ['lib/revfs/revfs-retry.ts', 254],
  ['lib/multi-instance/instance-channel.ts', 251],

  ['components/ui/sidebar.tsx', 487],
  ['components/layout/sidebar/TreeNodesSection.tsx', 320],
  ['lib/file-transfer/service.ts', 293],
  // Two data-testid attributes, so the integration suite's readiness probe can
  // stop keying on button copy — see ROBUSTNESS round 168.
  ['pages/Landing.tsx', 312],
  ['types/messaging-layer.ts', 453],
  ['types/workspace-protocol.ts', 355],
]);

if (!statSync(SRC, { throwIfNoEntry: false })) {
  console.error('check-file-length: citadel-workspaces/src is missing, so nothing was checked.');
  process.exit(1);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Tests are excluded on purpose. The cap exists to stop a MODULE
      // accreting responsibilities; a test file's length measures how many
      // cases are covered, which is the opposite signal.
      if (entry !== '__tests__' && entry !== 'node_modules') yield* walk(full);
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.bak')) {
      yield full;
    }
  }
}

const violations = [];
const grown = [];
const shrunk = [];
const lowered = [];
const seen = new Set();
let checked = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  const lines = readFileSync(file, 'utf8').split('\n').length - 1;

  const allowance = SKIP.get(rel);
  if (allowance !== undefined) {
    seen.add(rel);
    if (lines > allowance) grown.push({ rel, lines, allowance });
    else if (lines <= LIMIT) shrunk.push({ rel, lines });
    // Still over the cap, but under its recorded length: the entry has become
    // slack. Lower it, or the next change spends the difference for free.
    else if (lines < allowance) lowered.push({ rel, lines, allowance });
    continue;
  }

  checked += 1;
  if (lines > LIMIT) violations.push({ rel, lines });
}

// An exemption for a file that no longer exists is an exemption waiting to
// shield a new file that takes the same path.
const missing = [...SKIP.keys()].filter((rel) => !seen.has(rel));

if (grown.length > 0) {
  for (const { rel, lines, allowance } of grown) {
    console.error(
      `::error file=citadel-workspaces/src/${rel}::${rel} is exempt at ${allowance} lines and has grown to ${lines}`,
    );
  }
  console.error(`\nFAIL: ${grown.length} exempt file(s) grew.`);
  console.error('An exemption is a ceiling, not a licence. Extract something, or');
  console.error("raise the entry in check-file-length.mjs and say why in the PR.");
  process.exit(1);
}

if (shrunk.length > 0) {
  for (const { rel, lines } of shrunk) {
    console.error(`${rel} is down to ${lines} lines and no longer needs its exemption.`);
  }
  console.error(`\nFAIL: remove ${shrunk.length} stale entr(y/ies) from SKIP.`);
  process.exit(1);
}

if (lowered.length > 0) {
  for (const { rel, lines, allowance } of lowered) {
    console.error(
      `::error file=citadel-workspaces/src/${rel}::${rel} is recorded at ${allowance} lines ` +
        `but is ${lines}; lower the entry to ${lines}`,
    );
  }
  console.error(
    `\nFAIL: ${lowered.length} exemption(s) sit above the file's real length.`,
  );
  console.error('That difference is slack a later change can spend without this gate');
  console.error('noticing. The ratchet only means anything if it turns both ways.');
  process.exit(1);
}

if (missing.length > 0) {
  for (const rel of missing) console.error(`${rel} is exempted but does not exist.`);
  console.error('\nFAIL: drop the dead entr(y/ies) from SKIP.');
  process.exit(1);
}

if (violations.length > 0) {
  for (const { rel, lines } of violations.sort((a, b) => b.lines - a.lines)) {
    console.error(`::error file=citadel-workspaces/src/${rel}::${rel} has ${lines} lines (limit: ${LIMIT})`);
  }
  console.error(`\nFAIL: ${violations.length} file(s) exceed the ${LIMIT}-line limit.`);
  console.error('Extract a cohesive unit rather than compressing prose — and note that');
  console.error('rewriting a comment at the same length does not reduce the count.');
  process.exit(1);
}

console.log(
  `All ${checked} TypeScript files are within the ${LIMIT}-line limit ` +
    `(${SKIP.size} pre-existing files held at their current length).`,
);
