/**
 * Real git repositories in a temp directory for the stamp tests: no mocks. A parent with the UI as
 * a real submodule, a built dist/, a harness, an installed playwright, a tracked lockfile and an
 * agent workspace directory (keyed on its own: preflight-world-io.mjs, isAgentInput).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorld } from './preflight-world-io.mjs';

export const ENV = { PATH: '/usr/bin:/bin', SWEEP_PORT: '4199' };
export const sh = (cwd, ...args) => execFileSync('git', ['-c', 'protocol.file.allow=always', '-c', 'commit.gpgsign=false',
  '-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
export const put = (path, text) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };

/** A parent with the UI as a real submodule, a built dist/, a harness and an installed playwright. */
export function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'stamp-'));
  const ui = join(base, 'ui-origin');
  put(join(ui, 'package.json'), '{"name":"ui","devDependencies":{"playwright":"*"}}');
  put(join(ui, 'scripts', 'check-a11y.mjs'), "import { go } from './lib/harness.mjs';\ngo();\n");
  put(join(ui, 'scripts', 'lib', 'harness.mjs'), "import { chromium } from 'playwright';\nexport const go = () => chromium;\n");
  put(join(ui, 'scripts', 'check-static.mjs'), "import { readFileSync } from 'node:fs';\n");
  // Inputs no import closure would find: a config the gate reads, a script it only spawns, a module it imports dynamically.
  put(join(ui, 'vite.config.ts'), 'export default {};\n');
  put(join(ui, 'scripts', 'lib', 'spawned.mjs'), 'process.exit(0);\n');
  put(join(ui, 'scripts', 'lib', 'dynamic.mjs'), 'export const x = 1;\n');
  put(join(ui, '.gitignore'), 'dist\nnode_modules\n');
  sh(ui, 'init', '-q'); sh(ui, 'add', '.'); sh(ui, 'commit', '-qm', 'ui');
  const root = join(base, 'parent');
  put(join(root, 'package.json'), '{"name":"parent","devDependencies":{"playwright":"*"}}');
  put(join(root, '.gitignore'), 'node_modules\n');
  put(join(root, 'package-lock.json'), '{"lockfileVersion":3}');
  put(join(root, 'citadel-internal-service', 'src', 'lib.rs'), 'pub fn f() {}\n');
  sh(root, 'init', '-q'); sh(root, 'submodule', 'add', '-q', ui, 'citadel-workspaces'); sh(root, 'add', '.'); sh(root, 'commit', '-qm', 'p');
  put(join(root, 'citadel-workspaces', 'dist', 'index.html'), '<html>built</html>');
  put(join(root, 'node_modules', 'playwright', 'package.json'), '{"version":"1.57.0"}');
  put(join(root, 'node_modules', 'playwright-core', 'package.json'), '{"version":"1.57.0"}');
  put(join(root, 'node_modules', 'playwright-core', 'browsers.json'), '{"browsers":[{"name":"chromium","revision":"1200"}]}');
  return { base, root, done: () => rmSync(base, { recursive: true, force: true }) };
}

export const digest = (root, env = ENV) => {
  const w = readWorld(root, env);
  assert.ok('digest' in w, JSON.stringify(w));
  return w.digest;
};

