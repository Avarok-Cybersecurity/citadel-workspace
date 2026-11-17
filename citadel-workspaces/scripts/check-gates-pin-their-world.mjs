/**
 * Every browser-driving gate must pin the world it measures.
 *
 * `vite preview` proxies `/ws` to `127.0.0.1:${AGENT_PORT ?? 12345}`: a
 * developer's live stack locally, nothing at all in CI. A gate that spawns the
 * preview without deciding which of those it wants is measuring two different
 * applications, and the difference is not cosmetic — with no agent the
 * "Connection Failed" modal opens over the screen and traps focus, so anything
 * scoped to a dialog lands on the modal instead.
 *
 * That was found once, in check-accessibility.mjs, after it failed in CI and
 * passed locally with identical code. Four other gates had the same shape and
 * none of them had failed yet — which is the whole problem: they were green
 * about the wrong screen.
 *
 * So the rule is the shared spawn, not a hand-rolled one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)));

/**
 * check-agent-down.mjs owns this decision on purpose: the agent being down IS
 * its subject, and it varies the port deliberately across its own cases.
 */
const OWNS_ITS_WORLD = ['check-agent-down.mjs'];

const problems = [];
let checked = 0;

for (const file of readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs'))) {
  const source = readFileSync(join(SCRIPTS, file), 'utf-8');
  // A HAND-ROLLED spawn, by its argument list -- not the absence of an import.
  //
  // The first version asked whether the file mentioned `spawnPreview` at all,
  // which an import line satisfies on its own. Its control -- restoring a raw
  // spawn in a file that still imported the helper -- passed, so the rule could
  // not fail for the thing it exists to catch.
  const handRolled = /'vite',\s*'preview'/.test(source);
  if (!handRolled && !source.includes('spawnPreview')) continue;
  if (OWNS_ITS_WORLD.includes(file)) continue;
  checked += 1;
  if (!handRolled) continue;
  problems.push(`${file}: spawns its own preview, so its agent port is whatever happens to be running`);
}

if (checked === 0) {
  console.error('\n  No gate serves a preview — this check is measuring nothing.\n');
  process.exit(1);
}

if (problems.length > 0) {
  console.error('\n  Gates that do not pin the world they measure:\n');
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`  ${checked} browser gate(s) pin the agent port  ok`);
