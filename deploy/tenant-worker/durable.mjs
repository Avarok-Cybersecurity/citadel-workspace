/**
 * Phase 3 durability proof: an account and the workspace data it wrote survive a restart of the
 * server, because both live in the Durable Object's SQLite storage.
 *
 *   node durable.mjs <persist-dir>
 *
 * Starts `wrangler dev --persist-to <persist-dir>` itself (a fresh directory: the tenant is
 * created in it), creates tenant acme through the control plane, registers an account on /acme,
 * writes a profile name through the kernel and reads it back, then stops wrangler — every workerd
 * process, so nothing in memory survives — starts it again on the same directory, logs in with
 * the same account (no registration) and reads the name back. The client node stays up across
 * the restart; its account store is in memory, which is fine: it is the server's that is on trial.
 */
import {
  check, client, DEV_OVERRIDES, provision, request, requestOnceEnrolled, secret, short, startWrangler, stats, stopWrangler, verdict,
} from "./proof-lib.mjs";

const persistTo = process.argv[2];
if (!persistTo) {
  console.error("usage: node durable.mjs <persist-dir>");
  process.exit(2);
}
const tenant = "acme";
const username = `durable${Date.now()}`;
const password = secret();
const marker = `marker-${secret()}`;
const results = [];
let wrangler = null;
let c = null;

try {
  wrangler = await startWrangler(persistTo, DEV_OVERRIDES);
  await provision(tenant);
  c = await client(tenant);
  await c.register(username, password);
  const cid = await c.connect(username, password);
  check(results, "registered and connected before the restart", true, `cid=${cid}`);

  const updated = await requestOnceEnrolled(c, { UpdateUserProfile: { name: marker, avatar_data: null } });
  check(results, "profile name written", updated.UserProfileUpdated?.name === marker, short(updated));
  const before = await request(c, { GetMember: { user_id: username } });
  check(results, "profile name read back before the restart", before.Member?.name === marker, short(before));
  await c.disconnect();
  const statsBefore = await stats(tenant);
  console.log(`stored before restart: ${JSON.stringify(statsBefore.stored)}`);

  await stopWrangler(wrangler);
  wrangler = await startWrangler(persistTo, DEV_OVERRIDES);
  const statsAfter = await stats(tenant);
  console.log(`stored after restart (object not yet started): ${JSON.stringify(statsAfter.stored)}`);
  check(
    results,
    "the object came back as a fresh instance",
    statsAfter.running === false && statsAfter.accepted === 0,
    `running=${statsAfter.running} accepted=${statsAfter.accepted}`,
  );

  let loginCid = null;
  try {
    loginCid = await c.connect(username, password);
  } catch (e) {
    check(results, "logged in after the restart with the same account", false, e?.message ?? String(e));
  }
  if (loginCid !== null) {
    check(results, "logged in after the restart with the same account", loginCid === cid, `cid=${loginCid}`);
    const after = await request(c, { GetMember: { user_id: username } });
    check(results, "profile name read back after the restart", after.Member?.name === marker, short(after));
    const ws = await request(c, { GetWorkspace: { workspace_id: null } });
    const members = ws.Workspace?.members ?? [];
    check(results, "the workspace still lists the account", members.includes(username), short(members));
    await c.disconnect();
  }
} catch (e) {
  check(results, "proof ran to completion", false, e?.stack ?? String(e));
} finally {
  if (c !== null) await c.shutdown().catch(() => {});
  if (wrangler !== null) await stopWrangler(wrangler);
}
process.exit(verdict("DURABLE", results));
