import { test } from 'node:test';
import assert from 'node:assert/strict';
import { certificateGaps } from './certificate-coverage.mjs';

const CERT_ACTION = `name: Agent certificate
inputs:
  floor-days:
    description: >-
      Days the certificate must still be valid.
    required: true
runs:
  using: composite
  steps:
    - shell: bash
      env:
        FLOOR_DAYS: \${{ inputs.floor-days }}
      run: node scripts/verify-agent-certificate.mjs --floor-days "$FLOOR_DAYS"
`;
const BUILD_ACTION = `runs:
  using: composite
  steps:
    - uses: actions/download-artifact@v4
      with:
        name: agent-tls
    - run: ./scripts/build-agent-unix.sh "$TARGET"
`;
const DMG_ACTION = `runs:
  using: composite
  steps:
    - run: ./scripts/smoke-agent.sh Citadel-Agent.dmg
`;
const RELEASE = `on:
  workflow_call:
env:
  MIN_CERT_DAYS: \${{ inputs.publish && '30' || '0' }}
jobs:
  certificate:
    steps:
      - uses: ./.github/actions/agent-certificate
        with:
          floor-days: \${{ env.MIN_CERT_DAYS }}
  build:
    steps:
      - uses: ./.github/actions/build-agent
      - run: ./scripts/smoke-agent.sh "\${{ matrix.asset }}"
  macos-app:
    steps:
      - uses: ./.github/actions/macos-agent-dmg
`;
const VALIDATE = `on:
  pull_request:
jobs:
  unix-agents:
    steps:
      - name: The certificate compiled in is valid now
        run: node scripts/verify-agent-certificate.mjs --floor-days 0
      - run: ./scripts/build-agent-unix.sh "$TARGET"
`;
const actions = { 'agent-certificate': CERT_ACTION, 'build-agent': BUILD_ACTION, 'macos-agent-dmg': DMG_ACTION };
const gaps = (over = {}) => certificateGaps({
  workflows: [{ path: 'release.yml', text: RELEASE }, { path: 'validate.yml', text: VALIDATE }],
  actions,
  ...over,
});

test('the release and the PR legs as they are now are covered', () => {
  assert.deepEqual(gaps(), { problems: [], builds: 2, uses: 1 });
});

test('negative control: a PR leg that compiles the agent without verifying fails', () => {
  const unverified = VALIDATE.replace(/      - name: The certificate[^\n]*\n[^\n]*\n/, '');
  const { problems } = gaps({ workflows: [{ path: 'release.yml', text: RELEASE }, { path: 'validate.yml', text: unverified }] });
  assert.deepEqual(problems, [
    'validate.yml job unix-agents compiles the agent without verifying its certificate: run scripts/verify-agent-certificate.mjs --floor-days 0 in it',
  ]);
});

test('the action used without a floor, or declaring none, fails', () => {
  const noFloor = RELEASE.replace(/        with:\n          floor-days:[^\n]*\n/, '');
  assert.match(gaps({ workflows: [{ path: 'release.yml', text: noFloor }] }).problems.join('\n'), /used without floor-days/);
  const optional = CERT_ACTION.replace('    required: true', '    required: false');
  assert.match(gaps({ actions: { ...actions, 'agent-certificate': optional } }).problems.join('\n'), /required `floor-days`/);
  const fixed = CERT_ACTION.replace('--floor-days "$FLOOR_DAYS"', '--floor-days 30').replace('${{ inputs.floor-days }}', '30');
  assert.match(gaps({ actions: { ...actions, 'agent-certificate': fixed } }).problems.join('\n'), /with its floor-days input/);
});

test('a build that takes agent-tls needs an issuer in its own workflow', () => {
  const orphan = RELEASE.replace(/  certificate:\n(?:    .*\n|      .*\n)+?(?=  build:)/, '');
  assert.match(gaps({ workflows: [{ path: 'release.yml', text: orphan }] }).problems.join('\n'), /release.yml job build compiles the agent without verifying/);
});

test('smoke-agent.sh, directly or through an action, needs MIN_CERT_DAYS', () => {
  const unset = RELEASE.replace(/env:\n  MIN_CERT_DAYS:[^\n]*\n/, '');
  assert.match(gaps({ workflows: [{ path: 'release.yml', text: unset }] }).problems.join('\n'), /release.yml runs smoke-agent.sh without setting MIN_CERT_DAYS/);
  const viaAction = unset.replace(/      - run: \.\/scripts\/smoke-agent\.sh[^\n]*\n/, '');
  assert.match(gaps({ workflows: [{ path: 'release.yml', text: viaAction }] }).problems.join('\n'), /without setting MIN_CERT_DAYS/);
});
