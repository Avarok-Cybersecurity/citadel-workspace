/**
 * Shared plumbing for the proofs (durable.mjs, isolation.mjs, serve-tenants.mjs): run `wrangler
 * dev` as a child, create tenants through the control plane, drive the wasm proof client
 * (`proof-client` `ProofClient`), read an object's stats.
 * Requires Node >= 22 (a global WebSocket, which the wasm client dials with).
 *
 * A tenant's object is reached only once the control plane has created the tenant
 * (control/dispatch.mjs), so every proof provisions its tenants first, as a customer would: a
 * free-tier creation behind Cloudflare's always-pass Turnstile TESTING secret.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const { start_client } = require("./proof-client/pkg/citadel_tenant_proof_client.js");

export const PORT = Number(process.env.PROOF_PORT ?? "8807");
export const BASE = `127.0.0.1:${PORT}`;
/** `https` serves the edge with wrangler's self-signed certificate (`--local-protocol https`). */
const LOCAL_PROTOCOL = process.env.PROOF_LOCAL_PROTOCOL ?? "http";
if (LOCAL_PROTOCOL !== "http" && LOCAL_PROTOCOL !== "https") throw new Error("PROOF_LOCAL_PROTOCOL is http or https");
export const HTTP_BASE = `${LOCAL_PROTOCOL}://${BASE}`;
/** Cloudflare's published always-pass Turnstile testing secret: not a credential. */
const TURNSTILE_TESTING_SECRET = process.env.PROOF_TURNSTILE_SECRET ?? "1x0000000000000000000000000000000AA";
const LOG_FILTER = process.env.LOG_FILTER ?? "citadel=warn";

if (typeof WebSocket !== "function") {
  console.error(`node ${process.version} has no global WebSocket; run the proofs with Node >= 22`);
  process.exit(2);
}

// Every socket the wasm client opens goes through here, so a proof can point a client that
// registered on one tenant at another tenant's object without the client knowing.
const redirects = new Map();
const NativeWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends NativeWebSocket {
  constructor(url, protocols) {
    super(redirects.get(String(url)) ?? url, protocols);
  }
};
export function redirect(from, to) {
  if (to === null) redirects.delete(from);
  else redirects.set(from, to);
}

export const endpoint = (tenant) => `ws://${BASE}/${tenant}`;
export const secret = () => randomBytes(12).toString("hex");

export async function client(tenant) {
  return start_client(BASE, endpoint(tenant), LOG_FILTER);
}

export async function stats(tenant) {
  const res = await fetch(`${HTTP_BASE}/${tenant}`);
  if (!res.ok) throw new Error(`stats for ${tenant}: HTTP ${res.status}`);
  return res.json();
}

/** A request as JSON in, the response as a parsed object out. */
export async function request(c, body) {
  return JSON.parse(await c.request(JSON.stringify(body)));
}

/**
 * The kernel enrols an account from its ConnectSuccess event, which can land after the client's
 * connect resolved; a request for the account's own record can beat it. Retry that case only.
 */
export async function requestOnceEnrolled(c, body) {
  for (let attempt = 0; ; attempt++) {
    const response = await request(c, body);
    const error = response.Error ?? "";
    if (!/User not found|not a member/i.test(error) || attempt >= 20) return response;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Creates `slug` as a free tenant through the control plane and returns its claim code (the
 * tenant's master password, shown once). Throws unless the tenant is active and its object holds
 * that code.
 */
export async function provision(slug) {
  const res = await fetch(`${HTTP_BASE}/api/tenants`, {
    method: "POST",
    headers: { origin: HTTP_BASE, "content-type": "application/json" },
    body: JSON.stringify({ slug, display_name: `Proof ${slug}`, tier: "free", turnstile_token: "XXXX.DUMMY.TOKEN.XXXX" }),
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 201 || body?.status !== "active" || !/^[0-9a-f]{64}$/.test(body?.claim_code ?? "")) {
    throw new Error(`creating tenant ${slug}: HTTP ${res.status} ${JSON.stringify(body?.error ?? body?.status)}`);
  }
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.claim_code))).toString("hex");
  const held = (await stats(slug)).master_password_sha256_prefix;
  if (held !== digest.slice(0, 8)) throw new Error(`tenant ${slug}: its object does not hold the claim code`);
  return body.claim_code;
}

/**
 * `wrangler dev` on PORT with local state persisted under `persistTo`, the control plane's D1
 * migrated there and tenants routed by path; resolves once serving.
 */
export async function startWrangler(persistTo) {
  const migrate = spawnSync(
    "npx",
    ["wrangler@4", "d1", "migrations", "apply", "citadel-control", "--local", "--persist-to", persistTo],
    { encoding: "utf8", env: { ...process.env, CI: "1" } },
  );
  if (migrate.status !== 0) throw new Error(`migrating the control plane's D1 failed:\n${migrate.stdout}${migrate.stderr}`);
  const child = spawn(
    "npx",
    [
      "wrangler@4", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", persistTo,
      "--local-protocol", LOCAL_PROTOCOL,
      "--var", "TENANT_PATH_ROUTING:on",
      "--var", `ALLOWED_ORIGINS:${HTTP_BASE}`,
      "--var", "TURNSTILE_HOSTNAMES:example.com",
      "--var", `TURNSTILE_SECRET:${TURNSTILE_TESTING_SECRET}`,
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } },
  );
  let output = "";
  const collect = (chunk) => {
    output += chunk;
    if (process.env.PROOF_VERBOSE) process.stderr.write(chunk);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited ${child.exitCode}:\n${output}`);
    if (/Ready on/.test(output)) {
      try {
        await fetch(`${HTTP_BASE}/api/slug/probe-ready`);
        return { child, output: () => output };
      } catch {
        // not accepting yet
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await stopWrangler({ child });
  throw new Error(`wrangler dev did not come up in 60 s:\n${output}`);
}

/** Stop wrangler and its workerd children (the whole process group), and wait for them. */
export async function stopWrangler({ child }) {
  if (child.exitCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  try {
    process.kill(-child.pid, "SIGINT");
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }, 10_000);
  await exited;
  clearTimeout(timer);
}

export function check(results, name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : `: ${detail}`}`);
}

export function verdict(label, results) {
  const failed = results.filter((r) => !r.ok);
  console.log(`${label} ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length - failed.length}/${results.length} checks)`);
  return failed.length === 0 ? 0 : 1;
}

export const short = (value) => JSON.stringify(value).slice(0, 220);
