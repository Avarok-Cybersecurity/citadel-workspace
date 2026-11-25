import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDrift } from './installed-modules.mjs';

const lock = { packages: { '': { name: 'root' }, 'node_modules/vitest': { version: '4.0.1' }, 'node_modules/@esbuild/linux-x64': { version: '0.25.0', optional: true } } };
const same = { packages: { 'node_modules/vitest': { version: '4.0.1' } } };

test('an install matching the lockfile, with an optional platform build absent, has not drifted', () => {
  assert.deepEqual(installDrift(lock, same), { drifted: false, examples: [] });
});

test('a package installed at another version than the lockfile pins has drifted', () => {
  const r = installDrift(lock, { packages: { 'node_modules/vitest': { version: '3.2.4' } } });
  assert.deepEqual(r, { drifted: true, examples: ['node_modules/vitest: lockfile 4.0.1, installed 3.2.4'] });
});

test('a required package the lockfile names but nobody installed has drifted', () => {
  assert.equal(installDrift(lock, { packages: {} }).examples[0], 'node_modules/vitest: not installed');
});

test('no hidden lockfile at all (never installed with npm) has drifted', () => {
  assert.equal(installDrift(lock, null).drifted, true);
});
