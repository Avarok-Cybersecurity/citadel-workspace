// The shape billing/policy.json must have, checked where it is loaded (the Worker's
// control/policy.mjs, the node tests). Pure: it is handed the parsed file. Every key is required
// and nothing is filled in: a missing or malformed key throws, naming it.

const DIMENSIONS = ['relay-overage', 'document-appends', 'storage'];

const isCount = (v) => Number.isInteger(v) && v >= 0;
const isPositive = (v) => Number.isInteger(v) && v > 0;
const counts = (v) => Array.isArray(v) && v.length > 0 && v.every(isCount);

function need(ok, key, what) {
  if (!ok) throw new Error(`billing/policy.json ${key} is ${what}`);
}

/** `policy`, unchanged, once every key the billing code reads is present and well-formed. */
export function checkPolicy(policy) {
  const o = policy?.overage_billing;
  need(isPositive(o?.termination_ttl_hours), 'overage_billing.termination_ttl_hours', 'a positive integer');
  for (const d of DIMENSIONS) need(typeof o?.terminated_service?.[d] === 'string', `overage_billing.terminated_service.${d}`, 'a sentence');
  need(typeof o?.data_deleted_on_termination === 'boolean', 'overage_billing.data_deleted_on_termination', 'true or false');
  const d = policy?.dunning;
  need(isPositive(d?.grace_days), 'dunning.grace_days', 'a positive integer');
  need(counts(d?.reminder_days), 'dunning.reminder_days', 'a list of whole days');
  need(isPositive(d?.final_warning_hours), 'dunning.final_warning_hours', 'a positive integer');
  const a = policy?.alerts;
  need(counts(a?.usage_percent) && a.usage_percent.length >= 2, 'alerts.usage_percent', 'at least two whole percentages');
  need(a.usage_percent.every((p, i) => i === 0 || p > a.usage_percent[i - 1]), 'alerts.usage_percent', 'ascending');
  need(a?.overage_step_units && typeof a.overage_step_units === 'object', 'alerts.overage_step_units', 'an object');
  for (const [dim, step] of Object.entries(a.overage_step_units)) {
    if (dim === '$comment') continue;
    need(DIMENSIONS.includes(dim), `alerts.overage_step_units.${dim}`, `one of ${DIMENSIONS.join(', ')}`);
    need(isPositive(step), `alerts.overage_step_units.${dim}`, 'a positive integer');
  }
  need(counts(a?.countdown_hours), 'alerts.countdown_hours', 'a list of whole hours');
  // The terms' own keys belong to the terms rendering (builder D); here only that they exist.
  need(policy?.terms && typeof policy.terms === 'object' && Object.keys(withoutComments(policy.terms)).length > 0, 'terms', 'an object of the values the terms render');
  return policy;
}

/** `value` with every `$comment` removed, at any depth: the values a consumer renders. */
export function withoutComments(value) {
  if (Array.isArray(value)) return value.map(withoutComments);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== '$comment').map(([k, v]) => [k, withoutComments(v)]));
}

/** The policy values the UI, the emails and the terms render (GET /api/billing/policy). */
export function publicPolicy(policy) {
  const { overage_billing: o, dunning, alerts, terms } = withoutComments(policy);
  return {
    overage_billing: {
      termination_ttl_hours: o.termination_ttl_hours,
      terminated_service: o.terminated_service,
      data_deleted_on_termination: o.data_deleted_on_termination,
    },
    dunning,
    alerts,
    terms,
  };
}
