/**
 * A UI-testing agent must not be told to click something that does not exist.
 *
 * `.claude/agents/*.md` drive automated browser testing. Four of them told the
 * agent to click a "Join Workspace" or "Login Workspace" button. The landing
 * page's two CTAs are `Sign In` and `Create Account`, and the older copy
 * survives in this repository only inside test comments explaining that the
 * suite was MIGRATED OFF it -- so the UI had learned the lesson and the agent
 * docs never did.
 *
 * One of them also asserted a URL of `/office`, which no route serves, and a
 * workspace named "RW Root Workspace", which appears nowhere. Those were
 * written as CRITICAL CHECKs, so a healthy stack was scored as broken.
 *
 * This checks the two claims that can be checked mechanically:
 *
 *   - a `data-testid` named in an agent doc must exist in the UI;
 *   - a `http://localhost:5291/<path>` must match a route in App.tsx.
 *
 * Visible copy is deliberately NOT checked. Agent docs quote fragments and
 * paraphrases, and a gate that demanded exact matches would either be noisy or
 * be defeated by rewording -- which is why the docs are now written to name
 * test ids, whose whole purpose is to survive a copy change.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = join(ROOT, '.claude', 'agents');
const UI_SRC = join(ROOT, 'citadel-workspaces', 'src');
const APP = join(UI_SRC, 'App.tsx');

if (!existsSync(AGENTS)) {
  console.error('FAIL: no .claude/agents directory — nothing to check.');
  process.exit(1);
}
if (!existsSync(UI_SRC) || !existsSync(APP)) {
  console.error(
    'FAIL: the UI submodule is not populated, so no claim here can be checked.\n' +
      'Run `git submodule update --init --recursive` first. Passing without the\n' +
      'submodule would mean reporting success on an empty comparison.',
  );
  process.exit(1);
}

/** Every file under a directory, recursively. */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry.name)) yield full;
  }
}

let uiText = '';
for (const file of walk(UI_SRC)) uiText += readFileSync(file, 'utf8');

const routes = new Set(
  [...readFileSync(APP, 'utf8').matchAll(/path=["']([^"']+)["']/g)].map((m) => m[1]),
);

const docs = readdirSync(AGENTS).filter((f) => f.endsWith('.md'));
const problems = [];
let testIds = 0;
let urls = 0;

for (const name of docs) {
  const source = readFileSync(join(AGENTS, name), 'utf8');

  for (const match of source.matchAll(/data-testid=["']([\w-]+)["']/g)) {
    testIds += 1;
    if (!uiText.includes(`"${match[1]}"`) && !uiText.includes(`'${match[1]}'`)) {
      problems.push(`${name}: names data-testid="${match[1]}", which no component defines`);
    }
  }

  for (const match of source.matchAll(/http:\/\/localhost:5291(\/[\w:-]*)/g)) {
    const path = match[1];
    urls += 1;
    if (path === '/' || routes.has(path)) continue;
    // A parameterised route: /groups/:groupId matches /groups/anything.
    const matches = [...routes].some((r) =>
      r.includes(':') && new RegExp(`^${r.replace(/:[^/]+/g, '[^/]+')}$`).test(path),
    );
    if (!matches) {
      problems.push(
        `${name}: names ${path}, which App.tsx does not route — it falls through to NotFound`,
      );
    }
  }
}

if (testIds === 0 && urls === 0) {
  console.error('FAIL: no test ids or URLs found in any agent doc — this gate considered nothing.');
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error file=.claude/agents/${p.split(':')[0]}::${p}`);
  console.error(`\nFAIL: ${problems.length} agent instruction(s) name UI that does not exist.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nAn agent told to click a button that does not exist reports the stack as\n' +
      'broken. Name a data-testid rather than visible copy: four agents told the\n' +
      'agent to click "Join Workspace", which the UI stopped rendering long ago.',
  );
  process.exit(1);
}

console.log(
  `check-agent-docs-name-real-ui: ${testIds} test id(s) and ${urls} URL(s) across ` +
    `${docs.length} agent doc(s) all name UI that exists.`,
);
