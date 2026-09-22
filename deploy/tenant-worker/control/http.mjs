/**
 * Configuration, responses and request reading for the control plane.
 */

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const refuse = (error, detail, status) => json({ error, detail }, status);

function required(env, name) {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

const optional = (env, name) => (env[name] === undefined || env[name] === "" ? null : env[name]);

/**
 * What this deployment is, from `env`. Vars (wrangler.toml) are required: the Worker refuses to
 * run without them. Secrets are optional: a route whose secret is missing answers 503.
 */
export function config(env) {
  const routing = required(env, "TENANT_PATH_ROUTING");
  if (routing !== "on" && routing !== "off") throw new Error("TENANT_PATH_ROUTING is on or off");
  const pendingTtl = Number(required(env, "CHECKOUT_TTL_SECONDS"));
  // Stripe accepts a Checkout expiry between 30 minutes and 24 hours from creation.
  if (!Number.isInteger(pendingTtl) || pendingTtl < 1800 || pendingTtl > 86400) {
    throw new Error("CHECKOUT_TTL_SECONDS is an integer from 1800 to 86400");
  }
  return {
    controlHost: required(env, "CONTROL_HOST"),
    publicOrigin: required(env, "PUBLIC_ORIGIN"),
    allowedOrigins: required(env, "ALLOWED_ORIGINS").split(",").map((o) => o.trim()).filter(Boolean),
    pathRouting: routing === "on",
    checkoutTtl: pendingTtl,
    turnstile: optional(env, "TURNSTILE_SECRET")
      ? { secret: env.TURNSTILE_SECRET, hostnames: required(env, "TURNSTILE_HOSTNAMES") }
      : null,
    stripeKey: optional(env, "STRIPE_SECRET_KEY"),
    webhookSecret: optional(env, "STRIPE_WEBHOOK_SECRET"),
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
