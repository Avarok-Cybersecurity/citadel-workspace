/**
 * Upgrade proof: what an older server build stored in a tenant's Durable Object loads under the
 * server built from this tree, and a legacy (Argon2) account it stored upgrades to post-quantum
 * sign-in at its first login here.
 *
 *   node upgrade.mjs <persist-dir> <old-tenant-worker>     (from this directory, like durable.mjs)
 *
 * <old-tenant-worker> is the `deploy/tenant-worker` directory of a checkout of the commit
 * production runs, after build.sh and `npm ci` there: its Worker and its wasm, which belong
 * together (the object's glue changes with the node it starts). The proof starts that build's
 * `wrangler dev --persist-to <persist-dir>` (a fresh directory), creates tenant acme, registers
 * an account and writes a profile name through the kernel, then stops it, starts this tree's
 * build on the same directory and logs in with the same account, without registering again: it
 * reads the name back, the SDK records the upgrade that login carried (its negative control, this
 * tree's server without post-quantum sign-in, turns that check red), and the account signs in
 * again.
 *
 * The client is this tree's proof client throughout, and its node stays up across the swap: as
 * in durable.mjs, the server's storage is what is being tested.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  check, client, DEV_OVERRIDES, provision, request, requestOnceEnrolled, secret, short, startWrangler, startWranglerIn, stopWrangler, verdict,
} from "./proof-lib.mjs";

const [persistTo, oldDir] = process.argv.slice(2);
if (!persistTo || !oldDir) {
  console.error("usage: node upgrade.mjs <persist-dir> <old-tenant-worker>");
  process.exit(2);
}
for (const needed of ["server-wasm/pkg/instance.mjs", "node_modules/.bin/wrangler", "worker.mjs"]) {
  if (!existsSync(join(oldDir, needed))) {
    console.error(`${oldDir} has no ${needed}: build.sh and npm ci it first`);
    process.exit(2);
  }
}

const tenant = "acme";
const username = `upgrade${Date.now()}`;
const password = secret();
const marker = `marker-${secret()}`;
const results = [];
let wrangler = null;
let c = null;

try {
  wrangler = await startWranglerIn(resolve(oldDir), persistTo, DEV_OVERRIDES);
  await provision(tenant);
  c = await client(tenant);
  await c.register(username, password);
  const cid = await c.connect(username, password);
  check(results, "registered and connected on the old build", true, `cid=${cid}`);
  const updated = await requestOnceEnrolled(c, { UpdateUserProfile: { name: marker, avatar_data: null } });
  check(results, "profile name written on the old build", updated.UserProfileUpdated?.name === marker, short(updated));
  await c.disconnect();
  await stopWrangler(wrangler);
  wrangler = null;

  // At info, so the SDK's own record of the upgrade a legacy login carries reaches the output.
  wrangler = await startWrangler(persistTo, [...DEV_OVERRIDES, "--var", "LOG_FILTER:citadel=info"]);
  let loginCid = null;
  try {
    loginCid = await c.connect(username, password);
  } catch (e) {
    check(results, "logged in on this build with the account the old one stored", false, e?.message ?? String(e));
  }
  if (loginCid !== null) {
    check(results, "logged in on this build with the account the old one stored", loginCid === cid, `cid=${loginCid}`);
    const after = await request(c, { GetMember: { user_id: username } });
    check(results, "profile name the old build stored read back", after.Member?.name === marker, short(after));
    const ws = await request(c, { GetWorkspace: { workspace_id: null } });
    const members = ws.Workspace?.members ?? [];
    check(results, "the workspace still lists the account", members.includes(username), short(members));
    await c.disconnect();
    // This tree's server runs post-quantum sign-in, and this tree's client offers the upgrade
    // with its legacy login: the account's Argon2 record is replaced in the same exchange.
    const upgraded = `Account ${cid} upgraded to post-quantum sign-in`;
    check(results, "that login upgraded the account to post-quantum sign-in", wrangler.output().includes(upgraded), upgraded);
    let pqCid = null;
    try {
      pqCid = await c.connect(username, password);
    } catch (e) {
      check(results, "and it signs in again after the upgrade", false, e?.message ?? String(e));
    }
    if (pqCid !== null) {
      check(results, "and it signs in again after the upgrade", pqCid === cid, `cid=${pqCid}`);
      await c.disconnect();
    }
  }
} catch (e) {
  check(results, "proof ran to completion", false, e?.stack ?? String(e));
} finally {
  if (c !== null) await c.shutdown().catch(() => {});
  if (wrangler !== null) await stopWrangler(wrangler);
}
process.exit(verdict("UPGRADE", results));
