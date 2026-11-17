# Contract: CW-6 `citadel.session` (SW rev 3 §7.4, plan §5.3) — FROZEN 2026-11-16

Parties: `citadel-app-sdk-types` + host (H2), agent wire (H2 agent part, needs I2), manifest
types (H2/H1), sw-app (S6). Encoding of every call and event: the SDK's CBOR codec
(`codec.rs`: `ciborium`, strict, trailing bytes refused; serde struct maps, `deny_unknown_fields`).

## 1. Guest ABI (`citadel-app-sdk-types`)

```rust
// ops/mod.rs: Identity = 17 is RESERVED for CW-4 (not in this batch); Session takes 18.
Session = 18, "session", SessionOps {
    SessionOpen  = 1 -> SessionState, CitadelSession;
    SessionSend  = 2 -> (),           CitadelSession;
    SessionClose = 3 -> (),           CitadelSession;
}
// capability.rs
CitadelSession = "citadel.session" => Session,
// new module `session` beside canvas in calls/ (abi_types!)
pub struct SessionOpen  { pub server: String }                 // a canonical domain in manifest `servers`
pub struct SessionSend  { pub session: u32, pub body: Bytes }  // body.len() <= limits.session.max_msg_bytes
pub struct SessionClose { pub session: u32 }
pub struct SessionState { pub session: u32, pub cid: u64, pub state: SessionStatus }
#[serde(rename_all = "snake_case")] pub enum SessionStatus { Connecting, Connected, Closed { reason: String } }
// event.rs
AppEvent::Session { session: u32, event: SessionEvent }
#[serde(rename_all = "snake_case")] pub enum SessionEvent { Message { body: Bytes }, State { state: SessionStatus } }
```
Rules (pure, a new `session-rules` module in the UI host directory and the Rust mirror): `server ∉ manifest.servers` →
`Refused::Ungranted` with **no agent call**; a second `SessionOpen` for the same `server` returns
the existing `session`; `SessionSend` over `max_msg_bytes` → `Refused::Limit`, over
`max_msgs_per_s` (token bucket, burst = the limit) → `Refused::Limit`; `SessionSend`/`Close` on an
unknown or closed `session` → `Refused::Invalid`. Events need the `events` subscription like
topics. `AppContext.is_granted(Capability::CitadelSession)` is how a guest chooses between this
and the `net.host` fallback.

## 2. Manifest (`citadel-workspace-types/src/apps_manifest.rs`)

- `CapabilityRequest.servers: Option<Vec<String>>` — present **exactly** for `citadel.session`,
  1..=2 entries, each a canonical domain (identity-api §3); anything else is refused like `hosts`.
- `AppLimits.session: Option<SessionLimits { max_msg_bytes: u32 (1..=1_048_576), max_msgs_per_s: u32 (1..=64) }>`
  — present exactly when `citadel.session` is requested; shape mirrors `TopicLimits`.

## 3. Agent wire (`citadel-internal-service-types`, ts-rs bindings regenerated)

```rust
InternalServiceRequest::AppSessionOpen  { request_id: Uuid, cid: u64, app_id: String, install_id: String, acting_username: String, server: String }
InternalServiceRequest::AppSessionSend  { request_id: Uuid, cid: u64, install_id: String, session: u32, body: Vec<u8> }
InternalServiceRequest::AppSessionClose { request_id: Uuid, cid: u64, install_id: String, session: u32 }
InternalServiceResponse::AppSessionState   { cid: u64, request_id: Option<Uuid>, install_id: String, session: u32, server_cid: u64, state: SessionStatus }
InternalServiceResponse::AppSessionMessage { cid: u64, request_id: Option<Uuid>, install_id: String, session: u32, body: Vec<u8> }
InternalServiceResponse::AppSessionFailure { cid: u64, request_id: Option<Uuid>, install_id: String, reason: String }
```
`cid` is the member's workspace session CID (routing key, as in `AppFetch*`); `server_cid` is the
agent-held account's CID on the external server. `AppSessionMessage` and `AppSessionState` join
`CID_ROUTED_NOTIFICATIONS` (`citadel-workspaces/src/lib/multi-instance/routing-rules.ts`) with a
shape fixture each; the fixture-coverage test is the gate.

## 4. Agent behaviour (H2 agent part)

- One agent-held Citadel account per `(install_id, acting_username, server)`: username
  `<id_fp>.app-<install_id[..8]>@<server>` where `id_fp` is the acting member's identity
  fingerprint and `install_id[..8]` its first 8 characters; password `derive_password(server,
  username)` (identity-api §4); binding published on the external server with `sign_binding` so
  the Person link is `binding.pk == identity.pk` (SW §5.3). A legacy member with no identity: the
  open answers `AppSessionFailure { reason: "no_identity" }` and the guest falls back.
- Connect with the existing C2S machinery to `citadel.wss` of the server's well-known document,
  after the `ServerIdentityChallenge` (`server-identity-challenge.md`); hold it beside the
  member's session; reconnect with the SDK path (same CID); every inbound C2S message becomes one
  `AppSessionMessage`; connect/disconnect become `AppSessionState`.
- Hard limits in the agent, independent of the host's: one session per key above, ≤ 2 servers per
  install, `body ≤ 1 MiB`.
- **Servers must accept the username.** Added 2026-11-17 (coordinator's decision): the username
  above stays as written, so it is longer than the SDK's default `max_username_length` of 37 bytes.
  A server that accepts app sessions, and any server that accepts V2 identity accounts (whose
  `handle@domain` names are as long), must register with `max_username_length` raised above 37,
  up to `MAX_USERNAME_BYTES` (identity-api §1). The workspace server does this in
  `server_identity::credential_requirements()`. A server left at the default refuses the
  account's registration, and the open fails.

## 5. Tests (plan §4 H2 row)

Pure `session-rules` table; `servers ∉ manifest` → `Ungranted` with no agent call (recording
transport; control: skip the rule → the call reaches the agent → red); the agent reconnects with
the same CID after a forced close; routing fixture coverage red without the entry.
