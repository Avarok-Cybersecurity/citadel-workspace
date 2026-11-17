/**
 * The names a tenant's server answers to (its kernel's `[identity]`): `<slug>.<CONTROL_HOST>` until
 * a custom domain is attached, which then becomes canonical while every name before it joins
 * `former_domains`, so accounts registered under the slug host keep signing in and
 * `/.well-known/citadel` is served on both hosts. The registry row (D1 `custom_domain`,
 * `former_domains`) is the record; the object is handed the result (Provisioning).
 *
 * The kernel checks the names again at start (`[identity]` refuses a non-canonical one); these
 * checks keep a name it would refuse out of the registry in the first place.
 */

/** The most former domains the document may list (the kernel's MAX_FORMER_DOMAINS, C0's maxItems). */
export const MAX_FORMER_DOMAINS = 16;

/** A bare lowercase DNS name of at least two labels: no port, no path, no trailing dot. */
const CUSTOM_DOMAIN_SHAPE = /^(?=.{1,190}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** The tenant's host under the control plane: the canonical domain until a custom one is attached. */
export const slugHost = (cfg, slug) => `${slug}.${cfg.controlHost}`;

/** The identity a newly created tenant is provisioned with. */
export const createdIdentity = (cfg, slug) => ({ canonical_domain: slugHost(cfg, slug), former_domains: [] });

/** The identity a registry row describes. */
export function identityOf(cfg, row) {
  const former = JSON.parse(row.former_domains);
  return { canonical_domain: row.custom_domain ?? slugHost(cfg, row.slug), former_domains: former };
}

/** `identity` as provisioning stores it, or a refusal naming what is wrong. */
export function checkedIdentity(identity) {
  const { canonical_domain, former_domains } = identity ?? {};
  if (typeof canonical_domain !== "string" || canonical_domain === "") {
    throw new Error("provisioning needs identity.canonical_domain: the name the workspace's server answers to");
  }
  if (!Array.isArray(former_domains) || !former_domains.every((d) => typeof d === "string")) {
    throw new Error("provisioning needs identity.former_domains: the names it answered to before, or []");
  }
  if (former_domains.length > MAX_FORMER_DOMAINS) throw new Error(`at most ${MAX_FORMER_DOMAINS} former domains are published`);
  return { canonical_domain, former_domains: [...former_domains] };
}

/**
 * `{ok: true, identity}` after attaching `domain` to a tenant whose identity is `current`, or
 * `{ok: false, reason}`. The control plane's own names are never a tenant's custom domain.
 */
export function attached(cfg, current, domain) {
  if (typeof domain !== "string" || !CUSTOM_DOMAIN_SHAPE.test(domain)) return { ok: false, reason: "invalid-domain" };
  if (domain === cfg.controlHost || domain.endsWith(`.${cfg.controlHost}`)) return { ok: false, reason: "reserved-domain" };
  if (domain === current.canonical_domain) return { ok: false, reason: "already-canonical" };
  const former = [current.canonical_domain, ...current.former_domains].filter((d, i, all) => d !== domain && all.indexOf(d) === i);
  if (former.length > MAX_FORMER_DOMAINS) return { ok: false, reason: "too-many-former-domains" };
  return { ok: true, identity: { canonical_domain: domain, former_domains: former } };
}

/**
 * Attaches `domain` to the active tenant `slug`: the registry first (a domain another tenant holds
 * is refused there), then the tenant's object. Routing the domain's traffic to this Worker (a
 * Cloudflare custom hostname) is the operator's step, not this one's.
 */
export async function attachCustomDomain(io, cfg, slug, domain) {
  const row = await io.store.holder(slug, io.now());
  if (!row || row.status !== "active") return { ok: false, reason: "not-found" };
  const next = attached(cfg, identityOf(cfg, row), domain);
  if (!next.ok) return next;
  const stored = await io.store.setDomains(slug, row.tenant_id, domain, next.identity.former_domains);
  if (!stored) return { ok: false, reason: "domain-taken" };
  await io.tenant(slug).setDomains(next.identity);
  return next;
}
