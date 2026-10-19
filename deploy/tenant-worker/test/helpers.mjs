/**
 * Shared test plumbing. The one mock in this suite is at the fetch boundary: Turnstile's
 * siteverify and Stripe's API are third-party services a test cannot reach deterministically (and
 * must not charge), so `outbound()` answers them in-process. Everything on this side of `fetch` --
 * routing, validation, D1, the tenant's Durable Object and its wasm server -- is the real Worker.
 */
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { vi } from "vitest";
import { ioFor } from "../control/dispatch.mjs";
import { CUSTOMER_TERMS_VERSION } from "../control/customer-terms.mjs";
import { config } from "../control/http.mjs";
import { runMonitor } from "../control/monitor.mjs";
import { signLikeStripe } from "./stripe-sign.mjs";
import { customerEmail, MAIL_SINK_HOST, mailsIn, outbound, PRICES } from "./outbound.mjs";

export const ORIGIN = "https://work.avarok.net";
export const WEBHOOK_SECRET = "whsec_vitest_only";

let counter = 0;
/** A slug no other test uses: tests share one D1 file. */
export const freshSlug = (stem = "t") => `${stem}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export { customerEmail, MAIL_SINK_HOST, mailsIn, outbound, PRICES };

export const post = (path, body, headers = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

export const get = (path) => SELF.fetch(`${ORIGIN}${path}`);

/**
 * A creation body. A paid tier must name overage_billing; unnamed, the tests take it on (the path
 * most of them exercise: overage billed through the usage subscription). A test of the choice
 * itself names it, or names it `undefined` to leave it out.
 */
export const createBody = (slug, extra = {}) => ({
  slug, display_name: "Acme Ltd", tier: "free", turnstile_token: "tok", accepted_customer_terms_version: CUSTOMER_TERMS_VERSION,
  ...(extra.tier !== undefined && extra.tier !== "free" ? { overage_billing: true } : {}), ...extra,
});

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

/** `bytes` more inbound on the tenant object's meter, through a connection opened and closed for it. */
export const relay = (slug, bytes) =>
  runInDurableObject(tenantObject(slug), (instance) => {
    const id = `injected-${crypto.randomUUID()}`;
    instance.meter.connect(id, Date.now());
    instance.meter.inbound(id, bytes);
    instance.meter.disconnect(id, Date.now());
  });

/** The monitor over these tenants only: the suite's D1 holds every other test's tenants too. */
export function monitorOf(...slugs) {
  const io = ioFor(env);
  const only = { ...io, store: Object.assign(Object.create(io.store), { active: async () => (await io.store.active()).filter((r) => slugs.includes(r.slug)) }) };
  return () => runMonitor(only, config(env));
}
