/**
 * Admission proof: a workspace that requires a human check (Turnstile) to sign in and register,
 * enforced by the tenant's Durable Object over real Citadel sessions under `wrangler dev`, with
 * Cloudflare's TESTING keys against the real siteverify (no challenge is solved: the testing
 * secrets answer every token the same way).
 *
 *   node admission.mjs <persist-dir>      (from this directory, like durable.mjs; a fresh directory)
 *
 * With the always-pass testing secret: an admin registers while the setting is off, claims the
 * workspace and turns it on. Then a registration and a sign-in without a token are refused as
 * PqSignInAdmissionRequired (350) and admitted with one; a reconnect after the client's link
 * died half-open (the server still holds the session) presents its resume token and is not
 * asked; a recovery-code sign-in is not asked. Restarted with the always-fail testing secret, a
 * token siteverify refuses is PqSignInAdmissionFailed (351), for a sign-in and a registration.
 */
import {
  check, client, DEV_OVERRIDES, HTTP_BASE, provision, request, requestOnceEnrolled, secret, severClientSockets, short, startWrangler, stopWrangler, verdict,
} from "./proof-lib.mjs";

const persistTo = process.argv[2];
if (!persistTo) {
  console.error("usage: node admission.mjs <persist-dir>");
  process.exit(2);
}
/** Cloudflare's published testing secrets (not credentials) and a token they accept as input. */
const PASSES = "1x0000000000000000000000000000000AA";
const FAILS = "2x0000000000000000000000000000000AA";
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
/** The SDK's own forms of the two refusals (citadel_io ErrorCode 350, 351). */
const REQUIRED = "This workspace needs a verification check before you sign in";
const FAILED = "The verification check failed:";
const LOCAL_SESSION_STILL_UP = "Disconnect first before reconnecting";

const tenant = "acme";
const run = Date.now();
const [adminName, memberName, lateName] = [`admin${run}`, `member${run}`, `late${run}`];
const [adminPassword, memberPassword] = [secret(), secret()];
const results = [];
const clients = [];
let wrangler = null;

const withSecret = (value) => [...DEV_OVERRIDES, "--var", `TURNSTILE_SECRET:${value}`];
const refusal = (promise) => promise.then(() => "admitted", (e) => e?.message ?? String(e));
const discovered = async () => (await (await fetch(`${HTTP_BASE}/api/admission/${tenant}`)).json()).turnstile?.required;

async function newClient() {
  const c = await client(tenant);
  clients.push(c);
  return c;
}

/** Signs in again once the client has torn its own side of the severed link down. */
async function reconnectAfterTeardown(c, username, password) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await c.connect(username, password);
    } catch (e) {
      const message = e?.message ?? String(e);
      if (!message.includes(LOCAL_SESSION_STILL_UP) || Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

try {
  wrangler = await startWrangler(persistTo, withSecret(PASSES));
  const claimCode = await provision(tenant);
  const admin = await newClient();
  await admin.register(adminName, adminPassword);
  await admin.connect(adminName, adminPassword);
  const claimed = await requestOnceEnrolled(admin, {
    UpdateWorkspace: { workspace_id: null, name: null, description: null, workspace_master_password: claimCode, metadata: [...Buffer.from('{"initialized":true}')] },
  });
  check(results, "an admin registered and claimed the workspace while the check was off", claimed.Workspace !== undefined, short(claimed));
  const on = await request(admin, { UpdateSignInSettings: { settings: { require_turnstile_sign_in: true } } });
  check(results, "the admin turns the check on", on.SignInSettings?.require_turnstile_sign_in === true, short(on));
  check(results, "discovery says a check is required", (await discovered()) === true);

  const member = await newClient();
  const unchecked = await refusal(member.register(memberName, memberPassword));
  check(results, "a registration without a token is refused as required (350)", unchecked.includes(REQUIRED), unchecked);
  let codes = [];
  try {
    codes = JSON.parse(await member.register(memberName, memberPassword, TOKEN));
    check(results, "a registration with a token siteverify passes is admitted", codes.length === 10, `${codes.length} recovery codes`);
  } catch (e) {
    check(results, "a registration with a token siteverify passes is admitted", false, e?.message ?? String(e));
  }
  const bare = await refusal(member.connect(memberName, memberPassword));
  check(results, "a sign-in without a token is refused as required (350)", bare.includes(REQUIRED), bare);
  const cid = await member.connect(memberName, memberPassword, TOKEN);
  check(results, "a sign-in with a token siteverify passes is admitted", typeof cid === "string", `cid=${cid}`);

  // The link dies as the client sees it; the server still holds the session and its resume token.
  severClientSockets();
  const resumed = await refusal(reconnectAfterTeardown(member, memberName, memberPassword).then((again) => {
    if (again !== cid) throw new Error(`a different session: cid=${again}`);
  }));
  check(results, "a resume-token reconnect, with no token, is not asked", resumed === "admitted", resumed);
  await member.disconnect().catch(() => {});

  const recovered = codes.length === 0 ? "no recovery code to use" : await refusal(member.connect_recovery(memberName, codes[0]));
  check(results, "a recovery-code sign-in, with no token, is not asked", recovered === "admitted", recovered);
  for (const c of clients) await c.disconnect().catch(() => {});

  await stopWrangler(wrangler);
  wrangler = await startWrangler(persistTo, withSecret(FAILS));
  const refusedSignIn = await refusal(member.connect(memberName, memberPassword, TOKEN));
  check(results, "a sign-in whose token siteverify refuses fails (351)", refusedSignIn.includes(FAILED), refusedSignIn);
  const late = await newClient();
  const refusedRegister = await refusal(late.register(lateName, secret(), TOKEN));
  check(results, "a registration whose token siteverify refuses fails (351)", refusedRegister.includes(FAILED), refusedRegister);
} catch (e) {
  check(results, "proof ran to completion", false, e?.stack ?? String(e));
} finally {
  for (const c of clients) await c.shutdown().catch(() => {});
  if (wrangler !== null) await stopWrangler(wrangler);
}
process.exit(verdict("ADMISSION", results));
