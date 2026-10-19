// What we charge, derived from what we pay: billing/rates.json (upstream unit costs) x
// billing/pricing-model.json (the owner's multiplier, rounding and choices) -> the DERIVED prices
// in billing/tiers.json, plus each paid tier's seat floor. Pure: no I/O. A missing key fails.
// Every result is a PROPOSAL until pricing-model.json approval.status is approved (approval.mjs):
// only then may anything write it into tiers.json.
import { approvalOf } from './approval.mjs';
import { lookupKey, meteredLookupKey } from './catalogue.mjs';

function need(value, where) {
  if (value === undefined || value === null) throw new Error(`missing ${where}`);
  return value;
}

function positive(value, where) {
  if (typeof need(value, where) !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${where} must be a positive number, got ${value}`);
  }
  return value;
}

function rateOf(rates, id) {
  return positive(need(rates?.rates, 'rates.json rates')[id]?.value, `rates.json rates.${id}.value`);
}

function modelValue(model, key) {
  return need(need(model?.[key], `pricing-model.json ${key}`).value, `pricing-model.json ${key}.value`);
}

/**
 * Round `cents` UP to a multiple of `step`. The quotient is fixed to 9 places first so float noise
 * (0.05 * 3 * 100 = 15.000000000000002) does not ceil a whole step too far.
 */
export function ceilTo(cents, step) {
  positive(step, 'rounding step');
  return Math.ceil(Number((cents / step).toFixed(9))) * step;
}

/** Unit costs in USD, read once from rates.json and the model. */
function costBasis(rates, model, tiers) {
  const gbBytes = positive(tiers?.metering?.gb_bytes, 'tiers.json metering.gb_bytes');
  const rowsUsd = rateOf(rates, 'cloudflare.do.rows_written_usd_per_million') / 1e6;
  const requestUsd = rateOf(rates, 'cloudflare.do.requests_usd_per_million') / 1e6;
  const wsPerRequest = rateOf(rates, 'cloudflare.do.ws_messages_per_request');
  const frameBytes = positive(modelValue(model, 'object_relay_frame_bytes'), 'pricing-model.json object_relay_frame_bytes.value');
  const relayUsdPerGb = {
    turn: () => rateOf(rates, 'cloudflare.turn.usd_per_gb'),
    object: () => (requestUsd / wsPerRequest) * (gbBytes / frameBytes),
  };
  const relay = (path) => {
    const f = relayUsdPerGb[path];
    if (!f) throw new Error(`unknown relay path ${path} (turn | object)`);
    return f();
  };
  const storageRates = {
    do_sqlite: 'cloudflare.do.sqlite_usd_per_gb_month',
    r2: 'cloudflare.r2.storage_usd_per_gb_month',
  };
  const backend = modelValue(model, 'storage_backend');
  if (!storageRates[backend]) throw new Error(`unknown storage_backend ${backend} (do_sqlite | r2)`);
  const rowsPerAppend = positive(modelValue(model, 'rows_written_per_document_append'), 'pricing-model.json rows_written_per_document_append.value');
  return {
    backend,
    storageUsdPerGbMonth: rateOf(rates, storageRates[backend]),
    relay,
    appendUsd: rowsPerAppend * rowsUsd + requestUsd / wsPerRequest,
  };
}

function rounding(model) {
  const r = need(model?.rounding, 'pricing-model.json rounding');
  for (const k of ['metered_cents', 'addon_month_cents', 'seat_month_cents', 'year_months']) positive(r[k], `pricing-model.json rounding.${k}`);
  return r;
}

const usd = (cents) => `$${(cents / 100).toFixed(4)}`;

/** Formulas for entries marked `"derived": true`, by entry id. Each returns { interval: costCents }. */
const ADDON_FORMULAS = {
  storage: (addon, basis) => {
    const gb = positive(addon.grants?.storage_gb, 'add-on storage grants.storage_gb');
    return { cents: gb * basis.storageUsdPerGbMonth * 100, why: `${gb} GB x $${basis.storageUsdPerGbMonth}/GB-month (${basis.backend})` };
  },
};

const METERED_FORMULAS = {
  'relay-overage': (m, basis, model) => {
    const path = modelValue(model, 'relay_cost_path');
    return { cents: basis.relay(path) * 100, why: `1 GB on the ${path} path` };
  },
  'document-appends': (m, basis) => {
    const n = positive(m.quantity_per_unit, `metered ${m.id} quantity_per_unit`);
    return { cents: n * basis.appendUsd * 100, why: `${n} appends x $${basis.appendUsd.toPrecision(5)}/append` };
  },
};

function formula(table, entry, kind) {
  const f = table[entry.id];
  if (!f) throw new Error(`${kind} ${entry.id} is marked derived but derive.mjs has no formula for it`);
  return f;
}

/**
 * Every DERIVED price as `proposed` (lookup key -> cents), the unrounded cost x multiplier behind
 * each (`costs`), each paid tier's seat floor (cents per seat-month), the storage each paid seat
 * includes (`grants`, GB by tier), the model's approval status and one explanation line per figure.
 */
export function derive({ rates, model, tiers }) {
  const approval = approvalOf(model);
  const basis = costBasis(rates, model, tiers);
  const round = rounding(model);
  const mult = positive(modelValue(model, 'multiplier'), 'pricing-model.json multiplier.value');
  const prefix = need(tiers?.lookup_prefix, 'tiers.json lookup_prefix');
  const prices = {};
  const costs = {};
  const floors = {};
  const grants = {};
  const seatStorage = need(model?.seat_storage_gb, 'pricing-model.json seat_storage_gb');
  const explanations = [];
  const put = (key, cost, step, why) => {
    prices[key] = ceilTo(cost, step);
    costs[key] = cost;
    explanations.push(`${key}: ${why} x ${mult} = ${cost.toFixed(4)}¢ -> ${prices[key]}¢ (up to ${step}¢)`);
  };
  const putMonthYear = (id, monthCost, why) => {
    const month = lookupKey(prefix, id, 'month');
    put(month, monthCost, round.addon_month_cents, why);
    const year = lookupKey(prefix, id, 'year');
    prices[year] = prices[month] * round.year_months;
    costs[year] = monthCost * round.year_months;
    explanations.push(`${year}: ${round.year_months} x ${month} = ${prices[year]}¢`);
  };
  for (const addon of need(tiers.addons, 'tiers.json addons').filter((a) => a.derived === true)) {
    const { cents, why } = formula(ADDON_FORMULAS, addon, 'add-on')(addon, basis, model);
    const intervals = addon.prices.map((p) => p.interval).sort().join(',');
    if (intervals !== 'month,year') throw new Error(`derived add-on ${addon.id} sells month and year, got ${intervals}`);
    putMonthYear(addon.id, cents * mult, why);
  }
  for (const m of need(tiers.metered, 'tiers.json metered').filter((e) => e.derived === true)) {
    const { cents, why } = formula(METERED_FORMULAS, m, 'metered')(m, basis, model);
    put(meteredLookupKey(prefix, m.id), cents * mult, round.metered_cents, why);
  }
  const floorPath = modelValue(model, 'seat_floor_relay_path');
  const seatMode = modelValue(model, 'seat_prices');
  if (!['list', 'derived'].includes(seatMode)) throw new Error(`pricing-model.json seat_prices is list | derived, got ${seatMode}`);
  for (const tier of need(tiers.tiers, 'tiers.json tiers').filter((t) => t.prices.length > 0)) {
    const l = tier.limits;
    const storageGb = positive(seatStorage[tier.id], `pricing-model.json seat_storage_gb.${tier.id}`);
    grants[tier.id] = storageGb;
    const relayGb = need(l.relay_gb_per_seat, `tier ${tier.id} limits.relay_gb_per_seat`);
    const appends = need(l.document_appends_per_seat, `tier ${tier.id} limits.document_appends_per_seat`);
    const seatUsd = storageGb * basis.storageUsdPerGbMonth + relayGb * basis.relay(floorPath) + appends * basis.appendUsd;
    const cost = seatUsd * 100 * mult;
    floors[tier.id] = ceilTo(cost, round.seat_month_cents);
    explanations.push(`floor ${tier.id}: (${storageGb} GB + ${relayGb} relay GB on ${floorPath} + ${appends} appends = ${usd(seatUsd * 100)}) x ${mult} -> ${floors[tier.id]}¢/seat-month`);
    if (seatMode === 'derived') {
      const intervals = tier.prices.map((p) => p.interval).sort().join(',');
      if (intervals !== 'month,year') throw new Error(`tier ${tier.id} sells month and year, got ${intervals}`);
      for (const interval of ['month', 'year']) {
        const n = interval === 'year' ? round.year_months : 1;
        prices[lookupKey(prefix, tier.id, interval)] = floors[tier.id] * n;
        costs[lookupKey(prefix, tier.id, interval)] = cost * n;
      }
    }
  }
  return { approval, proposed: prices, costs, floors, grants, explanations };
}

/** Every licensed price in `tiers` priced under its seat floor (month) or ten floors (year). */
export function floorViolations(tiers, floors, model) {
  const yearMonths = rounding(model).year_months;
  const out = [];
  for (const tier of tiers.tiers.filter((t) => t.prices.length > 0)) {
    const floor = need(floors[tier.id], `seat floor for ${tier.id}`);
    for (const p of tier.prices) {
      const min = p.interval === 'year' ? floor * yearMonths : floor;
      if (p.unit_amount < min) out.push(`${tier.id}/${p.interval} ${p.unit_amount}¢ < floor ${min}¢`);
    }
  }
  return out;
}

/**
 * Every derived price below its unrounded cost x multiplier. Empty by construction; a guard. The
 * cost is fixed to 9 places, as in ceilTo, so 0.07 x 3 x 100 = 21.000000000000004 is 21.
 */
export function belowCost(prices, costs) {
  return Object.entries(costs).filter(([k, c]) => !(prices[k] >= Number(c.toFixed(9)))).map(([k, c]) => `${k}: ${prices[k]}¢ < cost x multiplier ${c.toFixed(4)}¢`);
}

/** Lookup key -> the price object in `tiers` for every price it lists, sold or proposed. */
function slotsOf(tiers) {
  const slots = new Map();
  const prefix = need(tiers?.lookup_prefix, 'tiers.json lookup_prefix');
  for (const e of [...tiers.tiers, ...tiers.addons]) for (const p of e.prices) slots.set(lookupKey(prefix, e.id, p.interval), p);
  for (const m of tiers.metered) for (const p of m.prices) slots.set(meteredLookupKey(prefix, m.id), p);
  return slots;
}

/** Lookup key -> unit_amount for every price tiers.json lists, whatever its status. */
export function amountsOf(tiers) {
  return Object.fromEntries([...slotsOf(tiers)].map(([key, p]) => [key, p.unit_amount]));
}

const GRANT_LIMIT = 'storage_gb_per_seat';

/**
 * `tiers` with every derived price (`proposed`) and seat grant (`grants`) written in. Both are
 * required; a key or tier that names no entry is refused, not dropped.
 */
export function applyDerived(tiers, { proposed, grants }) {
  if (!proposed || !grants) throw new Error('applyDerived needs { proposed, grants } from derive()');
  const out = structuredClone(tiers);
  const slots = slotsOf(out);
  for (const [key, cents] of Object.entries(proposed)) {
    const slot = slots.get(key);
    if (!slot) throw new Error(`derived price ${key} names no entry in tiers.json`);
    slot.unit_amount = cents;
  }
  for (const [id, gb] of Object.entries(grants)) {
    const tier = out.tiers.find((t) => t.id === id);
    if (!tier) throw new Error(`derived grant for ${id} names no tier in tiers.json`);
    tier.limits[GRANT_LIMIT] = gb;
  }
  return out;
}

/**
 * Every derived figure whose tiers.json value differs from the computation:
 * [{ key, tiers, derived }]. Empty once an approved model has been written in.
 */
export function driftOf({ rates, model, tiers }) {
  const d = derive({ rates, model, tiers });
  const have = amountsOf(tiers);
  const out = Object.entries(d.proposed).filter(([key, cents]) => have[key] !== cents).map(([key, cents]) => ({ key, tiers: have[key], derived: cents }));
  for (const [id, gb] of Object.entries(d.grants)) {
    const was = tiers.tiers.find((t) => t.id === id).limits[GRANT_LIMIT];
    if (was !== gb) out.push({ key: `${id} limits.${GRANT_LIMIT}`, tiers: was, derived: gb });
  }
  return out;
}
