/**
 * A gate nobody runs is not a gate.
 *
 * `check:spec-copy` had an npm script, a careful header, and NO invocation
 * anywhere in CI. It had therefore never run — in this repository or the
 * parent — from the day it was written. It was found only because wiring a
 * different gate meant reading the workflow beside it, and when it was finally
 * run it had three real findings waiting, one of them a locator searching for
 * copy the app had deliberately removed.
 *
 * The parent repository has had this check for its own `scripts/` since the
 * same failure happened there. This submodule did not, which is why six more
 * gates were in the same state.
 *
 * The rule: every `check:*` npm script must be named by a step in a workflow,
 * or appear here with the reason it is not — and the reason must say what it
 * NEEDS, not merely that it is inconvenient, so that a reader can tell a gate
 * waiting on infrastructure from a gate quietly abandoned.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

/**
 * Gates not yet wired, each with what it needs before it can be.
 *
 * Every entry here was RUN to find out, not guessed. Two of them are red on
 * real findings today; that is recorded rather than hidden, because an
 * unwired gate and a failing gate are different problems and conflating them
 * is how one of them gets forgotten.
 */
const NOT_IN_CI = new Map([
  ['check:types', 'static, but RED today on a real finding: declarations without a type'],
  ['check:a11y', 'needs the built app served and a browser driving it'],
  ['check:toast-header', 'needs a running app with a toast on screen; it measures geometry'],
  ['check:agent-down', 'needs port 12399 free, or it measures a CONNECTED app and reports the agent-down state works'],
  ['check:cdoc-paint-perf', 'a timing measurement that asserts no time; needs a quiet machine (a GitHub runner, never the shared Mac). Its vitest, paint-perf.test.ts, runs in CI'],
]);

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const gates = Object.keys(pkg.scripts ?? {}).filter((name) => name.startsWith('check:'));

if (gates.length === 0) {
  console.error('FAIL: no check: scripts found — this gate would pass by considering nothing.');
  process.exit(1);
}

const workflowText = existsSync(WORKFLOWS)
  ? readdirSync(WORKFLOWS)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => readFileSync(join(WORKFLOWS, f), 'utf8'))
      .join('\n')
  : '';

if (workflowText === '') {
  console.error('FAIL: no workflow files read — cannot tell which gates run.');
  process.exit(1);
}

const problems = [];
let invoked = 0;

for (const gate of gates) {
  // `npm run check:x` — anchored so `check:pwa` does not match `check:pwa-offline`.
  const runs = new RegExp(`npm run ${gate.replace(/[:-]/g, '[:-]')}(?![\\w-])`).test(workflowText);
  if (runs) {
    invoked += 1;
    if (NOT_IN_CI.has(gate)) {
      problems.push(`${gate} runs in CI now, so its NOT_IN_CI entry is stale — remove it`);
    }
    continue;
  }
  if (NOT_IN_CI.has(gate)) continue;
  problems.push(`${gate} is defined in package.json but no workflow step runs it`);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error file=package.json::${p}`);
  console.error(`\nFAIL: ${problems.length} gate(s) are not wired to anything.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nAdd a workflow step that runs it, or add it to NOT_IN_CI with what it\n' +
      'NEEDS before it can run. A gate nobody runs is not a gate: check:spec-copy\n' +
      'sat unrun from the day it was written and had three real findings waiting.',
  );
  process.exit(1);
}

console.log(
  `check-every-gate-is-invoked: ${invoked} of ${gates.length} check: script(s) run in CI; ` +
    `${NOT_IN_CI.size} recorded as not yet wired, each with what it needs.`,
);
