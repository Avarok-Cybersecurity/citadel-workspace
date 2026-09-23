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
  "citadel-relay-overage": "price_relay_overage",
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
/**
 * `meterEvents.failures` is how many `POST /v1/billing/meter_events` Stripe refuses (500) before
 * it accepts them.
 */
export function outbound({ turnstile = { success: true, hostname: "example.com" }, checkout, expire = {}, meterEvents = { failures: 0 }, subscriptions = { failures: 0 } } = {}) {
  let meterFailures = meterEvents.failures;
  let subscriptionFailures = subscriptions.failures;
  let subscriptionCount = 0;
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
      if (url.pathname === "/v1/billing/meter_events" && method === "POST") {
        if (meterFailures > 0) {
          meterFailures -= 1;
          return Response.json({ error: { message: "test: meter event refused" } }, { status: 500 });
        }
        return Response.json({ object: "billing.meter_event", event_name: form.get("event_name"), identifier: form.get("identifier") });
      }
      // The usage-only subscription (control/usage-subscription.mjs): created, and cancelled.
      if (url.pathname === "/v1/subscriptions" && method === "POST") {
        if (subscriptionFailures > 0) {
          subscriptionFailures -= 1;
          return Response.json({ error: { message: "test: subscription refused" } }, { status: 500 });
        }
        subscriptionCount += 1;
        return Response.json({ id: `sub_usage_${subscriptionCount}`, object: "subscription", status: "active" });
      }
      const cancelling = url.pathname.match(/^\/v1\/subscriptions\/(sub_[A-Za-z0-9_]+)$/);
      if (cancelling && method === "DELETE") return Response.json({ id: cancelling[1], object: "subscription", status: "canceled" });
      if (url.pathname === "/v1/billing_portal/sessions") {
        // Never the account's default portal: it belongs to another product on the same account.
        if (form.get("configuration") !== "bpc_test_citadel") {
          return Response.json({ error: { message: "test: portal opened without Citadel's configuration" } }, { status: 400 });
        }
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

/**
 * `period` ({start, end}, seconds) is put on the items, where Stripe's current API version keeps
 * the billing period; `periodOnSubscription` puts it on the subscription, as older versions did.
 */
export function subscriptionEvent(type, row, { id, created, status = "active", items, subId = "sub_test_1", period, periodOnSubscription = false }) {
  const onItems = period && !periodOnSubscription;
  const withPeriod = onItems ? items.map((i) => ({ ...i, current_period_start: period.start, current_period_end: period.end })) : items;
  const topLevel = period && periodOnSubscription ? { current_period_start: period.start, current_period_end: period.end } : {};
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
        ...topLevel,
        items: { data: withPeriod },
      },
    },
  };
}

export const item = (lookupKey, quantity) => ({ price: { id: PRICES[lookupKey], lookup_key: lookupKey }, quantity });

/** The tenant object's stats, through the Worker's own routing (`/<slug>`, path routing on). */
export const objectStats = async (slug) => (await SELF.fetch(`http://127.0.0.1/${slug}`)).json();

export { sha256Hex } from "../control/secrets.mjs";

export const tenantObject = (slug) => env.WORKSPACE.get(env.WORKSPACE.idFromName(slug));

/** A free tenant created through the control plane, and its object. */
export async function freeTenant(stem) {
  const slug = freshSlug(stem);
  outbound();
  const r = await post("/api/tenants", createBody(slug));
  if (r.status !== 201) throw new Error(`creating ${slug}: ${r.status}`);
  vi.restoreAllMocks();
  return { slug, object: tenantObject(slug) };
}

/** Upgrades to the tenant's socket through the Worker: the accepted client end, or the refusal. */
export async function openSocket(slug) {
  const r = await SELF.fetch(`http://127.0.0.1/${slug}`, { headers: { upgrade: "websocket" } });
  if (!r.webSocket) return { refused: r };
  const ws = r.webSocket;
  const closed = new Promise((resolve) => ws.addEventListener("close", (e) => resolve({ code: e.code, reason: e.reason })));
  ws.accept();
  return { ws, closed };
}

/**
 * `bytes` bytes that open a Citadel frame and never finish it: the node waits for the rest, so the
 * socket stays open (a complete frame of nonsense would have the node close it).
 */
export function unfinishedFrame(bytes) {
  const b = new Uint8Array(bytes);
  new DataView(b.buffer).setUint32(0, 1024 * 1024);
  return b;
}

/** Polls `probe` until it returns a truthy value, or fails naming `what`. */
export async function until(what, probe, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** wrangler.toml as `wrangler deploy` reads it (vitest.config.mjs), without the tests' overrides. */
export const production = () => JSON.parse(env.PRODUCTION_CONFIG);

/**
 * The bindings with wrangler.toml's own vars on top: the Worker as deployed, but for the secrets,
 * which a deployment sets with `wrangler secret put` (and the tests set to test values).
 */
export const productionEnv = (overrides = {}) => ({ ...env, ...production().vars, ...overrides });
