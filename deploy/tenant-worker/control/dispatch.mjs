/**
 * One Worker, two faces. `work.avarok.net` (and any host that is not a tenant's) is the control
 * plane: `/api/*` here, the static UI (ui.mjs, the Worker's assets) otherwise. `<slug>.work.avarok.net` -- and, when
 * TENANT_PATH_ROUTING is on (`wrangler dev`, where there are no subdomains), the path `/<slug>` --
 * is that tenant's Durable Object, reached only while the registry says the tenant is active. So
 * is a tenant's custom domain (control/tenant-domains.mjs): any host that is neither, found in the
 * registry. A tenant host answers its WebSocket and `GET /.well-known/citadel` (discovery.mjs).
 */
import { Store } from "./store.mjs";
import { UsageStore } from "./usage-store.mjs";
import { AuthVersionStore } from "./auth-versions.mjs";
import { config, isWebSocketUpgrade, json, upgradeRequired, readJson, refuse } from "./http.mjs";
import { createTenant, openPortal, slugAvailability, tenantStatus } from "./tenants.mjs";
import { handleWebhook } from "./webhook.mjs";
import { admissionAnywhere, admissionOf, reachable, WELL_KNOWN_PATH, wellKnownOf } from "./discovery.mjs";
import { slugHost } from "./tenant-domains.mjs";
import { serveUi } from "./ui.mjs";
import { serveSupport, supportRoute } from "./support.mjs";
import { SupportStore } from "./support-store.mjs";
import { verifyAdminRequest, verifySupportRequest } from "./support-verifier.mjs";
import { CouponStore } from "./coupon-store.mjs";
import { previewCoupon } from "./coupons.mjs";
import { couponAdminRoute, serveCouponAdmin } from "./coupon-admin.mjs";

/** Creation and portal bodies are a handful of short fields. */
const API_BODY_LIMIT = 4096;

export const objectFor = (env, slug) => env.WORKSPACE.get(env.WORKSPACE.idFromName(slug));

/** The I/O the control plane performs, in one place. */
export function ioFor(env) {
  return {
    fetch: (url, init) => fetch(url, init),
    now: () => Math.floor(Date.now() / 1000),
    nowMs: () => Date.now(),
    store: new Store(env.CONTROL_DB),
    usage: new UsageStore(env.CONTROL_DB),
    authVersions: new AuthVersionStore(env.CONTROL_DB),
    tenant: (slug) => objectFor(env, slug),
    support: new SupportStore(env.CONTROL_DB),
    verifySupport: verifySupportRequest,
    coupons: new CouponStore(env.CONTROL_DB),
    verifyAdmin: verifyAdminRequest,
  };
}

/** Which tenant a request is for, or null when it is for the control plane. */
export function tenantFor(url, cfg) {
  const host = url.hostname.toLowerCase();
  const suffix = `.${cfg.controlHost}`;
  if (host.endsWith(suffix)) return host.slice(0, -suffix.length);
  if (cfg.pathRouting && !url.pathname.startsWith("/api/")) {
    const segment = url.pathname.split("/").filter(Boolean)[0];
    if (segment !== undefined) return segment;
  }
  return null;
}

export async function dispatch(request, env) {
  const cfg = config(env);
  const url = new URL(request.url);
  const io = ioFor(env);
  const tenant = await routeOf(io, cfg, url);
  if (tenant !== null) return toTenant(io, cfg, tenant, request);
  if (url.pathname.startsWith("/api/")) return api(io, cfg, request, url);
  return serveUi(env.ASSETS, cfg.ui, request);
}

/**
 * The tenant a request is for and the path within its host, or null for the control plane: its
 * subdomain, then its custom domain, then (TENANT_PATH_ROUTING) the path `/<slug>`.
 */
async function routeOf(io, cfg, url) {
  const host = url.hostname.toLowerCase();
  if (host !== cfg.controlHost && !host.endsWith(`.${cfg.controlHost}`)) {
    const slug = await io.store.slugForDomain(host);
    if (slug !== null) return { slug, path: url.pathname };
  }
  const slug = tenantFor(url, cfg);
  if (slug === null) return null;
  const byPath = !host.endsWith(`.${cfg.controlHost}`);
  return { slug, path: byPath ? url.pathname.slice(slug.length + 1) || "/" : url.pathname };
}

async function toTenant(io, cfg, { slug, path }, request) {
  if (request.method === "GET" && path === WELL_KNOWN_PATH) return wellKnownOf(io, slug);
  const upgrade = isWebSocketUpgrade(request);
  // Refused before the registry is read, so a plain request learns nothing, not even existence.
  if (!upgrade && !cfg.diagnostics) return upgradeRequired();
  const { row, refusal } = await reachable(io, slug);
  if (refusal) return refusal;
  const object = io.tenant(slug);
  // Objects provisioned before names were passed on hold none; D1 has it (see adoptDisplayName).
  if (row.display_name) await object.adoptDisplayName(row.display_name);
  if (!upgrade) return json(await object.stats());
  // The object knows its tenant by the host it is reached at (tenantFor); a custom domain is
  // handed over as the tenant's own host.
  const own = new URL(request.url);
  if (tenantFor(own, cfg) !== slug) own.hostname = slugHost(cfg, slug);
  return object.fetch(own.href === request.url ? request : new Request(own, request));
}

async function api(io, cfg, request, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // after "api"
  const method = request.method;
  try {
    if (method === "GET" && parts.length === 2 && parts[0] === "slug") {
      return await slugAvailability(io, decodeURIComponent(parts[1]));
    }
    if (method === "GET" && parts.length === 1 && parts[0] === "admission") return admissionAnywhere(cfg);
    if (method === "GET" && parts.length === 2 && parts[0] === "admission") {
      return await admissionOf(io, cfg, decodeURIComponent(parts[1]));
    }
    if (method === "POST" && parts.length === 1 && parts[0] === "tenants") {
      const body = await readJson(request, cfg, API_BODY_LIMIT);
      if (body.error) return body.error;
      return await createTenant(io, cfg, body.value, request.headers.get("cf-connecting-ip"));
    }
    if (method === "GET" && parts.length === 3 && parts[0] === "tenants" && parts[2] === "status") {
      return await tenantStatus(io, cfg, parts[1], url.searchParams.get("session_id"));
    }
    if (method === "POST" && parts.length === 3 && parts[0] === "tenants" && parts[2] === "portal") {
      const body = await readJson(request, cfg, API_BODY_LIMIT);
      if (body.error) return body.error;
      return await openPortal(io, cfg, parts[1], body.value);
    }
    if (method === "POST" && parts.length === 2 && parts[0] === "stripe" && parts[1] === "webhook") {
      return await handleWebhook(io, cfg, request);
    }
    if (method === "POST" && parts.length === 2 && parts[0] === "coupons" && parts[1] === "preview") {
      const body = await readJson(request, cfg, API_BODY_LIMIT);
      if (body.error) return body.error;
      return await previewCoupon(io, body.value, request.headers.get("cf-connecting-ip"));
    }
    const support = supportRoute(method, parts);
    if (support !== null) return await serveSupport(io, cfg, request, support);
    const admin = couponAdminRoute(method, parts);
    if (admin !== null) return await serveCouponAdmin(io, cfg, request, admin);
    return refuse("not-found", "no such route", 404);
  } catch (e) {
    console.error(`[control] ${method} ${url.pathname} failed: ${e?.stack ?? e}`);
    return json({ error: "internal", detail: "the request failed; nothing was recorded" }, 500);
  }
}
