/**
 * Which workspace hosts may exist: `<slug>.work.avarok.net`. Pure.
 */

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

/**
 * Names the platform keeps, and every name avarok.net already answers for (a tenant at
 * `<name>.work.avarok.net` would read as that service's).
 */
export const RESERVED = new Set([
  "www", "api", "admin", "app", "local", "status", "mail", "mx", "docs", "blog", "auth",
  "gitlab", "work", "citadel",
  "ares", "activate", "dev-finco", "netdata", "rcon",
]);

/** `protonmail`, `protonmail2`, `protonmail-domainkey`, … : every Proton record avarok.net holds. */
const RESERVED_PREFIXES = ["protonmail"];

/** `{ok: true}` or `{ok: false, reason: "invalid" | "reserved"}`. */
export function checkSlug(slug) {
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) return { ok: false, reason: "invalid" };
  if (RESERVED.has(slug) || RESERVED_PREFIXES.some((p) => slug.startsWith(p))) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true };
}
