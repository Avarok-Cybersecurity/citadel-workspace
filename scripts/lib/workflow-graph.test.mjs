import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkNames, localActions, producedOnPullRequests, rawDispatches, releaseOnlyGaps, releaseTargets, triggers,
  unproducedRequired,
} from './workflow-graph.mjs';

const noCallee = () => {
  throw new Error('no reusable workflow expected');
};

// The agent repository's shape when its required name drifted (2026-11-21): no `name:`, an
// inline matrix list, and the rule still asking for ubuntu-latest.
const AGENT = `name: Validate PR
on:
  workflow_call:
  pull_request:
  push:
    branches: [master]
jobs:
  tests:
    strategy:
      matrix:
        os: [ ubuntu-24.04, macos-latest, windows-latest ]
    runs-on: \${{ matrix.os }}
    steps:
      - run: cargo nextest run
  fmt:
    runs-on: ubuntu-24.04
    steps:
      - run: cargo fmt --check
`;

test('a job with no name is checked as its id, with the matrix values appended', () => {
  assert.deepEqual(checkNames(AGENT, noCallee), [
    'tests (ubuntu-24.04)', 'tests (macos-latest)', 'tests (windows-latest)', 'fmt',
  ]);
});

test('the drifted required name is reported, with the name the job really has', () => {
  const { produced, examined } = producedOnPullRequests([{ path: 'v.yml', text: AGENT }], noCallee);
  assert.equal(examined, 1);
  const missing = unproducedRequired(['fmt', 'tests (ubuntu-latest)', 'GitGuardian Security Checks'], produced, ['GitGuardian Security Checks']);
  assert.deepEqual(missing, [{
    name: 'tests (ubuntu-latest)',
    near: ['tests (macos-latest)', 'tests (ubuntu-24.04)', 'tests (windows-latest)'],
  }]);
});

test('negative control: renaming the matrix entry makes the required name unproduced', () => {
  const renamed = AGENT.replace('ubuntu-24.04, macos', 'ubuntu-26.04, macos');
  const { produced } = producedOnPullRequests([{ path: 'v.yml', text: renamed }], noCallee);
  assert.equal(unproducedRequired(['tests (ubuntu-24.04)'], produced, []).length, 1);
});

test('a name that names a matrix value is substituted, not suffixed; strategy totals resolve', () => {
  const text = `on:
  pull_request:
jobs:
  agents:
    name: The \${{ matrix.target }} agent
    strategy:
      matrix:
        include:
          - os: macos-15
            target: aarch64-apple-darwin
          - os: ubuntu-24.04
            target: x86_64-unknown-linux-musl
    steps:
      - run: true
  shards:
    name: Playwright - shard \${{ matrix.shard }}/\${{ strategy.job-total }}
    strategy:
      matrix:
        shard: [1, 2]
    steps:
      - run: true
`;
  assert.deepEqual(checkNames(text, noCallee), [
    'The aarch64-apple-darwin agent', 'The x86_64-unknown-linux-musl agent',
    'Playwright - shard 1/2', 'Playwright - shard 2/2',
  ]);
});

test('a reusable workflow call prefixes the callee checks with the caller', () => {
  const caller = `on:
  pull_request:
jobs:
  wasm-rebuild-diff:
    uses: ./.github/workflows/wasm-rebuild-diff.yml
  all-green:
    name: Validation passed
    steps:
      - run: true
`;
  const callee = `on:
  workflow_call:
jobs:
  diff:
    name: wasm-rebuild-diff
    steps:
      - run: true
`;
  const read = (uses) => (uses === './.github/workflows/wasm-rebuild-diff.yml' ? callee : noCallee());
  assert.deepEqual(checkNames(caller, read), ['wasm-rebuild-diff / wasm-rebuild-diff', 'Validation passed']);
});

test('only pull_request workflows can satisfy a required check', () => {
  const pushOnly = AGENT.replace('  workflow_call:\n  pull_request:\n', '');
  const { produced, examined } = producedOnPullRequests([{ path: 'v.yml', text: pushOnly }], noCallee);
  assert.equal(examined, 0);
  assert.equal(produced.size, 0);
  assert.deepEqual(triggers('on: [push, pull_request]\njobs:\n'), ['push', 'pull_request']);
});

const RELEASE = `on:
  workflow_call:
jobs:
  certificate:
    steps:
      - uses: ./.github/actions/agent-certificate
  build:
    strategy:
      matrix:
        include:
          - os: windows-latest
            target: x86_64-pc-windows-msvc
          - os: ubuntu-24.04
            target: x86_64-unknown-linux-musl
    steps:
      - uses: ./.github/actions/build-agent
      # - uses: ./.github/actions/commented-out
      - uses: ./.github/actions/publish-agent-release
`;
const PR = `jobs:
  windows-agent:
    steps:
      - run: ./scripts/build-agent-windows.ps1 -Target x86_64-pc-windows-msvc
  unix-agents:
    steps:
      - run: ./scripts/build-agent-unix.sh x86_64-unknown-linux-musl
      - uses: ./.github/actions/agent-certificate
`;
const gaps = (over = {}) => releaseOnlyGaps({
  releaseActions: localActions(RELEASE),
  targets: releaseTargets(RELEASE),
  validateText: PR,
  twins: { 'build-agent': ['scripts/build-agent-unix.sh', 'scripts/build-agent-windows.ps1'] },
  allowed: { 'publish-agent-release': 'nothing exists to publish on a pull request' },
  ...over,
});

test('release actions are used directly, twinned, or allowlisted with a reason', () => {
  assert.deepEqual([...localActions(RELEASE)].sort(), ['agent-certificate', 'build-agent', 'publish-agent-release']);
  assert.deepEqual(gaps(), []);
});

test('a release-only action with no twin and no reason fails', () => {
  assert.match(gaps({ allowed: {} }).join('\n'), /publish-agent-release runs only at release/);
  assert.match(gaps({ allowed: { 'publish-agent-release': 'later' } }).join('\n'), /runs only at release/);
});

test('a twin the PR stopped invoking fails, and so does a target no PR job builds', () => {
  const dropped = PR.replace('./scripts/build-agent-windows.ps1 -Target x86_64-pc-windows-msvc', 'true');
  const found = gaps({ validateText: dropped }).join('\n');
  assert.match(found, /build-agent's PR twin is missing: validate.yml does not invoke scripts\/build-agent-windows.ps1/);
  assert.match(found, /the release builds x86_64-pc-windows-msvc, and no PR job does/);
});

test('a stale allowlist entry fails both ways', () => {
  const found = gaps({ allowed: {
    'publish-agent-release': 'nothing exists to publish on a pull request',
    'agent-certificate': 'it was release-only once, before the PR legs verified it',
    'retired-action': 'an action no release workflow uses any more',
  } }).join('\n');
  assert.match(found, /agent-certificate is allowlisted as release-only, but a PR job exercises it/);
  assert.match(found, /retired-action is allowlisted as release-only but no release workflow uses it/);
});

test('raw dispatches are found; comments and the script are not', () => {
  const text = [
    '      # gh workflow run deploy.yml is what this used to do',
    '      - run: gh workflow run deploy.yml --ref master -f sha="$GITHUB_SHA"',
    '      - run: gh api repos/o/r/actions/workflows/deploy.yml/dispatches -f ref=master',
    '      - run: node scripts/dispatch-workflow.mjs',
    '      - run: gh api repos/o/r/dispatches -f event_type=types-released',
  ].join('\n');
  assert.deepEqual(rawDispatches(text).map((d) => d.line), [2, 3]);
});
