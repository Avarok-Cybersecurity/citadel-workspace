# Passkey and security-key login — design

Status: proposal (research only, nothing implemented). Date: 2026-09-22.

Goal (user): "when logging-in, we should allow passkeys and hardware security keys
associated with each account."

## 1. What exists today (verified in code)

- **No WebAuthn anywhere.** A grep for `webauthn|passkey|navigator.credentials|hmac-secret`
  across `wt/cp-int`, `wt/agent-dmg`, `wt/ui-onboard/src` and `wt/ws-deploy/deploy`
  returns nothing.
- **SDK auth modes.** `auth.rs:55` in the SDK's `citadel_proto` crate — `AuthenticationRequest`
  has only `Credentialed { id, password }` and `Passwordless { username, server_addr }`
  (transient). The workspace kernel refuses transient accounts
  (`citadel-workspace-server-kernel/tests/transient_accounts_are_refused.rs`).
- **Password path.** `proposed_credentials.rs` in the SDK's `citadel_user` crate: client runs
  SHA3-256 then client-side Argon2 (`new_connect` → `argon_hash`), the hash travels in
  `DoConnectStage0Packet` already encrypted, and the server checks it with
  `AsyncArgon::verify` against a `ServerArgonContainer`
  (`validation.rs:44` in the SDK's `citadel_proto`).
- **The password is an authenticator, not a key input.** Session keys come from the
  stored CNAC `static_aux_ratchet` plus the fresh post-quantum pre-connect exchange
  (`preconnect_packet.rs:114-168` in the SDK's packet processor). So swapping the credential check
  is cryptographically possible without weakening session keys — but it is an SDK
  protocol change (the CNAC only knows `DeclaredAuthenticationMode::Argon`).
- **Agent storage.** The agent persists to a filesystem backend (`~/.citadel-agent`,
  `citadel-workspace-internal-service/src/main.rs`). It exposes a pre-auth "global"
  KV at **CID 0**: reads need no ownership and writes are explicitly allowed
  (`citadel-internal-service/src/kernel/requests/mod.rs:509-524`).
- **"Remember credentials" stores the password in plaintext** in that CID-0 KV:
  `handleAuthSuccess` writes `password` / `serverPassword` into `StoredSession`
  (`session-management.ts:84` in the UI's connection library,
  `io-websocket.ts: localDBSet(0n, SESSION_STORAGE_KEY, …)`), serialised with JSON.
  Any local process that can open a WebSocket to :12345 with an allowed Origin
  header (non-browser clients can forge it) can read it.
- **Agent connect** re-checks the password before reusing a live session
  (`citadel-internal-service/src/kernel/requests/connect.rs:102-133`).
- **macOS app** only opens the workspace URL (`apps/macos-agent/StatusMenu.swift:62`).

## 2. Options

### A. Client-side unlock with WebAuthn PRF (recommended for v1)

A passkey or security key created with the PRF extension returns a 32-byte
per-credential pseudo-random value for a fixed salt, only after the user proves presence
or identity on the key (WebAuthn L3 §10.1.4 `prf`; for CTAP2 keys it maps onto
`hmac-secret`, with the salt set to `SHA-256("WebAuthn PRF" || 0x00 || input)`). We derive
a key-encryption key (KEK) from it with HKDF and use it to wrap the account's Citadel
password. The server does not change. The SDK does not change.

**Support (Aug 2026; Corbado matrix, Yubico guide):**

| Platform / provider | create() PRF | get() PRF | Notes |
|---|---|---|---|
| iCloud Keychain / Apple Passwords, macOS 15+ (Safari 18+, Chrome 132+, Firefox 139+) | yes | yes | same output on create and get |
| iOS/iPadOS 18.4+ (any browser) | yes | yes | 18.0–18.3 had data-loss bugs as a cross-device authenticator: refuse to enrol below 18.4 |
| Google Password Manager (Android Chrome/Edge/Samsung; Firefox 149+) | yes | yes | "all GPM passkeys have PRF" |
| Windows Hello, Win11 24H2/25H2 after the Feb-2026 update | Chrome/Edge 147+, Firefox 148+ | Chrome/Edge 146+, Firefox 148+ | older Windows Hello: no hmac-secret at all |
| YubiKey 5 / YubiKey Bio / Security Key series (hmac-secret) | yes | yes | in Chrome/Edge/Firefox. Safari 26.4 has WebKit bugs 311099 (encrypted output returned undecrypted) and 314934 (null for Bio / intervalUV keys) |
| 1Password, Proton Pass, Keeper, Enpass, KeePassDX | yes | yes | |
| Bitwarden, KeePassXC, Samsung Pass | partial | partial | Samsung Pass: nothing at create, works on get |
| Microsoft Password Manager | yes | **no** | every get() fails |
| Dashlane, NordPass, Chrome profile authenticator | no | no | |

`getClientCapabilities()['extension:prf']` is **unreliable**: Chrome reports it as true
even with managers that then return nothing. Detect support by what a ceremony actually
returns, never by the capability flag.

**Where the wrapped secret lives:**

| | Agent CID-0 KV (recommended) | Browser IndexedDB (work.avarok.net origin) |
|---|---|---|
| Shared by Safari + Chrome on the same Mac | yes | no (one per browser profile) |
| Visible to the menu-bar app (list "log in as…") | yes | no |
| Survives "clear site data" | yes | no |
| Readable by other local processes | yes (ciphertext only) | only with disk access (ciphertext only) |
| Already the SSOT for the stored-session list | yes | no |

Both only ever hold AEAD ciphertext under a 256-bit KEK, so an offline attack is
infeasible. The agent is recommended because it already holds the account list, and
because one machine = one agent = one set of accounts.

**Multi-device.** A synced passkey (iCloud, GPM, 1Password) gives the same PRF output on
every device. The wrapped blob is still per agent. On a second machine the user types
the password once, then "Use passkey on this device" runs a **get()** (no new
credential) and writes a new blob. A roaming YubiKey works the same way. v2 option:
keep the blob in the account's server-side store as well. The server would then see only
ciphertext, but a pre-auth fetch-by-username needs a server change and would reveal that
an account has passkeys.

**Recovery.** The password stays valid (v1), so losing every key only costs the
convenience. If passwordless accounts are wanted later (a random 32-byte password
generated at registration and never shown), a printable recovery code must be a second
KEK, created at registration. Otherwise losing the key locks the account out for good.

**Attacker with the disk / agent storage:** gets the CNAC files and the wrapped blobs. The
blobs are useless without the authenticator plus UV. This is a strict improvement over
today's plaintext "Remember credentials". Deleting blobs (CID-0 writes are open) is a
denial of service that falls back to the password.

### B. Server-verified WebAuthn (tenant DO holds credential public keys)

The DO stores `{credentialId, COSE public key, signCount, transports, label}` per CID
and checks assertions (ES256/EdDSA/RS256 in the wasm server; `webauthn-rs` or
`p256`/`ed25519-dalek`).

- **Composition with Citadel:** there is no hook for this. The CNAC accepts only Argon
  (`validate_credentials` → `AccountNotPasswordProtected` otherwise). A passwordless B
  needs a new `AuthenticationRequest` / `ProposedCredentials` / `DeclaredAuthenticationMode`
  variant carrying `{credentialId, authenticatorData, clientDataJSON, signature}` in
  stage 0. The challenge should be bound to the Citadel pre-connect transcript (channel
  binding: challenge = H(preconnect transcript)), so an assertion cannot be replayed into
  another session. The agent would have to pause the handshake, hand the challenge to the
  UI, wait for the browser ceremony (seconds, with the user in the loop) and resume. That
  collides with handshake timeouts and with `SessionAlreadyActive` / claim logic.
- **Password for keys?** Not needed — keys come from the ratchet and the PQ KEX (section 1).
  The password only gates stage 0.
- **RP ID:** the ceremony runs on the page origin `https://work.avarok.net`. The browser
  never loads `<slug>.work.avarok.net`; the assertion travels browser → agent → Citadel
  → DO. The RP ID must be a registrable suffix of the origin (L3 §5.1.4 / §5.11), so the
  choices are `work.avarok.net` or `avarok.net`. A per-tenant RP ID (`acme.work.avarok.net`)
  is not a suffix of `work.avarok.net`. It would need Related Origin Requests
  (`/.well-known/webauthn` served by each tenant, listing `https://work.avarok.net`;
  Chrome 128, Safari 18, Firefox 152; the 5-label limit counts eTLD+1, so avarok.net is a
  single label). That adds a well-known per tenant and per-tenant credentials for no
  security gain. **Use `rp.id = "work.avarok.net"` for every tenant.** The DO checks
  `clientDataJSON.origin === "https://work.avarok.net"`,
  `rpIdHash === SHA-256("work.avarok.net")`, UV flag, challenge, and signCount (0 is
  allowed for synced passkeys). `user.id` = 16 random bytes stored per (tenant, CID),
  never the username. `user.name` = `alice @ acme` so the OS picker can tell tenants apart.
- Cost: SDK protocol change + DO storage + wasm verifier + agent handshake pause. It is
  the only option that removes the password (true phishing resistance).

### C. Passkey as a second factor on top of the password

Password Connect as today. Then the kernel refuses every WorkspaceProtocol request until
a `WebAuthnAssert` (challenge from the DO) has verified.

- No SDK change. Needs B's DO storage and verifier.
- Caveat: C2S is already authenticated by the password alone. SDK-level operations the
  kernel does not mediate (peer registration and signalling passed through the server SDK)
  would have to be gated too, or the second factor protects workspace data but not P2P.
- UX is worse than today (two steps), and it does not deliver the "log in with a passkey"
  the user asked for. It is useful later as an **admin/owner policy**.

### Comparison

| | A (PRF unlock) | B (server-verified) | C (2FA) |
|---|---|---|---|
| Passwordless UX | yes | yes | no |
| Server / SDK change | none / none | DO + SDK protocol | DO + kernel gate |
| Phishing resistance of the account | none added (password still works) | yes | yes (if gating is complete) |
| Works without PRF support | no (fall back to password) | yes | yes |
| Effort | small | large | medium |

## 3. Recommendation

Ship **A** now, with the blob in the agent's CID-0 KV. As part of it, retire plaintext
"Remember credentials". Plan **B** as v2 if passwordless-with-phishing-resistance becomes
a requirement. It reuses A's enrolment UI and credential IDs if v1 already requests
`residentKey: "required"` and stores the credential's public key (from
`response.getPublicKey()`) in the record, so v2 can upload it without re-enrolment.
Offer **C** only as an owner-configurable policy on top of B's verifier.

### 3.1 Cryptographic construction (A)

- `rp = { id: "work.avarok.net", name: "Citadel Workspace" }` (dev: `localhost`, a separate
  credential set by construction).
- create(): `authenticatorSelection = { residentKey: "required", userVerification: "required" }`,
  `pubKeyCredParams` ES256 (-7) and EdDSA (-8), RS256 (-257) as the last resort,
  `excludeCredentials` = the account's existing ids,
  `extensions.prf.eval.first = SALT`,
  `SALT = UTF-8("citadel-workspace/login-unlock/v1")` (the browser adds the
  "WebAuthn PRF" context hash itself). The challenge is random; the server never sees it.
- PRF output → `HKDF-SHA-256(ikm = prf, salt = 32 random bytes stored in the record,
  info = "citadel/passkey-unlock/v1|" + rpId + "|" + credIdB64u + "|" + tenant + "|" + cid)`
  → non-extractable AES-GCM-256 KEK (WebCrypto `importKey(..., false, ...)`).
- **Envelope:** per account, a random 32-byte DEK encrypts the password (and the workspace
  PSK, if the user asked to keep it). Per credential, the KEK wraps the DEK. AAD on both =
  `v1 | rpId | tenant | cid | username | credId`. A password change re-encrypts one record;
  a new key adds one wrapped-DEK record; revoking a key deletes one record.
- Records are CBOR (cbor-x, native bigint CID — no JSON per project rules), under CID-0
  keys `passkey-login/v1/account/<cid>` and `passkey-login/v1/cred/<credIdB64u>`:
  `{ v, rpId, credId, label, createdAt, lastUsedAt, transports, publicKeyCose, hkdfSalt,
  dekNonce, wrappedDek }` and `{ v, tenant, username, cid, pwNonce, wrappedPassword }`.
- Unwrap happens **in the page** (WebCrypto). The password then goes to the agent through
  the existing `Connect` exactly as if it had been typed. The agent API is unchanged apart
  from using the existing KV.

### 3.2 Why "passkey as a gate" without PRF is not secure

If the page did a WebAuthn get() and then read a password stored beside it, nothing checks
the assertion. The stored secret is readable by any code that can read the store — local
malware, a forged-Origin WebSocket client, the page itself without ever calling get(). The
ceremony is decoration. A gate needs a **verifier that holds the secret**: the authenticator
(PRF: the key never leaves it), or a server (B/C). Without PRF the correct fallback is
"type your password" (optionally the OS/browser password manager). The UI must not offer a
passkey button for that account on that device. `largeBlob` (data stored on the
authenticator, returned after an assertion) is a partial alternative, but support is
narrower than PRF and it does not require UV. Not recommended.

### 3.3 Enrolment flow (after a successful password login)

1. Settings → Security → "Sign-in keys" → **Add passkey or security key**. Only offered
   while the account's session is live and the password is in memory from this login. If it
   is not (for example after a session claim), ask for the password again and verify it via
   the agent's existing password check.
2. Label field (default "iCloud Keychain on MacBook" / "YubiKey"; editable).
3. create() with PRF. If `prf.results.first` is present → use it. If `prf.enabled` is true
   but there are no results (Chrome 146 on Windows, Samsung Pass, CTAP2.0 keys) → one
   immediate get() with `allowCredentials=[newId]` and `evalByCredential`. If it is still
   absent → abort. Tell the user this key cannot unlock login on this device, and call
   `PublicKeyCredential.signalUnknownCredential` where supported so the orphan passkey
   disappears from the picker.
4. **Round-trip check before saving:** unwrap the freshly written record and compare it
   with the in-memory password. Only then show success.
5. Several keys per account: each is its own cred record. The list shows label, created,
   last used, and "Remove".

### 3.4 Login flow

- Landing / login page: **Sign in with a passkey** →
  get({ `userVerification: "required"`, `allowCredentials: []` (discoverable),
  `extensions.prf.eval.first = SALT` }). The OS picker shows `alice @ acme`. Look up
  `cred/<rawId>` → derive KEK → unwrap DEK → unwrap password → existing `Connect`.
- Prefilled username (typed, or opened from the menu-bar app's per-account "Log in"):
  `allowCredentials` = that account's cred ids with transports, and `evalByCredential` →
  one tap. The menu-bar app lists accounts from the same CID-0 records (it never decrypts).
- Record missing for the chosen credential → "This passkey isn't set up on this device
  yet. Sign in with your password once, then choose *Use passkey on this device*."
- Decryption failure (tampered record, wrong key) → treat as missing. Never retry
  silently. Log without secrets.

### 3.5 Security analysis

- **Phishing:** PRF is scoped to the RP ID, so a look-alike origin cannot get the KEK. But
  A adds **no** account-level phishing resistance: the password still logs in. B is needed
  for that.
- **Origin binding / hosted-UI compromise:** the PRF output and the password are both
  visible to JS on `work.avarok.net`. A malicious deploy or XSS on that origin gets the
  password on the next tap, exactly as it does today when the user types it. Mitigations:
  a strict CSP with `connect-src wss://local.avarok.net:12345` (no CSP was found in
  `tenant-worker/worker.mjs` or `index.html` — worth checking separately), SRI, and deploy
  controls.
- **What the agent sees:** the plaintext password at Connect (as today) and the ciphertext
  records. It never sees the PRF output (unwrap is in the page). The agent is loopback-only
  and must stay so (memory: agent-is-loopback-only).
- **Local attacker (same user):** can read and delete the records (ciphertext). To use the
  passkey it has to drive a real browser on work.avarok.net and get the user through a
  Touch ID / PIN prompt. Native apps cannot assert for work.avarok.net without an
  associated-domains entitlement. `userVerification: "required"` stops a stolen
  presence-only key from working. YubiKeys need a FIDO2 PIN set, and the enrolment copy
  says so.
- **Attacker with disk + password-less:** nothing beyond today. Removing plaintext
  "Remember credentials" is a strict gain.
- **Record swap:** AEAD with an AAD over tenant, cid, username and credId stops pointing a
  credential at another account's record.

### 3.6 UX copy

- Button: **Sign in with a passkey**. Secondary: "Use password instead".
- Enrol card: "Sign in with Touch ID, your phone, or a security key instead of typing your
  password. Your password still works, and it's how you'll get back in if you lose every key."
- After create: "**{label}** can now unlock *{username} @ {workspace}* on this device."
- Unsupported: "This passkey can't unlock sign-in here (your browser or password manager
  doesn't support the feature we need). Your password still works. Try iCloud Keychain,
  Google Password Manager, or a YubiKey in Chrome or Firefox."
- Other device: "Your passkey works here, but this device doesn't have your sign-in saved
  yet. Enter your password once to set it up."
- Security key without a PIN: "Set a PIN on your security key first — we require it so a
  lost key can't be used on its own."
- Remove: "Remove **{label}**? It will no longer sign you in on this device. It may still
  appear in your passkey list; you can delete it there too."

## 4. Implementation steps (each: test + negative control)

Tests use Chrome's CDP virtual authenticator (`WebAuthn.addVirtualAuthenticator` with
`hasPrf: true`, `hasResidentKey: true`, `hasUserVerification: true`, `isUserVerified`),
confirmed in `node_modules/devtools-protocol/json/browser_protocol.json`. That is
production WebAuthn code against a spec authenticator, not a mock.

1. **Envelope module** (`src/lib/passkey/envelope.ts`: `deriveKek`, `wrapDek`,
   `sealPassword`, `open*`; pure, no I/O — SBIO).
   Test: vitest round-trip with fixed-vector PRF bytes, and AAD mismatch → throws.
   Negative control: drop `cid` from the AAD → the swap test must go red. Confirm the
   edit applied and was reverted.
2. **Record codec + store port** (CBOR records; a `PasskeyStore` interface whose
   production implementation uses the existing `localDBSet/Get(0n, …)`).
   Test: encode/decode of a bigint CID; a store round-trip through an in-memory
   `PasskeyStore` (justified: the port is the I/O boundary).
   Negative control: switch the codec to JSON → the bigint test fails.
3. **Ceremony adapter** (`create`/`get` options builders + PRF result extraction,
   including the "enabled but no results → follow-up get()" path).
   Test: Playwright + virtual authenticator with `hasPrf: true` → enrolment succeeds.
   Negative control: the same spec with `hasPrf: false` must show the "unsupported" copy
   and write **no** record (assert the KV key is absent by reading it, not by waiting for
   absence).
4. **Enrolment UI** (Settings → Sign-in keys; label; list; remove; round-trip verify
   before success).
   Test: enrol two keys, both listed, remove one, only its cred record is gone.
   Negative control: skip the round-trip check → a test that corrupts the wrapped DEK
   between write and verify must fail.
5. **Login UI** (discoverable + prefilled paths → unwrap → existing Connect).
   Test: logout → "Sign in with a passkey" → workspace loads, and the internal-service log
   shows a Connect for that CID.
   Negative control: flip one ciphertext byte in the KV → login must show the fallback and
   the agent must receive **no** Connect.
6. **Retire plaintext Remember-credentials** (migration: if the user enrols a key, delete
   `StoredSession.password`/`serverPassword`; decision D4).
   Test: after enrolment, the stored-session bytes contain no password.
   Negative control: re-enable the old write → the test fails.
7. **Menu-bar per-account "Log in"** (read cred/account metadata; open
   `https://work.avarok.net/login?u=<username>&t=<tenant>`; never decrypt).
   Test: Swift unit test on URL construction + a Playwright test that the prefilled path
   uses `allowCredentials`.
   Negative control: unknown username → no allowCredentials, and the discoverable path
   is used.
8. **Real-device matrix (manual, recorded):** Safari/Chrome/Firefox on macOS with iCloud
   Keychain; YubiKey 5 in Chrome and Firefox (Safari expected to fail: WebKit 311099/314934 —
   verify that the "unsupported" path shows, not a corrupt unwrap); iPhone via hybrid
   (iOS ≥ 18.4); Android GPM; Windows Hello 25H2.

## 5. Decisions needed

- D1. RP ID: `work.avarok.net` (recommended, narrow) or `avarok.net` (lets other avarok
  subdomains and future native apps share credentials, with a larger blast radius).
- D2. Blob location: agent CID-0 KV (recommended), IndexedDB, or both.
- D3. v1 keeps the password as the recovery path (recommended), or ship passwordless
  accounts now (generated password + mandatory recovery code).
- D4. Should enrolling a key delete the plaintext "Remember credentials" copy? Should that
  toggle be removed entirely?
- D5. Require UV (recommended; excludes PIN-less and U2F-only keys).
- D6. Block known-broken managers (Microsoft Password Manager, Dashlane, NordPass) by
  result, not by name — i.e. accept only keys that pass the round-trip check (recommended).
- D7. Is B (server-verified, phishing-resistant, SDK change) on the roadmap? If so,
  store `publicKeyCose` from day one (costs nothing).
- D8. C as an owner policy ("require a security key for admins")?
- D9. Native passkey ceremony in the menu-bar app (ASAuthorization PRF on macOS 15, with an
  associated domain `webcredentials:work.avarok.net`) — later, or never?

## 6. Sources

- W3C WebAuthn Level 3 — §10.1.4 prf extension, §5.11 related origins:
  https://www.w3.org/TR/webauthn-3/
- CTAP 2.2 hmac-secret: https://fidoalliance.org/specifications/download/ (CTAP 2.2, hmac-secret / hmac-secret-mc)
- PRF support matrix (Aug 2026): https://www.corbado.com/blog/passkeys-prf-webauthn
- Yubico, Developer's Guide to PRF (YubiKey 5 / Bio, envelope encryption, HKDF info binding):
  https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html
- Chromium Intent to Ship PRF: https://groups.google.com/a/chromium.org/g/blink-dev/c/iTNOgLwD2bI
- Related Origin Requests: https://passkeys.dev/docs/advanced/related-origins/ ,
  https://web.dev/articles/webauthn-related-origin-requests
- CDP virtual authenticator (`hasPrf`): https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/
