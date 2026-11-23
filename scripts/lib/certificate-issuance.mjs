/**
 * When may CI ask Let's Encrypt for the agent's certificate? Pure: the facts (days each
 * certificate has left, the configured floors) come from scripts/agent-certificate-decision.mjs.
 *
 * Let's Encrypt issues at most FIVE certificates a week for one exact set of names, and
 * local.avarok.net is one name. The release used to issue on every real release, so in one week
 * deploy runs 44018601504, 44000280048, 44404950812, 44543719941, 44939018558, 44958340345,
 * 44968283960 and 45018182270 each spent one -- several of them re-runs of a release that had
 * failed for an unrelated reason -- plus renew-agent-tls run 43869130576. Deploy run 45073729582
 * (master efd13076) was then refused ("too many certificates (5) already issued") and the release
 * stopped. Every one of those certificates was valid for 90 days; each was thrown away with its
 * runner.
 *
 * So issuance is a fallback, decided here, never a default:
 *
 *   release (the agent-certificate action)
 *     use-committed  committed >= floor + margin: the binary leaves with more than the floor
 *     use-cached     a certificate an earlier release issued for this committed one still has
 *                    floor + margin: a re-run, or the next release, reuses it
 *     issue          neither has: the renewal has fallen behind; issue once, and cache it
 *     refuse         a dry run (not a real release) whose committed certificate misses the floor;
 *                    a dry run never issues
 *
 *   renewal (renew-agent-tls.yml)
 *     nothing         committed >= renew-below, and not forced
 *     propose-pending bot/tls-renewal already holds one with >= renew-below: re-open its PR, and
 *                     do not issue again while that PR is unmerged
 *     renew           due, and nothing pending is fresh enough: issue
 */

const isDays = (n) => Number.isInteger(n);
const isWholeDays = (n) => Number.isInteger(n) && n >= 0;

/** A required whole number of days from a CLI flag or env var; no default (PCND). */
export function parseDays(text, what) {
  if (typeof text !== 'string' || !/^\d+$/.test(text.trim())) {
    throw new Error(`${what} must be a whole number of days, got ${JSON.stringify(text)}`);
  }
  return Number(text.trim());
}

/** "true" or "false" exactly: a missing or misspelt flag must not read as either. */
export function parseBoolean(text, what) {
  if (text === 'true') return true;
  if (text === 'false') return false;
  throw new Error(`${what} must be "true" or "false", got ${JSON.stringify(text)}`);
}

/**
 * @param {{ committedDaysLeft: number, cachedDaysLeft: number | null, floorDays: number,
 *   marginDays: number, realRelease: boolean }} facts
 * @returns {{ action: 'use-committed' | 'use-cached' | 'issue' | 'refuse', reason: string }}
 */
export function releaseIssuance({ committedDaysLeft, cachedDaysLeft, floorDays, marginDays, realRelease }) {
  if (!isDays(committedDaysLeft)) throw new Error(`committed days left ${committedDaysLeft} is not a whole number`);
  if (cachedDaysLeft !== null && !isDays(cachedDaysLeft)) throw new Error(`cached days left ${cachedDaysLeft} is not a whole number or null`);
  if (!isWholeDays(floorDays)) throw new Error(`floor ${floorDays} is not a whole number of days`);
  if (!isWholeDays(marginDays)) throw new Error(`margin ${marginDays} is not a whole number of days`);
  if (typeof realRelease !== 'boolean') throw new Error(`whether this is a real release was not decided (${realRelease})`);
  if (!realRelease) {
    if (committedDaysLeft >= floorDays) return { action: 'use-committed', reason: `a dry run builds with the committed certificate (${committedDaysLeft} days, floor ${floorDays})` };
    return { action: 'refuse', reason: `the committed certificate has ${committedDaysLeft} days, under the ${floorDays}-day floor, and a dry run never issues: merge the renewal (renew-agent-tls.yml)` };
  }
  const need = floorDays + marginDays;
  if (committedDaysLeft >= need) {
    return { action: 'use-committed', reason: `the committed certificate has ${committedDaysLeft} days, at least the floor ${floorDays} + margin ${marginDays}` };
  }
  if (cachedDaysLeft !== null && cachedDaysLeft >= need) {
    return { action: 'use-cached', reason: `the committed certificate has ${committedDaysLeft} days (< ${need}); reusing the one an earlier release issued, with ${cachedDaysLeft}` };
  }
  const cached = cachedDaysLeft === null ? 'none is cached' : `the cached one has ${cachedDaysLeft}`;
  return { action: 'issue', reason: `the committed certificate has ${committedDaysLeft} days (< ${need}) and ${cached}: issuing ONE, cached for every later run until the renewal lands` };
}

/**
 * @param {{ committedDaysLeft: number, pendingDaysLeft: number | null, renewBelowDays: number,
 *   force: boolean }} facts  pendingDaysLeft: the certificate on bot/tls-renewal, null if no branch
 * @returns {{ action: 'nothing' | 'propose-pending' | 'renew', reason: string }}
 */
export function renewalIssuance({ committedDaysLeft, pendingDaysLeft, renewBelowDays, force }) {
  if (!isDays(committedDaysLeft)) throw new Error(`committed days left ${committedDaysLeft} is not a whole number`);
  if (pendingDaysLeft !== null && !isDays(pendingDaysLeft)) throw new Error(`pending days left ${pendingDaysLeft} is not a whole number or null`);
  if (!isWholeDays(renewBelowDays) || renewBelowDays === 0) throw new Error(`renew-below ${renewBelowDays} is not a positive whole number of days`);
  if (typeof force !== 'boolean') throw new Error(`force was not decided (${force})`);
  if (!force && committedDaysLeft >= renewBelowDays) {
    return { action: 'nothing', reason: `the committed certificate has ${committedDaysLeft} days (renews under ${renewBelowDays})` };
  }
  if (pendingDaysLeft !== null && pendingDaysLeft >= renewBelowDays) {
    return { action: 'propose-pending', reason: `bot/tls-renewal already holds a certificate with ${pendingDaysLeft} days: re-proposing it, not issuing again` };
  }
  const pending = pendingDaysLeft === null ? 'nothing is pending' : `the pending one has only ${pendingDaysLeft}`;
  const why = force ? 'forced' : `the committed certificate has ${committedDaysLeft} days (< ${renewBelowDays})`;
  return { action: 'renew', reason: `${why} and ${pending}: issuing` };
}
