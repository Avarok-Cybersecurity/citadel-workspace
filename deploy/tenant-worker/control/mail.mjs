/**
 * Sending an email: Cloudflare Email Sending through the `MAIL` binding, as rMazing's notary
 * does (~/rMazing/deploy/notary-worker/mail.mjs). No third-party account and no API key.
 *
 * `MAIL_ENDPOINT` replaces the binding when set: the suite points it at a sink it answers
 * itself (test/helpers.mjs outbound). Production sets `MAIL_FROM` and the binding and never the
 * endpoint (test/production-config.test.mjs). With neither, nothing can be sent, and
 * `mailTransport` says so rather than pretending.
 *
 * Nothing here logs an address, a subject or a body: the body carries a claim code.
 */

/** The transport for `env`, or null when this deployment cannot send email. */
export function mailTransport(env) {
  const from = typeof env.MAIL_FROM === "string" && env.MAIL_FROM.trim() ? env.MAIL_FROM.trim() : null;
  if (from === null) return null;
  if (typeof env.MAIL_ENDPOINT === "string" && env.MAIL_ENDPOINT) {
    const endpoint = env.MAIL_ENDPOINT;
    return {
      async send({ to, subject, text }) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ from, to: [to], subject, text }),
        });
        if (!response.ok) throw new Error(`mail sink answered ${response.status}`);
      },
    };
  }
  if (!env.MAIL) return null;
  // "Name <box@domain>": the binding wants the name and the address apart.
  const match = /^\s*(?:(.*?)\s*<)?([^<>\s]+@[^<>\s]+?)>?\s*$/.exec(from);
  if (!match) throw new Error("MAIL_FROM is not an address");
  return {
    async send({ to, subject, text }) {
      await env.MAIL.send({ to, from: { email: match[2], name: match[1] || "Citadel Workspace" }, subject, text });
    },
  };
}
