# Contract: "Sign in with Citadel" (owner decision D-B, §9a, 2026-11-16) — FROZEN 2026-11-16

Schema: `sign-in-with-citadel.schema.json` (`$defs` SignInLink, ReturnAllowlist, ReturnPost,
SignInBeginRequest, SignInBeginResponse, SignInProveRequest, SignInProveResponse,
SignInCompleteRequest, SignInCompleteResponse; fixtures under `fixtures/sign-in-with-citadel/`).
Known answers: `sign-in-kat.json`. The assertion format and verifier are `identity-api.md` §7; the
identity proof (§1a) is `identity-api.md` §7a. Parties: work.avarok.net (I5: the page; I4: the
allowlist, the attempt and code stores, the issuer endpoints, the control host's identity, §7),
the local agent (I2: `IdentitySignChallenge`, §8), `sw-mcp` (S4), the synchronized.work site (S3),
the sw node (S2: consumes assertions in ENROL). Design and threat model:
`~/avarok/wt/apps-plan/SIGN-IN-IDENTITY-PROOF.md`.

## 1. The flow (MCP variant; the browser variant differs only in §5)

1. **Start.** `sw-mcp` tool `sign_in_start` draws `verifier` (32 random bytes, memory only),
   computes `challenge = SHA3-256(verifier)`, `state` (16..=32 random bytes), and returns
   `https://work.avarok.net/sign-in?client=sw-mcp&challenge=<b64url>&state=<b64url>&return=<url-encoded>`
   plus the **match phrase** (§3). Exactly those four parameters (`SignInLink`); any other
   parameter is refused by the page. `return` must be in the allowlist for `client` (§2) or the
   page shows a refusal and never signs anyone in.
2. **Page.** The page reuses the login modal (register = create a portable identity in the local
   agent through the identity screens; sign in = prove the one it holds). It shows the requesting
   client's `display_name`, the browser's device description, and the match phrase recomputed from
   `challenge`. The person compares the phrase with what the MCP printed before approving. **Which**
   identity is signing in is proven by §1a; the page never tells the issuer a public key.
3. **Return.** After the proof (§1a) the page renders an auto-submitting form that POSTs
   `ReturnPost` `{code, state}` (`application/x-www-form-urlencoded`) to the `return` the issuer
   echoed in `SignInProveResponse`. Nothing but `challenge` and `state` ever travels in a URL. For
   `client=sw-mcp` the only allowlisted return is `https://work.avarok.net/sign-in/code`, a page
   that displays the code for pasting with the words "never share this code". The code (§4) is
   stored server-side as `{code → challenge, aud, identity_pk, issued_at, used: false}` where
   `identity_pk` is **the key the proof carried** — the only way it ever gets there.
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
   audience, expired assertion (`sign-in-kat.json` `must_fail`); and for the proof, every case of
   `proof_must_fail` (§1a).

## 1a. Identity proof (between steps 2 and 3): the agent signs the issuer's challenge

Constants (`sign-in-kat.json` `proof_constants`): `ATTEMPT_TTL_S = 300`, `MAX_PROOF_FAILURES = 5`,
`AGENT_PROBE_MS = 3000`, `PROOF_VERSION = 0x01`, domain `citadel-sign-in-proof-v1`.

1. **Probe.** Before anything is sent to the issuer, the page asks the local agent `IdentityStatus`
   over `wss://local.avarok.net:12345`. No answer within `AGENT_PROBE_MS`: the page shows "Install
   the Citadel Agent" (the download component, a Retry button) and stops. There is no fallback — no
   phrase import, no typed password — and no server state exists for a visitor without an agent.
2. **Begin.** `POST https://work.avarok.net/sign-in/begin` `SignInBeginRequest` `{v: 1, client,
   challenge, state, return}`. The issuer re-validates the link (`client` registered, `return`
   allowlisted for it; 400 `unknown_client | return_not_allowlisted | malformed_link`), draws
   `attempt` (16..=32 random bytes) and `nonce` (32 random bytes), stores `{attempt → nonce, client,
   aud, challenge, return, created_at, proven: false, failures: 0}` for `ATTEMPT_TTL_S`, and answers
   `SignInBeginResponse` `{v: 1, attempt, nonce, issuer: "work.avarok.net", aud, display_name,
   expires_in_s}`. `aud` and `display_name` come from the allowlist (SSOT); `expires_in_s` is
   relative so a skewed browser clock cannot refuse a fresh proof.
3. **Consent and signature.** The page shows the consent dialog (§8) and, on Approve, sends the
   agent `IdentitySignChallenge {issuer, aud, nonce, challenge, unlock_password}`. The agent
   re-proves the unlock password against the sealed seed, takes **`origin` from the `Origin` header
   of the control connection's handshake** (browser-set; never from the request), and answers
   `IdentityOutcome::SignedChallenge { proof }` where `proof` is the base64url blob of
   identity-api §7a: `0x01 ‖ str16(issuer) ‖ str16(aud) ‖ str16(origin) ‖ nonce ‖ challenge ‖
   identity_pk ‖ sig` signed by the **identity key**.
4. **Prove.** `POST /sign-in/prove` `SignInProveRequest` `{v: 1, attempt, proof}`. The issuer
   checks, in order: `attempt` exists (`unknown_attempt`), `now − created_at ≤ ATTEMPT_TTL_S`
   (`attempt_expired`), not proven (`attempt_proven`); then `verify_proof(blob, "work.avarok.net",
   "https://work.avarok.net", stored aud, stored nonce, stored challenge)`: parse and version
   (`malformed_proof`), signature under the key inside the blob (`bad_signature`), `issuer`
   (`wrong_issuer`), `origin` (`wrong_origin`), `aud` (`audience_mismatch`), `nonce`
   (`nonce_mismatch`), `challenge` (`challenge_mismatch`). Any failure: HTTP 400 with the reason;
   after `MAX_PROOF_FAILURES` the attempt is burnt. Success: the attempt is marked proven (a second
   `prove` is `attempt_proven`), the code (§4) is drawn and stored with `identity_pk` = the proof's
   key, and the answer is `SignInProveResponse` `{v: 1, code, return, state}`. Step 3 of §1 follows.

Replay: a proof is bound to this issuer (`issuer`), this page origin (`origin`), this client
(`aud`), this attempt (`nonce`) and this link (`challenge`), and an attempt is proven once; no
proof is valid twice or anywhere else. Phishing: a page on another origin is refused the agent's
handshake by its `OriginPolicy`; one that is admitted anyway gets a proof naming its own origin,
which the issuer refuses; one that forwards the person to another `challenge` shows other match
words. The issuer keeps **no identity registry**: the subject of the assertion is the key the proof
proved. Vectors: `sign-in-kat.json` `attempt`, `proof`, `proof_must_fail`.

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

## 7. The issuer's identity: work.avarok.net's key and `/.well-known/citadel` (I4)

The control host runs no Citadel node, so until now it had no server key and no document.

- **Key at rest:** the Worker secret `CONTROL_SERVER_KEY_SEED` (32 bytes as 64 hex chars), set
  once by the operator from the OS CSPRNG (`wrangler secret put`; DEPLOY.md), **never generated in
  code** (a new key makes every pinned consumer refuse the issuer — `KeyChanged`, the correct and
  visible outcome). `xi_server = HMAC-SHA3-256(seed, "citadel-server-sign-v1")`, ML-DSA-65: the same
  `ServerKey` derivation as every tenant, so the KAT seeds convention holds (`sign-in-kat.json`
  `issuer.key.seed_hex` is a test seed, never a production one). `deploy.sh`'s required-secrets
  check gains it. Without it the Worker answers `/.well-known/citadel` 404 with a log line, every
  `/sign-in/*` endpoint `503 issuer_unavailable`, and signs nothing.
- **`issued_at` is the var `CONTROL_SERVER_KEY_ISSUED_AT`** (Unix seconds, `[vars]`, changed only
  with the key), not a clock: a Worker runs in many isolates, and first-request issuance would let a
  later fetch show an older `issued_at` than the pinned one (`Stale`). Every isolate serves
  byte-identical, deterministically signed JSON.
- **The document** has **no `citadel` member** (`well-known-citadel.schema.json`: `citadel` is now
  optional; absent ⇔ an issuer-only server): `{v: 1, canonical_domain: "work.avarok.net",
  server_key, former_domains: [], issued_at, sig}`. The agent refuses `RegisterIdentity` and
  `ServerDiscovery` against such a domain with `NoCitadelEndpoint`. Fixture:
  `fixtures/well-known-citadel/valid-issuer-only.json`; vector: `sign-in-kat.json` `issuer.well_known`.
- **Serving:** `GET /.well-known/citadel` on the control host (dispatch `routeOf` → null) answers it,
  `application/json`, `Cache-Control: max-age=300`, built by a new control-plane module
  (`control-identity`, beside `control/tenant-identity.mjs`) through a server-wasm `IssuerIdentity
  { seed, canonical_domain, issued_at }` with `well_known()` and `sign_assertion()` — the crate's
  code, one key for the document and the assertions.
- **Path-routing exception:** `tenantFor` treats the first path segment as a slug only when it is
  not in `CONTROL_SEGMENTS = {"api", ".well-known", "sign-in"}` (one set in `control/dispatch.mjs`,
  replacing the lone `/api/` test); a tenant's document stays at `/<slug>/.well-known/citadel`.
  `sign-in` joins `RESERVED` in `control/slug.mjs`.
- Consumers (`sw-mcp`, the sw node) pin `(pk, issued_at)` on first fetch and `check_against_pin`
  after — unchanged, now against a document that exists.

## 8. The agent wire: `IdentitySignChallenge` and consent (I2, I5)

```rust
InternalServiceRequest::IdentitySignChallenge {
    request_id: Uuid, issuer: String, aud: String, nonce: [u8; 32], challenge: [u8; 32],
    unlock_password: SecBuffer,          // re-proven against the sealed seed, as IdentityExport re-proves
}
IdentityOutcome::SignedChallenge { proof: String }          // base64url blob, identity-api.md §7a
IdentityRefusal::{ NoIdentity, WrongPassword, NoBrowserOrigin, RateLimited, BadField }
```
- The agent records the handshake `Origin` on every control connection (today `origin_check` only
  admits or refuses it) and signs **that** string. A connection with no `Origin` (a native client)
  is refused `NoBrowserOrigin` for this request: a native approver is a later extension with an
  origin label of its own that the issuer would list.
- The password is re-proven per signature; lock state is unchanged (a locked identity signs after
  the re-proof exactly as `IdentityExport` exports). Rate: one request per 2 s per connection; five
  `WrongPassword` in a row → `RateLimited` for 60 s. Both are explicit `[identity]` settings in the
  agent's config (PCND), with these values in the shipped `kernel.toml`.
- `issuer`, `aud` 1..=255 bytes; `nonce`, `challenge` exactly 32 → else `BadField`. The agent
  signs whatever `issuer` and `aud` the page names: both are checked by the issuer, and the page is
  on the issuer's own origin by construction.
- **Consent UX (I5):** a page dialog, never `window.confirm`, showing `display_name` and the client
  id, the device description, the three match words (≥ 24 px), "Signing in as `<id_fp grouped>`"
  (the agent's `IdentityStatus`), the copy "Only approve if you started this sign-in yourself and
  the words match what <display_name> printed", a `type=password` unlock field, Approve (disabled
  while the field is empty) and Cancel. New users first run `IdentityCreate` and the recovery-phrase
  confirmation (the I5 identity screens), then the same dialog.
