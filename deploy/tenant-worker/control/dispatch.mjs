/**
 * One Worker, two faces. `work.avarok.net` (and any host that is not a tenant's) is the control
 * plane: `/api/*` here, the static UI (ui.mjs, the Worker's assets) otherwise. `<slug>.work.avarok.net` -- and, when
 * TENANT_PATH_ROUTING is on (`wrangler dev`, where there are no subdomains), the path `/<slug>` --
 * is that tenant's Durable Object, reached only while the registry says the tenant is active.
 */
import { checkSlug } from "./slug.mjs";
import { Store } from "./store.mjs";
import { UsageStore } from "./usage-store.mjs";
import { config, isWebSocketUpgrade, json, upgradeRequired, readJson, refuse } from "./http.mjs";
import { createTenant, openPortal, slugAvailability, tenantStatus } from "./tenants.mjs";
import { handleWebhook } from "./webhook.mjs";
import { serveUi } from "./ui.mjs";

/** Creation and portal bodies are a handful of short fields. */
const API_BODY_LIMIT = 4096;

export const objectFor = (env, slug) => env.WORKSPACE.get(env.WORKSPACE.idFromName(slug));

/** The I/O the control plane performs, in one place. */
export function ioFor(env) {
  return {
    fetch: (url, init) => fetch(url, init),
    now: () => Math.floor(Date.now() / 1000),
    store: new Store(env.CONTROL_DB),
    usage: new UsageStore(env.CONTROL_DB),
    tenant: (slug) => objectFor(env, slug),
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
  const tenant = tenantFor(url, cfg);
  if (tenant !== null) return toTenant(io, cfg, tenant, request);
  if (url.pathname.startsWith("/api/")) return api(io, cfg, request, url);
  return serveUi(env.ASSETS, cfg.ui, request);
}

async function toTenant(io, cfg, slug, request) {
  const upgrade = isWebSocketUpgrade(request);
  // Refused before the registry is read, so a plain request learns nothing, not even existence.
  if (!upgrade && !cfg.diagnostics) return upgradeRequired();
  if (!checkSlug(slug).ok) return refuse("not-found", "no such workspace", 404);
  const row = await io.store.holder(slug, io.now());
  if (!row || row.status === "pending") return refuse("not-found", "no such workspace", 404);
  if (row.status === "suspended") return refuse("suspended", "this workspace is suspended", 403);
  const object = io.tenant(slug);
  if (!upgrade) return json(await object.stats());
  return object.fetch(request);
}

async function api(io, cfg, request, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // after "api"
  const method = request.method;
  try {
    if (method === "GET" && parts.length === 2 && parts[0] === "slug") {
      return await slugAvailability(io, decodeURIComponent(parts[1]));
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
    return refuse("not-found", "no such route", 404);
  } catch (e) {
    console.error(`[control] ${method} ${url.pathname} failed: ${e?.stack ?? e}`);
    return json({ error: "internal", detail: "the request failed; nothing was recorded" }, 500);
  }
}
