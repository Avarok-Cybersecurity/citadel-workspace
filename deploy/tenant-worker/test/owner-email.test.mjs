/**
 * The claim code is emailed with a link straight to claiming, and following the link verifies the
 * address.
 *
 * Owner, 2026-09-27: the email is required, the link verifies it, and the code travels in the
 * email too, so a creator who closed the tab can still claim. What is pinned here:
 * - the one message: to the address given, with the code, a /claim link carrying slug, code and
 *   a verification token in its fragment, and a "this wasn't me" link;
 * - verification: once, and a repeat is still a success; a wrong, stale or replaced token is not;
 * - resend and change, proven by the claim code;
 * - "this wasn't me": the address is forgotten and never mailed again;
 * - limits: a recipient cannot be mailed without end;
 * - a send that fails never fails the creation;
 * - a paid workspace is emailed when its payment completes.
 *
 * Through the real Worker, D1 and tenant object; the mail sink stands in for Email Sending.
 */
import { env } from "cloudflare:test";
import { describe, expect, it, vi, afterEach } from "vitest";
import { createBody, deliver, freshSlug, get, mailsIn, ownerEmail, outbound, post, tenantRow } from "./helpers.mjs";
import { SEND_LIMITS } from "../control/owner-email.mjs";

afterEach(() => vi.restoreAllMocks());

async function createFree(stem, extra = {}, sink = {}) {
  const slug = freshSlug(stem);
  const { calls } = outbound(sink);
  const r = await post("/api/tenants", createBody(slug, extra));
  const body = await r.json();
  return { slug, r, body, mails: mailsIn(calls) };
}

/** The token and code in a claim email's /claim link. */
function linkOf(mail) {
  const m = /https:\/\/work\.avarok\.net\/claim#slug=([^&\s]+)&code=([0-9a-f]{64})&v=([0-9a-f]{64})/.exec(mail.text);
  return m ? { slug: decodeURIComponent(m[1]), code: m[2], token: m[3] } : null;
}

describe("the claim email", () => {
  it("goes to the address given, with the code and a link that fills in the claim", async () => {
    const { slug, r, body, mails } = await createFree("em");
    expect(r.status).toBe(201);
    expect(body.email_sent).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual([ownerEmail(slug)]);
    expect(mails[0].text).toContain(body.claim_code);
    expect(linkOf(mails[0])).toMatchObject({ slug, code: body.claim_code });
    expect(mails[0].text).toMatch(/#slug=[^&\s]+&not-me=[0-9a-f]{64}/);
    // The creator-chosen workspace name is not in a message this service sends.
    expect(mails[0].text).not.toContain("Acme Ltd");
    expect(await tenantRow(slug)).toMatchObject({ owner_email: ownerEmail(slug), email_verified_at: null });
  });

  it("is required, and must be an address", async () => {
    for (const email of [undefined, "", "not an address", "a@b", `${"x".repeat(250)}@example.com`]) {
      const { r } = await createFree("er", { email });
      expect(r.status, String(email)).toBe(400);
    }
  });

  it("does not fail the creation when it cannot be sent", async () => {
    const { r, body } = await createFree("ef", {}, { mailStatus: 500 });
    expect(r.status).toBe(201);
    expect(body.claim_code).toMatch(/^[0-9a-f]{64}$/);
    expect(body.email_sent).toBe(false);
  });
});

describe("verifying the address", () => {
  it("is done by the link's token, once, and a repeat is still a success", async () => {
    const { slug, mails } = await createFree("ev");
    const { token } = linkOf(mails[0]);
    for (let i = 0; i < 2; i++) {
      const r = await post(`/api/tenants/${slug}/verify-email`, { token });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ email_verified: true });
    }
    expect((await (await get(`/api/tenants/${slug}/status`)).json()).email_verified).toBe(true);
  });

  it("refuses a wrong or expired token", async () => {
    const { slug, mails } = await createFree("ew");
    expect((await post(`/api/tenants/${slug}/verify-email`, { token: "0".repeat(64) })).status).toBe(400);
    await env.CONTROL_DB.prepare("UPDATE tenants SET verify_expires = 1 WHERE slug = ?").bind(slug).run();
    expect((await post(`/api/tenants/${slug}/verify-email`, { token: linkOf(mails[0]).token })).status).toBe(400);
    expect((await tenantRow(slug)).email_verified_at).toBeNull();
  });
});

describe("resending and changing the address", () => {
  it("resends to the owner's address on the claim code, and the older link stops working", async () => {
    const { slug, body, mails: first } = await createFree("es");
    const { calls } = outbound();
    const r = await post(`/api/tenants/${slug}/email`, { claim_code: body.claim_code });
    expect(await r.json()).toMatchObject({ email_sent: true });
    const [again] = mailsIn(calls);
    expect(again.to).toEqual([ownerEmail(slug)]);
    expect((await post(`/api/tenants/${slug}/verify-email`, { token: linkOf(first[0]).token })).status).toBe(400);
    expect((await post(`/api/tenants/${slug}/verify-email`, { token: linkOf(again).token })).status).toBe(200);
  });

  it("changes the address on the claim code, unverified until its own link is followed", async () => {
    const { slug, body } = await createFree("ec");
    const { calls } = outbound();
    await post(`/api/tenants/${slug}/email`, { claim_code: body.claim_code, email: "new@example.com" });
    expect(mailsIn(calls)[0].to).toEqual(["new@example.com"]);
    expect(await tenantRow(slug)).toMatchObject({ owner_email: "new@example.com", email_verified_at: null });
  });

  it("does nothing without the right claim code, and says the same as for no workspace", async () => {
    const { slug } = await createFree("ex");
    const { calls } = outbound();
    const wrong = await post(`/api/tenants/${slug}/email`, { claim_code: "0".repeat(64), email: "attacker@example.com" });
    const missing = await post(`/api/tenants/no-such-${slug}/email`, { claim_code: "0".repeat(64) });
    expect([wrong.status, missing.status]).toEqual([404, 404]);
    expect(mailsIn(calls)).toHaveLength(0);
    expect((await tenantRow(slug)).owner_email).toBe(ownerEmail(slug));
  });
});

describe("this wasn't me", () => {
  it("forgets the address, and it is never emailed again", async () => {
    const email = `victim-${freshSlug()}@example.com`;
    const { slug, mails } = await createFree("en", { email });
    const token = /not-me=([0-9a-f]{64})/.exec(mails[0].text)[1];
    expect((await post(`/api/tenants/${slug}/not-me`, { token })).status).toBe(200);
    expect((await tenantRow(slug)).owner_email).toBeNull();
    const { body, mails: after } = await createFree("en2", { email });
    expect(body.email_sent).toBe(false);
    expect(after).toHaveLength(0);
  });
});

describe("the limits", () => {
  it("stop one address being mailed without end", async () => {
    const email = `target-${freshSlug()}@example.com`;
    const sent = [];
    for (let i = 0; i <= SEND_LIMITS.perRecipient; i++) sent.push((await createFree(`el${i}`, { email })).body.email_sent);
    expect(sent).toEqual([...Array(SEND_LIMITS.perRecipient).fill(true), false]);
  });
});

describe("a paid workspace", () => {
  it("is emailed its claim code when its payment completes, and the success page still shows it once", async () => {
    const slug = freshSlug("ep");
    const sessionId = `cs_test_${crypto.randomUUID().replace(/-/g, "")}`;
    outbound({ checkout: { id: sessionId } });
    expect((await post("/api/tenants", createBody(slug, { tier: "team", interval: "month", seats: 3 }))).status).toBe(201);
    const row = await tenantRow(slug);
    const { calls } = outbound();
    const r = await deliver({
      id: `evt_${crypto.randomUUID()}`,
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: sessionId, object: "checkout.session", customer: "cus_test_1", subscription: "sub_test_1", payment_status: "paid", metadata: { tenant: slug, tenant_id: row.tenant_id } } },
    });
    expect(await r.json()).toMatchObject({ applied: true, email_sent: true });
    const [mail] = mailsIn(calls);
    const shown = await (await get(`/api/tenants/${slug}/status?session_id=${sessionId}`)).json();
    expect(shown.claim_code).toMatch(/^[0-9a-f]{64}$/);
    expect(linkOf(mail).code).toBe(shown.claim_code);
  });
});
