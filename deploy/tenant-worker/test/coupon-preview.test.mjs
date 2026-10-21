/**
 * The coupon preview as a guessing surface: its per-address limit, and a lookup whose statements
 * are the same whatever the code. Real Worker and D1; nothing mocked but the counting wrapper
 * around the D1 binding, which only records what is asked of it.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ioFor } from "../control/dispatch.mjs";
import { couponFor } from "../control/coupons.mjs";
import { CouponStore } from "../control/coupon-store.mjs";
import { freshIp, issueCode, preview, previewBody } from "./coupon-helpers.mjs";

describe("the preview's limits", () => {
  it("20 previews an hour from one address; the 21st is 429 before any lookup; another address is unaffected", async () => {
    const ip = freshIp();
    for (let i = 0; i < 20; i++) expect((await preview(previewBody("LAUNCH10"), ip)).status).toBe(200);
    const limited = await preview(previewBody("LAUNCH10"), ip);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "coupon-rate-limited", detail: "Too many attempts. Try again in an hour." });
    expect((await preview(previewBody("LAUNCH10"), freshIp())).status).toBe(200);
  });

  it("looks a code up with the same statements whether it is unknown, static or dynamic", async () => {
    const dynamic = await issueCode({ template: "pct-10-once" });
    const statements = [];
    const db = env.CONTROL_DB;
    const counting = {
      prepare: (sql) => {
        statements.push(sql);
        return db.prepare(sql);
      },
      batch: (list) => {
        statements.push(`batch of ${list.length}`);
        return db.batch(list);
      },
    };
    const io = { ...ioFor(env), coupons: new CouponStore(counting) };
    const shapes = [];
    for (const code of ["NOSUCHCODE2", "LAUNCH10", dynamic]) {
      statements.length = 0;
      await couponFor(io, code, { slug: null, tier: "team", interval: "month" });
      shapes.push([...statements]);
    }
    expect(shapes[0].length).toBeGreaterThan(0);
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });
});
