/**
 * scripts/ci-first-party-key.sh, against artifacts made here: one carrying the CI root's key among
 * binary bytes, one without it. Each answer beside its opposite, and an unreadable artifact is an
 * error, never "absent".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciRootKeys } from './sign-first-party-apps.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci-first-party-key.sh');
const [key] = ciRootKeys(readFileSync(join(ROOT, 'citadel-workspace-server-kernel/src/kernel/apps/ci_first_party_root.rs'), 'utf8'));

const run = (...args) => spawnSync('sh', [SCRIPT, ...args], { encoding: 'utf8' });

function artifacts() {
  const dir = mkdtempSync(join(tmpdir(), 'ci-key-'));
  const withKey = join(dir, 'with.wasm');
  const without = join(dir, 'without.wasm');
  writeFileSync(withKey, Buffer.concat([Buffer.from([0, 97, 115, 109, 1]), Buffer.from(key), Buffer.from([0, 255])]));
  writeFileSync(without, Buffer.concat([Buffer.from([0, 97, 115, 109, 1]), Buffer.from(key.slice(0, -1)), Buffer.from([0, 255])]));
  return { dir, withKey, without };
}

test('an artifact without the key is absent, and one with it is refused as absent', () => {
  const { dir, withKey, without } = artifacts();
  try {
    assert.equal(run('absent', without).status, 0);
    const refused = run('absent', without, withKey);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /with\.wasm: the CI first-party root's key is present, and must be absent/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('an artifact with the key is present, and one without it is refused as present', () => {
  const { dir, withKey, without } = artifacts();
  try {
    assert.equal(run('present', withKey).status, 0);
    const refused = run('present', without);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /without\.wasm: the CI first-party root's key is absent, and must be present/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a missing artifact, no artifact or an unknown answer is an error', () => {
  assert.match(run('absent', '/nonexistent/server.wasm').stderr, /is missing or empty/);
  assert.match(run('absent').stderr, /usage/);
  assert.match(run('maybe', SCRIPT).stderr, /neither absent nor present/);
});

test('an artifact that cannot be read is an error, never absent', { skip: process.getuid?.() === 0 ? 'root reads any file' : false }, () => {
  const { dir, without } = artifacts();
  try {
    chmodSync(without, 0o000);
    const refused = run('absent', without);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /could not read .*without\.wasm \(grep exited 2\)/);
  } finally {
    chmodSync(without, 0o600);
    rmSync(dir, { recursive: true });
  }
});
