/** The dunning emails' text: every number and date from billing/policy.json and the dunning row. */
import policy from "../../../billing/policy.json";
import { describe, expect, it } from "vitest";
import { dunningMail } from "../control/dunning-mail.mjs";

const since = Date.UTC(2026, 9, 1, 12) / 1000;
const state = (p) => ({
  kind: "payment_required", since, purge_at: since + p.dunning.grace_days * 86400, reminders_sent: [0], final_warning_sent_at: null,
  invoice: { id: "in_1", hosted_invoice_url: "https://invoice.stripe.com/i/in_1", customer_email: "a@example.com" },
});
const mail = (p, email) => dunningMail({ policy: p, email, state: state(p), slug: "acme", publicOrigin: "https://work.avarok.net" });
const purgeDate = (p) => new Date(state(p).purge_at * 1000).toISOString().slice(0, 10);
const EMAILS = [{ kind: "failed", day: 0 }, { kind: "reminder", day: 7 }, { kind: "final", day: 28 }];

describe("the dunning emails", () => {
  it("each names the purge date, the pay link, Plan & billing, what is refused and what is deleted", () => {
    for (const email of EMAILS) {
      const { subject, text } = mail(policy, email);
      expect(subject).toContain('"acme"');
      expect(text).toContain(`${purgeDate(policy)} (UTC)`);
      expect(text).toContain("https://invoice.stripe.com/i/in_1");
      expect(text).toContain("https://work.avarok.net/");
      expect(text).toContain("Plan & billing");
      expect(text).toMatch(/refuses every connection/);
      expect(text).toMatch(/every account, message, file, document and setting/);
    }
  });

  it(`say grace_days (${policy.dunning.grace_days}) and final_warning_hours (${policy.dunning.final_warning_hours}) as policy.json has them`, () => {
    expect(mail(policy, EMAILS[0]).text).toContain(`${policy.dunning.grace_days} days after the payment failed`);
    expect(mail(policy, EMAILS[2]).subject).toContain(`deleted in ${policy.dunning.final_warning_hours} hours`);
    expect(mail(policy, EMAILS[1]).text).toContain(`${policy.dunning.grace_days - 7} days remain`);
  });

  // The control: a copy of the policy with other values yields other text, so nothing above is a literal.
  it("change with the policy: a copy with other values says those values", () => {
    const other = { ...policy, dunning: { ...policy.dunning, grace_days: 45, final_warning_hours: 72 } };
    expect(purgeDate(other)).not.toBe(purgeDate(policy));
    expect(mail(other, EMAILS[0]).text).toContain("45 days after the payment failed");
    expect(mail(other, EMAILS[0]).text).toContain(purgeDate(other));
    expect(mail(other, EMAILS[0]).text).not.toContain(purgeDate(policy));
    expect(mail(other, EMAILS[2]).subject).toContain("deleted in 72 hours");
    expect(mail(other, EMAILS[2]).subject).not.toContain(`${policy.dunning.final_warning_hours} hours`);
  });

  it("without a hosted invoice, points at Plan & billing alone; an unknown kind throws", () => {
    const s = { ...state(policy), invoice: { id: null, hosted_invoice_url: null, customer_email: "a@example.com" } };
    const { text } = dunningMail({ policy, email: EMAILS[0], state: s, slug: "acme", publicOrigin: "https://work.avarok.net" });
    expect(text).not.toContain("Pay the invoice here");
    expect(text).toContain("https://work.avarok.net/");
    expect(() => mail(policy, { kind: "thanks", day: 0 })).toThrow(/no dunning email/);
    expect(() => mail({ dunning: {} }, EMAILS[0])).toThrow(/required/);
  });
});
