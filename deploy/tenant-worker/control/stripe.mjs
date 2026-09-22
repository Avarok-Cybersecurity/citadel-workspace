/**
 * Stripe over fetch (no SDK in a Worker): the API helper, price ids by lookup key, and webhook
 * signature verification (the rMazing `cc-tiers::stripe::verified` rule, over WebCrypto).
 */
import { fromHex } from "./secrets.mjs";

const API = "https://api.stripe.com/v1";
/** Stripe's recommendation against replay: a signature's timestamp within five minutes of now. */
export const TOLERANCE_SECONDS = 300;

export class StripeError extends Error {
  constructor(status, message) {
    super(`stripe answered ${status}: ${message}`);
    this.status = status;
  }
}

/** One Stripe call. `form` is a flat record of Stripe's bracketed form keys. */
export async function stripe(io, key, method, path, form, idempotencyKey) {
  const headers = { authorization: `Bearer ${key}` };
  let url = `${API}${path}`;
  let body;
  if (method === "GET") {
    if (form) url += `?${new URLSearchParams(form)}`;
  } else {
    headers["content-type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    body = new URLSearchParams(form ?? {});
  }
  const response = await io.fetch(url, { method, headers, body });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new StripeError(response.status, answer?.error?.message ?? "unknown");
  return answer;
}

/** Active price ids for `keys` (lookup keys), as a Map; throws naming any key Stripe lacks. */
export async function priceIds(io, key, keys) {
  const form = new URLSearchParams({ active: "true", limit: "100" });
  for (const k of keys) form.append("lookup_keys[]", k);
  const list = await stripe(io, key, "GET", "/prices", form);
  const found = new Map((list.data ?? []).map((p) => [p.lookup_key, p.id]));
  const missing = keys.filter((k) => !found.has(k));
  if (missing.length) throw new Error(`Stripe holds no active price under ${missing.join(", ")}`);
  return found;
}

/**
 * The event, if `header` is Stripe's signature over `payload` under `secret` within tolerance of
 * `now` (seconds); else `{error}`. Refusals in the order a forger learns least from: header shape,
 * then time, then the signature (HMAC verify, constant time), then the body.
 */
export async function verifyWebhook(payload, header, secret, now) {
  let timestamp = null;
  const signatures = [];
  for (const part of String(header ?? "").split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t" && /^\d+$/.test(v)) timestamp = Number(v);
    if (k === "v1") signatures.push(v);
  }
  if (timestamp === null || signatures.length === 0) return { error: "signature-header" };
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) return { error: "signature-stale" };
  const enc = new TextEncoder();
  const mac = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = enc.encode(`${timestamp}.${payload}`);
  let valid = false;
  for (const sig of signatures) {
    const bytes = fromHex(sig);
    if (bytes && bytes.length === 32 && (await crypto.subtle.verify("HMAC", mac, bytes, signed))) valid = true;
  }
  if (!valid) return { error: "signature-invalid" };
  try {
    return { event: JSON.parse(payload) };
  } catch {
    return { error: "event-unreadable" };
  }
}
