// Which usage alerts are due (docs/plans/billing-automation.md G4). Pure: the policy, the
// dimension's measurements and the keys already sent this period are handed in, and the keys
// to announce now come back; the caller sends and records them (control/alerts.mjs).
//
// Three families of key, every number from billing/policy.json `alerts`:
//   percent:<p>    p of usage_percent reached, of the included quota;
//   overage:<n>    with overage billing on, the nth overage_step_units[dimension] beyond it;
//   countdown:<h>  with it off, h of countdown_hours or fewer left before the termination
//                  (countdown:0 is the termination itself).
// Within a family only the most advanced key reached is announced, and only if no key at least
// as advanced was sent: usage that leaps past two thresholds between runs is one email, not two,
// and a lower threshold reached later (it cannot be, within a period) would not repeat it.

const HOUR_MS = 3600 * 1000;

/** The used share of the included quota, in percent; a zero quota is all used once anything is. */
export function percentOf(used, included) {
  if (included > 0) return (used / included) * 100; // not-policy: a ratio expressed in percent
  return used > 0 ? Infinity : 0;
}

/** Whether `used` has reached the included quota: the crossing a termination counts from. */
export const quotaReached = (used, included) => (included > 0 ? used >= included : used > 0);

const valueOf = (key) => Number(key.slice(key.indexOf(':') + 1));
const familyOf = (key) => key.slice(0, key.indexOf(':'));

/** The most advanced of `reached` (by `rank`, larger is further) unless `sent` covers it. */
function mostAdvanced(family, reached, sent, rank) {
  if (reached.length === 0) return [];
  const top = reached.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  const covered = [...sent].some((k) => familyOf(k) === family && rank(valueOf(k)) >= rank(top));
  return covered ? [] : [`${family}:${top}`];
}

/**
 * The threshold keys to announce now for one dimension. `now` and `terminate_at` are ms;
 * `state` and `terminate_at` are the object's (control/termination.mjs); `sent` is a Set of
 * the keys recorded this period for this dimension.
 */
export function dueAlerts({ policy, dimension, used, included, overage_billing, state, terminate_at, now, sent }) {
  if (!(sent instanceof Set)) throw new Error('dueAlerts needs the keys already sent, as a Set');
  const { usage_percent, overage_step_units, countdown_hours } = policy.alerts;
  const percent = percentOf(used, included);
  const due = mostAdvanced('percent', usage_percent.filter((p) => percent >= p), sent, (p) => p);
  if (overage_billing) {
    const step = overage_step_units[dimension];
    if (step !== undefined && quotaReached(used, included)) {
      const steps = Math.floor((used - included) / step);
      due.push(...mostAdvanced('overage', steps >= 1 ? [steps] : [], sent, (n) => n));
    }
    return due;
  }
  if (state === 'terminating' || state === 'terminated') {
    if (!Number.isFinite(terminate_at)) throw new Error(`a ${state} ${dimension} has no terminate_at`);
    const left = state === 'terminated' ? 0 : Math.max(0, (terminate_at - now) / HOUR_MS);
    due.push(...mostAdvanced('countdown', countdown_hours.filter((h) => left <= h), sent, (h) => -h));
  }
  return due;
}
