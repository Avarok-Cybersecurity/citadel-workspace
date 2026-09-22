/**
 * The Phase 1 proof: a wasm Citadel client registers, connects and round-trips workspace requests
 * against the workspace server running in the Durable Object under `wrangler dev`.
 *
 *   node proof.mjs <ws-endpoint> [requests]
 *
 * Prints one JSON line of client-side timings and the stats the object reports, and exits non-zero
 * if any step fails. It measures; it does not start the worker.
 */
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { run_proof } = require("./proof-client/pkg/citadel_tenant_proof_client.js");

const endpoint = process.argv[2];
const requests = Number(process.argv[3] ?? "10");
if (!endpoint) {
  console.error("usage: node proof.mjs <ws-endpoint> [requests]");
  process.exit(2);
}
// The address the connection settings carry; the endpoint URL is what is actually dialled.
const serverAddr = "127.0.0.1:8787";
const username = `proof${Date.now()}`;
const password = randomBytes(12).toString("hex");

// CPU time of every workerd process (the Durable Object runs in one of them), in ms. `ps` reports
// centiseconds, so a phase's figure is quantised to 10 ms.
function workerdCpuMs() {
  const out = execSync("ps -axo time=,command=", { encoding: "utf8" });
  let total = 0;
  for (const line of out.split("\n")) {
    if (!line.includes("workerd serve")) continue;
    const parts = line.trim().split(/\s+/)[0].split(":").map(Number);
    total += parts.reduce((acc, v) => acc * 60 + v, 0);
  }
  return Math.round(total * 1000);
}

const phases = [];
const clientPhases = [];
let last = workerdCpuMs();
let lastClient = process.cpuUsage();
const onPhase = (name) => {
  const client = process.cpuUsage(lastClient);
  clientPhases.push([name, Math.round((client.user + client.system) / 1000)]);
  const now = workerdCpuMs();
  phases.push([name, now - last]);
  last = now;
  lastClient = process.cpuUsage();
};

const t0 = performance.now();
try {
  const report = JSON.parse(
    await run_proof(serverAddr, endpoint, username, password, requests, process.env.LOG_FILTER ?? "citadel=warn", onPhase),
  );
  report.total_ms = performance.now() - t0;
  report.server_cpu_ms_by_phase = Object.fromEntries(phases);
  report.client_cpu_ms_by_phase = Object.fromEntries(clientPhases);
  const statsUrl = endpoint.replace(/^ws/, "http");
  report.object = await (await fetch(statsUrl)).json();
  const { responses, ...timings } = report;
  console.log(`PROOF PASS ${JSON.stringify(timings)}`);
  responses.forEach((r, i) => console.log(`RESPONSE ${i}: ${r}`));
  process.exit(0);
} catch (e) {
  console.log(`PROOF FAIL after ${Math.round(performance.now() - t0)} ms: ${e?.message ?? e}`);
  process.exit(1);
}
