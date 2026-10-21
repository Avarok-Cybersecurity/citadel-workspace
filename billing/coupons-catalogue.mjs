// The coupon shapes billing/tiers.json `coupons` allows, checked when they load. Pure: no I/O.
// Static codes (in the file) and dynamic ones (issued into D1 by the signed admin tool) are
// checked by the same `checkCoupon`, so past this module there is one coupon shape.

const INTERVALS = ['month', 'year'];
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const TRIAL_CAP_FIELDS = ['max_days', 'members', 'storage_gb', 'connections', 'relay_gb', 'secure_links_per_member', 'secure_links_pool'];
const ALARM_FIELDS = ['relay_gb_per_period', 'storage_gb', 'members'];
/** Stripe's own bound on a trial, and the design's hard cap on a trial template. */
const HARD_MAX_TRIAL_DAYS = 30;
const MAX_REPEATING_MONTHS = 36;
export const MAX_NOTE_LENGTH = 500;

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function exactKeys(what, value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${what} is an object`);
  const allowed = new Set([...required, ...optional]);
  const extra = Object.keys(value).filter((k) => !allowed.has(k) && k !== '$comment');
  if (extra.length) throw new Error(`${what} has unknown fields: ${extra.join(', ')}`);
  const missing = required.filter((k) => !(k in value));
  if (missing.length) throw new Error(`${what} lacks ${missing.join(', ')}`);
}

function subsetOf(what, list, allowed) {
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${what} is a non-empty list`);
  if (new Set(list).size !== list.length) throw new Error(`${what} repeats an entry`);
  const bad = list.filter((x) => !allowed.includes(x));
  if (bad.length) throw new Error(`${what} names ${bad.join(', ')}, which is not one of ${allowed.join(', ')}`);
}

function checkTemplate(t, cat) {
  const what = `coupon template ${t?.id}`;
  if (typeof t?.id !== 'string' || !ID.test(t.id)) throw new Error(`${what}: id is lowercase letters, digits and dashes`);
  if ('trial_days' in t) {
    exactKeys(what, t, ['id', 'trial_days', 'intervals']);
    if (!isInt(t.trial_days, 1, cat.trialCaps.max_days)) throw new Error(`${what}: trial_days is 1 to ${cat.trialCaps.max_days}`);
  } else {
    exactKeys(what, t, ['id', 'discount', 'duration', 'intervals'], ['months']);
    const d = t.discount;
    if (d?.kind === 'percent') {
      exactKeys(`${what} discount`, d, ['kind', 'percent_off']);
      if (!isInt(d.percent_off, 1, 100)) throw new Error(`${what}: percent_off is an integer from 1 to 100`);
    } else if (d?.kind === 'amount') {
      exactKeys(`${what} discount`, d, ['kind', 'amount_off']);
      if (!isInt(d.amount_off, 1, cat.flatMaxCents)) throw new Error(`${what}: amount_off is 1 to ${cat.flatMaxCents} cents`);
    } else {
      throw new Error(`${what}: discount.kind is percent or amount`);
    }
    if (t.duration === 'once') {
      if ('months' in t) throw new Error(`${what}: a once discount has no months`);
    } else if (t.duration === 'repeating') {
      if (!isInt(t.months, 1, MAX_REPEATING_MONTHS)) throw new Error(`${what}: months is 1 to ${MAX_REPEATING_MONTHS}`);
      // Stripe applies duration_in_months to a yearly subscription's first invoice only.
      if (t.intervals?.length !== 1 || t.intervals[0] !== 'month') throw new Error(`${what}: a repeating discount is for intervals ["month"] only`);
    } else {
      throw new Error(`${what}: duration is once or repeating`);
    }
  }
  subsetOf(`${what} intervals`, t.intervals, INTERVALS);
}

function checkGrant(g, tiers) {
  const what = `coupon grant ${g?.id}`;
  exactKeys(what, g, ['id', 'tier_as', 'seats', 'storage_gb', 'unmetered_relay', 'unlimited', 'alarm']);
  if (typeof g.id !== 'string' || !ID.test(g.id)) throw new Error(`${what}: id is lowercase letters, digits and dashes`);
  const tier = tiers.get(g.tier_as);
  if (!tier || tier.prices.length === 0) throw new Error(`${what}: tier_as is a paid tier`);
  if (!isInt(g.seats, 1, tier.limits.members)) throw new Error(`${what}: seats is 1 to ${g.tier_as}'s ${tier.limits.members}`);
  const storageCeiling = tier.limits.storage_gb_per_seat * g.seats;
  if (!isInt(g.storage_gb, 1, storageCeiling)) throw new Error(`${what}: storage_gb is 1 to ${storageCeiling} (${g.tier_as} at ${g.seats} seats)`);
  if (typeof g.unmetered_relay !== 'boolean') throw new Error(`${what}: unmetered_relay is true or false`);
  if (typeof g.unlimited !== 'boolean') throw new Error(`${what}: unlimited is true or false`);
  if (g.unlimited && !g.unmetered_relay) throw new Error(`${what}: an unlimited grant's relay is unmetered`);
  exactKeys(`${what} alarm`, g.alarm, ALARM_FIELDS);
  for (const k of ALARM_FIELDS) {
    if (g.alarm[k] !== null && !isInt(g.alarm[k], 1, Number.MAX_SAFE_INTEGER)) throw new Error(`${what}: alarm.${k} is a positive integer or null`);
  }
}

/**
 * Checks one coupon -- a static entry after `fromStatic`, or a dynamic one as issued -- against the
 * catalogue: `{code, template, grant_id, available_on, intervals, max_redemptions, redeem_by_ms}`,
 * every field required (template xor grant_id, the other null; redeem_by_ms null for never).
 * `allowUnlimited` is false for static codes: the file is public, so it may name no unlimited grant.
 */
export function checkCoupon(c, cat, { allowUnlimited }) {
  const what = `coupon ${c?.code}`;
  exactKeys(what, c, ['code', 'template', 'grant_id', 'available_on', 'intervals', 'max_redemptions', 'redeem_by_ms']);
  if (typeof c.code !== 'string' || !cat.codeShape.test(c.code)) throw new Error(`${what}: the code does not match code_shape`);
  if ((c.template === null) === (c.grant_id === null)) throw new Error(`${what}: names exactly one of template and grant_id`);
  let intervals = INTERVALS;
  if (c.template !== null) {
    const t = cat.templates.get(c.template);
    if (!t) throw new Error(`${what}: no template ${c.template}`);
    intervals = t.intervals;
  } else {
    const g = cat.grants.get(c.grant_id);
    if (!g) throw new Error(`${what}: no grant ${c.grant_id}`);
    if (g.unlimited && !allowUnlimited) throw new Error(`${what}: a static code may not name the unlimited grant ${g.id}`);
    if (g.unlimited && c.redeem_by_ms === null) throw new Error(`${what}: a code for an unlimited grant needs redeem_by_ms`);
  }
  // The free tier takes no coupon: only paid tiers are offered.
  subsetOf(`${what} available_on`, c.available_on, cat.paidTiers);
  subsetOf(`${what} intervals`, c.intervals, intervals);
  if (!isInt(c.max_redemptions, 1, 1_000_000)) throw new Error(`${what}: max_redemptions is 1 to 1000000`);
  if (c.redeem_by_ms !== null && !isInt(c.redeem_by_ms, 1, 8.64e15)) throw new Error(`${what}: redeem_by_ms is Unix milliseconds or null`);
}

/** A tiers.json static entry in the shape `checkCoupon` takes. */
function fromStatic(s) {
  exactKeys(`static coupon ${s?.code}`, s, ['code', 'available_on', 'intervals', 'max_redemptions', 'redeem_by'], ['template', 'grant_id']);
  const redeemBy = s.redeem_by === null ? null : Date.parse(s.redeem_by);
  if (redeemBy !== null && (typeof s.redeem_by !== 'string' || !Number.isFinite(redeemBy))) {
    throw new Error(`static coupon ${s.code}: redeem_by is an ISO 8601 instant or null`);
  }
  return {
    code: s.code, template: s.template ?? null, grant_id: s.grant_id ?? null, available_on: s.available_on, intervals: s.intervals,
    max_redemptions: s.max_redemptions, redeem_by_ms: redeemBy,
  };
}

/**
 * The checked `coupons` block: `{codeShape, flatMaxCents, trialCaps, templates, grants, paidTiers,
 * statics}`, frozen. Throws on the first rule it breaks, so a bad tiers.json never loads.
 */
export function couponCatalogue(table) {
  const c = table.coupons;
  exactKeys('tiers.json coupons', c, ['code_shape', 'flat_max_cents', 'trial_caps', 'templates', 'grants', 'static']);
  if (typeof c.code_shape !== 'string' || !c.code_shape.startsWith('^') || !c.code_shape.endsWith('$')) {
    throw new Error('coupons.code_shape is an anchored regular expression');
  }
  if (!isInt(c.flat_max_cents, 1, 1_000_000)) throw new Error('coupons.flat_max_cents is a positive integer of cents');
  exactKeys('coupons.trial_caps', c.trial_caps, TRIAL_CAP_FIELDS);
  if (!isInt(c.trial_caps.max_days, 1, HARD_MAX_TRIAL_DAYS)) throw new Error(`coupons.trial_caps.max_days is 1 to ${HARD_MAX_TRIAL_DAYS}`);
  for (const k of TRIAL_CAP_FIELDS) if (!isInt(c.trial_caps[k], 0, 1_000_000)) throw new Error(`coupons.trial_caps.${k} is a count`);
  const tiers = new Map(table.tiers.map((t) => [t.id, t]));
  const cat = {
    codeShape: new RegExp(c.code_shape),
    flatMaxCents: c.flat_max_cents,
    trialCaps: Object.freeze({ ...c.trial_caps }),
    paidTiers: table.tiers.filter((t) => t.prices.length > 0).map((t) => t.id),
    templates: new Map(),
    grants: new Map(),
  };
  for (const t of c.templates) {
    checkTemplate(t, cat);
    if (cat.templates.has(t.id)) throw new Error(`duplicate coupon template ${t.id}`);
    cat.templates.set(t.id, Object.freeze(structuredClone(t)));
  }
  for (const g of c.grants) {
    checkGrant(g, tiers);
    if (cat.grants.has(g.id) || cat.templates.has(g.id)) throw new Error(`duplicate coupon template or grant id ${g.id}`);
    cat.grants.set(g.id, Object.freeze(structuredClone(g)));
  }
  const codes = new Set();
  cat.statics = Object.freeze(c.static.map((s) => {
    const coupon = fromStatic(s);
    checkCoupon(coupon, cat, { allowUnlimited: false });
    if (codes.has(coupon.code)) throw new Error(`duplicate static coupon ${coupon.code}`);
    codes.add(coupon.code);
    return Object.freeze(coupon);
  }));
  return Object.freeze(cat);
}

/** JSON with every object's keys sorted, so the same template always hashes the same. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => k !== '$comment').sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The Stripe coupon id of a discount template, content-addressed: a template whose content
 * changes gets a new id. `sha256Hex(text)` resolves to the hex digest (node:crypto in the
 * catalogue script, WebCrypto in the Worker), so both compute the same id with no lookup.
 */
export async function stripeCouponId(template, sha256Hex) {
  return `citadel-coupon-${template.id}-${(await sha256Hex(canonicalJson(template))).slice(0, 8)}`;
}
