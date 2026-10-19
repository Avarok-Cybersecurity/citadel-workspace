/**
 * The rates agent's decisions, pure: fetched pages in, the new billing/rates.json and
 * billing/tiers.json (or nothing) out, with the change log. Every guardrail lives here:
 *
 *   (a) fail closed: any page that failed to fetch or parse refuses the whole run;
 *   (b) no derived price moves more than pricing-model max_change_percent_per_run without
 *       ownerApproved;
 *   (c) no price is written below cost x multiplier, and no list seat price below its floor;
 *   (d) an unchanged run writes nothing (rates keep their fetched_at);
 *   (e) the derived prices and grants are written into tiers.json ONLY when pricing-model.json
 *       approval.status is approved; while proposed, rates.json may still be refreshed, and every
 *       derived figure that differs from tiers.json is reported as a proposal, never written.
 */
import { parseSource } from './parse-rates.mjs';
import { applyDerived, belowCost, derive, driftOf, floorViolations } from '../../billing/derive.mjs';

/** results: [{ source, body } | { source, error }] -> { rateId: { value, unit, source, raw } }. */
export function collectRates(sources, results) {
  const failures = [];
  const out = {};
  for (const source of sources) {
    const r = results.find((x) => x.source.id === source.id);
    if (!r) { failures.push(`${source.id}: not fetched`); continue; }
    if (r.error) { failures.push(`${source.id}: ${r.error.message ?? r.error}`); continue; }
    try {
      const parsed = parseSource(source, r.body);
      for (const rate of source.rates) out[rate.id] = { ...parsed[rate.id], unit: rate.unit, source: source.page };
    } catch (e) {
      failures.push(e.message);
    }
  }
  if (failures.length) throw new Error(`fail closed, nothing written:\n  ${failures.join('\n  ')}`);
  return out;
}

/**
 * { rates, tiers, log, proposals, approval, explanations }: `rates` / `tiers` are the files' new
 * contents, or null when that file must not be written (`tiers` is always null while the model is
 * proposed). `proposals`: one "PROPOSED (not written)" line per derived figure that differs, while
 * proposed. Throws (with every reason) when a guardrail refuses.
 */
export function planUpdate({ oldRates, fetched, model, tiers, ownerApproved, now }) {
  if (typeof ownerApproved !== 'boolean') throw new Error('planUpdate needs ownerApproved: true | false');
  if (typeof now !== 'string' || Number.isNaN(Date.parse(now))) throw new Error('planUpdate needs now as an ISO time');
  const log = [];
  const refusals = [];
  const old = oldRates?.rates;
  if (!old || typeof old !== 'object') throw new Error('billing/rates.json has no rates object');
  for (const id of Object.keys(old)) if (!fetched[id]) refusals.push(`${id}: in rates.json but no source provides it`);
  const merged = {};
  for (const [id, f] of Object.entries(fetched)) {
    const was = old[id];
    if (was && was.value === f.value) { merged[id] = was; continue; }
    merged[id] = { value: f.value, unit: f.unit, source: f.source, raw: f.raw, fetched_at: now };
    log.push(`${id}: ${was ? was.value : '(none)'} → ${f.value} (${f.source})`);
  }
  const ratesChanged = log.length > 0;
  const newRates = { ...oldRates, fetched_at: ratesChanged ? now : oldRates.fetched_at, rates: merged };

  const d = derive({ rates: newRates, model, tiers });
  const drift = driftOf({ rates: newRates, model, tiers });
  for (const { key, tiers: was } of drift) if (was === undefined) throw new Error(`derived ${key} is not listed in tiers.json`);
  const rates = ratesChanged ? newRates : null;
  if (d.approval !== 'approved') {
    if (refusals.length) throw new Error(`refused, nothing written:\n  ${refusals.join('\n  ')}`);
    const proposals = drift.map((x) => `PROPOSED (not written): ${x.key} ${x.tiers} → ${x.derived}`);
    return { rates, tiers: null, log, proposals, approval: d.approval, explanations: d.explanations };
  }
  const max = model?.max_change_percent_per_run?.value;
  if (!(typeof max === 'number' && max > 0)) throw new Error('missing pricing-model.json max_change_percent_per_run.value');
  for (const { key, tiers: was, derived: cents } of drift) {
    const pct = (Math.abs(cents - was) / was) * 100;
    log.push(`${key}: ${was} → ${cents} (derived, ${pct.toFixed(1)}%)`);
    if (pct > max && !ownerApproved) refusals.push(`${key}: ${was} → ${cents} moves ${pct.toFixed(1)}% > ${max}% (re-run with --owner-approved)`);
  }
  const newTiers = applyDerived(tiers, d);
  refusals.push(...belowCost(d.proposed, d.costs), ...floorViolations(newTiers, d.floors, model));
  if (refusals.length) throw new Error(`refused, nothing written:\n  ${refusals.join('\n  ')}`);
  const tiersChanged = JSON.stringify(newTiers) !== JSON.stringify(tiers);
  return { rates, tiers: tiersChanged ? newTiers : null, log, proposals: [], approval: d.approval, explanations: d.explanations };
}
