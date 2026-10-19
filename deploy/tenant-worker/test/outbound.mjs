/**
 * The suite's one mock, at the fetch boundary (see helpers.mjs): Turnstile's siteverify, Stripe's
 * API, Cloudflare Realtime TURN and the MAIL_ENDPOINT sink, answered in-process. Re-exported by
 * helpers.mjs.
 */
import { vi } from "vitest";
import { WANTED_PRICES } from "../control/plans.mjs";

export const PRICES = {
  "citadel-team-month": "price_team_m",
  "citadel-team-year": "price_team_y",
  "citadel-business-month": "price_business_m",
  "citadel-business-year": "price_business_y",
  "citadel-storage-month": "price_storage_m",
  "citadel-storage-year": "price_storage_y",
  "citadel-secure-links-month": "price_links_m",
  "citadel-secure-links-year": "price_links_y",
  "citadel-relay-overage": "price_relay_overage",
  "citadel-document-appends": "price_document_appends",
};

/** The address outbound() gives the Stripe customer `id`. */
export const customerEmail = (id) => `billing+${id}@example.com`;
/** Host of the MAIL_ENDPOINT the suite sets (vitest.config.mjs). */
export const MAIL_SINK_HOST = "mail.sink.test";
/** The messages the sink received, from an `outbound()` call log. */
export const mailsIn = (calls) =>
  calls.filter((c) => c.url.startsWith(`https://${MAIL_SINK_HOST}`)).map((c) => JSON.parse(c.body));

/**
 * Stripe's price under `lookupKey` as GET /v1/prices answers it: by default exactly what
 * billing/tiers.json derives (tax-exclusive, as pricing-model.json `tax` says), so a test drifts
 * only what it names in `drift`.
 */
function stripePrice(lookupKey, drift) {
  const want = WANTED_PRICES.get(lookupKey);
  return {
    id: PRICES[lookupKey], object: "price", lookup_key: lookupKey, active: true, product: `prod_${want.metadata.citadel_tier}`,
    unit_amount: want.unit_amount, currency: want.currency, tax_behavior: "exclusive", metadata: { ...want.metadata },
    recurring: { interval: want.interval, usage_type: want.usage_type, meter: want.usage_type === "metered" ? `mtr_${want.metadata.citadel_tier}` : null },
    ...(drift?.[lookupKey] ?? {}),
  };
}

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
/**
 * `prices.drift` is `{lookupKey: fields}` Stripe's price under that key holds instead of the
 * catalogue's (a drifted amount, an unspecified tax behaviour). A created price is `price_new_<n>`.
 */
/**
 * `mailStatus` is the status the MAIL_ENDPOINT sink answers every message with.
 */
/**
 * `turn` is how Cloudflare Realtime TURN answers `generate-ice-servers`: `{status, body}`, by
 * default a 201 with a STUN and a TURN server whose credentials are numbered by call.
 */
export function outbound({ turnstile = { success: true, hostname: "example.com" }, checkout, expire = {}, meterEvents = { failures: 0 }, subscriptions = { failures: 0 }, turn, prices = { drift: {} }, mailStatus = 202 } = {}) {
  let turnCalls = 0;
  let pricesCreated = 0;
  let meterFailures = meterEvents.failures;
  let subscriptionFailures = subscriptions.failures;
  let subscriptionCount = 0;
  const calls = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method ?? "GET";
    const form = init.body instanceof URLSearchParams ? init.body : new URLSearchParams(url.search);
    calls.push({ url: url.origin + url.pathname, method, form, headers: init.headers ?? {}, body: init.body });
    if (url.hostname === "challenges.cloudflare.com") return Response.json(turnstile);
    // The MAIL_ENDPOINT sink (vitest.config.mjs): what the control plane would have emailed.
    if (url.hostname === MAIL_SINK_HOST) return new Response(null, { status: mailStatus });
    if (url.hostname === "rtc.live.cloudflare.com") {
      turnCalls += 1;
      if (turn) return Response.json(turn.body, { status: turn.status });
      return Response.json(
        {
          iceServers: [
            { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
            {
              urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
              username: `user-${turnCalls}`,
              credential: `credential-${turnCalls}`,
            },
          ],
        },
        { status: 201 },
      );
    }
    if (url.hostname === "api.stripe.com") {
      if (url.pathname === "/v1/prices" && method === "GET") {
        const data = form.getAll("lookup_keys[]").filter((k) => PRICES[k]).map((k) => stripePrice(k, prices.drift));
        return Response.json({ data });
      }
      if (url.pathname === "/v1/prices" && method === "POST") {
        pricesCreated += 1;
        return Response.json({ id: `price_new_${pricesCreated}`, object: "price", lookup_key: form.get("lookup_key"), active: true });
      }
      const archiving = url.pathname.match(/^\/v1\/prices\/(price_[A-Za-z0-9_]+)$/);
      if (archiving && method === "POST") return Response.json({ id: archiving[1], object: "price", active: form.get("active") !== "false" });
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
      // The billing address the alerts read at send time (control/alerts.mjs).
      const customer = method === "GET" && url.pathname.match(/^\/v1\/customers\/(cus_[A-Za-z0-9_]+)$/);
      if (customer) return Response.json({ id: customer[1], object: "customer", email: customerEmail(customer[1]) });
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
