/**
 * The billing paragraphs of the Customer Terms and the Terms of Use, worded from
 * billing/policy.json and from nothing else: every number and every per-service sentence is read
 * from the policy, and a missing or malformed key throws instead of rendering a guess (PCND).
 * Pure: the policy object in, the block texts out. scripts/render-billing-terms.mjs does the I/O.
 */

/** How the terms name each service a quota pays for. Must name exactly the policy's dimensions. */
const SERVICE_NAME = Object.freeze({
  'relay-overage': 'Relay',
  'document-appends': 'Document appends',
  storage: 'Storage',
});

function at(policy, path) {
  let value = policy;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      throw new Error(`billing/policy.json has no ${path}; the terms cannot be worded without it`);
    }
    value = value[key];
  }
  return value;
}

function count(policy, path) {
  const value = at(policy, path);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`billing/policy.json ${path} must be a positive integer, not ${JSON.stringify(value)}`);
  return value;
}

function sentence(policy, path) {
  const value = at(policy, path);
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`billing/policy.json ${path} must be a sentence, not ${JSON.stringify(value)}`);
  return value.trim();
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `terms.effective_date` (an ISO calendar date) as the documents state it: "October 18, 2026". */
export function effectiveDate(policy) {
  const value = at(policy, 'terms.effective_date');
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const date = m === null ? null : new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (date === null || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`billing/policy.json terms.effective_date must be a calendar date, YYYY-MM-DD, not ${JSON.stringify(value)}`);
  }
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function flag(policy, path) {
  const value = at(policy, path);
  if (typeof value !== 'boolean') throw new Error(`billing/policy.json ${path} must be true or false, not ${JSON.stringify(value)}`);
  return value;
}

function ascending(policy, path, { min, below }) {
  const value = at(policy, path);
  const ok = Array.isArray(value) && value.length > 0
    && value.every((v, i) => Number.isInteger(v) && v >= min && v < below && (i === 0 || v > value[i - 1]));
  if (!ok) throw new Error(`billing/policy.json ${path} must be ascending integers from ${min} and below ${below}, not ${JSON.stringify(value)}`);
  return value;
}

/** "a", "a and b", "a, b, and c". */
function series(items) {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

const hours = (n) => `${n} hour${n === 1 ? '' : 's'}`;
const days = (n) => `${n} day${n === 1 ? '' : 's'}`;

function reminderSchedule(reminderDays) {
  const later = reminderDays.filter((d) => d > 0);
  const after = later.length === 0 ? [] : [`${series(later.map(String))} days after it`];
  return series([...(reminderDays[0] === 0 ? ['on the day of the failure'] : []), ...after]);
}

/** One sub-bullet per terminated service, in the policy's order, indented `indent` spaces. */
function services(policy, indent) {
  const sentences = at(policy, 'overage_billing.terminated_service');
  const keys = Object.keys(sentences).filter((k) => !k.startsWith('$'));
  const named = Object.keys(SERVICE_NAME);
  const unnamed = keys.filter((k) => !named.includes(k));
  const absent = named.filter((k) => !keys.includes(k));
  if (unnamed.length || absent.length) {
    throw new Error(`overage_billing.terminated_service and the terms' service names disagree: unnamed ${JSON.stringify(unnamed)}, absent ${JSON.stringify(absent)}`);
  }
  return keys.map((key) => {
    const sentence = sentences[key];
    if (typeof sentence !== 'string' || sentence.trim() === '') throw new Error(`overage_billing.terminated_service.${key} must be a sentence`);
    return `${' '.repeat(indent)}- **${SERVICE_NAME[key]}.** ${sentence.trim()}`;
  });
}

function noDeletion(policy) {
  if (flag(policy, 'overage_billing.data_deleted_on_termination')) {
    throw new Error('overage_billing.data_deleted_on_termination is true, and the terms have no wording for deleting data on termination; write it before rendering');
  }
}

/** Read every value the blocks use, so a missing key fails before anything is written. */
export function billingTermsValues(policy) {
  noDeletion(policy);
  const graceDays = count(policy, 'dunning.grace_days');
  return {
    graceDays,
    reminderDays: ascending(policy, 'dunning.reminder_days', { min: 0, below: graceDays }),
    finalWarningHours: count(policy, 'dunning.final_warning_hours'),
    ttlHours: count(policy, 'overage_billing.termination_ttl_hours'),
    usagePercent: ascending(policy, 'alerts.usage_percent', { min: 1, below: 101 }),
    changeNotice: sentence(policy, 'terms.change_notice'),
  };
}

/** The Customer Terms' Section 2 block: failed payment, overage, termination, alerts. */
function customerPayment(policy, v) {
  const lines = [
    `- **Late or failed payment.** If a payment fails, the workspace is paused at once: it refuses connections until the payment is made. Avarok sends reminders to Customer's billing contact ${reminderSchedule(v.reminderDays)}, and a final warning ${hours(v.finalWarningHours)} before deletion. If the payment is still outstanding ${days(v.graceDays)} after the failure, Avarok deletes the workspace's Customer Data stored on the workspace server, and it cannot be recovered. Payment at any time before then restores the workspace at once.`,
    "- **Usage limits, overage, and termination.** Customer chooses, for each paid workspace, whether overage billing is enabled, and may change that choice in the Service.",
    "  - **With overage billing enabled**, usage beyond the plan's included quotas is billed at the rates shown in the Service.",
    `  - **With overage billing disabled**, nothing beyond the included quotas is billed. Instead, the service a quota pays for is terminated ${hours(v.ttlHours)} after the quota is crossed, until the billing period resets. For each service, termination means the following, and where a service's description says otherwise it governs:`,
    ...services(policy, 4),
    '  - **No deletion on termination.** No Customer Data is deleted by a termination under this Section. Customer Data is deleted for non-payment only, as described under "Late or failed payment".',
    `  - **Usage alerts.** Avarok notifies the workspace's Admins when usage reaches ${series(v.usagePercent.map((p) => `${p}%`))} of an included quota, once for each in every billing period.`,
    `- **Changes to these billing rules.** ${v.changeNotice}`,
  ];
  return lines.join('\n');
}

/** The Terms of Use's Section 11 block: what a member meets when the workspace is paused or limited. */
function platformSuspension(policy, v) {
  return [
    "**Your workspace's plan.** What the Service provides in a workspace depends on the Workspace Owner's plan and payments, and these consequences apply to you as a member:",
    '',
    `- **Payment failure.** If the Workspace Owner's payment fails, the workspace is paused: you cannot connect to it until the payment is made. If the payment is still outstanding ${days(v.graceDays)} after the failure, the workspace's data stored on the workspace server is deleted and cannot be recovered.`,
    `- **Usage limits.** If the Workspace Owner has not enabled overage billing, the service a usage quota pays for is terminated ${hours(v.ttlHours)} after the workspace crosses that quota, until the billing period resets. For each service, termination means the following, and where a service's description says otherwise it governs:`,
    ...services(policy, 2),
    '- **No deletion on termination.** No data is deleted by these terminations.',
  ].join('\n');
}

/** The Terms of Use's Section 17 block, a sub-bullet of "Changes". */
function platformChanges(v) {
  return `  - **Billing rules.** ${v.changeNotice}`;
}

/** Every block, by document and block id, and the effective date both documents' headers state. */
export function billingTermsBlocks(policy) {
  const v = billingTermsValues(policy);
  return {
    effective: effectiveDate(policy),
    customer: { payment: customerPayment(policy, v) },
    platform: { suspension: platformSuspension(policy, v), changes: platformChanges(v) },
  };
}
