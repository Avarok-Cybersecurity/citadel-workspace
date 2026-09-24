/**
 * Cloudflare Turnstile: the widget's token is posted to siteverify, and its answer is read by one
 * rule (`verdict`), the rMazing `cc-account::turnstile::passed` rule in JS.
 */

export const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const CREATE_ACTION = "create-workspace";

/**
 * Whether siteverify's answer lets this request through: success, solved on one of the
 * configured hostnames (comma-separated), and -- when Cloudflare echoes an action, which it does
 * for every widget that sets `data-action` -- for this route's action. Cloudflare's testing keys
 * echo no action; such an answer is bound by the secret and hostname alone.
 * `null` when it passes, else the refusal's detail.
 */
export function verdict(answer, hostnames, action) {
  if (!answer || typeof answer !== "object") return "the Turnstile answer could not be read";
  if (answer.success !== true) {
    const codes = Array.isArray(answer["error-codes"]) ? answer["error-codes"].join(",") : "";
    return `Turnstile did not pass this request${codes ? `: ${codes}` : ""}`;
  }
  const allowed = hostnames.split(",").map((h) => h.trim()).filter(Boolean);
  if (typeof answer.hostname !== "string" || !allowed.includes(answer.hostname)) {
    return "the Turnstile answer is for another site";
  }
  if (typeof answer.action === "string" && answer.action !== "" && answer.action !== action) {
    return "the Turnstile answer is for another action";
  }
  return null;
}

/** Asks siteverify about `token`; resolves to the verdict. */
export async function verifyTurnstile(io, { secret, hostnames }, token, action, ip) {
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  const response = await io.fetch(SITEVERIFY, { method: "POST", body: form });
  const answer = await response.json().catch(() => null);
  return verdict(answer, hostnames, action);
}
