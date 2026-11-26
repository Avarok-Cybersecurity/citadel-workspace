import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootVitestRefusal } from './root-vitest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a vitest run started at the repository root is refused, naming where each suite runs', () => {
  const why = rootVitestRefusal({ cwd: '/r', root: '/r' });
  assert.match(why, /integration suites/);
  assert.match(why, /cd citadel-workspaces && npx vitest run/);
});

test('a run anywhere else that walks up to the root config gets the empty config it had before', () => {
  assert.equal(rootVitestRefusal({ cwd: '/r/citadel-workspace-client-ts', root: '/r' }), null);
});

test('loading the root config from the root throws, and from elsewhere exports an empty config (no test runner started)', () => {
  const load = (cwd) => execFileSync(process.execPath, ['--input-type=module', '-e',
    `import(${JSON.stringify(join(ROOT, 'vitest.config.mjs'))}).then((m) => console.log(JSON.stringify(m.default)), (e) => { console.log('THREW ' + e.message.split('\\n')[0]); })`],
    { cwd, encoding: 'utf8' }).trim();
  assert.match(load(ROOT), /^THREW vitest at the repository root/);
  assert.equal(load(join(ROOT, 'scripts')), '{}');
});
