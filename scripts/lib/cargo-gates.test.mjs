import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cargoGates } from './cargo-gates.mjs';

const WORKFLOW = `
on: pull_request
jobs:
  root:
    runs-on: ubuntu-24.04
    steps:
      - run: cargo clippy --workspace -- -D warnings
  apps:
    runs-on: ubuntu-24.04
    steps:
      - name: an app
        working-directory: apps/first-party/pool
        run: |
          cargo fmt --all --check
          cargo clippy --locked --target wasm32-unknown-unknown -- -D warnings
          echo done
      - name: the signer, on its pinned toolchain
        working-directory: apps/first-party/signer
        run: cargo +1.99.0 test --locked
`;

test("CI's cargo commands outside the workspaces preflight names are read with their directory", () => {
  assert.deepEqual(cargoGates({ text: WORKFLOW, covered: ['.'] }), [
    { wd: 'apps/first-party/pool', argv: ['cargo', 'fmt', '--all', '--check'], sources: ['apps'] },
    { wd: 'apps/first-party/pool', argv: ['cargo', 'clippy', '--locked', '--target', 'wasm32-unknown-unknown', '--', '-D', 'warnings'], sources: ['apps'] },
    { wd: 'apps/first-party/signer', argv: ['cargo', '+1.99.0', 'test', '--locked'], sources: ['apps'] },
  ]);
});

test('a command that is not one plain cargo invocation is refused, not guessed at', () => {
  const text = WORKFLOW.replace('cargo fmt --all --check', 'cargo fmt --all --check || true');
  assert.throws(() => cargoGates({ text, covered: ['.'] }), /cannot run/);
});

test("on the real workflow it finds compute-pool's clippy, and nothing in the root or agent workspaces", () => {
  const text = readFileSync(new URL('../../.github/workflows/validate.yml', import.meta.url), 'utf8');
  const gates = cargoGates({ text, covered: ['.', 'citadel-internal-service'] });
  assert.ok(gates.some((g) => g.wd === 'apps/first-party/compute-pool' && g.argv.includes('clippy') && g.argv.includes('warnings')));
  assert.ok(gates.every((g) => g.wd !== '.' && g.wd !== 'citadel-internal-service'));
  assert.ok(gates.some((g) => g.wd === 'citadel-internal-service/citadel-app-sdk'), 'the guest SDK is its own workspace');
});
