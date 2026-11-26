import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prerequisiteProblem, UI_PREREQUISITES } from './prerequisites.mjs';

const UI = '/r/citadel-workspaces';
const none = () => false;
const all = () => true;

test('a check that builds against the UI, with the clients not built, is refused up front naming each missing path and the bootstrap', () => {
  const why = prerequisiteProblem({ checks: [{ cmd: 'npx', cwd: UI }], uiDirs: [UI], exists: none });
  for (const p of UI_PREREQUISITES) assert.ok(why.includes(p.path), p.path);
  assert.match(why, /scripts\/bootstrap\.sh/);
  assert.match(prerequisiteProblem({ checks: [{ cmd: 'node', cwd: '/r', relevance: { browser: true } }], uiDirs: [UI], exists: none }), /1 check/);
});

test('nothing is refused when no check that will run needs them, or when they are all there', () => {
  assert.equal(prerequisiteProblem({ checks: [{ cmd: 'node', cwd: UI, relevance: { browser: false } }, { cmd: 'cargo', cwd: '/r' }], uiDirs: [UI], exists: none }), null);
  assert.equal(prerequisiteProblem({ checks: [{ cmd: 'npx', cwd: UI }], uiDirs: [UI], exists: all }), null);
});
