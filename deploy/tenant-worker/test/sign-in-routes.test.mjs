/**
 * The control host's /sign-in/* routes over HTTP (batch 1116 lane I4c): who may call each, and
 * how the code reaches the person -- the body of a form POST to the code page, never a URL.
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { beginSignIn, proveSignIn } from "../control/sign-in-issuer.mjs";
import { SIGN_IN_CLIENTS } from "../control/sign-in-clients.mjs";
import { beginBody, breaks, CFG, issuer, KAT_DEVICE, KAT_NONCE, KAT_PROOF, KAT_VERIFIER, katIo, pagePost, read, signInFixture } from "./sign-in-helpers.mjs";

const url = (path) => `https://${CFG.controlHost}${path}`;
const STATE = signInFixture("ReturnPost/valid.json").state;

/** A code proven through the production handlers, at the real clock. */
async function proven() {
  const io = katIo({ now: Math.floor(Date.now() / 1000) }, [crypto.getRandomValues(new Uint8Array(16)), KAT_NONCE]);
  const begun = await (await beginSignIn(io, issuer(), beginBody())).json();
  return read(await proveSignIn(io, issuer(), { v: 1, attempt: begun.attempt, proof: KAT_PROOF }));
}

describe("the allowlist", () => {
  it("is C0's initial ReturnAllowlist", () => {
    expect(SIGN_IN_CLIENTS).toEqual(signInFixture("ReturnAllowlist/valid.json"));
  });
});

describe("begin and prove answer the sign-in page only", () => {
  it("begin from our own origin draws a schema-valid attempt; from another origin it is refused", async () => {
    const r = await read(await pagePost("/sign-in/begin", beginBody()));
    expect(r.status).toBe(200);
    expect(breaks("SignInBeginResponse", r.body)).toBeNull();
    expect(r.body).toMatchObject({ issuer: "work.avarok.net", aud: "sw-mcp", expires_in_s: 300 });
    const foreign = await SELF.fetch(url("/sign-in/begin"), {
      method: "POST", headers: { origin: "https://work.avarok.net.evil.example", "content-type": "application/json" }, body: JSON.stringify(beginBody()),
    });
    expect(foreign.status).toBe(403);
  });

  it("prove over HTTP runs the attempt's checks", async () => {
    const r = await read(await pagePost("/sign-in/prove", { v: 1, attempt: "A".repeat(22), proof: KAT_PROOF }));
    expect(r).toMatchObject({ status: 400, body: { error: "unknown_attempt" } });
  });
});

describe("the code never travels in a URL", () => {
  it("prove names the allowlisted return exactly, with no query, fragment or code, and redirects nowhere", async () => {
    const { status, body } = await proven();
    expect(status).toBe(200);
    expect(breaks("SignInProveResponse", body)).toBeNull();
    expect(body.return).toBe(SIGN_IN_CLIENTS.clients["sw-mcp"].returns[0]);
    const target = new URL(body.return);
    expect(target.search + target.hash).toBe("");
    expect(body.return).not.toContain(body.code);
  });

  it("the code page shows a code POSTed to it by our page, and answers a GET carrying one with nothing", async () => {
    const { body } = await proven();
    const form = new URLSearchParams({ code: body.code, state: STATE }).toString();
    const page = await SELF.fetch(url("/sign-in/code"), {
      method: "POST", headers: { origin: CFG.publicOrigin, "content-type": "application/x-www-form-urlencoded" }, body: form,
    });
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await page.text();
    expect(html).toContain(`<output id="code">${body.code}</output>`);
    expect(html).toContain("Never share this code");

    const viaUrl = await SELF.fetch(url(`/sign-in/code?${form}`));
    expect(viaUrl.status).toBe(405);
    expect(await viaUrl.text()).not.toContain(body.code);
  });

  it("the code page refuses another origin's form and anything but {code, state}", async () => {
    const post = (origin, form) =>
      SELF.fetch(url("/sign-in/code"), { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: form });
    expect((await post("https://evil.example", `code=ZTBN-PG9A&state=${STATE}`)).status).toBe(403);
    expect((await post(CFG.publicOrigin, `code=<script>&state=${STATE}`)).status).toBe(400);
    expect((await post(CFG.publicOrigin, `code=ZTBN-PG9A&state=${STATE}&extra=1`)).status).toBe(400);
  });
});

describe("complete answers a client", () => {
  const completion = (code, headers = {}) =>
    SELF.fetch(url("/sign-in/complete"), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ v: 1, client: "sw-mcp", code, verifier: KAT_VERIFIER, device: KAT_DEVICE }),
    });

  it("from the MCP (no Origin) it signs a schema-valid assertion", async () => {
    const { body } = await proven();
    const r = await read(await completion(body.code));
    expect(r.status).toBe(200);
    expect(breaks("SignInCompleteResponse", r.body)).toBeNull();
  });

  it("CORS admits exactly the allowlisted origins", async () => {
    const preflight = (origin) => SELF.fetch(url("/sign-in/complete"), { method: "OPTIONS", headers: { origin } });
    const ok = await preflight("https://synchronized.work");
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://synchronized.work");
    expect((await preflight("https://evil.example")).status).toBe(403);
    expect((await completion("ZTBN-PG9A", { origin: "https://evil.example" })).status).toBe(403);
    const fromSite = await completion("ZTBN-PG9A", { origin: "https://synchronized.work" });
    expect(fromSite.headers.get("access-control-allow-origin")).toBe("https://synchronized.work");
  });
});
