import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectChecks } from './change-tiers.mjs';
import { uiTestReadsIn } from './preflight-derived.mjs';
import { readsPath, uiTestReads } from './ui-test-reads.mjs';

const ui = 'citadel-workspaces';
const tree = new Set(['billing/tiers.json', 'docs/contracts/batch-1116', 'docs/contracts/batch-1116/identity-kat.json',
  'citadel-internal-service/sdk/corpus.json', 'citadel-workspaces/src/lib/x.ts']);
const exists = (p) => tree.has(p);
const file = (path, source) => ({ path, source });

test('a path a test reads from its own file, from citadel-workspaces/ or from the root is found', () => {
  const reads = uiTestReads({ ui, exists, files: [
    file('citadel-workspaces/src/lib/onboarding/__tests__/t.test.ts', "resolve(__dirname, '../../../../../billing/tiers.json')"),
    file('citadel-workspaces/src/a.test.ts', "resolve(process.cwd(), '../citadel-internal-service/sdk/corpus.json')"),
    file('citadel-workspaces/src/b.test.ts', "const REPO = resolve(process.cwd(), '..'); join(REPO, `docs/contracts/batch-1116`)"),
  ] });
  assert.deepEqual(reads, ['billing/tiers.json', 'citadel-internal-service/sdk/corpus.json', 'docs/contracts/batch-1116']);
});

test('paths inside the UI, paths that do not exist, URLs and a path inside another found path are left out', () => {
  const reads = uiTestReads({ ui, exists, files: [
    file('citadel-workspaces/src/c.test.ts', "'../lib/x.ts' 'docs/nope/x.json' 'https://billing.stripe.com/p/x' 'docs/contracts/batch-1116' '../docs/contracts/batch-1116/identity-kat.json'"),
  ] });
  assert.deepEqual(reads, ['docs/contracts/batch-1116']);
});

test('a check with reads is selected at pre-push by a change to one of them, never at pre-commit', () => {
  const unit = { name: 'unit tests', tiers: new Set(['ui']), reads: ['billing/tiers.json', 'docs/contracts/batch-1116'] };
  const names = (hook, paths) => selectChecks([unit], hook, paths, []).map((c) => c.name);
  assert.deepEqual(names('pre-push', ['docs/contracts/batch-1116/fixtures/a.json']), ['unit tests']);
  assert.deepEqual(names('pre-push', ['billing/tiers.json']), ['unit tests']);
  assert.deepEqual(names('pre-push', ['docs/TESTING.md', 'billing/tiers.json.bak']), []);
  assert.deepEqual(names('pre-commit', ['billing/tiers.json']), []);
  assert.equal(readsPath(['docs/contracts'], 'docs/contracts-old/x'), false);
});

test('in this repository the UI tests read parent paths, each outside citadel-workspaces/', () => {
  const reads = uiTestReadsIn(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  assert.ok(reads.length > 0, 'derived nothing: the scan of the UI test sources found no parent path');
  for (const r of reads) assert.ok(!r.startsWith(`${ui}/`) && !r.startsWith('..'), r);
});
