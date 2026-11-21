// The tracking-identifier check's decisions. The sample identifiers are assembled at run
// time so this file never contains one itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, findings, parseLog } from './tracking-ids.mjs';

const PREFIX = 'S' + 'A-';
const GH_PREFIX = 'GH' + 'SA-';

test('public algorithm names pass', () => {
  assert.deepEqual(scan(`sign with ML-D${PREFIX}65 (MlDsa65); D${PREFIX}65 too`), []);
});

test('an identifier fails, naming its line', () => {
  assert.deepEqual(scan(`fix\n\nlane ${PREFIX}10 done`), [{ n: 3, line: `lane ${PREFIX}10 done` }]);
});

test('an identifier fails in lower case', () => {
  assert.equal(scan(`${PREFIX.toLowerCase()}3: tidy`).length, 1);
});

test('a GH-style identifier fails', () => {
  assert.equal(scan(`see ${GH_PREFIX}abcd-`).length, 1);
});

test('text with no identifier passes', () => {
  assert.deepEqual(scan('fix(agent): close the socket on drop\n\nNothing to see.'), []);
});

test('a finding names the commit and line', () => {
  const log = `0123456789abcdef\x00ok\n\x1e\nfedcba9876543210\x00subject\n\n${PREFIX}10\n\x1e\n`;
  assert.deepEqual(findings(parseLog(log)), [`commit fedcba987654 line 3: ${PREFIX}10`]);
});
