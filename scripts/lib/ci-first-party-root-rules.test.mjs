/**
 * ci-first-party-root-rules.mjs against this tree (no problem) and against the tree with one change
 * each: a build that ships naming the feature or the CI stage, a production stage copying from the
 * CI stage, a builder that stops checking, a publishing build losing its marker, a deploy that
 * stops checking its wasm, and another workflow running the CI stack script.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciRootProblems, MARKED, NAMES } from './ci-first-party-root-rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const paths = [...new Set([...Object.values(NAMES).flat(), ...Object.keys(MARKED), '.github/workflows/deploy.yml', 'deploy/tenant-worker/server-wasm/Cargo.toml'])];
const tree = new Map(paths.map((p) => [p, readFileSync(join(ROOT, p), 'utf8')]));
const DOCKERFILE = 'docker/workspace-server/Dockerfile';

/** The tree with `path` changed by `edit`, which must change it. */
function with_(path, edit) {
  const before = tree.get(path);
  const after = edit(before);
  assert.notEqual(after, before, `the edit to ${path} changed nothing`);
  return new Map(tree).set(path, after);
}

test('this tree keeps the CI root in the integration image', () => {
  assert.ok(execFileSync('git', ['ls-files', ...paths], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).length === paths.length);
  assert.deepEqual(ciRootProblems(tree), []);
});

test('a shipping build that names the feature, the CI stage or the override is refused', () => {
  const cargo = with_('deploy/tenant-worker/server-wasm/Cargo.toml', (t) => t.replace('citadel-workspace-server-kernel = { workspace = true }', 'citadel-workspace-server-kernel = { workspace = true, features = ["ci-first-party-root"] }'));
  assert.match(ciRootProblems(cargo).join('\n'), /server-wasm\/Cargo\.toml names `ci-first-party-root`/);
  const publish = with_('.github/workflows/publish-images.yml', (t) => t.replace('CITADEL_DEPLOY=1', 'CITADEL_DEPLOY=1\n              KERNEL_BUILDER=builder-ci-first-party'));
  assert.match(ciRootProblems(publish).join('\n'), /publish-images\.yml names `builder-ci-first-party`/);
  const deploy = with_('.github/workflows/deploy.yml', (t) => `${t}\n# -f docker/ci/compose.ci-first-party.yml\n`);
  assert.match(ciRootProblems(deploy).join('\n'), /deploy\.yml names `compose\.ci-first-party\.yml`/);
});

test('the production stage copies only from the builder that checks its kernel', () => {
  const fromCi = with_(DOCKERFILE, (t) => t.replace('COPY --from=builder /usr/local/bin/citadel-workspace-server-kernel', 'COPY --from=builder-ci-first-party /usr/local/bin/citadel-workspace-server-kernel'));
  assert.match(ciRootProblems(fromCi).join('\n'), /production stage must copy only from `builder`/);
  const unchecked = with_(DOCKERFILE, (t) => t.replace('RUN ./scripts/ci-first-party-key.sh absent ', 'RUN true '));
  assert.match(ciRootProblems(unchecked).join('\n'), /`builder` stage must check its kernel lacks/);
  const unproved = with_(DOCKERFILE, (t) => t.replace('RUN ./scripts/ci-first-party-key.sh present ', 'RUN true '));
  assert.match(ciRootProblems(unproved).join('\n'), /`builder-ci-first-party` stage must check its kernel has/);
  const featured = with_(DOCKERFILE, (t) => t.replace('RUN cargo build --release --bin citadel-workspace-server-kernel\n', 'RUN cargo build --release --bin citadel-workspace-server-kernel --features citadel-workspace-server-kernel/ci-first-party-root\n'));
  assert.match(ciRootProblems(featured).join('\n'), /only `builder-ci-first-party` may build with the feature \(`builder` names it\)/);
  const defaulted = with_(DOCKERFILE, (t) => t.replace('ARG KERNEL_BUILDER=builder\n', 'ARG KERNEL_BUILDER=builder-ci-first-party\n'));
  assert.match(ciRootProblems(defaulted).join('\n'), /default kernel stage must be/);
});

test('every publishing or deploying build is marked, and the deploy checks its wasm', () => {
  for (const [path, line] of Object.entries(MARKED)) {
    const unmarked = with_(path, (t) => t.replace(line, ''));
    assert.match(ciRootProblems(unmarked).join('\n'), new RegExp(`${path.replaceAll('.', '\\.')} does not mark its build`));
  }
  const unchecked = with_('deploy/tenant-worker/deploy.sh', (t) => t.replace('"$ROOT/scripts/ci-first-party-key.sh" absent server-wasm/pkg/*.wasm\n', ''));
  assert.match(ciRootProblems(unchecked).join('\n'), /must check the server wasm it built/);
});

test('the CI stack script is run by validate.yml alone', () => {
  const other = with_('.github/workflows/deploy.yml', (t) => `${t}\n      - run: ./scripts/ci-stack.sh build server out\n`);
  assert.match(ciRootProblems(other).join('\n'), /ci-stack\.sh may be run only by \.github\/workflows\/validate\.yml, not \.github\/workflows\/deploy\.yml/);
});
