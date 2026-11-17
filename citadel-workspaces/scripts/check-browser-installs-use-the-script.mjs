/**
 * Every browser install in CI goes through the install-chromium action, which runs
 * scripts/ci/install-chromium.sh with the browser and apt packages cached.
 *
 * The install was written inline, step by step, and each fix reached only some of the copies.
 * A retry went into three parent steps while three UI steps shipped without one. A wait for
 * the dpkg lock went into six steps; a seventh, added later for the geometry gates, copied an
 * older block with no wait and a 300s bound. On 2026-10-22 that step ("UI sweep geometry",
 * UI run 39831695758, and its rerun) died twice on
 *   E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 2787 (apt-get)
 * The same day a 15-minute job ran out inside an uncached install from a ~40 KB/s apt mirror
 * (UI run 39843446695), so the caches live in the action too: a step that called the script
 * directly, or cached ~/.cache/ms-playwright beside it, would be the next drifted copy.
 *
 * Usage: node scripts/check-browser-installs-use-the-script.mjs <repo-root>
 * It reads <repo-root>/.github/workflows/*.yml and <repo-root>/.github/actions/* /action.yml.
 * The UI runs it on itself (`npm run check:browser-installs`); the parent runs it on the
 * parent's root, from citadel-workspaces/.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = 'scripts/ci/install-chromium.sh';
const ACTION = '.github/actions/install-chromium/action.yml';
const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INLINE = /playwright\s+install/;
const SCRIPT_CALL = /install-chromium\.sh/;
const BROWSER_CACHE = /ms-playwright/;
const USES = /^(-\s+)?uses:\s*\.\/(parent\/)?citadel-workspaces\/\.github\/actions\/install-chromium$/;

if (process.argv.length !== 3) {
  console.error('usage: check-browser-installs-use-the-script.mjs <repo-root>');
  process.exit(64);
}
const root = resolve(process.argv[2]);
for (const required of [SCRIPT, ACTION]) {
  if (!existsSync(join(UI_ROOT, required))) {
    console.error(`FAIL: ${required} is missing, so every install this check requires would fail.`);
    process.exit(1);
  }
}
const actionFile = join(UI_ROOT, ACTION);
if (!readFileSync(actionFile, 'utf8').includes(`/${SCRIPT}"`)) {
  console.error(`FAIL: ${ACTION} no longer runs ${SCRIPT}; the action is the script's only caller.`);
  process.exit(1);
}

function yamlFiles() {
  const files = [];
  const workflows = join(root, '.github', 'workflows');
  if (!existsSync(workflows)) {
    console.error(`FAIL: ${workflows} does not exist; pass the repository root.`);
    process.exit(1);
  }
  for (const f of readdirSync(workflows)) if (/\.ya?ml$/.test(f)) files.push(join(workflows, f));
  const actions = join(root, '.github', 'actions');
  if (existsSync(actions)) {
    for (const a of readdirSync(actions)) {
      for (const f of ['action.yml', 'action.yaml']) {
        if (existsSync(join(actions, a, f))) files.push(join(actions, a, f));
      }
    }
  }
  return files;
}

const files = yamlFiles();
const problems = [];
let calls = 0;
for (const file of files) {
  if (resolve(file) === actionFile) continue;
  const rel = relative(root, file);
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/(^|\s)#.*$/, '').trim();
    if (!code) return;
    const where = `${rel}:${i + 1}: ${code.slice(0, 100)}`;
    if (USES.test(code)) calls += 1;
    if (INLINE.test(code)) problems.push(`inline browser install -- ${where}`);
    if (SCRIPT_CALL.test(code)) problems.push(`the script called beside the action -- ${where}`);
    if (BROWSER_CACHE.test(code)) problems.push(`a browser cache beside the action's -- ${where}`);
  });
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(
    `\nFAIL: ${problems.length} line(s) install or cache a browser beside the install-chromium action.\n` +
      'Replace the step with\n' +
      '  uses: ./parent/citadel-workspaces/.github/actions/install-chromium   (UI workflow)\n' +
      '  uses: ./citadel-workspaces/.github/actions/install-chromium          (parent workflow)\n' +
      'and `working-directory:` naming a directory whose node_modules holds the locked playwright.\n' +
      'It waits for the dpkg lock and caches the browser and the apt packages; a copy beside it is\n' +
      'how a step came to have no wait at all.',
  );
  process.exit(1);
}
if (calls === 0) {
  // Both repositories install Chromium in CI. None found means the call shape changed and
  // this check stopped recognising it -- not that the browsers stopped being installed.
  console.error(`FAIL: no \`uses: .../${dirname(ACTION)}\` step in ${files.length} file(s) under ${root}.`);
  process.exit(1);
}
console.log(
  `check-browser-installs-use-the-script: ${calls} install(s) through ${dirname(ACTION)}, ` +
    `no inline install, script call or browser cache beside it, across ${files.length} workflow/action file(s)`,
);
