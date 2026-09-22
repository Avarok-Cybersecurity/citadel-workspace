/**
 * The deployed configuration, locally: wrangler.toml as `deploy.sh` ships it (host routing, no
 * stats, the built UI in ui-dist) under `wrangler dev`, overriding only Turnstile, which a machine
 * cannot pass for real (PRODUCTION_LIKE_OVERRIDES).
 *
 *   PROOF_PORT=8848 PROOF_LOCAL_PROTOCOL=https NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *     node proof-production.mjs <fresh-persist-dir> <claims-file> <slug> [--serve]
 *
 * `wrangler dev` answers every request as if it were for one host -- the first route,
 * work.avarok.net, unless `--local-upstream` names another -- so the proof runs in two phases
 * over one persisted state:
 *   1. the apex: the site (SPA shell, meta tags, headers per kind of file), then a tenant created
 *      through the control plane, then `/<slug>` on the apex, which must be the site, not stats;
 *   2. the tenant host (`--local-upstream <slug>.work.avarok.net`): a plain request is 426 with
 *      nothing in it. With --serve it then keeps serving, for the WebSocket proof (the kernel's
 *      a_hosted_tenant_is_claimed_with_its_claim_code test, pointed at wss://localhost:<port>/<slug>).
 * Writes `{"<slug>": "<claim code>"}` to <claims-file> (0600); prints no claim code.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { check, HTTP_BASE, PRODUCTION_LIKE_OVERRIDES, startWrangler, stopWrangler, verdict } from "./proof-lib.mjs";

const [persistTo, claimsFile, slug, flag] = process.argv.slice(2);
if (!persistTo || !claimsFile || !slug || (flag !== undefined && flag !== "--serve")) {
  console.error("usage: node proof-production.mjs <fresh-persist-dir> <claims-file> <slug> [--serve]");
  process.exit(2);
}

const ORIGIN = "https://work.avarok.net";
const AGENT = "wss://local.avarok.net:12345";
// Stated independently of the Worker: nginx's policy (the one the self-hosted image sends) with
// the loopback agent this deployment names substituted, exactly as nginx's envsubst would.
const NGINX = readFileSync(fileURLToPath(new URL("../../docker/ui/nginx.conf.template", import.meta.url)), "utf8");
const EXPECTED_CSP = /^\s*default\s+"([^"]+)";/m.exec(NGINX)[1].replace("${LOOPBACK_AGENT_ORIGIN}", AGENT);
const STATS_FIELDS = ["accepted", "connections", "stored", "entitlements", "master_password_sha256_prefix", "provisioned"];
const results = [];
const meta = (html, name) => new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html)?.[1];

function headersOk(name, r, cache) {
  const h = (k) => r.headers.get(k);
  check(results, `${name}: CSP is nginx's with Turnstile`, h("content-security-policy") === EXPECTED_CSP
    && EXPECTED_CSP.includes("script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' https://challenges.cloudflare.com;")
    && EXPECTED_CSP.includes("frame-src https://challenges.cloudflare.com;"), h("content-security-policy"));
  check(results, `${name}: HSTS, frame, type, referrer and permissions policies`,
    h("strict-transport-security") === "max-age=31536000; includeSubDomains" && h("x-frame-options") === "DENY"
      && h("x-content-type-options") === "nosniff" && h("referrer-policy") === "strict-origin-when-cross-origin"
      && h("permissions-policy") === "geolocation=(), microphone=(self), camera=(self), display-capture=(self)");
  check(results, `${name}: cache-control ${cache}`, h("cache-control") === cache, h("cache-control"));
}

let wrangler = await startWrangler(persistTo, PRODUCTION_LIKE_OVERRIDES);
let serving = false;
try {
  console.log(`== phase 1: the apex (${HTTP_BASE} as work.avarok.net)`);
  let shell = "";
  for (const path of ["/", "/create", "/create/done"]) {
    const r = await fetch(`${HTTP_BASE}${path}`, { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
    const html = await r.text();
    shell = html;
    check(results, `GET ${path} is the SPA shell`, r.status === 200 && /^text\/html/.test(r.headers.get("content-type") ?? "") && html.includes('<div id="root">'), r.status);
    check(results, `GET ${path} meta tags`, meta(html, "citadel-control-plane") === "/api" && meta(html, "citadel-loopback-agent") === AGENT
      && meta(html, "citadel-default-server") === "",
      JSON.stringify(["citadel-control-plane", "citadel-loopback-agent", "citadel-default-server"].map((n) => meta(html, n))));
    headersOk(`GET ${path}`, r, "public, no-cache");
  }
  const bundle = /src="(\/assets\/[^"]+\.js)"/.exec(shell)?.[1];
  const js = await fetch(`${HTTP_BASE}${bundle}`);
  check(results, `GET ${bundle} (hashed bundle)`, js.status === 200 && /javascript/.test(js.headers.get("content-type") ?? ""), js.status);
  headersOk(`GET ${bundle}`, js, "public, max-age=31536000, immutable");
  const wasm = await fetch(`${HTTP_BASE}/wasm/citadel_internal_service_wasm_client_bg.wasm`);
  check(results, "GET the WASM client", wasm.status === 200 && wasm.headers.get("content-type") === "application/wasm", wasm.status);
  headersOk("GET the WASM client", wasm, "public, no-cache");
  headersOk("GET /sw.js", await fetch(`${HTTP_BASE}/sw.js`), "no-cache, no-store, must-revalidate");
  const missing = await fetch(`${HTTP_BASE}/assets/index-00000000.js`);
  check(results, "a missing hashed bundle is 404, not the shell", missing.status === 404 && !/html/.test(missing.headers.get("content-type") ?? ""), missing.status);

  const created = await fetch(`${HTTP_BASE}/api/tenants`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ slug, display_name: `Proof ${slug}`, tier: "free", turnstile_token: "XXXX.DUMMY.TOKEN.XXXX" }),
  });
  const body = await created.json();
  check(results, `POST /api/tenants creates ${slug}, active`, created.status === 201 && body.status === "active" && /^[0-9a-f]{64}$/.test(body.claim_code ?? ""),
    `${created.status} ${body.status ?? body.error} host=${body.workspace_host}`);
  if (body.claim_code) writeFileSync(claimsFile, JSON.stringify({ [slug]: body.claim_code }), { mode: 0o600 });
  const byPath = await fetch(`${HTTP_BASE}/${slug}`);
  const byPathText = await byPath.text();
  check(results, `GET /${slug} on the apex is the site, not the tenant's stats`,
    byPath.status === 200 && byPathText.includes('<div id="root">') && STATS_FIELDS.every((f) => !byPathText.includes(`"${f}"`)), byPath.status);
  await stopWrangler(wrangler);

  console.log(`== phase 2: the tenant host (${HTTP_BASE} as ${slug}.work.avarok.net)`);
  wrangler = await startWrangler(persistTo, [...PRODUCTION_LIKE_OVERRIDES, "--local-upstream", `${slug}.work.avarok.net`]);
  for (const [method, path] of [["GET", "/"], ["GET", "/index.html"], ["GET", "/stats"], ["POST", "/"]]) {
    const r = await fetch(`${HTTP_BASE}${path}`, { method, body: method === "POST" ? "x" : undefined });
    const text = await r.text();
    check(results, `${method} ${path} on the tenant host is 426 with nothing in it`,
      // Not the `Upgrade` response header: it is hop-by-hop, and wrangler's proxy drops it (the
      // vitest suite, which calls the Worker directly, asserts it).
      r.status === 426 && text === "a workspace is reached over a WebSocket", `${r.status} ${JSON.stringify(text.slice(0, 80))}`);
  }
  const code = verdict("PRODUCTION-LIKE", results);
  if (code !== 0 || flag !== "--serve") {
    await stopWrangler(wrangler);
    process.exit(code);
  }
  serving = true;
  console.log(`SERVING ${HTTP_BASE} as ${slug}.work.avarok.net (claims in ${claimsFile}); Ctrl-C to stop`);
  const stop = async () => {
    await stopWrangler(wrangler);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (e) {
  console.error(`proof-production failed: ${e?.stack ?? e}`);
  if (!serving) console.error(wrangler.output().slice(-4000));
  await stopWrangler(wrangler);
  process.exit(1);
}
