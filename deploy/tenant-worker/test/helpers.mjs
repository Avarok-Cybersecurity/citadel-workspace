/**
 * Shared test plumbing. The one mock in this suite is at the fetch boundary: Turnstile's
 * siteverify and Stripe's API are third-party services a test cannot reach deterministically (and
 * must not charge), so `outbound()` answers them in-process. Everything on this side of `fetch` --
 * routing, validation, D1, the tenant's Durable Object and its wasm server -- is the real Worker.
 */
import { env, SELF } from "cloudflare:test";
import { vi } from "vitest";
import { signLikeStripe } from "./stripe-sign.mjs";

export const ORIGIN = "https://work.avarok.net";
export const WEBHOOK_SECRET = "whsec_vitest_only";

let counter = 0;
/** A slug no other test uses: tests share one D1 file. */
export const freshSlug = (stem = "t") => `${stem}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const PRICES = {
  "citadel-team-month": "price_team_m",
  "citadel-team-year": "price_team_y",
  "citadel-business-month": "price_business_m",
  "citadel-business-year": "price_business_y",
  "citadel-storage-month": "price_storage_m",
  "citadel-storage-year": "price_storage_y",
};

/**
 * Answers siteverify (with `turnstile`, an answer object) and Stripe. Records every call as
 * `{url, method, form}` so a test can assert what was sent.
 */
/**
 * `expire` is how Stripe answers `POST /v1/checkout/sessions/<id>/expire`: open sessions expire
 * (200) unless `expire.refuse` names the state the session is really in ("complete", "expired"),
 * in which case the expire is a 400 and a GET of the session reports that state.
 */
export function outbound({ turnstile = { success: true, hostname: "example.com" }, checkout, expire = {} } = {}) {
  const calls = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method ?? "GET";
    const form = init.body instanceof URLSearchParams ? init.body : new URLSearchParams(url.search);
    calls.push({ url: url.origin + url.pathname, method, form, headers: init.headers ?? {} });
    if (url.hostname === "challenges.cloudflare.com") return Response.json(turnstile);
    if (url.hostname === "api.stripe.com") {
      if (url.pathname === "/v1/prices") {
        const data = form.getAll("lookup_keys[]").filter((k) => PRICES[k]).map((k) => ({ id: PRICES[k], lookup_key: k }));
        return Response.json({ data });
      }
      const expiring = url.pathname.match(/^\/v1\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)\/expire$/);
      if (expiring) {
        if (expire.refuse) return Response.json({ error: { message: "Only Checkout Sessions with a status in [open] can be expired." } }, { status: 400 });
        return Response.json({ id: expiring[1], status: "expired" });
      }
      const reading = url.pathname.match(/^\/v1\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/);
      if (reading && method === "GET") return Response.json({ id: reading[1], status: expire.refuse ?? "open" });
      if (url.pathname === "/v1/checkout/sessions") {
        const id = checkout?.id ?? `cs_test_${crypto.randomUUID().replaceAll("-", "")}`;
        return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
      }
      if (url.pathname === "/v1/billing_portal/sessions") {
        return Response.json({ id: "bps_1", url: "https://billing.stripe.com/p/session/test_1" });
      }
    }
    return new Response("unexpected outbound request in a test", { status: 599 });
  });
  return { calls, spy };
}

export const post = (path, body, headers = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

export const get = (path) => SELF.fetch(`${ORIGIN}${path}`);

export const createBody = (slug, extra = {}) => ({ slug, display_name: "Acme Ltd", tier: "free", turnstile_token: "tok", ...extra });

export const tenantRow = (slug) => env.CONTROL_DB.prepare("SELECT * FROM tenants WHERE slug = ?").bind(slug).first();
export const eventRecorded = async (id) =>
  (await env.CONTROL_DB.prepare("SELECT 1 FROM stripe_events WHERE id = ?").bind(id).first()) !== null;

/** POSTs `event` to the webhook, signed with `secret` at `timestamp` (seconds). */
export async function deliver(event, { secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000), header } = {}) {
  const payload = JSON.stringify(event);
  const signature = header ?? (await signLikeStripe(payload, secret, timestamp));
  return SELF.fetch(`${ORIGIN}/api/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body: payload,
  });
}

export function subscriptionEvent(type, row, { id, created, status = "active", items, subId = "sub_test_1" }) {
  return {
    id,
    type,
    created,
    data: {
      object: {
        id: subId,
        object: "subscription",
        customer: "cus_test_1",
        status,
        metadata: { tenant: row.slug, tenant_id: row.tenant_id },
        items: { data: items },
      },
    },
  };
}

export const item = (lookupKey, quantity) => ({ price: { id: PRICES[lookupKey], lookup_key: lookupKey }, quantity });

/** The tenant object's stats, through the Worker's own routing (`/<slug>`, path routing on). */
export const objectStats = async (slug) => (await SELF.fetch(`http://127.0.0.1/${slug}`)).json();

export { sha256Hex } from "../control/secrets.mjs";

/** wrangler.toml as `wrangler deploy` reads it (vitest.config.mjs), without the tests' overrides. */
export const production = () => JSON.parse(env.PRODUCTION_CONFIG);

/**
 * The bindings with wrangler.toml's own vars on top: the Worker as deployed, but for the secrets,
 * which a deployment sets with `wrangler secret put` (and the tests set to test values).
 */
export const productionEnv = (overrides = {}) => ({ ...env, ...production().vars, ...overrides });
