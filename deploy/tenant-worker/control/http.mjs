/**
 * Configuration, responses and request reading for the control plane.
 */

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export const refuse = (error, detail, status) => json({ error, detail }, status);

function required(env, name) {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

/** A var that is exactly "on" or "off": anything else is a misconfiguration, not a default. */
function onOff(env, name) {
  const value = required(env, name);
  if (value !== "on" && value !== "off") throw new Error(`${name} is on or off`);
  return value === "on";
}

/** Whether `request` asks to become a WebSocket (the only thing a tenant host answers). */
export const isWebSocketUpgrade = (request) => (request.headers.get("upgrade") ?? "").toLowerCase() === "websocket";

/** A tenant host serves one thing, the workspace's WebSocket; anything else is told only that. */
export const upgradeRequired = () =>
  new Response("a workspace is reached over a WebSocket", {
    status: 426,
    headers: { upgrade: "websocket", "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

/** A var that must be declared but may be empty (an empty meta tag is a real setting). */
function declared(env, name) {
  const value = env[name];
  if (typeof value !== "string") throw new Error(`${name} is not set (it may be empty)`);
  return value;
}

/** The page's own shape check (citadel-workspaces resolve-url.ts LOOPBACK_ORIGIN_SHAPE). */
const LOOPBACK_ORIGIN_SHAPE = /^wss:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?:[0-9]{1,5}$/;
/** docker/ui/16-validate-runtime-vars.sh: a host or IP, optionally :port. */
const SERVER_ADDRESS_SHAPE = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(:[0-9]{1,5})?$/;

function uiConfig(env) {
  const loopbackAgent = required(env, "LOOPBACK_AGENT_ORIGIN");
  // It goes into the CSP and a meta tag verbatim; a value the page rejects is silently ignored.
  if (!LOOPBACK_ORIGIN_SHAPE.test(loopbackAgent)) throw new Error("LOOPBACK_AGENT_ORIGIN is a bare wss://host:port");
  const defaultServer = declared(env, "DEFAULT_WORKSPACE_SERVER");
  if (defaultServer !== "" && !SERVER_ADDRESS_SHAPE.test(defaultServer)) {
    throw new Error("DEFAULT_WORKSPACE_SERVER is a host[:port] or empty");
  }
  return { loopbackAgent, defaultServer };
}

const optional = (env, name) => (env[name] === undefined || env[name] === "" ? null : env[name]);

/**
 * Cloudflare Realtime TURN (control/ice.mjs): the key's id and API token are secrets, and
 * without both no relay credentials are minted (members are told so); the credentials' lifetime
 * is a var, required whether or not the secrets are set.
 */
export function turnConfig(env) {
  const ttl = Number(required(env, "TURN_CREDENTIAL_TTL_SECONDS"));
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) throw new Error("TURN_CREDENTIAL_TTL_SECONDS is an integer from 60 to 86400");
  const keyId = optional(env, "TURN_KEY_ID");
  const token = optional(env, "TURN_KEY_API_TOKEN");
  if (keyId === null || token === null) {
    if (keyId !== token) console.warn("[tenant] only one of TURN_KEY_ID and TURN_KEY_API_TOKEN is set: no relay credentials are minted");
    return null;
  }
  return { keyId, token, ttl };
}

/**
 * What this deployment is, from `env`. Vars (wrangler.toml) are required: the Worker refuses to
 * run without them. Secrets are optional: a route whose secret is missing answers 503.
 */
export function config(env) {
  const pendingTtl = Number(required(env, "CHECKOUT_TTL_SECONDS"));
  // Stripe accepts a Checkout expiry between 30 minutes and 24 hours from creation.
  if (!Number.isInteger(pendingTtl) || pendingTtl < 1800 || pendingTtl > 86400) {
    throw new Error("CHECKOUT_TTL_SECONDS is an integer from 1800 to 86400");
  }
  return {
    controlHost: required(env, "CONTROL_HOST"),
    publicOrigin: required(env, "PUBLIC_ORIGIN"),
    allowedOrigins: required(env, "ALLOWED_ORIGINS").split(",").map((o) => o.trim()).filter(Boolean),
    pathRouting: onOff(env, "TENANT_PATH_ROUTING"),
    // A tenant's object answers a plain GET with its stats (connections, row counts,
    // entitlements, a claim-code fingerprint) only when this is on: for the local proofs, never
    // in production, where a tenant host answers WebSocket upgrades and nothing else.
    diagnostics: onOff(env, "TENANT_DIAGNOSTICS"),
    ui: uiConfig(env),
    checkoutTtl: pendingTtl,
    turnstile: optional(env, "TURNSTILE_SECRET")
      ? { secret: env.TURNSTILE_SECRET, hostnames: required(env, "TURNSTILE_HOSTNAMES") }
      : null,
    stripeKey: optional(env, "STRIPE_SECRET_KEY"),
    webhookSecret: optional(env, "STRIPE_WEBHOOK_SECRET"),
    // The customer portal configuration (bpc_...) to open. Never Stripe's default: the Stripe
    // account is shared with another product, whose default portal would then be shown to
    // Citadel customers. Unset, the portal route answers 503.
    portalConfiguration: optional(env, "STRIPE_PORTAL_CONFIGURATION"),
  };
}

/** The body as text, refused past `limit` bytes whatever the Content-Length claims. */
export async function readText(request, limit) {
  const claimed = Number(request.headers.get("content-length") ?? "0");
  if (claimed > limit) return { error: refuse("too-large", `bodies here are at most ${limit} bytes`, 413) };
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > limit) return { error: refuse("too-large", `bodies here are at most ${limit} bytes`, 413) };
  return { text: new TextDecoder().decode(bytes) };
}

/**
 * A same-origin JSON body: the browser's Origin must be one of ours (a form or a page elsewhere
 * cannot post here), the type JSON, the size small, the value an object.
 */
export async function readJson(request, cfg, limit) {
  const origin = request.headers.get("origin");
  if (!origin || !cfg.allowedOrigins.includes(origin)) {
    return { error: refuse("cross-origin", "this API answers its own site only", 403) };
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { error: refuse("malformed-request", "the body is JSON", 415) };
  }
  const read = await readText(request, limit);
  if (read.error) return read;
  try {
    const value = JSON.parse(read.text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return { value };
  } catch {
    return { error: refuse("malformed-request", "the body is one JSON object", 400) };
  }
}
