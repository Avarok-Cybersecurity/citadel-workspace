/**
 * Sign-in proof: post-quantum sign-in and the workspace's sign-in settings, over real Citadel
 * sessions against the tenant's Durable Object under `wrangler dev`.
 *
 *   node sign-in.mjs <persist-dir>      (from this directory, like durable.mjs; a fresh directory)
 *
 * Creates tenant acme, registers two accounts (post-quantum: this tree's server runs it), claims
 * the workspace with the first, then: a member cannot change the sign-in settings and an admin
 * can; discovery (/api/admission/acme) reports what the admin stored; and after a restart of
 * every workerd process both the setting and the OPRF seed are still there -- the admin signs in
 * again. That last check is also what shows the accounts are post-quantum: with the seed
 * regenerated at every boot (its negative control) the same sign-in is refused, "Authentication
 * failed", which a legacy Argon2 account would never be.
 */
import {
  check, client, DEV_OVERRIDES, HTTP_BASE, provision, request, requestOnceEnrolled, secret, short, startWrangler, stopWrangler, verdict,
} from "./proof-lib.mjs";

const persistTo = process.argv[2];
if (!persistTo) {
  console.error("usage: node sign-in.mjs <persist-dir>");
  process.exit(2);
}
const tenant = "acme";
const run = Date.now();
const [adminName, memberName] = [`admin${run}`, `member${run}`];
const [adminPassword, memberPassword] = [secret(), secret()];
const results = [];
const clients = [];
let wrangler = null;

const settings = (on) => ({ UpdateSignInSettings: { settings: { require_turnstile_sign_in: on } } });
const discovered = async () => (await (await fetch(`${HTTP_BASE}/api/admission/${tenant}`)).json()).turnstile?.required;

async function signedIn(username, password) {
  const c = await client(tenant);
  clients.push(c);
  await c.register(username, password);
  await c.connect(username, password);
  return c;
}

try {
  wrangler = await startWrangler(persistTo, DEV_OVERRIDES);
  const claimCode = await provision(tenant);
  const admin = await signedIn(adminName, adminPassword);
  const claimed = await requestOnceEnrolled(admin, {
    UpdateWorkspace: { workspace_id: null, name: null, description: null, workspace_master_password: claimCode, metadata: [...Buffer.from('{"initialized":true}')] },
  });
  check(results, "the workspace was claimed with its claim code", claimed.Workspace !== undefined, short(claimed));

  const initial = await request(admin, "GetSignInSettings");
  check(results, "the setting starts off", initial.SignInSettings?.require_turnstile_sign_in === false, short(initial));
  check(results, "discovery says no check is required", (await discovered()) === false);

  const member = await signedIn(memberName, memberPassword);
  const refused = await requestOnceEnrolled(member, settings(true));
  check(results, "a member cannot turn it on", /only an admin/.test(refused.Error ?? ""), short(refused));
  check(results, "and discovery still says off", (await discovered()) === false);

  const on = await request(admin, settings(true));
  check(results, "an admin turns it on", on.SignInSettings?.require_turnstile_sign_in === true, short(on));
  check(results, "discovery says a check is required", (await discovered()) === true);
  const read = await request(member, "GetSignInSettings");
  check(results, "a member reads it as on", read.SignInSettings?.require_turnstile_sign_in === true, short(read));
  for (const c of clients) await c.disconnect();

  await stopWrangler(wrangler);
  wrangler = await startWrangler(persistTo, DEV_OVERRIDES);
  check(results, "discovery still says required after a restart", (await discovered()) === true);
  let again = null;
  try {
    // The check is on now, so this fresh sign-in carries a token (Turnstile's testing secret passes it).
    await admin.connect(adminName, adminPassword, "XXXX.DUMMY.TOKEN.XXXX");
    again = await request(admin, "GetSignInSettings");
  } catch (e) {
    check(results, "the admin signed in again after the restart (the seed survived)", false, e?.message ?? String(e));
  }
  if (again !== null) {
    check(results, "the admin signed in again after the restart (the seed survived)", true);
    check(results, "the setting survived the restart", again.SignInSettings?.require_turnstile_sign_in === true, short(again));
    const off = await request(admin, settings(false));
    check(results, "and the admin turns it off again", off.SignInSettings?.require_turnstile_sign_in === false, short(off));
    check(results, "discovery follows", (await discovered()) === false);
    await admin.disconnect();
  }
} catch (e) {
  check(results, "proof ran to completion", false, e?.stack ?? String(e));
} finally {
  for (const c of clients) await c.shutdown().catch(() => {});
  if (wrangler !== null) await stopWrangler(wrangler);
}
process.exit(verdict("SIGN-IN", results));
