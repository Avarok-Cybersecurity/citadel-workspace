/**
 * A step every path needs must run before the path is chosen.
 *
 * Two defects in the workspace kernel, found in one sweep, with one shape.
 *
 * **The migration.** `store_group_message` calls `migrate_group_to_pages` right
 * after taking the group lock. `update_group_message` and `delete_group_message`
 * take the same lock and read straight through. `migrate_group_to_pages` is the
 * only place the legacy pre-paging key is deleted, and `save_group_pages` cannot
 * clean up after itself on an unmigrated room -- it computes `previous` from an
 * index that does not exist yet, so its orphan sweep runs over an empty range.
 *
 * The result: delete a message in a room whose history is still in the legacy
 * blob, and an index gets written, every later read goes through the pages, the
 * message LOOKS deleted -- and its plaintext stays in the backend until the
 * whole room is deleted. An edit retains the pre-edit content the same way.
 * A delete that does not delete.
 *
 * **The authorization.** `remove_user_from_domain` called `ensure_may_act_on`
 * inside its `if domain_id == WORKSPACE_ROOT_ID` branch, so every office and
 * room was gated by the `RemoveUsers` permission alone. A Custom role at editor
 * rank grants that -- so its holder could remove the Owner from any office or
 * room, while the identical request against the workspace root refused with
 * "cannot remove ..., who is above them". `add_user_to_domain` had it right,
 * above the branch, with a comment explaining exactly that reasoning.
 *
 * THE RULE, in both cases: name the function, name the call that must appear in
 * it, and require it before the first branch or read that would otherwise skip
 * it.
 *
 * WHAT THIS CANNOT SEE: whether the call is correct, or reached at runtime. It
 * checks that the text is there and is early. That is enough for this defect
 * class, which is always an omission rather than a mistake.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = join(ROOT, 'citadel-workspace-server-kernel', 'src');

if (!existsSync(KERNEL)) {
  console.error('FAIL: the server kernel source is not present — this gate examined nothing.');
  process.exit(1);
}

/**
 * Each rule: in `file`, every function in `fns` must contain `required` before
 * `before`.
 */
const RULES = [
  {
    file: join('kernel', 'transaction', 'mod.rs'),
    fns: ['store_group_message', 'update_group_message', 'delete_group_message'],
    required: 'migrate_group_to_pages',
    before: 'get_group_messages',
    why:
      'the legacy pre-paging key is deleted nowhere else, so a room that has not migrated ' +
      'keeps the original message bodies after an edit or a delete',
  },
  {
    file: join('handlers', 'domain', 'server_ops', 'async_domain_server_ops.rs'),
    fns: ['add_user_to_domain', 'remove_user_from_domain'],
    required: 'ensure_may_act_on',
    before: 'WORKSPACE_ROOT_ID',
    why:
      'who may act on whom is not a property of the storage the domain lives in, so gating ' +
      'it inside the workspace-root branch leaves every office and room ungated',
  },
];

/** The body of `fn name`, from its signature to the next top-level `pub` or `fn` at the same depth. */
function bodyOf(source, name) {
  const sig = source.indexOf(`fn ${name}(`);
  if (sig === -1) return null;
  const open = source.indexOf('{', sig);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i);
    }
  }
  return null;
}

/** Strip comments: an explanation of a call is not the call. */
function code(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

const problems = [];
let fnsChecked = 0;

for (const rule of RULES) {
  const path = join(KERNEL, rule.file);
  if (!existsSync(path)) {
    console.error(`FAIL: ${rule.file} is missing — this gate's rules no longer address the tree.`);
    process.exit(1);
  }
  const source = readFileSync(path, 'utf8');

  for (const fn of rule.fns) {
    const raw = bodyOf(source, fn);
    if (raw === null) {
      problems.push(`${rule.file}: \`${fn}\` not found — the rule below no longer addresses it`);
      continue;
    }
    fnsChecked += 1;
    const body = code(raw);
    const required = body.indexOf(rule.required);
    const before = body.indexOf(rule.before);

    if (required === -1) {
      problems.push(
        `${rule.file}: \`${fn}\` never calls \`${rule.required}\` — ${rule.why}`,
      );
      continue;
    }
    if (before !== -1 && required > before) {
      problems.push(
        `${rule.file}: \`${fn}\` calls \`${rule.required}\` only AFTER \`${rule.before}\` — ` +
          `${rule.why}`,
      );
    }
  }
}

// Vacuity floor: every function named above exists today. Checking none of them
// means the rules stopped addressing the code and this gate reports over nothing.
if (fnsChecked < RULES.reduce((n, r) => n + r.fns.length, 0)) {
  console.error(
    `FAIL: checked ${fnsChecked} function(s); the rules name ` +
      `${RULES.reduce((n, r) => n + r.fns.length, 0)}.\n` +
      'A function the rules name has moved or been renamed, so part of this gate read nothing.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAIL: ${problems.length} precondition(s) that do not precede the path.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nPut the call above the branch. A step every path needs is not a property of the path.\n' +
      '\nThe last two of these were a delete that left the deleted plaintext in the backend,\n' +
      'and a permission check that gated the workspace root while every office and room went\n' +
      'through on a role permission alone.',
  );
  process.exit(1);
}

console.log(
  `check-preconditions-precede-the-branch: ${fnsChecked} function(s) across ${RULES.length} ` +
    'rule(s); each calls what it must, before the path that would skip it.',
);
