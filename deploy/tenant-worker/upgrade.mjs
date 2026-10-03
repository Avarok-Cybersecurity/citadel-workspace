/**
 * Upgrade proof: what an older server build stored in a tenant's Durable Object loads under the
 * server built from this tree.
 *
 *   node upgrade.mjs <persist-dir> <old-server-pkg>     (from this directory, like durable.mjs)
 *
 * <old-server-pkg> is a `server-wasm/pkg` directory that build.sh produced from the commit
 * production runs (for example a worktree of it). The proof puts that build in place of this
 * tree's server-wasm/pkg, starts `wrangler dev --persist-to <persist-dir>` (a fresh directory),
 * creates tenant acme, registers an account and writes a profile name through the kernel, then
 * stops wrangler, puts this tree's build back, starts wrangler on the same directory and logs in
 * with the same account, without registering again, and reads the name back. This tree's
 * server-wasm/pkg is restored however the proof ends.
 *
 * The client is this tree's proof client throughout, and its node stays up across the swap: as
 * in durable.mjs, the server's storage is what is being tested.
 */
import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  check, client, DEV_OVERRIDES, provision, request, requestOnceEnrolled, secret, short, startWrangler, stopWrangler, verdict,
} from "./proof-lib.mjs";

const [persistTo, oldPkg] = process.argv.slice(2);
if (!persistTo || !oldPkg) {
  console.error("usage: node upgrade.mjs <persist-dir> <old-server-pkg>");
  process.exit(2);
}
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "server-wasm", "pkg");
for (const dir of [PKG, oldPkg]) {
  if (!existsSync(join(dir, "instance.mjs"))) {
    console.error(`${dir} holds no build.sh output (no instance.mjs)`);
    process.exit(2);
  }
}

const tenant = "acme";
const username = `upgrade${Date.now()}`;
const password = secret();
const marker = `marker-${secret()}`;
const results = [];
// Beside the build rather than in a temporary directory, so the rename never crosses filesystems.
const held = join(HERE, "server-wasm", "pkg.held-by-upgrade");
if (existsSync(held)) {
  console.error(`${held} exists: an earlier run did not finish; put it back as ${PKG} first`);
  process.exit(2);
}
let wrangler = null;
let c = null;

/** Puts this tree's build back in place; safe to call more than once. */
function restoreCurrentBuild() {
  if (!existsSync(held)) return;
  rmSync(PKG, { recursive: true, force: true });
  renameSync(held, PKG);
}

renameSync(PKG, held);
try {
  cpSync(oldPkg, PKG, { recursive: true });
  wrangler = await startWrangler(persistTo, DEV_OVERRIDES);
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

  restoreCurrentBuild();
  wrangler = await startWrangler(persistTo, DEV_OVERRIDES);
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
  }
} catch (e) {
  check(results, "proof ran to completion", false, e?.stack ?? String(e));
} finally {
  if (c !== null) await c.shutdown().catch(() => {});
  if (wrangler !== null) await stopWrangler(wrangler);
  restoreCurrentBuild();
}
process.exit(verdict("UPGRADE", results));
