/**
 * Relay (TURN) credentials for a tenant's members, minted from Cloudflare Realtime TURN.
 *
 * The workspace kernel inside the object decides who may ask (an enrolled member, not a guest);
 * it calls `mint(memberId)` through the host object the object passes it (server-wasm ice.rs).
 * This decides whether to mint and does it: the long-lived key's API token is used here and
 * nowhere else, and only the short-lived credentials it buys go back to the kernel, which sends
 * them over the member's encrypted session.
 *
 * Each answer is `{ice_servers, expires_at}` or `{unavailable: reason}`. Declining is never an
 * exception: an unset key, a plan whose relay is used up, and a member asking too often are all
 * answers the member's agent handles by connecting without a relay.
 */
import { isPaid, METERING } from "./plans.mjs";
import { UNAVAILABLE } from "./ice-reasons.mjs";

export const turnEndpoint = (keyId) =>
  `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;

/** Per member, over a sliding hour. A cached answer is not a mint and does not count. */
export const MINTS_PER_HOUR = 30;
const HOUR_MS = 3600 * 1000;
/** A member's credentials are handed out again until this fraction of their lifetime has passed. */
export const REFRESH_AT = 0.8;

export { UNAVAILABLE };

/**
 * Whether the tenant's plan still grants relay: a free plan has only what it includes and is
 * barred once that is used; a paid one is billed for relay beyond it (control/monitor.mjs).
 */
export function relayAllowed(limits, bytesIn) {
  if (isPaid(limits.tier)) return true;
  return bytesIn < limits.relay_gb_included * METERING.gb_bytes;
}

/** Cloudflare's answer as the kernel's `IceServer` list, or null for a shape it does not have. */
function iceServersOf(body) {
  const list = body?.iceServers;
  if (!Array.isArray(list) || list.length === 0) return null;
  const servers = [];
  for (const s of list) {
    const urls = typeof s?.urls === "string" ? [s.urls] : s?.urls;
    if (!Array.isArray(urls) || urls.length === 0 || !urls.every((u) => typeof u === "string")) return null;
    const text = (v) => (typeof v === "string" ? v : null);
    servers.push({ urls, username: text(s.username), credential: text(s.credential) });
  }
  return servers;
}

export class IceMinter {
  /**
   * `turn`: `{keyId, token, ttl}` from http.mjs `turnConfig`, or null when unset.
   * `io`: `{fetch, nowMs}`. `tenant()`: `{limits, bytesIn}`, the object's enforced entitlements
   * and this period's metered relay, read when a mint is asked for.
   */
  constructor(turn, io, tenant) {
    this.turn = turn;
    this.io = io;
    this.tenant = tenant;
    this.cache = new Map();
    this.mints = new Map();
  }

  async mint(memberId) {
    if (this.turn === null) return { unavailable: UNAVAILABLE.notConfigured };
    const { limits, bytesIn } = this.tenant();
    if (!relayAllowed(limits, bytesIn)) return { unavailable: UNAVAILABLE.relayUsed };
    const now = this.io.nowMs();
    this.#prune(now);
    const cached = this.cache.get(memberId);
    if (cached && now < cached.refreshAt) return cached.answer;
    const recent = this.mints.get(memberId) ?? [];
    if (recent.length >= MINTS_PER_HOUR) return { unavailable: UNAVAILABLE.rateLimited };
    this.mints.set(memberId, [...recent, now]);

    const iceServers = await this.#generate();
    if (iceServers === null) return { unavailable: UNAVAILABLE.failed };
    const answer = { ice_servers: iceServers, expires_at: Math.floor(now / 1000) + this.turn.ttl };
    this.cache.set(memberId, { answer, refreshAt: now + this.turn.ttl * 1000 * REFRESH_AT, expiresAt: now + this.turn.ttl * 1000 });
    return answer;
  }

  async #generate() {
    const { keyId, token, ttl } = this.turn;
    let response;
    try {
      response = await this.io.fetch(turnEndpoint(keyId), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl }),
      });
    } catch (e) {
      console.error(`[tenant] TURN credential request failed: ${e?.message ?? e}`);
      return null;
    }
    const body = await response.json().catch(() => null);
    const servers = response.ok ? iceServersOf(body) : null;
    if (servers === null) console.error(`[tenant] TURN credential request answered ${response.status} with no usable iceServers`);
    return servers;
  }

  /** Forgets expired credentials and mints older than the window, so neither map grows. */
  #prune(now) {
    for (const [member, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(member);
    for (const [member, times] of this.mints) {
      const kept = times.filter((t) => now - t < HOUR_MS);
      if (kept.length) this.mints.set(member, kept);
      else this.mints.delete(member);
    }
  }
}
