/**
 * The control host's `/sign-in/*` routes (sign-in-with-citadel.md §1-§4): the public allowlist,
 * the issuer's three endpoints (sign-in-issuer.mjs) and the code page, the `return` of `sw-mcp`.
 * `/sign-in` itself is the UI's page (lane I5), served with the rest of the site.
 *
 * `begin` and `prove` come from that page only (readJson: our own Origin). `complete` comes from
 * a client: the MCP, with no Origin, or a browser client from its allowlisted origin (§5, CORS).
 * The code reaches the person only in the body of a form POST to the code page, never in a URL:
 * that page reads no query and answers nothing to a GET.
 */
import { json, readJson, readText, refuse } from "./http.mjs";
import { issuerMissing, issuerOf } from "./control-identity.mjs";
import { beginSignIn, completeSignIn, proveSignIn } from "./sign-in-issuer.mjs";
import { completionOrigins, SIGN_IN_CLIENTS } from "./sign-in-clients.mjs";
import { CODE_SHAPE } from "./sign-in-code.mjs";

export const SIGN_IN_PREFIX = "/sign-in/";
/** Bodies: a link's four fields; a proof of at most 8130 base64url characters; a completion. */
const BEGIN_LIMIT = 2048;
const PROVE_LIMIT = 9216;
const COMPLETE_LIMIT = 2048;
const CODE_PAGE_LIMIT = 512;
const CORS_MAX_AGE_S = 600;
const STATE_SHAPE = /^[A-Za-z0-9_-]{22,43}$/;

export async function serveSignIn(io, cfg, request, url) {
  const route = url.pathname.slice(SIGN_IN_PREFIX.length);
  const method = request.method;
  const issuer = issuerOf(cfg);
  if (issuer === null) {
    issuerMissing(url.pathname);
    return refuse("issuer_unavailable", "sign-in is not available: this host has no issuer key", 503);
  }
  if (route === "clients.json" && method === "GET") return json(SIGN_IN_CLIENTS, 200, { "cache-control": "public, max-age=300" });
  if (route === "begin" && method === "POST") return withJson(request, cfg, BEGIN_LIMIT, (body) => beginSignIn(io, issuer, body));
  if (route === "prove" && method === "POST") return withJson(request, cfg, PROVE_LIMIT, (body) => proveSignIn(io, issuer, body));
  if (route === "complete" && method === "OPTIONS") return preflight(request);
  if (route === "complete" && method === "POST") return complete(io, issuer, request);
  if (route === "code" && method === "POST") return codePage(request, cfg);
  if (route === "code") return refuse("method-not-allowed", "this page is reached by the sign-in form only", 405);
  return refuse("not-found", "no such route", 404);
}

async function withJson(request, cfg, limit, handle) {
  const body = await readJson(request, cfg, limit);
  return body.error ?? (await handle(body.value));
}

/** The CORS origin a completion may come from: null (no Origin, a native client), the origin, or false. */
function completionOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin === null) return null;
  return completionOrigins().has(origin) ? origin : false;
}

const corsHeaders = (origin) => (origin === null ? {} : { "access-control-allow-origin": origin, vary: "Origin" });

function preflight(request) {
  const origin = completionOrigin(request);
  if (!origin) return refuse("cross-origin", "this origin may not complete a sign-in", 403);
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      "access-control-allow-methods": "POST",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": String(CORS_MAX_AGE_S),
    },
  });
}

async function complete(io, issuer, request) {
  const origin = completionOrigin(request);
  if (origin === false) return refuse("cross-origin", "this origin may not complete a sign-in", 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return refuse("malformed_request", "the body is JSON", 415);
  }
  const read = await readText(request, COMPLETE_LIMIT);
  if (read.error) return read.error;
  let body;
  try {
    body = JSON.parse(read.text);
  } catch {
    body = null;
  }
  const response = body && typeof body === "object" && !Array.isArray(body)
    ? await completeSignIn(io, issuer, body)
    : refuse("malformed_request", "the body is one JSON object", 400);
  for (const [name, value] of Object.entries(corsHeaders(origin))) response.headers.set(name, value);
  return response;
}

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

/**
 * `POST /sign-in/code` (the `sw-mcp` return): `ReturnPost` `{code, state}` form-encoded, from our
 * own page only, displayed for pasting into the MCP. Both fields are checked against their shapes,
 * so nothing a poster chooses beyond a code's 32 symbols is ever rendered.
 */
async function codePage(request, cfg) {
  const origin = request.headers.get("origin");
  if (!origin || !cfg.allowedOrigins.includes(origin)) return refuse("cross-origin", "this page is reached by the sign-in form only", 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return refuse("malformed_request", "the body is a form", 415);
  }
  const read = await readText(request, CODE_PAGE_LIMIT);
  if (read.error) return read.error;
  const form = new URLSearchParams(read.text);
  const keys = [...form.keys()];
  const code = form.get("code");
  const wellFormed = keys.length === 2 && keys.includes("code") && keys.includes("state") && CODE_SHAPE.test(code ?? "") && STATE_SHAPE.test(form.get("state") ?? "");
  if (!wellFormed) return refuse("malformed_request", "the form is {code, state}", 400);
  return new Response(codeHtml(code), { status: 200, headers: PAGE_HEADERS });
}

const codeHtml = (code) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your sign-in code</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 16px;line-height:1.5}
output{display:block;font:700 2.5rem ui-monospace,monospace;letter-spacing:.15em;margin:1.5rem 0}</style></head>
<body><h1>Your sign-in code</h1>
<p>Paste this code into the app that asked you to sign in. It works once, for ten minutes.</p>
<output id="code">${code}</output>
<p><strong>Never share this code.</strong> Nobody from Avarok or synchronized.work will ever ask you for it.</p>
</body></html>
`;
