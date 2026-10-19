// The owner's approval of billing/pricing-model.json (its `approval` block). Pure: no I/O. Until
// status is "approved", every derived price is computed and reported but never written to
// billing/tiers.json, never applied to Stripe and never repaired at checkout. No default: a missing
// key or any other status throws.
const STATUSES = ['proposed', 'approved'];

/** "proposed" | "approved", or a throw naming what is wrong with the block. */
export function approvalOf(model) {
  const a = model?.approval;
  if (!a || typeof a !== 'object') throw new Error('missing pricing-model.json approval');
  if (!STATUSES.includes(a.status)) throw new Error(`pricing-model.json approval.status is ${STATUSES.join(' | ')}, got ${a.status}`);
  for (const k of ['approved_on', 'approved_by']) {
    if (!(k in a)) throw new Error(`missing pricing-model.json approval.${k} (null is a value)`);
  }
  if (a.status === 'proposed') {
    if (a.approved_on !== null || a.approved_by !== null) throw new Error('pricing-model.json approval: a proposed model has approved_on and approved_by null');
    return a.status;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.approved_on ?? '') || Number.isNaN(Date.parse(a.approved_on))) {
    throw new Error(`pricing-model.json approval.approved_on is the approval date (YYYY-MM-DD), got ${a.approved_on}`);
  }
  if (typeof a.approved_by !== 'string' || !a.approved_by.trim()) throw new Error('pricing-model.json approval.approved_by names who approved');
  return a.status;
}

export const isApproved = (model) => approvalOf(model) === 'approved';

/** Why a write to Stripe (prices, meters, the portal) must not happen, or null when it may. */
export function stripeWriteRefusal(model) {
  if (isApproved(model)) return null;
  return 'refusing to write to Stripe: billing/pricing-model.json approval.status is "proposed". '
    + 'The owner sets it to "approved" (with approved_on and approved_by) once the pricing rows in '
    + 'docs/plans/billing-automation.md are decided; applies happen only from origin/master at deploy.';
}
