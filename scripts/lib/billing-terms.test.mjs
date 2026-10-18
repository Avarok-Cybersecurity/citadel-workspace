/**
 * The billing terms renderer: every value from the policy, nothing assumed when one is missing,
 * and a second rendering changes nothing. Runs against the committed policy and terms.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBlocks, applyEffectiveDate } from './billing-terms-blocks.mjs';
import { billingTermsBlocks, effectiveDate } from './billing-terms-wording.mjs';
import { renderBillingTerms } from './billing-terms.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const policy = () => JSON.parse(read('billing/policy.json'));

function without(path) {
  const p = policy();
  const keys = path.split('.');
  const parent = keys.slice(0, -1).reduce((o, k) => o[k], p);
  delete parent[keys.at(-1)];
  return p;
}

const REQUIRED = [
  'dunning.grace_days', 'dunning.reminder_days', 'dunning.final_warning_hours',
  'overage_billing.termination_ttl_hours', 'overage_billing.terminated_service', 'overage_billing.terminated_service.storage',
  'overage_billing.data_deleted_on_termination', 'alerts.usage_percent', 'terms.change_notice', 'terms.effective_date',
];

for (const path of REQUIRED) {
  test(`a policy without ${path} is refused, not defaulted`, () => {
    assert.throws(() => billingTermsBlocks(without(path)), new RegExp(path.split('.').at(-1)));
  });
}

test('every number and sentence in the blocks is the policy\'s', () => {
  const p = policy();
  p.dunning.grace_days = 45;
  p.dunning.reminder_days = [3, 9];
  p.overage_billing.termination_ttl_hours = 12;
  p.alerts.usage_percent = [70, 95];
  p.terms.change_notice = 'A changed notice.';
  p.overage_billing.terminated_service.storage = 'A changed storage sentence.';
  const { customer, platform } = billingTermsBlocks(p);
  assert.match(customer.payment, /45 days after the failure/);
  assert.match(customer.payment, /3 and 9 days after it/);
  assert.match(customer.payment, /terminated 12 hours after/);
  assert.match(customer.payment, /70% and 95%/);
  assert.match(customer.payment, /A changed notice\./);
  assert.match(platform.suspension, /A changed storage sentence\./);
  assert.match(platform.changes, /A changed notice\./);
});

test('a dimension the terms cannot name, or deletion on termination, is refused', () => {
  const extra = policy();
  extra.overage_billing.terminated_service.bandwidth = 'New.';
  assert.throws(() => billingTermsBlocks(extra), /unnamed \["bandwidth"\]/);
  const deleting = policy();
  deleting.overage_billing.data_deleted_on_termination = true;
  assert.throws(() => billingTermsBlocks(deleting), /no wording for deleting data/);
});

test('the effective date is a real calendar date, written out', () => {
  const p = policy();
  for (const bad of ['2026-02-30', '18 October 2026', '', 20261018]) {
    p.terms.effective_date = bad;
    assert.throws(() => effectiveDate(p), /calendar date/);
  }
  p.terms.effective_date = '2027-01-05';
  assert.equal(effectiveDate(p), 'January 5, 2027');
});

test('a missing, unclosed or unexpected marker is refused', () => {
  const text = 'a\n<!-- billing-policy:begin x -->\nold\n<!-- billing-policy:end x -->\nb';
  assert.equal(applyBlocks(text, { x: 'new' }, 'doc'), 'a\n<!-- billing-policy:begin x -->\nnew\n<!-- billing-policy:end x -->\nb');
  assert.throws(() => applyBlocks(text, { x: 'n', y: 'n' }, 'doc'), /no billing-policy marker for block\(s\) y/);
  assert.throws(() => applyBlocks(text, {}, 'doc'), /x have no rendering/);
  assert.throws(() => applyBlocks('<!-- billing-policy:begin x -->\n', { x: 'n' }, 'doc'), /never ends/);
  assert.throws(() => applyEffectiveDate('no header', 'May 1, 2026', 'doc'), /exactly one/);
});

test('rendering the committed terms twice changes nothing', () => {
  const once = renderBillingTerms(read);
  const files = new Map(once.map((r) => [r.path, r.after]));
  const twice = renderBillingTerms((path) => files.get(path) ?? read(path));
  for (const r of twice) assert.equal(r.after, r.before, r.path);
});
