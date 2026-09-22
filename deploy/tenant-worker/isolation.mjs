/**
 * Phase 3 isolation proof: two tenants under one `wrangler dev` share nothing — not accounts, not
 * workspace data, not a wasm instance.
 *
 *   node isolation.mjs <persist-dir>
 *
 * Registers account U on /acme and writes a marker through the kernel, then:
 *   - points that same client (same local account, same keys) at /globex: login must fail there;
 *   - registers the SAME username on /globex from a second client: it must be free there;
 *   - reads U's record on /globex: acme's marker must be absent; writes a second marker there;
 *   - runs both tenants' sessions at once, interleaving requests: each must only see its own;
 *   - reads U's record on /acme again: still acme's marker, never globex's.
 * Finally it compares the objects' wasm instance ids (a Rust global each instance fixes on first
 * read): distinct ids under one isolate-wide instance count mean the two objects shared an
 * isolate, and each still ran on its own instance, with its own Rust globals.
 */
import {
  check, client, DEV_OVERRIDES, endpoint, provision, redirect, request, requestOnceEnrolled, secret, short, startWrangler, stats,
  stopWrangler, verdict,
} from "./proof-lib.mjs";

const persistTo = process.argv[2];
if (!persistTo) {
  console.error("usage: node isolation.mjs <persist-dir>");
  process.exit(2);
}
const username = `iso${Date.now()}`;
const [acmePass, globexPass] = [secret(), secret()];
const [acmeMark, globexMark] = [`acme-${secret()}`, `globex-${secret()}`];
const results = [];
let wrangler = null;
const clients = [];

const nameOf = async (c) => (await request(c, { GetMember: { user_id: username } })).Member?.name;

try {
  wrangler = await startWrangler(persistTo, DEV_OVERRIDES);
  // Both created through the control plane, as customers would; neither is reachable before.
  await provision("acme");
  await provision("globex");
  const a = await client("acme");
  clients.push(a);
  await a.register(username, acmePass);
  await a.connect(username, acmePass);
  const wrote = await requestOnceEnrolled(a, { UpdateUserProfile: { name: acmeMark, avatar_data: null } });
  check(results, "acme: account registered and marker written", wrote.UserProfileUpdated?.name === acmeMark, short(wrote));
  await a.disconnect();

  redirect(endpoint("acme"), endpoint("globex"));
  let foreignLogin;
  try {
    foreignLogin = { ok: true, cid: await a.connect(username, acmePass) };
    await a.disconnect();
  } catch (e) {
    foreignLogin = { ok: false, error: e?.message ?? String(e) };
  }
  redirect(endpoint("acme"), null);
  check(results, "globex: acme's account cannot log in", !foreignLogin.ok, short(foreignLogin));

  const b = await client("globex");
  clients.push(b);
  let globexRegister;
  try {
    await b.register(username, globexPass);
    globexRegister = { ok: true };
  } catch (e) {
    globexRegister = { ok: false, error: e?.message ?? String(e) };
  }
  check(results, "globex: the same username is free", globexRegister.ok, short(globexRegister));
  await b.connect(username, globexPass);
  const globexSees = (await requestOnceEnrolled(b, { GetMember: { user_id: username } })).Member?.name;
  check(results, "globex: acme's marker is absent", globexSees !== undefined && globexSees !== acmeMark, `name=${globexSees}`);
  const wrote2 = await request(b, { UpdateUserProfile: { name: globexMark, avatar_data: null } });
  check(results, "globex: its own marker written", wrote2.UserProfileUpdated?.name === globexMark, short(wrote2));

  await a.connect(username, acmePass);
  // One request in flight per client (a client has one channel), both clients at once.
  const series = async (c, tenant) => {
    const seen = [];
    for (let i = 0; i < 6; i++) seen.push([tenant, await nameOf(c)]);
    return seen;
  };
  const rounds = (await Promise.all([series(a, "acme"), series(b, "globex")])).flat();
  const crossed = rounds.filter(([t, name]) => name !== (t === "acme" ? acmeMark : globexMark));
  check(results, "both tenants at once: each sees only its own record", crossed.length === 0, short(crossed.length ? crossed : rounds.length));
  check(results, "acme: marker unchanged by globex's write", (await nameOf(a)) === acmeMark);
  await a.disconnect();
  await b.disconnect();

  const [sa, sg] = [await stats("acme"), await stats("globex")];
  console.log(`acme   stats: ${JSON.stringify({ ...sa, connections: undefined })}`);
  console.log(`globex stats: ${JSON.stringify({ ...sg, connections: undefined })}`);
  check(
    results,
    "each object ran on its own wasm instance",
    sa.wasm_instance !== null && sg.wasm_instance !== null && sa.wasm_instance !== sg.wasm_instance,
    `acme=${sa.wasm_instance} globex=${sg.wasm_instance} instances_in_isolate(acme view)=${sa.wasm_instances_in_isolate} (globex view)=${sg.wasm_instances_in_isolate}`,
  );
} catch (e) {
  check(results, "proof ran to completion", false, e?.stack ?? String(e));
} finally {
  for (const c of clients) await c.shutdown().catch(() => {});
  if (wrangler !== null) await stopWrangler(wrangler);
}
process.exit(verdict("ISOLATION", results));
