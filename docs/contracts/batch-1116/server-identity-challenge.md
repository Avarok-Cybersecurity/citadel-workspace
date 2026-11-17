# Contract: `ServerIdentityChallenge` (plan §5.2, identity doc §3.1 rev b) — FROZEN 2026-11-16

A WorkspaceProtocol request, not an SDK or protocol change. Cryptography and vectors:
`identity-api.md` §6, `identity-kat.json` `servers.*.challenge`. Parties: kernel (I3), agent (I2),
tenant worker (I4, serves the well-known document), sw node (S2, same kernel code).

## 1. Wire (`citadel-workspace-types`)

```rust
WorkspaceProtocolRequest::ServerIdentityChallenge { nonce: [u8; 32] }
WorkspaceProtocolResponse::ServerIdentity { domain: String, pk: Vec<u8> /* 1952 */, sig: Vec<u8> /* 3309 */ }
GetWorkspace response gains `accepted_domains: Vec<String>`   // [canonical, former…], canonical first
```
`deny_unknown_fields` on both; `nonce` is exactly 32 bytes; `sig = ServerKey::sign_challenge(
canonical_domain, cid, nonce)` where `cid` is the **requesting session's CID** as the kernel
knows it, never a value the client sends.

## 2. Kernel (I3)

- Refuses to start without `[identity] { canonical_domain, former_domains = [...], discovery =
  "well_known" | "pinned" }` and without a server key (`ServerKey::from_seed`, seed sealed in the
  kernel's backend, generated at provisioning). No default for any of the three (PCND, D-A).
- Answers every `ServerIdentityChallenge` on an authenticated session, for any member, at any
  time, without side effects; answers at most 1 per second per session (more → refused, no sig).
- Builds the `/.well-known/citadel` document (`well-known-citadel.schema.json`) from the config
  and the key with `ServerKey::sign_well_known`; writes it to the configured path and serves it on
  the loopback admin port, so the tenant worker and a self-hosted proxy publish one artefact.
- `NamePolicy` (identity doc §6) and the `accepted_domains` list derive from the same config.

## 3. Agent (I2)

- On `RegisterIdentity`: fetch `https://<dialled canonical>/.well-known/citadel` (system roots,
  `Accept: application/json`, 64 KiB cap, I/O behind a port), `parse_well_known(json, dialled)`,
  dial `citadel.wss`, register as `handle@canonical_domain`, pin `(canonical_domain, server_key,
  issued_at)` in the account record. `discovery = "pinned"` servers: the operator-typed key is
  pinned instead and the record is marked `unverified` until a challenge matches. A document
  with no `citadel` member (an issuer-only server, `sign-in-with-citadel.md` §7) refuses both
  `RegisterIdentity` and `ServerDiscovery` with `NoCitadelEndpoint`: there is no node to dial.
- After every successful connect (first and reconnect): send the challenge with a fresh random
  nonce; `verify_server_challenge(pinned_pk, pinned_domain, session_cid, nonce, sig)`. On any
  failure: disconnect, emit a `ServerIdentityMismatch { domain, pinned_fp, offered_fp }` warning
  on the UI wire, leave the record untouched. **Never re-pin silently.** On success for an
  `unverified` record: mark verified.
- `ConnectIdentity` never recomputes the domain or re-fetches the document to decide anything;
  a refetch only runs `check_against_pin` (`KeyChanged` → the same warning).

## 4. Tests (plan §6; each with its control)

T13 well-known parse/refuse/unknown-field/stale; T14 agent mismatch → disconnect + warning +
record untouched (control: skip the challenge → a key-swapped server is accepted); T15 kernel
signature binds `(nonce, cid, domain)`: a signature replayed for another cid, domain or nonce
fails (control: sign the nonce alone → the cross-cid replay verifies); start refused without
`[identity]` or `discovery` (control: default the domain to `bind_addr`).
