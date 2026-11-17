# Contract: `citadel-identity` (plan §5.1, identity doc rev b) — FROZEN 2026-11-16

Known answers: `identity-kat.json` (checked by `node scripts/check-batch-contracts.mjs`, which
recomputes every HMAC/SHA3/encoding step from the seeds and checks every length; ML-DSA-65
signatures are verified by the crate's own test against the vectors). Reference implementation:
`citadel-internal-service/citadel-identity/` (I1). Where this file and the crate disagree, this
file wins and the crate changes.

## 1. Constants (SSOT here; mirrored by the kernel test)

| name | value |
|---|---|
| `MAX_USERNAME_BYTES` | 255 (the kernel cap, u8 max) |
| `MIN_HANDLE_BYTES` / `MAX_HANDLE_BYTES` | 3 / 64 |
| `MAX_DOMAIN_BYTES` | 190 (64 + 1 + 190 = 255) |
| `SEED_LEN` / `PUBLIC_KEY_LEN` / `SIGNATURE_LEN` / `NONCE_LEN` | 32 / 1952 / 3309 / 32 |
| `PASSWORD_LEN` | 43 (base64url, no pad, of 32 bytes) |
| `FINGERPRINT_BYTES` | 10 (16 base32 chars, 80 bits) |
| `BINDING_VERSION` / `BINDING_FIXED_LEN` | `0x02` / 5272 (+ `len(domain)`) |
| `MAX_BINDING_BASE64_LEN` / `MAX_BINDING_FUTURE_SKEW_S` | 8192 / 300 |
| `WELL_KNOWN_VERSION` / `SERVER_KEY_ALG` | 1 / `"ML-DSA-65"` |
| `SERVER_CHALLENGE_TIMEOUT_S` / `WELL_KNOWN_FETCH_TIMEOUT_S` | 10 / 10 (seconds: the agent's wait for the `ServerIdentity` answer before refusing the sign-in / the whole `/.well-known/citadel` exchange) |
| `ASSERTION_VERSION` / `MAX_ASSERTION_FIELD_BYTES` | `0x01` / 255 |
| `PHRASE_WORDS` | 24 |

## 2. Primitives and domain separation

- Hash `SHA3-256`; MAC `HMAC-SHA3-256`; signatures FIPS 204 **ML-DSA-65, pure mode, empty
  context, deterministic variant** (`ml-dsa 0.1.1` `SigningKey::from_seed` + `Signer::sign`); no
  other algorithm anywhere in this crate.
- **Every signed message is `domain ‖ 0x00 ‖ body`** (`codec::domain_separated`). The three HMAC
  sub-key labels are the whole HMAC message with no separator. Domains, each used once:

| domain string | signs / hashes |
|---|---|
| `citadel-identity-sign-v1` | HMAC label → identity signing-key seed `xi` |
| `citadel-identity-pw-v1` | HMAC label → password key `k_pw` |
| `citadel-server-sign-v1` | HMAC label → server signing-key seed (§6) |
| `citadel-identity-fp-v1` | fingerprint hash body = `pk` |
| `citadel-server-pw-v2` | per-server password (HMAC message, §4) |
| `citadel-identity-binding-v2` | binding (§5) |
| `citadel-well-known-v1` | `/.well-known/citadel` self-signature (§6) |
| `citadel-server-challenge-v1` | post-connect server challenge (§6) |
| `citadel-sign-in-assertion-v1` | "Sign in with Citadel" assertion (§7, `sign-in-with-citadel.md`) |
| `citadel-sign-in-match-v1` | match-phrase hash (`sign-in-with-citadel.md`) |

- Encodings: `base64url_nopad` (RFC 4648 §5, strict decode: padding, other alphabets and non-zero
  trailing bits refused); `base32_lower_nopad` (RFC 4648 §6 alphabet, lowercase); `u16be`/`u64be`
  big-endian; `str16(s) = u16be(len s) ‖ utf8(s)`.

## 3. Names

```rust
pub struct CanonicalDomain(String);                 // only canonical_domain() makes one
pub fn canonical_domain(dialled: &str) -> Result<CanonicalDomain, DomainError>;
pub enum Username<'a> { Legacy(&'a str), V2 { handle: &'a str, domain: &'a str } }
pub fn parse_username(u: &str) -> Result<Username<'_>, NameError>;
pub fn validate_handle(h: &str) -> Result<(), NameError>;
pub fn make_username(handle: &str, domain: &CanonicalDomain) -> Result<String, NameError>;
pub fn display_handle<'a>(u: &'a str, accepted: &[CanonicalDomain]) -> &'a str;
```

`canonical_domain`: refuse any non-ASCII, whitespace or `@ ? # % \` character first; lowercase;
strip `scheme://` (scheme must be `[a-z][a-z0-9+.-]*`); strip trailing `/`s; split `authority/path`;
host labels `[a-z0-9-]{1,63}` not edged by `-` (an IPv6 literal is therefore refused); port
`1..=65535` with no leading zero, kept unless it is `443`; path segments `[a-z0-9._~-]+`, never `.`
or `..`, re-joined with single `/`; result ≤ 190 bytes. Idempotent. Errors: `Empty, TooLong,
ForbiddenChar, BadScheme, BadHost, BadPort, BadPath`.

`validate_handle`: 3..=64 bytes of `[a-z0-9._-]`, no leading/trailing `.`, no `..`
(`HandleLength, HandleChar, HandleDots`). `parse_username`: empty → `Empty`; > 255 bytes →
`TooLong`; no `@` → `Legacy`; two or more `@` → `TooManyAt`; one `@` → handle validated and the
domain must equal its own `canonical_domain` (`NotCanonical`). `display_handle` returns the bare
handle iff V2 and `domain ∈ accepted`; otherwise the whole input. Vectors: `identity-kat.json`
`canonical_domain`, `validate_handle`, `parse_username`, `display_handle`.

## 4. Identity, fingerprint, password

```rust
pub struct Identity { /* ML-DSA-65 signer + k_pw; zeroised on drop; the seed is not kept */ }
impl Identity {
  pub fn from_seed(seed: &[u8; 32]) -> Identity;
  pub fn pk(&self) -> &[u8; 1952];  pub fn public_key(&self) -> &MlDsa65Pk;
  pub fn id_fp(&self) -> String;                                           // 16 chars
  pub fn derive_password(&self, domain: &CanonicalDomain, username: &str) -> Password; // 43 chars
  pub fn sign_binding(&self, username: &str, domain: &CanonicalDomain, issued_at_s: u64) -> Result<BindingBlob, NameError>;
}
pub fn fingerprint(pk: &MlDsa65Pk) -> String;  pub fn fingerprint_grouped(pk) -> String; // abcd-efgh-ijkl-mnop
```
```
xi       = HMAC-SHA3-256(key = seed, msg = "citadel-identity-sign-v1");  (sk, pk) = ML-DSA-65.KeyGen(xi)
k_pw     = HMAC-SHA3-256(key = seed, msg = "citadel-identity-pw-v1")
id_fp    = base32_lower_nopad( SHA3-256("citadel-identity-fp-v1" ‖ 0x00 ‖ pk)[..10] )
pw_bytes = HMAC-SHA3-256(key = k_pw, msg = "citadel-server-pw-v2" ‖ 0x00 ‖ utf8(domain) ‖ 0x00 ‖ utf8(username))
password = base64url_nopad(pw_bytes)
```
`username` is the full Citadel username (`handle@domain`). Vectors: `identities.A`, `identities.B`.

## 5. Binding

```
body = str16(u) ‖ str16(d) ‖ u64be(issued_at_s)        u = account username (V2 or legacy), d = canonical domain
sig  = ML-DSA-65.Sign(sk, "citadel-identity-binding-v2" ‖ 0x00 ‖ body)
blob = 0x02 ‖ u64be(issued_at_s) ‖ str16(d) ‖ pk[1952] ‖ sig[3309]          stored as base64url_nopad ≤ 8192 chars
```
```rust
pub fn binding_message(username: &str, domain: &str, issued_at_s: u64) -> Result<Vec<u8>, NameError>;
pub fn verify_binding(blob: &[u8], expect_username: &str, accepted: &[CanonicalDomain], now_s: u64) -> Result<Verified, BindingError>;
pub struct Verified { pub pk: MlDsa65Pk, pub id_fp: String, pub domain: CanonicalDomain, pub issued_at_s: u64 }
```
`verify_binding` order: parse the blob exactly (`Malformed` on short/long), `Version`,
`expect_username` must parse, `d` must be canonical and `∈ accepted` (`DomainNotAccepted`),
`issued_at_s ≤ now_s + 300` (`FromTheFuture`), signature (`Signature`). **Monotonic `issued_at`
against the stored binding is the server's check**, not this function's. Vectors:
`identities.*.binding` (V2 name) and `identities.*.legacy_binding` (`john.doe`).

## 6. Server key, `/.well-known/citadel`, challenge

```rust
pub struct ServerKey; impl ServerKey { pub fn from_seed(seed: &[u8; 32]) -> ServerKey; pub fn public_key(&self) -> &MlDsa65Pk;
  pub fn sign_challenge(&self, domain: &CanonicalDomain, cid: u64, nonce: &[u8; 32]) -> Vec<u8>;
  pub fn sign_well_known(&self, doc: &WellKnownCitadel) -> Result<Vec<u8> /* JSON */, WellKnownError>; }
pub struct WellKnownCitadel { pub v: u8, pub canonical_domain: CanonicalDomain, pub citadel_wss: String,
  pub server_key: MlDsa65Pk, pub former_domains: Vec<CanonicalDomain>, pub issued_at_s: u64 }
pub fn well_known_message(doc: &WellKnownCitadel) -> Result<Vec<u8>, WellKnownError>;
pub fn parse_well_known(json: &[u8], fetched_from: &CanonicalDomain) -> Result<WellKnownCitadel, WellKnownError>;
pub fn check_against_pin(doc: &WellKnownCitadel, pinned_key: &MlDsa65Pk, pinned_issued_at_s: u64) -> Result<(), WellKnownError>;
pub fn challenge_message(domain: &CanonicalDomain, cid: u64, nonce: &[u8; 32]) -> Vec<u8>;
pub fn verify_server_challenge(pk: &MlDsa65Pk, domain: &CanonicalDomain, cid: u64, nonce: &[u8; 32], sig: &[u8]) -> Result<(), ChallengeError>;
```
- Server key: `xi_server = HMAC-SHA3-256(key = seed, msg = "citadel-server-sign-v1")`, ML-DSA-65.
- Document: `well-known-citadel.schema.json` (`deny_unknown_fields`). Signed message =
  `"citadel-well-known-v1" ‖ 0x00 ‖ CBOR(doc without sig)` where the CBOR is RFC 8949 §4.2.1
  deterministic: a map with text keys sorted by their encoded bytes, `v` and `issued_at` unsigned
  integers, `pk` the base64url **text**, `former_domains` an array of text, nested maps `citadel`
  and `server_key` the same way. `parse_well_known` checks in order: JSON shape, `alg`, canonical
  domains (each equal to its own canonical form; no former domain equals the canonical or repeats),
  `v`, `wss://` endpoint whose host canonicalises, signature, then `fetched_from ∈ {canonical} ∪
  former` (`NotThisServer`). `check_against_pin`: key must equal the pinned key (`KeyChanged`,
  both fingerprints — never a silent re-pin) and `issued_at ≥ pinned` (`Stale`).
- Challenge: `body = nonce[32] ‖ u64be(cid) ‖ utf8(domain)`; `sig = Sign(sk_server,
  "citadel-server-challenge-v1" ‖ 0x00 ‖ body)`. A signature for another `cid`, `domain` or
  `nonce` must fail (`servers.*.challenge_replays_that_must_fail`). See
  `server-identity-challenge.md` for the wire.

## 7. Sign-in assertion (consumed by `sign-in-with-citadel.md`)

```rust
pub struct SignInAssertion { pub identity: MlDsa65Pk, pub device: String, pub aud: String, pub exp_s: u64, pub nonce: [u8; 32] }
pub fn assertion_message(a: &SignInAssertion) -> Result<Vec<u8>, AssertionError>;
impl ServerKey { pub fn sign_assertion(&self, a: &SignInAssertion) -> Result<Vec<u8> /* blob */, AssertionError>; }
pub fn verify_assertion(blob: &[u8], issuer: &MlDsa65Pk, expect_aud: &str, expect_nonce: &[u8; 32], now_s: u64) -> Result<SignInAssertion, AssertionError>;
```
```
body = str16(aud) ‖ str16(device) ‖ u64be(exp_s) ‖ nonce[32] ‖ identity_pk[1952]      aud, device: 1..=255 bytes
sig  = Sign(sk_issuer, "citadel-sign-in-assertion-v1" ‖ 0x00 ‖ body)
blob = 0x01 ‖ body ‖ sig[3309]
```
The identity is the full public key (never only `id_fp`). `verify_assertion` order: parse,
`Version`, signature, `aud == expect_aud` (`WrongAudience`), `nonce == expect_nonce`
(`WrongNonce`), `now_s < exp_s` (`Expired`). Vectors: `sign-in-kat.json`.

## 8. Recovery phrase

```rust
pub fn phrase_encode(seed: &[u8; 32]) -> [&'static str; 24];
pub fn phrase_decode(words: &[&str]) -> Result<[u8; 32], PhraseError>;   // WordCount | UnknownWord(i) | Checksum
```
Bits = `seed[256] ‖ SHA3-256(seed)[0]` (264 bits), read as 24 big-endian 11-bit indices into the
**BIP-39 English list** (2048 words, `bitcoin/bips` `bip-0039/english.txt`, sha256
`2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda`). Decoding is exact-match on
lowercase words; normalising typed input is the caller's. Vectors: `identities.*.phrase`.

## 9. Decisions recorded here

- I1's choices (`Result<BindingBlob, NameError>` from `sign_binding`; server-key HMAC label; CBOR
  mirroring the JSON with `pk` as text; the binary assertion blob with the full identity key;
  `SHA3-256(seed)[0]` phrase check; ports kept unless 443; IPv6 literals refused; 300 s skew;
  monotonicity at the server) are adopted as written. None contradicts plan §5.1.
- Deterministic signing is part of the contract: two implementations signing the same message
  with the same key produce the same bytes, so the KAT signatures can be compared, not only verified.
