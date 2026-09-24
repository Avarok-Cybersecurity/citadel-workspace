/**
 * Relay-credential proof: a real Citadel client asks its tenant's workspace server for relay
 * servers (`GetIceServers`), through the Worker, the Durable Object, the wasm kernel and the
 * object's minter (control/ice.mjs) and back.
 *
 *   node relay.mjs <persist-dir> [<turn-env-file>]
 *
 * Without a TURN key (wrangler.toml sets none), the member is told no relay is available: the
 * whole path answers, and nothing is sent to Cloudflare. With `<turn-env-file>` (a dotenv file
 * holding TURN_KEY_ID and TURN_KEY_API_TOKEN, passed to `wrangler dev --env-file`; never
 * committed), wrangler is restarted with the key and a 120 s lifetime, and the member receives
 * real Cloudflare credentials -- one mint: the second request must be answered from the cache.
 * Only the URLs and whether a username and credential are present are printed.
 */
import {
  check, client, DEV_OVERRIDES, provision, request, requestOnceEnrolled, secret, short, startWrangler, stopWrangler, verdict,
} from "./proof-lib.mjs";
import { UNAVAILABLE } from "./control/ice-reasons.mjs";

const [persistTo, turnEnvFile] = process.argv.slice(2);
if (!persistTo) {
  console.error("usage: node relay.mjs <persist-dir> [<turn-env-file>]");
  process.exit(2);
}
const TTL = 120;
const tenant = "relay";
const username = `relay${Date.now()}`;
const password = secret();
const results = [];
let wrangler = null;
let c = null;

/** What a response is, without its credentials. */
const redacted = (r) =>
  r.IceServers
    ? { expires_at: r.IceServers.expires_at, servers: r.IceServers.ice_servers.map((s) => ({ urls: s.urls, username: s.username !== null, credential: s.credential !== null })) }
    : r;

async function member() {
  c = await client(tenant);
  await c.register(username, password);
  await c.connect(username, password);
  // Enrolment lands after connect resolves; wait for it before asking as a member.
  await requestOnceEnrolled(c, { GetMember: { user_id: username } });
}

try {
  wrangler = await startWrangler(persistTo, DEV_OVERRIDES);
  await provision(tenant);
  await member();
  const unset = await request(c, "GetIceServers");
  check(results, "without a TURN key, a member is told no relay is available", unset.IceServersUnavailable?.reason === UNAVAILABLE.notConfigured, short(unset));

  if (turnEnvFile) {
    // The same client across the restart: its account store is in memory (as in durable.mjs).
    await c.disconnect();
    await stopWrangler(wrangler);
    wrangler = await startWrangler(persistTo, [...DEV_OVERRIDES, "--env-file", turnEnvFile, "--var", `TURN_CREDENTIAL_TTL_SECONDS:${TTL}`]);
    await c.connect(username, password);
    const before = Math.floor(Date.now() / 1000);
    const first = await requestOnceEnrolled(c, "GetIceServers");
    console.log(`first answer: ${JSON.stringify(redacted(first))}`);
    const servers = first.IceServers?.ice_servers ?? [];
    const urls = servers.flatMap((s) => s.urls);
    check(results, "a member receives Cloudflare's relay servers", urls.some((u) => /^turns:[^?]+:443(\?|$)/.test(u)), short(urls));
    check(results, "the TURN entries carry a username and credential", servers.filter((s) => s.urls.some((u) => u.startsWith("turn"))).every((s) => s.username && s.credential), "");
    const expires = first.IceServers?.expires_at ?? 0;
    check(results, "they expire after the configured lifetime", expires >= before + TTL && expires <= before + TTL + 5, `expires_at - now = ${expires - before}`);
    const second = await request(c, "GetIceServers");
    check(results, "asked again at once, the same credentials (no second mint)", JSON.stringify(second) === JSON.stringify(first), "");
  }
  await c.disconnect();
} catch (e) {
  check(results, "proof ran to completion", false, e?.stack ?? String(e));
} finally {
  if (c !== null) await c.shutdown().catch(() => {});
  if (wrangler !== null) await stopWrangler(wrangler);
}
process.exit(verdict("RELAY", results));
