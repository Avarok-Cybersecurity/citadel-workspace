// The tracking-identifier check's decisions. The sample identifiers are assembled at run
// time so this file never contains one itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, findings, parseExemptions, parseLog } from './tracking-ids.mjs';

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
  assert.deepEqual(findings(parseLog(log), new Set()), [`commit fedcba987654 line 3: ${PREFIX}10`]);
});

const LISTED = 'a'.repeat(40);
const UNLISTED = 'b'.repeat(40);
const sameMessage = (sha) => `${sha}\x00subject\n\nlane ${PREFIX}10\n\x1e\n`;

test('a listed commit is not judged', () => {
  assert.deepEqual(findings(parseLog(sameMessage(LISTED)), parseExemptions(`${LISTED}\n`)), []);
});

test('an unlisted commit with the same message still fails', () => {
  assert.equal(findings(parseLog(sameMessage(UNLISTED)), parseExemptions(`${LISTED}\n`)).length, 1);
});

test('the pull request text is never exempt', () => {
  assert.equal(findings([{ where: 'pull request body', text: `${PREFIX}10` }], parseExemptions(`${LISTED}\n`)).length, 1);
});

test('an exemptions line that is not a full SHA is refused, by number and not by text', () => {
  for (const bad of [`${LISTED.slice(0, 12)}\n`, `${LISTED} lane ${PREFIX}10\n`, `${LISTED.toUpperCase()}\n`, `\n`, `${LISTED}\n\n`]) {
    assert.throws(() => parseExemptions(bad), (e) => /not a full 40-hex commit SHA/.test(e.message) && !e.message.includes(PREFIX));
  }
});

test('an empty list exempts nothing', () => {
  assert.equal(parseExemptions('').size, 0);
});
