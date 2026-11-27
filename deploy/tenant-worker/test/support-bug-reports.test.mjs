/**
 * Avarok support's signed reads of problem reports (control/support.mjs `bugs` and `bug`) through
 * the real verifier (server-wasm) and the real D1 store: only a verified request lists them or
 * returns a body, each at its own route, and a report past its 90 days is not returned. The
 * requests are support_fixtures' (citadel-support-signature), signed at one fixed instant.
 */
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ioFor } from "../control/dispatch.mjs";
import { config } from "../control/http.mjs";
import { serveSupport, supportRoute } from "../control/support.mjs";
import { RETENTION_MS } from "../control/bug-report-store.mjs";
import fixtures from "./fixtures/support-requests.json";
import { ORIGIN } from "./helpers.mjs";

const NOW = fixtures.now_ms;
const STORED = "br_0123456789abcdef01234567";

function ask(route, name, at = NOW) {
  const io = { ...ioFor(env), nowMs: () => at };
  const request = new Request(`${ORIGIN}/api/support/${route}`, { method: "POST", body: fixtures.requests[name] });
  return serveSupport(io, config(env), request, supportRoute("POST", ["support", route]));
}

beforeAll(async () => {
  const store = ioFor(env).bugReports;
  await store.insert({ id: STORED, tenant: "acme", surface: "app.boot-failed", contact: null, body: '{"what":"it froze"}' }, NOW - 1_000);
});

describe("the problem reports, read by support", () => {
  it("lists them without bodies", async () => {
    const r = await ask("bugs", "list_bug_reports");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      reports: [{ id: STORED, tenant: "acme", surface: "app.boot-failed", contactable: false, received_at_ms: NOW - 1_000 }],
    });
  });

  it("returns one with its body, by its id", async () => {
    const r = await ask("bug", "fetch_bug_report");
    expect(r.status).toBe(200);
    expect((await r.json()).report).toMatchObject({ id: STORED, body: '{"what":"it froze"}' });
  });

  it("names no report it does not hold", async () => {
    const r = await ask("bug", "fetch_missing_bug_report");
    expect(r.status).toBe(404);
  });

  it("serves a request only at its own route", async () => {
    const r = await ask("bug", "list_bug_reports_at_bug");
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "wrong-route" });
  });

  it("returns nothing past its 90 days", async () => {
    const store = ioFor(env).bugReports;
    expect(await store.get(STORED, NOW - 1_000 + RETENTION_MS)).toBeNull();
    expect(await store.list(0, NOW - 1_000 + RETENTION_MS)).toEqual([]);
  });

  it("refuses an unsigned read before touching the store", async () => {
    const io = { ...ioFor(env), nowMs: () => NOW };
    const r = await serveSupport(io, config(env), new Request(`${ORIGIN}/api/support/bugs`, { method: "POST", body: "{}" }), "bugs");
    expect(r.status).toBe(401);
  });
});
