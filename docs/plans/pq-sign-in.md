# Post-quantum sign-in: ML-KEM factors, OPAQUE password hardening, server-verified keys

Status: agreed with the owner on 2026-10-02. This supersedes options A and C of
[passkey-login.md](passkey-login.md).

## Owner decisions
1. **Servers verify; clients do the heavy lifting.** The server is a Rust
   Durable Object on `wasm32-unknown-unknown`. It never runs a password hashing
   function.
2. **Post-quantum only for authentication. ML-KEM, which the SDK already has,
   carries the security.** No ECDSA, Ed25519 or RSA verification anywhere.
3. **Keep OPAQUE** as an extra layer on the password factor.
   - What it buys: an offline guess against a stolen account database needs
     the server's OPRF key as well.
   - What it doesn't carry: the post-quantum security, which ML-KEM provides.
4. **A sign-in policy per account:** `Password`, `PasswordAndKey` or `KeyOnly`.
5. **A recovery phrase** (24 words) for a lost password or lost keys. It replaced
   the recovery codes (owner, 2026-11-20); there is no codes path left.

## Owner decisions, 2026-10-03 (server phase)
6. **No backup of the OPRF seed.** Each tenant's seed lives only in its Durable
   Object's key-value storage (`control:oprf-seed`), apart from the account rows,
   and is never exported.
   - What it buys: there is no second copy to steal, leak or forget to rotate, and
     nothing outside the object can ever drive an offline guess.
   - What it costs: if the seed is lost while the accounts survive, every
     **password** factor of that tenant stops verifying and must be reset. Security
     keys and the **recovery phrase** don't use the OPRF and keep working, so members
     sign in with the phrase (a recovery session), enrol a key or reset the password,
     and carry on. A stored value that is not a seed stops the object; it is never
     silently replaced, since a new seed is the same lockout.
   - Losing the whole of the object's storage loses the accounts with it; a seed
     backup would not help there.
7. **Upgrade legacy accounts immediately, at their next login.** A legacy
   (Argon2) account's first successful login against a 0.12 server carries the
   upgrade, and the server swaps the record in the same exchange.
   - What it buys: the server stops running Argon2 for that account at once, and the
     stolen-rows offline guess is closed account by account as people sign in,
     with no migration window to manage.
   - What it costs: it is one way. After the swap the legacy path is refused, so a
     client older than 0.12, or a server rolled back below 0.12, can't sign that
     account in until it is updated ("update your app"). A rollback of the tenant
     Worker past this release must be treated as breaking for every account that
     signed in since.

## What is wrong today
- Password login makes the server run Argon2 (`AsyncArgon::verify`) on every
  login, and a stolen record is enough to guess passwords offline.
- Passkeys only unlock a password stored on the agent (WebAuthn PRF). The
  server verifies nothing and the challenge is unchecked.
- Local passkey records are keyed by `rpId` plus username, and every tenant
  shares `work.avarok.net`, so they collide across tenants.

## One mechanism for every factor
Each factor is an **ML-KEM-1024 keypair derived deterministically on the
client** (FIPS 203 `KeyGen_internal(d, z)` from a 64-byte seed). The server
stores only the encapsulation (public) key.

| Factor | How the client derives the 64-byte seed |
|---|---|
| Password | `rwd = OPRF(k_user, password)`, computed blinded with the server (RFC 9497, ristretto255), then `seed = Argon2id(rwd, salt_user)` on the client |
| A hardware key / passkey | the WebAuthn **PRF** (`hmac-secret`) output for this credential and an account-specific `eval` salt, then HKDF-SHA3. The PRF is symmetric HMAC-SHA-256 inside the authenticator, so it is post-quantum safe. The key's classical assertion signature is **not** relied on. |
| The recovery phrase | a 32-byte seed the client draws, shown once as 24 words; `HKDF-SHA3-256(seed)` with the server's domain and the username in `info`, so one seed gives unrelated factors per server and name (256 bits, so no stretching is needed) |

**Proving a factor.** The steps for each required factor:
1. The server runs `ML-KEM.Encaps(ek_factor)` and gets `(ct, K)`.
2. The client derives `dk` (password plus OPRF plus Argon2, or a key touch, or
   the phrase) and decapsulates `ct`, getting `K`.
3. The client returns `tag = HMAC-SHA3-256(K, "citadel-auth-v1" ‖ factor_id ‖ transcript_hash)`.
4. The server compares in constant time.

Every factor's `K` is mixed into Citadel's post-quantum session key schedule,
so the login is bound to this channel and can't be replayed on another
handshake.

**Server cost per login:**
- One OPRF evaluation (1 ristretto scalar multiplication), only for password
  factors.
- One ML-KEM encapsulation per required factor.
- HMAC compares.

## Protocol (Citadel SDK, next protocol minor, gated with `protocol_version_at_least`)
All of this runs **inside** the post-quantum channel.

### Registration
1. C→S `RegStart { username, oprf_blinded? }`
2. S→C `RegReply { oprf_evaluated?, salt_user, prf_eval_salt }`
   - The server creates the per-user OPRF key from the tenant's OPRF seed with
     HKDF, keyed on the username.
3. The client derives each factor's `ek`. For a key, the browser runs
   `navigator.credentials.create` with the `prf` extension, then `get` for the
   PRF output.
4. C→S `RegFinish { factors: [{ kind, ek, credential_id?, label? }], policy, recovery_eks: [10] }`
5. The server stores the account record atomically. A key factor must come
   with an ML-KEM proof in the same flow: the server encapsulates to the new
   `ek` and the client proves it, so nobody can enrol a key they don't hold.

### Login
1. C→S `LoginStart { username, oprf_blinded? }`
2. S→C `LoginChallenge { oprf_evaluated?, salt_user, prf_eval_salt, challenges: [{ factor_id, kind, credential_id?, ct }] }`
   - For an unknown username, the server returns decoy salts, a decoy OPRF
     evaluation and decoy ciphertexts, all deterministic for that username, so
     existence doesn't leak.
3. C→S `LoginFinish { tags: [{ factor_id, tag }] }`
4. The server checks that the tags satisfy the policy. Failure is always the
   same generic "authentication failed".

### Key management (authenticated session requests; every change needs a fresh step-up proof)
- `ListCredentials` returns id, label, kind, created, last_used.
- `AddCredential` follows the enrolment flow above, with an ML-KEM proof of
  the new key.
- `RenameCredential`.
- `RemoveCredential`: refused if it would leave the policy unsatisfiable.
- `SetSignInPolicy`.
- `RegenerateRecoveryPhrase`.

The phrase is not used up: it signs in again and again, always to a recovery
session, and an old, foreign or wrong phrase fails like any other factor. A
recovery session may only manage the sign-in methods (list, add or remove a key,
set a new password, set the policy, regenerate the phrase) and sign out. A
recovery and a phrase sign-in are both asked the human check, with action
`recover`.

### The phrase recovers the files
The phrase's seed is also the account's RE-VFS root
(`RevfsKey::derive(seed, canonical_domain, cid)`), so a member who recovers on a
new device opens the files stored before.
- The agent keeps the seed sealed under the device vault. It is never stored in
  plaintext and never sent to the server (only the factor's `ek` is).
- Registration stores the issued phrase's seed before anything can use a key.
  `RecoverAccount` on a device that does not hold the account stores the typed
  phrase's seed. An account with no stored root has no key, and Connect refuses
  it by name.
- Regenerating the phrase re-keys the files. An object's layer keys are derived
  from the root, so nothing can be re-wrapped: the agent reads each object under
  the old root and writes it again under the new one (staging copy, then the
  object, then the staging copy goes), from its own index of the account's
  objects. The pass resumes where it stopped, every object stays readable at
  every step, and the old root stays sealed until no index entry names it. While
  a pass runs, the account's other file operations are refused (`REKEYING`).

### Migration
Accounts with a legacy Argon2 record keep working.
- **Upgrade:** after the next successful legacy login, inside the same session,
  the client registers the ML-KEM password factor and the server swaps the
  record.
- **After upgrade:** the legacy path is refused for that account. Older apps
  get "update your app".

## Server storage
Accounts live in the Durable Object's SQLite (`HostSql`):
```
AuthRecord = Legacy(Argon) | PqFactors
Factor     = { id, kind: Password|Key|Recovery, ek: [u8; 1568], credential_id?, label, created_ms, last_used_ms, consumed? }
policy, salt_user, prf_eval_salt
```
The tenant's **OPRF seed** is generated at provisioning and kept in Durable
Object key-value storage, separate from the SQLite account rows. Stealing the
account rows alone therefore can't drive offline guessing. It is never logged.

## Crates (pure Rust; wasm32-unknown-unknown)
- **ML-KEM:** the SDK's existing implementation. Confirm it exposes
  deterministic `KeyGen_internal` from a seed; otherwise use RustCrypto
  `ml-kem`.
- **OPRF:** `voprf`, RFC 9497 with ristretto255 and SHA-512. We use the OPRF
  only; ML-KEM replaces OPAQUE's classical 3DH.
- **Hashing and MAC:** `hkdf`, `hmac`, and `sha3` (already in the lock).
- **Password stretching:** `argon2`, on the client only.
- **Not used:** no `p256`, `ecdsa`, `ed25519-dalek`, `rsa`, `webauthn-rs` or
  `ring`. Nothing parses COSE, because the key's signature is not used.

## Edges
- **Browser:** runs the WebAuthn ceremonies (PRF `create`/`get`). Only the
  browser can talk to the key.
- **Agent:**
  - runs the OPRF client, Argon2, ML-KEM keygen and decapsulation, and the
    tags;
  - relays a key challenge as `AuthKeyChallenge`: the browser returns the PRF
    output, the agent derives and decapsulates.
  - The user-presence wait is ≤60 s and applies only to that stage.
- **The browser WASM client** can run the same client code when no agent is
  present.
- **The PRF output never leaves the edge.** The server only ever sees an `ek`
  and a tag.

## UI (Citadel Workspace; built after the protocol works)
- **Registration:** an optional "Add a security key" step, then the 24-word
  recovery phrase, shown once with a confirmation.
- **Sign-in:** password-only accounts are unchanged. `PasswordAndKey` accounts
  ask for the password, then show "Touch your security key". `KeyOnly`
  accounts sign in key-first, with no password field.
- **Settings → Sign-in keys:** backed by the server. It lists, adds, renames
  and removes keys, switches the policy, and regenerates the recovery phrase.
- **Unsupported keys:** a key without PRF support is refused with a clear
  reason.
- **Local records:** scoped by tenant and CID (fixing the collision). The
  PRF-sealed password store is retired for upgraded accounts.

## Tests
Every test gets a negative control: break the check, watch the test go red,
restore it.

Each of the following must be rejected:
- a replayed tag (other transcript);
- a wrong password;
- the wrong key (another credential's PRF);
- a tampered ciphertext;
- a tampered OPRF evaluation;
- an old, foreign or wrong recovery phrase;
- a recovery session attempting a normal operation;
- removing the last factor;
- enrolling a key without its proof.

It must also hold that:
- an unknown username is indistinguishable from a known one;
- the server never calls Argon2 (asserted);
- interop works both ways through the version gate;
- the WASM server build contains no classical signature crate (a dependency
  gate).

## Phases
1. SDK: the ML-KEM factor framework, the password factor with OPRF, the version
   gate, upgrade-on-login.
2. SDK: key and recovery factors, the policy, the management requests.
3. Agent: new Register/Connect fields, the key-challenge relay, the management
   requests (with generated TypeScript types).
4. UI: the registration step, the sign-in prompts, Settings backed by the
   server, tenant-scoped records.
5. Server: the tenant-worker SDK bump, the provisioning OPRF seed, a deploy
   test, then deploy.
6. Live: YubiKey 5 and Touch ID on both Macs, every policy, and recovery.
