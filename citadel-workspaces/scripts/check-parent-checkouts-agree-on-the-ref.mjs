/**
 * Every job that checks the parent repository out must take the ref the
 * `parent-ref` job resolved — and must declare that it depends on it.
 *
 * This repository's CI does not stand alone: five jobs check the PARENT repo out to
 * `parent/`, lay this PR's code over `parent/citadel-workspaces`, and then run the
 * parent's build layout and the parent's gate scripts against it. One of those gates
 * carries an allowance table keyed to THIS repo's files.
 *
 * While the parent ref was hardcoded to the parent's default branch, that made a
 * coordinated change across the two repos unmergeable. The allowance table cannot
 * describe the old and the new file lengths at once, so this repo could not go green
 * until the parent merged the new table, and the parent could not go green until it
 * pinned the new files. There was no merge order that worked; the observed symptom was
 * a single red check with a correct-looking message, repeated for as long as anyone
 * kept re-running it.
 *
 * The fix resolves the ref once, in a job, preferring a parent branch of the same name
 * as the branch under test. The failure mode it replaces is a SIXTH checkout site added
 * later that copies the old hardcoded form — the fix landing in four of five places is
 * the most common defect in this tree, and here it would be invisible: the job would
 * pass, against the wrong parent.
 *
 * Two things are asserted, because either alone is satisfiable while broken:
 *
 *   - the `ref:` reads the resolver's output. A `needs:` with a hardcoded ref still
 *     checks out the wrong revision.
 *   - the job declares `needs: parent-ref`. Without it the expression evaluates to the
 *     EMPTY STRING, which `actions/checkout` treats as "the default branch" — silently
 *     reintroducing exactly the bug this removes, with no error anywhere.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'validate.yml');

/** The job that resolves the ref, and the expression every checkout must use. */
const RESOLVER = 'parent-ref';
const EXPECTED = `needs.${RESOLVER}.outputs.ref`;

if (!existsSync(WORKFLOW)) {
  console.error(`FAIL: ${WORKFLOW} does not exist — this gate would pass by reading nothing.`);
  process.exit(1);
}

/**
 * Read line-wise rather than through a YAML parser.
 *
 * `js-yaml` is not a declared dependency of this repository or the parent — it is only
 * hoisted transitively, so importing it makes this gate fail to START on a bare
 * checkout, and a gate that cannot start is indistinguishable from one that passes in
 * a `continue-on-error` step. The parent's workflow gate text-parses for the same
 * reason. The workflow's indentation is uniform and machine-written, so this is a
 * narrower assumption than it looks.
 */
const lines = readFileSync(WORKFLOW, 'utf8').split('\n');

/** Jobs, in file order, each with the lines belonging to it. */
const jobs = [];
let inJobs = false;
for (const line of lines) {
  if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
  if (!inJobs) continue;
  // A top-level key at column 0 ends the jobs block.
  if (/^\S/.test(line)) { inJobs = false; continue; }
  const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
  if (header) { jobs.push({ name: header[1], body: [] }); continue; }
  if (jobs.length > 0) jobs.at(-1).body.push(line);
}

const resolver = jobs.find((j) => j.name === RESOLVER);
if (!resolver) {
  console.error(`FAIL: validate.yml has no \`${RESOLVER}\` job, so nothing resolves the parent ref.`);
  process.exit(1);
}
if (!resolver.body.some((l) => /^ {6}ref:\s*\S/.test(l))) {
  console.error(`FAIL: the \`${RESOLVER}\` job declares no \`outputs.ref\`, so every consumer reads "".`);
  process.exit(1);
}

/** The `with:` mapping of each `actions/checkout` step in a job body. */
function checkoutWiths(body) {
  const found = [];
  for (let i = 0; i < body.length; i += 1) {
    if (!/^\s*(?:- )?uses:\s*actions\/checkout/.test(body[i])) continue;
    // Collect the sibling keys under the step's `with:`, which is indented past it.
    const withAt = body.findIndex((l, k) => k > i && /^\s*with:\s*$/.test(l));
    if (withAt === -1) continue;
    const indent = body[withAt].search(/\S/);
    const map = {};
    for (let k = withAt + 1; k < body.length; k += 1) {
      const col = body[k].search(/\S/);
      if (body[k].trim() === '') continue;
      if (col <= indent) break;
      const kv = /^\s*([A-Za-z0-9_-]+):\s*(.*)$/.exec(body[k]);
      if (kv) map[kv[1]] = kv[2].trim();
    }
    found.push(map);
  }
  return found;
}

const problems = [];
let sites = 0;

for (const job of jobs) {
  const needsLine = job.body.find((l) => /^ {4}needs:\s*/.test(l)) ?? '';
  const needs = needsLine.replace(/^ {4}needs:\s*/, '').replace(/[[\]]/g, '');
  for (const step of checkoutWiths(job.body)) {
    // A checkout naming another repository is the parent checkout; a bare one is this PR.
    if (!step.repository) continue;
    sites += 1;
    const ref = step.ref ?? '';
    if (!ref.includes(EXPECTED)) {
      problems.push(`job \`${job.name}\` checks out ${step.repository} at \`${ref || '(unset)'}\` — expected \${{ ${EXPECTED} }}`);
    } else if (!needs.split(/[\s,]+/).includes(RESOLVER)) {
      problems.push(`job \`${job.name}\` reads \${{ ${EXPECTED} }} but does not declare \`needs: ${RESOLVER}\` — the expression is then the empty string, and checkout falls back to the default branch`);
    }
  }
}

// Vacuity floor. If a refactor renames the step or the checkout action, this gate
// would find nothing to check and report success on an unexamined workflow.
if (sites === 0) {
  console.error('FAIL: found no parent-repository checkout steps at all — this gate examined nothing.');
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error file=.github/workflows/validate.yml::${p}`);
  console.error(`\nFAIL: ${problems.length} of ${sites} parent-checkout site(s) do not use the resolved ref.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    `\nAdd \`needs: ${RESOLVER}\` to the job and set the checkout's\n` +
      `\`ref: \${{ ${EXPECTED} }}\`. Hardcoding the parent's default branch here is what\n` +
      'made a coordinated two-repo change unmergeable; see the header of this file.',
  );
  process.exit(1);
}

console.log(
  `check-parent-checkouts-agree-on-the-ref: ${sites} parent-checkout site(s) across ` +
    `${jobs.length} job(s) all take \`${EXPECTED}\` and declare the dependency.`,
);
