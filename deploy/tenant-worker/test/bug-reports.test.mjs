/**
 * POST /api/bug-reports against the real Worker and its local D1: what is stored, and each refusal
 * the client turns into a sentence (citadel-workspaces/src/lib/bug-report/send.ts).
 */
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ioFor } from "../control/dispatch.mjs";
import { REPORTS_PER_HOUR } from "../control/bug-reports.mjs";
import { RETENTION_MS } from "../control/bug-report-store.mjs";
import { ORIGIN } from "./helpers.mjs";

let n = 0;
const freshIp = () => `198.51.100.${(n++ % 250) + 1}-${Date.now()}`;

const report = (overrides = {}) => ({
  format: 1, surface: "apps.NotListed", note: "it broke", contact: null,
  context: [
    { key: "build", label: "App version", value: "seq 9", removable: false },
    { key: "tenant", label: "Workspace server", value: "acme.work.avarok.net", removable: false },
  ],
  console: [{ at: 1, source: "ConsoleError", message: "fetch failed <url>", stack: null, repeats: 2 }],
  crumbs: [{ at: 1, dir: "sent", kind: "Telemetry.GetMyConsent" }],
  trail: [{ at: 1, kind: "taken", surface: "apps.NotListed", route: "report-bug" }],
  ...overrides,
});

const send = (body, ip = freshIp(), origin = ORIGIN) =>
  SELF.fetch(`${ORIGIN}/api/bug-reports`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "cf-connecting-ip": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/bug-reports", () => {
  it("stores a well-formed report for 90 days under a random id, with the tenant resolved from its server", async () => {
    const response = await send(report());
    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect(id).toMatch(/^br_[0-9a-f]{24}$/u);
    const row = await ioFor(env).bugReports.get(id, Date.now());
    expect(row.tenant).toBe("acme");
    expect(row.contact).toBeNull();
    expect(JSON.parse(row.body).note).toBe("it broke");
    const stored = await env.CONTROL_DB.prepare("SELECT received_at_ms, expires_at_ms FROM bug_reports WHERE id = ?").bind(id).first();
    expect(stored.expires_at_ms - stored.received_at_ms).toBe(RETENTION_MS);
  });

  it("records the contact only when the report carries one", async () => {
    const { id } = await (await send(report({ contact: "alice@acme.work.avarok.net" }))).json();
    expect((await ioFor(env).bugReports.get(id, Date.now())).contact).toBe("alice@acme.work.avarok.net");
  });

  it("422 when a field still carries a shape that must not be stored, and nothing is stored", async () => {
    const before = (await env.CONTROL_DB.prepare("SELECT count(*) AS c FROM bug_reports").first()).c;
    const leaky = report({ console: [{ at: 1, source: "ConsoleError", message: "GET https://x.example/?t=1", stack: null, repeats: 1 }] });
    const response = await send(leaky);
    expect(response.status).toBe(422);
    expect((await response.json()).detail).toBe("console[0] looks like a url");
    expect(await send(report({ note: "my key is AAAAB3NzaC1yc2EAAAADAQABAAABAQ" }))).toHaveProperty("status", 422);
    expect((await env.CONTROL_DB.prepare("SELECT count(*) AS c FROM bug_reports").first()).c).toBe(before);
  });

  it("400 for an unknown field, 413 over 96 KiB, 403 from another origin", async () => {
    expect((await send({ ...report(), screenshot: "x" })).status).toBe(400);
    expect((await send(report({ note: "x".repeat(100 * 1024) }))).status).toBe(413);
    expect((await send(report(), freshIp(), "https://evil.example")).status).toBe(403);
  });

  it(`at most ${REPORTS_PER_HOUR} an hour from one address; another address is unaffected`, async () => {
    const ip = freshIp();
    for (let i = 0; i < REPORTS_PER_HOUR; i += 1) expect((await send(report(), ip)).status).toBe(201);
    expect((await send(report(), ip)).status).toBe(429);
    expect((await send(report())).status).toBe(201);
  });

  it("the purge deletes only reports past their 90 days", async () => {
    const store = ioFor(env).bugReports;
    const { id } = await (await send(report())).json();
    await store.purge(Date.now());
    expect(await store.get(id, Date.now())).not.toBeNull();
    await store.purge(Date.now() + RETENTION_MS + 1);
    expect(await env.CONTROL_DB.prepare("SELECT id FROM bug_reports WHERE id = ?").bind(id).first()).toBeNull();
  });
});
