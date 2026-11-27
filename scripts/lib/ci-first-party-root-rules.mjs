/**
 * The CI first-party root stays in the pull-request integration image. Pure: the files are handed
 * in (path -> text), the problems come back, for scripts/check-ci-first-party-root-stays-in-ci.mjs.
 *
 * The kernel's `ci-first-party-root` feature trusts a key anyone can sign with (a published test
 * seed). Its build.rs refuses it under CITADEL_DEPLOY and on wasm32, and every shipped kernel is
 * checked not to carry the key (scripts/ci-first-party-key.sh); this holds the wiring that decides
 * which builds can ask for it at all:
 *
 *   - each name that enables or selects it appears only in the files that have a reason to name it
 *     (NAMES), so a workflow, action, compose file or Cargo.toml that ships cannot turn it on;
 *   - the Dockerfile's production stage copies only from `builder`, which checks its kernel lacks
 *     the key, and the CI stage checks its kernel has it (proving the check sees a real one);
 *   - the Dockerfile's default kernel stage is `builder`;
 *   - the script that adds the CI override is run by validate.yml alone;
 *   - every build that publishes or deploys marks itself with CITADEL_DEPLOY=1 (MARKED), and the
 *     deploy checks the server wasm it built.
 */

const DOCKERFILE = 'docker/workspace-server/Dockerfile';
const OVERRIDE = 'docker/ci/compose.ci-first-party.yml';
const CI_STACK = 'scripts/ci-stack.sh';
const VALIDATE = '.github/workflows/validate.yml';
const DEPLOY_SH = 'deploy/tenant-worker/deploy.sh';
const KERNEL_APPS = 'citadel-workspace-server-kernel/src/kernel/apps';

/** Each name, and the only files that may contain it. */
export const NAMES = {
  'ci-first-party-root': [
    'citadel-workspace-server-kernel/Cargo.toml',
    'docker/workspace-server/citadel-workspace-server-kernel.Cargo.docker.toml',
    'citadel-workspace-server-kernel/build.rs',
    `${KERNEL_APPS}/ci_first_party_root.rs`,
    `${KERNEL_APPS}/install.rs`,
    `${KERNEL_APPS}/mod.rs`,
    `${KERNEL_APPS}/first_party_key_tests.rs`,
    'citadel-workspace-server-kernel/src/kernel/command_processor/first_party_provisioning.rs',
    DOCKERFILE,
    OVERRIDE,
    'scripts/ci-first-party-key.sh',
    // The clippy job lints the feature and proves build.rs refuses it for a deploy.
    VALIDATE,
    // The gate index quotes this gate's own summary (build-gates-index.mjs).
    'docs/GATES.md',
  ],
  'builder-ci-first-party': [DOCKERFILE, OVERRIDE],
  KERNEL_BUILDER: [DOCKERFILE, OVERRIDE],
  'compose.ci-first-party.yml': [CI_STACK, OVERRIDE, DOCKERFILE, VALIDATE],
  CI_FIRST_PARTY_SIGNED_DIR: [CI_STACK, OVERRIDE, VALIDATE],
  '--ci-key': ['scripts/build-first-party-apps.mjs', 'scripts/lib/sign-first-party-apps.mjs', 'scripts/lib/sign-first-party-apps.test.mjs', VALIDATE, DOCKERFILE, CI_STACK],
};

/** The builds that publish or deploy, and the line each must carry. */
export const MARKED = {
  '.github/workflows/publish-images.yml': /^\s*CITADEL_DEPLOY=1\s*$/m,
  'docker-compose.production.yml': /^\s*CITADEL_DEPLOY: "1"\s*$/m,
  '.github/actions/tenant-worker-deploy/action.yml': /^\s*CITADEL_DEPLOY: '1'\s*$/m,
  [DEPLOY_SH]: /^export CITADEL_DEPLOY=1$/m,
};

/** The Dockerfile's stages: name -> the lines from its FROM to the next. */
export function stages(dockerfile) {
  const out = new Map();
  let current = null;
  for (const line of dockerfile.split('\n')) {
    const from = /^FROM\s+\S+\s+AS\s+(\S+)\s*$/i.exec(line);
    if (from) {
      current = from[1];
      out.set(current, []);
    } else if (current !== null) {
      out.get(current).push(line);
    }
  }
  return out;
}

function dockerfileProblems(text) {
  const problems = [];
  const all = stages(text);
  const stage = (name) => (all.get(name) ?? []).join('\n');
  for (const name of ['builder', 'builder-ci-first-party', 'production', 'dev']) {
    if (!all.has(name)) problems.push(`${DOCKERFILE} has no \`${name}\` stage`);
  }
  const froms = [...stage('production').matchAll(/--from=(\S+)/g)].map((m) => m[1]);
  if (froms.length === 0 || froms.some((f) => f !== 'builder')) {
    problems.push(`${DOCKERFILE}: the production stage must copy only from \`builder\` (it copies from ${froms.join(', ') || 'nothing'})`);
  }
  if (!/^RUN \.\/scripts\/ci-first-party-key\.sh absent /m.test(stage('builder'))) {
    problems.push(`${DOCKERFILE}: the \`builder\` stage must check its kernel lacks the CI root's key`);
  }
  if (!/^RUN \.\/scripts\/ci-first-party-key\.sh present /m.test(stage('builder-ci-first-party'))) {
    problems.push(`${DOCKERFILE}: the \`builder-ci-first-party\` stage must check its kernel has the CI root's key`);
  }
  for (const [name, lines] of all) {
    if (name !== 'builder-ci-first-party' && lines.some((l) => !l.trimStart().startsWith('#') && l.includes('ci-first-party-root'))) {
      problems.push(`${DOCKERFILE}: only \`builder-ci-first-party\` may build with the feature (\`${name}\` names it)`);
    }
  }
  if (!/^ARG KERNEL_BUILDER=builder$/m.test(text)) problems.push(`${DOCKERFILE}: the default kernel stage must be \`ARG KERNEL_BUILDER=builder\``);
  return problems;
}

/** Every problem with `files` (path -> text, the tracked tree). */
export function ciRootProblems(files) {
  const problems = [];
  for (const [name, allowed] of Object.entries(NAMES)) {
    for (const [path, text] of files) {
      if (text.includes(name) && !allowed.includes(path)) problems.push(`${path} names \`${name}\`, which only ${allowed.join(', ')} may`);
    }
  }
  for (const [path, line] of Object.entries(MARKED)) {
    const text = files.get(path);
    if (text === undefined) problems.push(`${path} is missing`);
    else if (!line.test(text)) problems.push(`${path} does not mark its build with CITADEL_DEPLOY=1`);
  }
  const deploy = files.get(DEPLOY_SH) ?? '';
  if (!/^"\$ROOT\/scripts\/ci-first-party-key\.sh" absent server-wasm\/pkg\/\*\.wasm$/m.test(deploy)) {
    problems.push(`${DEPLOY_SH} must check the server wasm it built lacks the CI root's key`);
  }
  const runners = [...files].filter(([path, text]) => path.startsWith('.github/') && text.includes('ci-stack.sh')).map(([path]) => path);
  if (runners.some((p) => p !== VALIDATE)) problems.push(`${CI_STACK} may be run only by ${VALIDATE}, not ${runners.filter((p) => p !== VALIDATE).join(', ')}`);
  const dockerfile = files.get(DOCKERFILE);
  if (dockerfile === undefined) problems.push(`${DOCKERFILE} is missing`);
  else problems.push(...dockerfileProblems(dockerfile));
  return problems;
}
