import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveContexts, mergeBlockers } from './merge-blockers.mjs';

const rule = (over = {}) => ({
  required_status_checks: { strict: false, contexts: ['GitGuardian Security Checks', 'fmt'] },
  ...over,
});
const facts = (over = {}) => ({
  protection: rule(),
  codeowners: null,
  declared: ['fmt', 'GitGuardian Security Checks'],
  produced: new Set(['fmt']),
  external: ['GitGuardian Security Checks'],
  ...over,
});

test('a rule every PR can satisfy predicts no blocker', () => {
  assert.deepEqual(mergeBlockers(facts()), { live: ['GitGuardian Security Checks', 'fmt'], blockers: [], warnings: [] });
});

test('a required check nothing produces blocks, and so does a declared list that drifted', () => {
  const protection = rule({ required_status_checks: { contexts: ['fmt', 'tests (ubuntu-latest)'] } });
  const { blockers } = mergeBlockers(facts({ protection }));
  assert.match(blockers[0], /"tests \(ubuntu-latest\)" is produced by no pull_request job/);
  assert.match(blockers[1], /live only: tests \(ubuntu-latest\); declared only: GitGuardian Security Checks/);
});

test('code owner reviews with a CODEOWNERS file block; without owners they do not', () => {
  const protection = rule({ required_pull_request_reviews: { require_code_owner_reviews: true, required_approving_review_count: 0 } });
  assert.match(mergeBlockers(facts({ protection, codeowners: '# owners\n* @tbraun96\n' })).blockers[0], /\* @tbraun96/);
  assert.deepEqual(mergeBlockers(facts({ protection, codeowners: '# nobody\n' })).blockers, []);
});

test('required approvals block; strict only warns', () => {
  const protection = rule({
    required_status_checks: { strict: true, contexts: ['GitGuardian Security Checks', 'fmt'] },
    required_pull_request_reviews: { required_approving_review_count: 1 },
  });
  const d = mergeBlockers(facts({ protection }));
  assert.match(d.blockers.join('\n'), /1 approving review\(s\) required/);
  assert.match(d.warnings.join('\n'), /up to date/);
});

test('a repository the JSON does not list is judged on reviews only', () => {
  const d = mergeBlockers(facts({ declared: null, produced: null, protection: rule({ required_status_checks: { contexts: ['anything'] } }) }));
  assert.deepEqual(d.blockers, []);
});

test('both protection shapes are read', () => {
  assert.deepEqual(liveContexts({ required_status_checks: { checks: [{ context: 'b' }], contexts: ['a'] } }), ['a', 'b']);
  assert.deepEqual(liveContexts({}), []);
});
