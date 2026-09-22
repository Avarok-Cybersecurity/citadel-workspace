/**
 * Shared plumbing for the Phase 3 proofs (durable.mjs, isolation.mjs): run `wrangler dev` as a
 * child, drive the wasm proof client (`proof-client` `ProofClient`), read an object's stats.
 * Requires Node >= 22 (a global WebSocket, which the wasm client dials with).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const { start_client } = require("./proof-client/pkg/citadel_tenant_proof_client.js");

export const PORT = Number(process.env.PROOF_PORT ?? "8807");
export const BASE = `127.0.0.1:${PORT}`;
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
  const res = await fetch(`http://${BASE}/${tenant}`);
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

/** `wrangler dev` on PORT with local state persisted under `persistTo`; resolves once serving. */
export async function startWrangler(persistTo) {
  const child = spawn(
    "npx",
    ["wrangler@4", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", persistTo],
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
        await fetch(`http://${BASE}/__ready`);
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
