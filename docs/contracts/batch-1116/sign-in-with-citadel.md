# Contract: "Sign in with Citadel" (owner decision D-B, §9a, 2026-11-16) — FROZEN 2026-11-16

Schema: `sign-in-with-citadel.schema.json` (`$defs` SignInLink, ReturnAllowlist, ReturnPost,
SignInCompleteRequest, SignInCompleteResponse; fixtures under `fixtures/sign-in-with-citadel/`).
Known answers: `sign-in-kat.json`. The assertion format and verifier are `identity-api.md` §7.
Parties: work.avarok.net (I5: the page, the allowlist, the code store, the issuer), `sw-mcp`
(S4), the synchronized.work site (S3), the sw node (S2: consumes assertions in ENROL).

## 1. The flow (MCP variant; the browser variant differs only in §5)

1. **Start.** `sw-mcp` tool `sign_in_start` draws `verifier` (32 random bytes, memory only),
   computes `challenge = SHA3-256(verifier)`, `state` (16..=32 random bytes), and returns
   `https://work.avarok.net/sign-in?client=sw-mcp&challenge=<b64url>&state=<b64url>&return=<url-encoded>`
   plus the **match phrase** (§3). Exactly those four parameters (`SignInLink`); any other
   parameter is refused by the page. `return` must be in the allowlist for `client` (§2) or the
   page shows a refusal and never signs anyone in.
2. **Page.** The page reuses the login modal (register or sign in with the portable identity,
   held by the local agent). It shows the requesting client's `display_name`, the browser's device
   description, and the match phrase recomputed from `challenge`. The person compares the phrase
   with what the MCP printed before confirming.
3. **Return.** After sign-in the page renders an auto-submitting form that POSTs `ReturnPost`
   `{code, state}` (`application/x-www-form-urlencoded`) to `return`. Nothing but `challenge` and
   `state` ever travels in a URL. For `client=sw-mcp` the only allowlisted return is
   `https://work.avarok.net/sign-in/code`, a page that displays the code for pasting. The code
   (§4) is stored server-side as `{code → challenge, aud, identity_pk, issued_at, used: false}`.
4. **Complete.** The person pastes the code into `sign_in_complete(code)`. The MCP POSTs
   `SignInCompleteRequest` `{v: 1, client, code, verifier, device}` to
   `https://work.avarok.net/sign-in/complete`. The server checks, in order: `client` registered;
   `code` exists, unused, `now − issued_at ≤ 600 s`; `SHA3-256(verifier) == challenge` stored
   under the code; `aud(client) == stored aud`; then marks the code used and answers
   `SignInCompleteResponse` `{v: 1, issuer: "work.avarok.net", assertion}` where `assertion` is
   the blob of identity-api §7 with `aud = allowlist.clients[client].aud`, `device` = the
   request's `device`, `nonce = challenge`, `exp = now + 30 days`, signed by work.avarok.net's
   **server identity key** (the one in its `/.well-known/citadel`; no second key). Any failed check
   answers HTTP 400 with a reason code (`unknown_client | unknown_code | code_used | code_expired |
   verifier_mismatch | audience_mismatch`) and, after 5 failed attempts on one code, burns it.
5. **Store and verify.** The MCP verifies with `verify_assertion(blob, issuer_pk, aud, challenge,
   now)` where `issuer_pk` comes from `https://work.avarok.net/.well-known/citadel` (pinned on
   first use, `check_against_pin` after), then seals the blob in its store. Tests, each with its
   negative control: replayed code, wrong verifier, expired code, off-allowlist return, mismatched
   audience, expired assertion (`sign-in-kat.json` `must_fail`).

## 2. Return-origin allowlist (`ReturnAllowlist`; served at `/sign-in/clients.json`, public)

`{ v: 1, clients: { <client id>: { display_name, aud, returns: [<https URL>…] } } }`. A client
id is `[a-z0-9][a-z0-9.-]*`; `aud` is normally the client id. A return URL is `https`, host and
optional port, an absolute path, **no query, no fragment, no wildcard, no userinfo**; matching is
exact after lowercasing scheme and host. There is no open redirect: a `return` not listed for its
`client` is refused before authentication. The file is the SSOT for both the page and the issuer.
Initial contents: `fixtures/sign-in-with-citadel/ReturnAllowlist/valid.json`.

## 3. Match phrase

`h = SHA3-256("citadel-sign-in-match-v1" ‖ 0x00 ‖ challenge)`; the first 33 bits of `h` are three
big-endian 11-bit indices into the recovery-phrase word list (identity-api §8). The MCP prints
them space-separated; the page shows the same three words. A phishing page that forwards the
person to a different `challenge` shows different words.

## 4. One-time code

Eight symbols from the 32-symbol alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no `I L O U`),
40 random bits, displayed and accepted as `XXXX-XXXX`; input is uppercased and the dash is
optional on entry, but the wire form always carries the dash. Single use, 600 s TTL, bound to the
challenge and the audience, rate-limited (§1 step 4). It is useless without `verifier`: a code
alone, stolen from a screen, yields nothing.

## 5. Browser variant (synchronized.work site)

Same link with `client=synchronized.work`, `return=https://synchronized.work/auth/return`. The
site keeps `verifier` and `state` in `sessionStorage`, receives the POST (§1 step 3) at
`/auth/return`, checks `state`, and calls `/sign-in/complete` by `fetch` (CORS: work.avarok.net
allows exactly the allowlisted origins). `device` is `browser#<kid>` of the browser's Controller
key. The site holds no identity seed; it is view-only until paired (SW §5.4).

## 6. What the assertion is for: enrolment without the seed (C0 decision, needs owner sign-off)

Under D-B the MCP never holds the identity seed, so it cannot derive the Endpoint password
(identity doc §3.3) or sign `ENROL` with the identity key (SW §4.3 row 11). Therefore:

- `device` is `<slug>#<base64url(SHA3-256(Endpoint ML-DSA-65 signing pk))>` (slug `[a-z0-9-]`,
  1..=64). The assertion binds the identity to **that key**, not just a label, so a node that sees
  the assertion cannot enrol a key of its own with it.
- The Device account on the sw node is `<id_fp>.<slug>@synchronized.work` (identity doc §5.2
  naming) with a **generated** password kept in the MCP's sealed store. The derived-password rule
  stays for Endpoints whose holder has the seed (the agent, CW-6).
- `ENROL` **by assertion**: `Signed.kid` is the Endpoint's own signing key, the payload is
  `{op: "enrol", endpoint_cid, kind, pubkeys, epoch, assertion: bstr}`, and the node accepts it
  iff the assertion verifies against work.avarok.net's pinned server key, `aud ∈ {sw-mcp,
  synchronized.work}`, it is unexpired, and `SHA3-256(pubkeys.sign)` equals the kid in
  `assertion.device`. Root-signed `ENROL` (agent path) is unchanged.
- **Owner question:** confirm this replaces the root signature for sign-in-enrolled Endpoints.
  The alternative (the page also signing `ENROL`) needs the Endpoint keys in the link, which D-B
  forbids.
