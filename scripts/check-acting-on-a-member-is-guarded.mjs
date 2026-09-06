/**
 * Every server op that writes another member's standing passes the authority
 * ladder first.
 *
 * `ensure_may_act_on` compares the actor's `command_authority` against the
 * TARGET's. Without it the rule is only "you may not promote above yourself",
 * with no matching "you may not unseat someone above you" -- and
 * `Permission::for_role(Banned)` is empty, so the granting check passes
 * trivially for every actor: banning grants nothing, and neither does removing.
 *
 * The guard was added to three doors and a fourth stayed open for months,
 * because that one does not write a ROLE at all. `update_member_permissions`
 * writes the permission MAP: its entry gate admits any Admin, its containment
 * check only bounds what may be handed OUT, and `Remove` is exempt from even
 * that. So an Admin could `Set` the Owner's grants to nothing while being
 * unable to demote that same Owner by a single rank.
 *
 * That is the shape this gate exists for -- a rule enforced in N of N+1 places,
 * where the missing one is missing because it is spelled differently. Grepping
 * for the mechanism finds it; grepping for the symptom does not.
 *
 * The rule: an op taking an actor and a SECOND USER calls `ensure_may_act_on`,
 * or delegates to a sibling that does.
 *
 * A second user is identified by parameter name. `workspace_id`, `domain_id`,
 * `entity_id` and `office_id` are places, not people, and ops that take those
 * are authorized by `check_entity_permission` instead -- a different rule with
 * a different question. If a future op names its target something this does not
 * recognise, add the name here rather than widening the match: a pattern loose
 * enough to catch every id would report over every read in the file.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OPS = join(
  ROOT,
  'citadel-workspace-server-kernel/src/handlers/domain/server_ops/async_domain_server_ops.rs',
);

if (!existsSync(OPS)) {
  console.error(`FAIL: ${OPS} is missing — the server ops moved and this gate read nothing.`);
  process.exit(1);
}

const GUARD = 'ensure_may_act_on';

/** Parameter names that denote a PERSON being acted upon, not a place. */
const A_SECOND_USER = /^(target_user_id|user_id_to_add|user_id_to_remove|member_id|peer_user_id)$/;

/** The guard itself, and the helpers it is built from — these may not call it. */
const NOT_SUBJECT_TO_THE_RULE = new Set([GUARD, 'ensure_not_last_admin', 'ensure_may_grant_role']);

const source = readFileSync(OPS, 'utf8');
const lines = source.split('\n');

/** Span of each `async fn` at impl-body indentation, to its closing brace. */
function functions() {
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    const start = lines[i].match(/^ {4}(?:pub )?(?:async )?fn (\w+)\(/);
    if (!start) continue;
    let end = i + 1;
    while (end < lines.length && !/^ {4}\}/.test(lines[end])) end += 1;
    found.push({ name: start[1], from: i, to: end, body: lines.slice(i, end + 1).join('\n') });
    i = end;
  }
  return found;
}

const all = functions();

// Vacuity floor: this file is large and its ops are the subject. Zero means the
// indentation or the layout moved and every check below is reporting on nothing.
if (all.length < 20) {
  console.error(
    `FAIL: found only ${all.length} function(s) in the server ops; the layout moved and this\n` +
      'gate examined essentially nothing.',
  );
  process.exit(1);
}

if (!source.includes(`async fn ${GUARD}(`)) {
  console.error(
    `FAIL: \`${GUARD}\` is not defined in the server ops any more.\n` +
      'If the ladder moved, point this gate at its new home — do not delete the gate.',
  );
  process.exit(1);
}

const guarded = new Set();
const offenders = [];
let subjectCount = 0;

for (const fn of all) {
  if (NOT_SUBJECT_TO_THE_RULE.has(fn.name)) continue;
  const signature = fn.body.slice(0, fn.body.indexOf(') ->'));
  const takesASecondUser = [...signature.matchAll(/(\w+):\s*&str/g)].some((m) =>
    A_SECOND_USER.test(m[1]),
  );
  if (!takesASecondUser) continue;
  subjectCount += 1;
  if (fn.body.includes(`self.${GUARD}(`)) {
    guarded.add(fn.name);
    continue;
  }
  // A thin wrapper that hands the same pair to a guarded sibling is guarded.
  const delegatesTo = [...fn.body.matchAll(/self\.(\w+)\(/g)].map((m) => m[1]);
  if (delegatesTo.some((callee) => guarded.has(callee))) continue;
  offenders.push(
    `async_domain_server_ops.rs:${fn.from + 1}: \`${fn.name}\` writes another member's ` +
      `standing without passing \`${GUARD}\``,
  );
}

// Second vacuity floor: the four known doors exist. Finding fewer than four
// subjects means the parameter names changed and the match went blind.
if (subjectCount < 4) {
  console.error(
    `FAIL: only ${subjectCount} op(s) matched as acting on a second user; at least four do.\n` +
      'The parameter names changed — extend A_SECOND_USER rather than leaving this blind.',
  );
  process.exit(1);
}

if (offenders.length > 0) {
  for (const o of offenders) console.error(`::error::${o}`);
  console.error(`\nFAIL: ${offenders.length} op(s) act on a member without the authority ladder.\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    `\n\`${GUARD}\` is the only thing comparing the actor against the target's CURRENT standing.\n` +
      'The entry gate admits any Admin, and the granting check bounds only what is handed OUT —\n' +
      'which is nothing at all when the operation is a ban, a removal, or a Remove of permissions.\n' +
      '\nThe last op to miss it let an Admin empty the Owner\'s permission map while being unable\n' +
      'to demote that same Owner by one rank.',
  );
  process.exit(1);
}

console.log(
  `check-acting-on-a-member-is-guarded: ${subjectCount} op(s) act on a second user across ` +
    `${all.length} server op(s); all pass \`${GUARD}\` or delegate to one that does.`,
);
