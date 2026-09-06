/**
 * "I could not ask" is not "there is nothing there".
 *
 * `remote.sessions()` is the agent's only way to ask the SDK which sessions
 * and P2P channels are live. Three call sites turned an `Err` into a benign
 * default — `false`, `false`, `vec![]` — and every one of them fed a branch
 * that DESTROYS state on absence:
 *
 *   requests/connect.rs        removed the map entry, pruned CID-scoped state,
 *                              and ran the SDK connect against a session the
 *                              SDK may still hold — the ratchet reset the
 *                              SessionAlreadyActive branch exists to prevent.
 *   connection_management_claim removed a live, claimable session from the map
 *                              and then told the user it was not claimable.
 *   requests/peer/connect.rs   dropped the peer's sink from `conn.peers`, which
 *                              is where requests/message.rs finds a peer to
 *                              send to — so an established channel became
 *                              unreachable while both sides believed it was up.
 *
 * One of them said so in its own log line: "assuming inactive".
 *
 * The rule: an `Err` arm on a `sessions()` query may not evaluate to a value
 * that means "absent". It must propagate (`?`) or return a Failure response.
 * A deliberate exception must say `// best-effort:` and why — the same escape
 * hatch the intent-results gate uses, for the same reason.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = join(ROOT, 'citadel-internal-service');

if (!existsSync(AGENT)) {
  console.error(
    'FAIL: the agent submodule is not populated, so nothing can be checked.\n' +
      'Run `git submodule update --init --recursive`. Passing here would mean\n' +
      'reporting success on an empty comparison.',
  );
  process.exit(1);
}

/**
 * The lines of a match arm, from its `{` to the matching `}`.
 *
 * Returns the whole slice for an arm with no braces (`Err(_) => false,`),
 * which is a single line and therefore its own body.
 */
function armBody(lines) {
  const open = lines.findIndex((l) => l.includes('{'));
  if (open === -1) return lines.slice(0, 1);
  let depth = 0;
  for (let i = open; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    if (depth <= 0) return lines.slice(open, i + 1);
  }
  return lines.slice(open);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'target' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.rs')) yield full;
  }
}

/** Values that mean "nothing is there" and must not come from a failed query. */
const MEANS_ABSENT = /^\s*(false|vec!\[\]|None|Vec::new\(\)|Default::default\(\))\s*,?\s*$/;

const problems = [];
let queries = 0;

for (const file of walk(AGENT)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/\.sessions\(\)\s*\.await/.test(line)) return;
    queries += 1;

    // The Err arm of this match, if there is one, within the query's block.
    const region = lines.slice(i, Math.min(lines.length, i + 40));
    const errAt = region.findIndex((l) => /^\s*Err\(/.test(l));
    if (errAt === -1) return; // `?` or no match — nothing to judge.

    // The Err arm's OWN body, brace-matched.
    //
    // A fixed window here is not merely imprecise, it inverts the result: 14
    // lines from `Err(` runs past the arm into the `if` that follows, whose
    // branches contain `return` — so the gate saw a return, decided the
    // failure was handled, and excused two of the three sites it was written
    // for. check-disconnect-reports-failure carries a comment about the same
    // bug, which is where the technique below comes from.
    const body = armBody(region.slice(errAt));
    if (body.some((l) => /best-effort:/.test(l))) return;
    if (body.some((l) => /\b(return|\?;)/.test(l))) return;

    const absent = body.find((l) => MEANS_ABSENT.test(l));
    if (absent) {
      problems.push(
        `${relative(ROOT, file)}:${i + errAt + 1} — the Err arm evaluates to ` +
          `\`${absent.trim()}\`, which the caller reads as "not there"`,
      );
    }
  });
}

if (queries === 0) {
  console.error(
    'FAIL: no `sessions().await` call sites found. Either the SDK API was renamed\n' +
      'or the scan root moved — this gate is now inert and would report success.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error file=${p.split(' —')[0].split(':')[0]}::${p}`);
  console.error(`\nFAIL: ${problems.length} SDK session quer(y|ies) treat a failure as absence.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nReturn a Failure response or propagate with `?`. Every branch that reads\n' +
      'absence here destroys state: it removes the session from the connection\n' +
      'map, prunes CID-scoped state, or drops a peer sink that message routing\n' +
      'depends on. If a default really is right, write `// best-effort: <why>`.',
  );
  process.exit(1);
}

console.log(
  `check-session-query-failures-are-not-absence: ${queries} sessions() call site(s); ` +
    'no failed query is read as absence.',
);
