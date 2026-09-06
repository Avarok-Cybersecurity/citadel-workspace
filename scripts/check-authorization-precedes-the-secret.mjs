/**
 * A secret comparison must not run before the caller has been authorized.
 *
 * Whichever check runs FIRST is the one whose failure message the caller sees,
 * and two distinguishable messages are an oracle. `update_workspace` and
 * `create_workspace` both compared the master password before asking who was
 * asking, so any account could send a guess and read which error came back:
 *
 *   "Invalid workspace master password"      -> the guess was wrong
 *   "Only root workspace admins can ..."     -> the guess was RIGHT
 *
 * The master password is what grants administrator. With open enrolment anyone
 * who can register has that oracle, and the rate limiter is per CID (100/s), so
 * the guess rate scales with the number of accounts created.
 *
 * Making the comparison constant-time — which it now is, see kernel/secret_eq.rs
 * — does nothing here. Timing was never the leak; the answer was being returned
 * as text. The two fixes are unrelated and both are needed.
 *
 * `update_workspace` was fixed first. `create_workspace` was found a round later
 * with the identical shape, which is why this is a gate rather than a second
 * careful comment: it is the third occurrence that this exists to stop.
 *
 * The rule: in any function that calls `secrets_match`, an authorization check
 * must appear textually BEFORE it.
 *
 * Deliberately exempt: a BOOTSTRAP path, where the password IS the
 * authorization — that is how the first owner claims an unowned workspace, and
 * the oracle is inherent to the design rather than an ordering mistake. Such a
 * site must say so in a comment naming the bootstrap, so the exemption is a
 * decision someone made rather than a case nobody considered.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = join(ROOT, 'citadel-workspace-server-kernel', 'src');

if (!existsSync(KERNEL)) {
  console.error(`FAIL: ${relative(ROOT, KERNEL)} does not exist — this gate examined nothing.`);
  process.exit(1);
}

/** The secret comparison this gate is about. */
const SECRET_COMPARE = /\bsecrets_match\s*\(/;

/** Anything that establishes the caller may act. */
const AUTHORIZATION =
  /\b(check_entity_permission|is_admin|is_owner|ensure_may_|requires_owned_session|is_member_of_domain)\b/;

/**
 * A site that says, in words, why no authorization precedes it.
 *
 * Two legitimate shapes, and both must be written down rather than inferred:
 *   - the BOOTSTRAP claim, where the password IS the authorization; and
 *   - the BOOT SEQUENCE, which has no caller to authorize at all — it compares the
 *     configured password against the stored one to decide whether to warn about a
 *     rotation, returns nothing to anyone, and takes no attacker input.
 *
 * The second was found by this gate on its first working run, in
 * `inject_admin_user`. Requiring the words is the point: the exemption is then a
 * decision somebody made, and the next reader can check whether it still holds.
 */
const EXEMPTION = /bootstrap|boot sequence|no caller to authorize/i;

function* rustFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { yield* rustFiles(full); continue; }
    if (entry.endsWith('.rs')) yield full;
  }
}

/**
 * The `fn` a line belongs to: walk BACKWARD to the nearest function signature.
 *
 * A brace-depth splitter was tried first and found zero call sites — caught only
 * by the vacuity floor below, which is the entire reason that floor exists. Rust
 * bodies contain braces inside string literals, `format!` placeholders and doc
 * comments, so counting them is guesswork. Walking back to the signature needs no
 * balance at all.
 */
function enclosingFunction(lines, index) {
  for (let i = index; i >= 0; i -= 1) {
    const m = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/.exec(lines[i]);
    if (m) return { name: m[1], start: i };
  }
  return null;
}

const problems = [];
let filesRead = 0;
let comparisonsSeen = 0;

for (const file of rustFiles(KERNEL)) {
  filesRead += 1;
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  // The definition of secrets_match itself, and its tests, are not call sites.
  if (rel.endsWith('secret_eq.rs')) continue;

  lines.forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return; // a comment cannot compare a secret
    if (!SECRET_COMPARE.test(line)) return;
    comparisonsSeen += 1;

    const fn = enclosingFunction(lines, i);
    if (!fn) {
      problems.push(`${rel}:${i + 1}: a secret comparison outside any function`);
      return;
    }
    const preceding = lines.slice(fn.start, i);
    // An explicit, written bootstrap decision between the signature and the call.
    if (preceding.some((l) => /^\s*\/\//.test(l) && EXEMPTION.test(l))) return;
    if (preceding.some((l) => !/^\s*\/\//.test(l) && AUTHORIZATION.test(l))) return;

    problems.push(
      `${rel}:${i + 1}: \`${fn.name}\` compares the secret before authorizing the caller ` +
        '— the two error messages are an oracle on the master password',
    );
  });
}

// Vacuity floor. `secrets_match` has call sites in this kernel; finding none
// means it was renamed and this gate is reporting a clean bill over nothing.
if (filesRead < 20 || comparisonsSeen === 0) {
  console.error(
    `FAIL: read ${filesRead} file(s) and found ${comparisonsSeen} secret comparison(s).\n` +
      'A zero means `secrets_match` was renamed, not that the kernel stopped comparing secrets.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAIL: ${problems.length} secret comparison(s) run before authorization.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nCheck the caller FIRST, then the secret. Whichever runs first owns the error the\n' +
      'caller sees, and two distinguishable errors let anyone with an account brute-force\n' +
      'the credential that grants Admin. A constant-time compare does not help: the answer\n' +
      'is being returned as text.\n' +
      '\nIf the password genuinely IS the authorization here — the bootstrap claim — say so\n' +
      'in a comment naming the bootstrap, so it reads as a decision rather than an oversight.',
  );
  process.exit(1);
}

console.log(
  `check-authorization-precedes-the-secret: ${comparisonsSeen} secret comparison(s) across ` +
    `${filesRead} kernel file(s); every one is reached only after the caller is authorized.`,
);
