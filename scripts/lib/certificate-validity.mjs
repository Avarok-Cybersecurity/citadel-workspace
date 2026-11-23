/**
 * May an agent be built with this certificate? Pure: scripts/verify-agent-certificate.mjs
 * parses the files and passes the facts in.
 *
 * The certificate is compiled into the agent (include_bytes! in the internal service's
 * main.rs), and when it expires every copy of that agent stops serving the page at once. So a
 * build that is PUBLISHED must carry at least 30 days (smoke-agent.sh enforces the same floor on
 * the packaged binary); a build that is not -- a dry run of the release, a PR's agent legs --
 * needs only a certificate valid now.
 *
 * Why the floor is an input: the 30-day rule used to apply to every run, so run 44941697947 (a
 * Release agent DRY run, job certificate) failed "the certificate expires within 30 days" a
 * month before the committed certificate expired, and no dry run could exercise the pipeline
 * until a renewal landed. An EXPIRED certificate still refuses at every floor.
 */

const DAY_MS = 86_400_000;

/** Whole days from now until notAfter, rounded down; negative once it has expired. */
export function daysLeft(notAfterMs, nowMs) {
  if (!Number.isFinite(notAfterMs) || !Number.isFinite(nowMs)) throw new Error('the expiry or the clock is not a time');
  return Math.floor((notAfterMs - nowMs) / DAY_MS);
}

/** A required whole number of days, 0 or more: "0" is valid now, "30" a published build. */
export function parseFloorDays(text) {
  if (typeof text !== 'string' || !/^\d+$/.test(text.trim())) {
    throw new Error(`the floor must be a whole number of days (0 for a build that is not published, 30 for one that is), got ${JSON.stringify(text)}`);
  }
  return Number(text.trim());
}

/**
 * @param {{ notAfterMs: number, nowMs: number, floorDays: number, coversHost: boolean,
 *   keyMatches: boolean, host: string }} facts
 */
export function judgeCertificate({ notAfterMs, nowMs, floorDays, coversHost, keyMatches, host }) {
  if (!Number.isInteger(floorDays) || floorDays < 0) throw new Error(`floor ${floorDays} is not a whole number of days`);
  const left = daysLeft(notAfterMs, nowMs);
  const until = new Date(notAfterMs).toISOString();
  if (!coversHost) return { ok: false, daysLeft: left, reason: `the certificate does not name ${host}` };
  if (!keyMatches) return { ok: false, daysLeft: left, reason: 'the certificate and key do not match' };
  if (notAfterMs <= nowMs) {
    return { ok: false, daysLeft: left, reason: `the certificate EXPIRED at ${until}; renew it (renew-agent-tls.yml merges the renewal)` };
  }
  if (notAfterMs - nowMs < floorDays * DAY_MS) {
    return {
      ok: false,
      daysLeft: left,
      reason: `the certificate expires at ${until}, within the ${floorDays}-day floor for a published build; renew it (renew-agent-tls.yml merges the renewal)`,
    };
  }
  return { ok: true, daysLeft: left, reason: `valid until ${until} (${left} days), floor ${floorDays} days` };
}
