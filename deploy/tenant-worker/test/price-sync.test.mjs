/**
 * The price sync at sale (control/price-sync.mjs), through the real Worker's creation: a price
 * Stripe holds with a drifted amount or tax behaviour is replaced before the Checkout is opened,
 * and the Checkout sells the replacement. Stripe is the one mock (helpers.mjs outbound()).
 */
import { describe, expect, it } from "vitest";
import { planPriceSync } from "../../../billing/reconcile.mjs";
import { WANTED_PRICES } from "../control/plans.mjs";
import { createBody, freshSlug, outbound, post, PRICES } from "./helpers.mjs";

const team = { tier: "team", interval: "month", seats: 2 };
const stripeCalls = (calls) => calls.filter((c) => c.url.startsWith("https://api.stripe.com/"));
const createdPrices = (calls) => calls.filter((c) => c.url === "https://api.stripe.com/v1/prices" && c.method === "POST");

describe("the price sync at checkout", () => {
  it("replaces a price whose amount drifted, archives the old one, and sells the new one", async () => {
    const { calls } = outbound({ prices: { drift: { "citadel-team-month": { unit_amount: 500 } } } });
    expect((await post("/api/tenants", createBody(freshSlug("ps"), team))).status).toBe(201);
    const order = stripeCalls(calls).map((c) => `${c.method} ${new URL(c.url).pathname}`);
    expect(order).toEqual(["GET /v1/prices", "POST /v1/prices", `POST /v1/prices/${PRICES["citadel-team-month"]}`, "POST /v1/checkout/sessions"]);
    const [created] = createdPrices(calls);
    expect(Object.fromEntries(created.form)).toEqual({
      product: "prod_team", currency: "usd", unit_amount: String(WANTED_PRICES.get("citadel-team-month").unit_amount),
      "recurring[interval]": "month", "recurring[usage_type]": "licensed", lookup_key: "citadel-team-month",
      transfer_lookup_key: "true", tax_behavior: "exclusive", "metadata[citadel_tier]": "team",
    });
    expect(created.headers["idempotency-key"]).toMatch(/^price-sync-[0-9a-f]{64}$/);
    expect(stripeCalls(calls)[2].form.get("active")).toBe("false");
    expect(calls.find((c) => c.url.endsWith("/v1/checkout/sessions")).form.get("line_items[0][price]")).toBe("price_new_1");
  });

  it("replaces a price created with another tax behaviour", async () => {
    const { calls } = outbound({ prices: { drift: { "citadel-storage-month": { tax_behavior: "unspecified" } } } });
    expect((await post("/api/tenants", createBody(freshSlug("pt"), { ...team, storage_blocks: 1 }))).status).toBe(201);
    expect(createdPrices(calls).map((c) => c.form.get("lookup_key"))).toEqual(["citadel-storage-month"]);
    const session = calls.find((c) => c.url.endsWith("/v1/checkout/sessions")).form;
    expect([session.get("line_items[0][price]"), session.get("line_items[1][price]")]).toEqual([PRICES["citadel-team-month"], "price_new_1"]);
  });

  it("touches nothing when Stripe matches the catalogue", async () => {
    const { calls } = outbound();
    expect((await post("/api/tenants", createBody(freshSlug("pm"), team))).status).toBe(201);
    expect(createdPrices(calls)).toEqual([]);
    expect(calls.filter((c) => /\/v1\/prices\/price_/.test(c.url))).toEqual([]);
  });

  it("does not repair a missing price: the creation fails and nothing is charged", async () => {
    const saved = PRICES["citadel-team-month"];
    delete PRICES["citadel-team-month"];
    try {
      const { calls } = outbound();
      expect((await post("/api/tenants", createBody(freshSlug("px"), team))).status).toBe(502);
      expect(createdPrices(calls)).toEqual([]);
    } finally {
      PRICES["citadel-team-month"] = saved;
    }
  });
});

describe("planPriceSync (provisional billing/reconcile.mjs)", () => {
  const want = WANTED_PRICES.get("citadel-relay-overage");
  const have = {
    id: "price_old", active: true, product: "prod_x", unit_amount: want.unit_amount, currency: want.currency, tax_behavior: "exclusive",
    recurring: { interval: want.interval, usage_type: "metered", meter: "mtr_1" }, metadata: { ...want.metadata },
  };
  const opts = { productId: "prod_x", meterId: "mtr_1", taxBehavior: "exclusive" };
  it("is empty when nothing differs, and carries the meter on a metered replacement", () => {
    expect(planPriceSync(want, have, opts)).toEqual([]);
    const ops = planPriceSync(want, { ...have, unit_amount: want.unit_amount + 1 }, opts);
    expect(ops.map((o) => o.op)).toEqual(["create_price", "archive_price"]);
    expect(ops[0].form).toMatchObject({ "recurring[meter]": "mtr_1", "recurring[usage_type]": "metered", transfer_lookup_key: "true" });
    expect(ops[1].id).toBe("price_old");
  });
});
