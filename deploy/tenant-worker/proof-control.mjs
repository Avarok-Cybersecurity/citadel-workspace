/**
 * The Phase 4a proof, against a running `wrangler dev` (see proof-control.sh):
 *
 *   node proof-control.mjs free   <base>   free tenant -> claim code -> the object holds it -> a wasm
 *                                          client registers, connects and round-trips at /<slug>
 *   node proof-control.mjs paid   <base>   a REAL Stripe test-mode Checkout (Team monthly x 3 + 2
 *                                          storage blocks), cancelled and retried with the reservation
 *                                          token (the old session is expired AT Stripe; a wrong token
 *                                          is 409), the new one retrieved back from Stripe; then locally
 *                                          signed checkout.session.completed + subscription.created
 *                                          -> active with those entitlements; claim code once
 *   node proof-control.mjs denied <base>   (run with the always-fail Turnstile secret) 403, no row
 *
 * Secrets are read from .dev.vars and never printed.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { signLikeStripe } from "./test/stripe-sign.mjs";

const [mode, base] = process.argv.slice(2);
if (!mode || !base) {
  console.error("usage: node proof-control.mjs free|paid|denied <http-base>");
  process.exit(2);
}
const vars = Object.fromEntries(
  readFileSync(new URL("./.dev.vars", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const ORIGIN = base;
const slug = `${mode}-${Date.now().toString(36)}`;
const say = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const fail = (why) => {
  console.log(`PROOF FAIL (${mode}): ${why}`);
  process.exit(1);
};
const redact = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "claim_code" && typeof v === "string" ? `${v.slice(0, 4)}…(${v.length} hex)` : v)));
const sha256 = async (t) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))).toString("hex");

const api = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: body ? { origin: ORIGIN, "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const create = (extra) => api("POST", "/api/tenants", { slug, display_name: "Proof Org", turnstile_token: "XXXX.DUMMY.TOKEN.XXXX", ...extra });
const stripeGet = async (path) => {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { headers: { authorization: `Bearer ${vars.STRIPE_SECRET_KEY}` } });
  const body = await r.json();
  if (!r.ok) fail(`stripe ${path}: ${body?.error?.message}`);
  return body;
};
const webhook = async (event, secret = vars.STRIPE_WEBHOOK_SECRET) => {
  const payload = JSON.stringify(event);
  const r = await fetch(`${base}/api/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": await signLikeStripe(payload, secret, Math.floor(Date.now() / 1000)), "content-type": "application/json" },
    body: payload,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const stats = async () => (await fetch(`${base}/${slug}`)).json();

if (mode === "denied") {
  const r = await create({ tier: "free" });
  say("create with always-fail Turnstile secret", redact(r));
  const status = await api("GET", `/api/tenants/${slug}/status`);
  const avail = await api("GET", `/api/slug/${slug}`);
  say("status afterwards", status);
  say("slug afterwards", avail.body);
  if (r.status !== 403 || status.status !== 404 || avail.body.available !== true) fail("a refused Turnstile left state behind");
  console.log(`PROOF PASS (denied): 403, no tenant row for ${slug}`);
  process.exit(0);
}

if (mode === "free") {
  const r = await create({ tier: "free" });
  say("create", redact(r));
  if (r.status !== 201) fail("free creation failed");
  const s = await stats();
  const want = (await sha256(r.body.claim_code)).slice(0, 8);
  say("object", { provisioned: s.provisioned, master_password_sha256_prefix: s.master_password_sha256_prefix, expected_prefix: want, entitlements: s.entitlements });
  if (s.master_password_sha256_prefix !== want) fail("the object does not hold the claim code");
  const ws = `${base.replace(/^http/, "ws")}/${slug}`;
  say("wasm proof client dials", ws);
  const run = spawnSync(process.execPath, ["proof.mjs", ws, "4"], { cwd: new URL(".", import.meta.url).pathname, encoding: "utf8" });
  const lines = run.stdout.split("\n").filter((l) => /^(PROOF|RESPONSE)/.test(l));
  lines.forEach((l) => console.log(`  ${l.slice(0, 220)}`));
  if (run.status !== 0) fail("the wasm client could not use the tenant");
  const unknown = await fetch(`${base}/nobody-${Date.now().toString(36)}`);
  say("an unprovisioned slug", unknown.status);
  if (unknown.status !== 404) fail("an unknown slug reached an object");
  console.log(`PROOF PASS (free): ${slug} active, object holds the claim code, wasm client round-tripped`);
  process.exit(0);
}

if (mode === "paid") {
  const plan = { tier: "team", interval: "month", seats: 3, storage_blocks: 2 };
  const initial = await create(plan);
  const redactToken = (b) => ({ ...b, reservation_token: b?.reservation_token ? `${b.reservation_token.slice(0, 4)}…` : b?.reservation_token });
  say("create", { status: initial.status, body: redactToken(initial.body) });
  if (initial.status !== 201 || !/^[0-9a-f]{64}$/.test(initial.body.reservation_token ?? "")) fail("paid creation failed or returned no reservation token");
  const firstSession = new URL(initial.body.checkout_url).pathname.match(/(cs_test_[A-Za-z0-9]+)/)?.[1];
  // The visitor cancels at Stripe and comes back to the same slug: without their token, 409.
  const stranger = await create({ ...plan, reservation_token: "0".repeat(64) });
  say("retry with a wrong token", stranger);
  if (stranger.status !== 409 || stranger.body?.error !== "slug-taken") fail("a wrong reservation token was not refused");
  const r = await create({ ...plan, reservation_token: initial.body.reservation_token });
  say("retry with the reservation token", { status: r.status, body: redactToken(r.body) });
  if (r.status !== 201) fail("the creator could not retry their own reservation");
  const old = await stripeGet(`/checkout/sessions/${firstSession}`);
  say("the first session at Stripe after the retry", { id: `${firstSession.slice(0, 14)}…`, status: old.status, livemode: old.livemode });
  if (old.status !== "expired") fail("the superseded Checkout Session is still payable");
  const url = new URL(r.body.checkout_url);
  say("checkout host", url.host);
  if (url.host !== "checkout.stripe.com") fail("not a Stripe Checkout URL");
  const sessionId = url.pathname.match(/(cs_test_[A-Za-z0-9]+)/)?.[1];
  if (!sessionId) fail("no session id in the Checkout URL");
  const session = await stripeGet(`/checkout/sessions/${sessionId}?expand[]=line_items`);
  const lines = session.line_items.data.map((l) => ({ lookup_key: l.price.lookup_key, quantity: l.quantity, unit_amount: l.price.unit_amount, amount_total: l.amount_total, interval: l.price.recurring?.interval }));
  say("retrieved session", { id: `${sessionId.slice(0, 14)}…`, livemode: session.livemode, mode: session.mode, status: session.status, amount_total: session.amount_total, currency: session.currency, metadata: session.metadata });
  say("line items", lines);
  const want = [
    { lookup_key: "citadel-team-month", quantity: 3, unit_amount: 600, amount_total: 1800, interval: "month" },
    { lookup_key: "citadel-storage-month", quantity: 2, unit_amount: 200, amount_total: 400, interval: "month" },
  ];
  if (session.livemode !== false || session.amount_total !== 2200 || JSON.stringify(lines) !== JSON.stringify(want)) fail("the session is not what was asked for");
  const tenantId = session.metadata.tenant_id;

  // NEGATIVE CONTROL: the same event under a secret that is not the Worker's.
  const now = Math.floor(Date.now() / 1000);
  const items = session.line_items.data.map((l) => ({ price: { id: l.price.id, lookup_key: l.price.lookup_key }, quantity: l.quantity }));
  const subCreated = {
    id: `evt_proof_${now}_sub`, type: "customer.subscription.created", created: now,
    data: { object: { id: "sub_proof_1", object: "subscription", customer: "cus_proof_1", status: "active", metadata: { tenant: slug, tenant_id: tenantId }, items: { data: items } } },
  };
  const forged = await webhook(subCreated, `whsec_${"0".repeat(32)}`);
  const afterForged = await api("GET", `/api/tenants/${slug}/status`);
  say("forged signature", { webhook: forged, status_after: afterForged.body.status });
  if (forged.status !== 400 || afterForged.body.status !== "pending") fail("a forged webhook changed state");

  // The superseded session completing late (correctly signed) activates nothing: its tenant_id is gone.
  const lateOld = await webhook({
    id: `evt_proof_${now}_old`, type: "checkout.session.completed", created: now,
    data: { object: { id: firstSession, object: "checkout.session", customer: "cus_proof_old", subscription: "sub_proof_old", payment_status: "paid", metadata: old.metadata } },
  });
  const afterLate = await api("GET", `/api/tenants/${slug}/status`);
  say("the superseded session's completion", { webhook: lateOld, status_after: afterLate.body.status });
  if (lateOld.body?.applied !== false || afterLate.body.status !== "pending") fail("the superseded session activated the tenant");

  const completed = {
    id: `evt_proof_${now}_cs`, type: "checkout.session.completed", created: now,
    data: { object: { id: sessionId, object: "checkout.session", customer: "cus_proof_1", subscription: "sub_proof_1", payment_status: "paid", metadata: session.metadata } },
  };
  say("checkout.session.completed", await webhook(completed));
  say("customer.subscription.created", await webhook(subCreated));
  say("same event again", await webhook(subCreated));
  const s = await stats();
  say("object entitlements", s.entitlements);
  const first = await api("GET", `/api/tenants/${slug}/status?session_id=${sessionId}`);
  const second = await api("GET", `/api/tenants/${slug}/status?session_id=${sessionId}`);
  say("status with session id (1st)", redact(first.body));
  say("status with session id (2nd)", second.body);
  if (first.body.status !== "active" || !/^[0-9a-f]{64}$/.test(first.body.claim_code ?? "") || second.body.claim_code !== undefined) fail("claim not returned exactly once");
  if ((await sha256(first.body.claim_code)).slice(0, 8) !== s.master_password_sha256_prefix) fail("claim code is not the object's password");
  const e = s.entitlements;
  if (e.status !== "active" || e.tier !== "team" || e.seats !== 3 || e.storage_blocks !== 2 || e.storage_gb !== 50 || e.members_max !== 3) fail("wrong entitlements");
  console.log(`PROOF PASS (paid): real test-mode Checkout matched; ${slug} active with team x3 + 2 blocks (50 GB); claim once`);
  process.exit(0);
}
fail(`unknown mode ${mode}`);
