# P2P internal HTTP, group topics, and the Compute Pool demo: design (read-only investigation)

Tree: `~/avarok/wt/followups-int` (feat/apps-followups @ 01627d71). Paths are relative to it; `CIS/` = `citadel-internal-service/`, `UI/` = `citadel-workspaces/`, `K/` = `citadel-workspace-server-kernel/src/kernel/`. "UNVERIFIED" marks claims not proven from code.

## 0. Findings that shape everything
- F1. The P2P data path already exists in the agent but nothing uses it. `CIS/citadel-internal-service/src/kernel/requests/apps_ihttp.rs` validates a frame, checks `peer_capabilities(peer).carries_internal_http()` (ILM flag `INTERNAL_HTTP = 0b10`, `CIS/intersession-layer-messaging/src/capabilities.rs:30`; advertised by default, `kernel/ilm/registry.rs:26`), wraps it in `citadel-ihttp/1` (`kernel/apps/ihttp/envelope.rs`) and sends it over the ILM. Inbound frames go out as `IhttpFrameNotification` only to windows that declared `ClientCapabilities::ihttp` (`citadel-internal-service-types/src/multi_window.rs:100`). The UI declares only `{ agent_ilm: true }` (`UI/src/lib/agent-conversations/capabilities.ts:110`). Its only ihttp port is the relay (`UI/src/lib/citadel-apps/runtime/ihttp-relay-port.ts:10`: "The P2P path ... not used here yet").
- F2. The agent checks shape and the peer's flag. It does not check apps: it never looks at installs, consent, audience or routes (`kernel/apps/ihttp/mod.rs:1-8`). All authority checks on the P2P path must therefore live in the app host at each end, plus a kernel authority the serving host asks.
- F3. There is no per-member consent today. The installer grants (`AppInstall.granted`, `citadel-workspace-types/src/apps_install.rs`). Effective capabilities are granted ∩ the installer's permissions ∩ the acting user's permissions ∩ scope reach (`K/apps/rules.rs:148`, `K/command_processor/apps_gather.rs:131`). Per-user state is only `UserApps { disabled }` (`K/apps/records.rs:137`). The owner's "the user must allow it" needs a new per-user consent record.
- F4. There is at most one Active install per (app_id, scope_key) (`K/command_processor/apps_ihttp_target.rs:13`). For same-app P2P this means caller and server share one install, and the kernel can stamp `Caller.install_id` without the wire carrying it. The wire format deliberately has no identity field (`CIS/citadel-ihttp-types/src/lib.rs:14`).
- F5. Frames have two shapes: the guest `calls::FrameKind` with `Cancel{reason: String}` and the wire `IhttpFrameKind` with a closed `CancelReason`. One translation joins them (`UI/src/lib/citadel-apps/host/ihttp-wire.ts`). This is tolerable, but the sdk-types doc comment says the wire crate "must re-export rather than restate", which is an SSOT debt (S, CIS).
- F6. The demo needs no first-party key. `ListingOffer::Signed` installs any validly signed manifest (`ListingSource::Upload`, `K/command_processor/apps_offer.rs:69-83`). Only `documents` and the glue ABI are first-party-only (`K/apps/rules.rs:41`, `K/apps/install.rs:18`, which is `&[]`). The key matters only for a global catalogue listing (`apps/catalogue/catalogue.json`, which has no entries).
- F7. No integration spec installs an app. The only real-browser app check is `npm run check:app-zone` (UI). `IhttpFrameNotification` is not in `CID_ROUTED_NOTIFICATIONS` (`UI/src/lib/multi-instance/routing-rules.ts:39-56`). With two sessions in one browser, routing by request_id would hand one user's frames to the other's tab (the CLAUDE.md "Critical Routing Fix" class of bug).

## 1. The P2P internal-HTTP permission
**Decision: two capabilities**, mirroring the relay pair, because serving uses your device and calling does not:
- `ihttp.p2p.serve` + `routes` (subset of `ihttp.serve` routes; manifest must also declare `ihttp.serve`). Installer permission `AppInstallAllowPeerServe`. Risk: high.
- `ihttp.p2p.call` + `targets` (v1: targets MUST be empty, so the app calls its own id only; see OD3). Installer permission `AppInstallAllowPeerCall`. Risk: medium.
Both go in the `Ihttp` group (`CIS/citadel-app-sdk-types/src/capability.rs:64`), so there is no new import group. `acting_user_requirement` is `&[]`, like the relay caps (`K/apps/rules.rs:62`). Member seed: none; Owner/Admin: all (as R4.1). The 49 permission variants become 51 (`citadel-workspace-types/src/structs.rs:251`, plus `role_table.rs` tests).

**Per-member consent (new).** `UserApps` gains `peer_allowed: BTreeMap<install_id, PeerConsent { serve: bool, call: bool, at_ms }>`. New `AppsRequest::SetPeerConsentForMe { install_id, serve, call }` follows the `set_disabled` pattern (`K/command_processor/apps_member.rs:93`). The effective-capability function adds a fifth input, the member's own consent, for the two p2p caps only: no consent, not effective. Revocation is per install (= per scope) and per direction. "Disabled for me" already implies both are off. Per-peer block (OD4): `blocked_peers: BTreeSet<username>` per install, checked by the serving host's authorisation query.

**Where each check happens** (A calls B, same app, same install I at scope S):
| # | Check | Where | Source of truth |
|---|---|---|---|
| 1 | A's app holds `ihttp.p2p.call` (granted, installer still holds the permission, A consented) | A's host before the first frame (fast fail); re-checked by #5 | `AuthorizePeer` answer cached on A's page |
| 2 | Peer B advertises internal HTTP | A's agent (`carries_internal_http`, exists) | ILM PeerCapabilities |
| 3 | Frame is valid and within size limits | both agents (`ihttp::outbound` / `envelope::read`, exist) | citadel-ihttp-types |
| 4 | Caller identity | B's agent: `IhttpFrameNotification.peer_cid` is the authenticated P2P session's CID. Never app-asserted | Citadel session |
| 5 | A is inside I's audience and scope, I is Active, A holds effective `ihttp.p2p.call` + consent, A is not blocked by B; B holds effective `ihttp.p2p.serve` + consent; routes digest matches | **kernel**, asked by B's host on the first `RequestHead` from (A_cid, I) | kernel records |
| 6 | Route match, stream/credit/rate limits, monotonic stream ids per caller CID | B's host `ihttp-router.ts` (exists, relay-only today) | citadel-ihttp-types constants + manifest limits |
| 7 | B's app instance mounted and serving | B's host (no mounted instance means uniform refusal) | page |

**How B's host learns A's membership. Options compared:**
- (a) **Kernel query, recommended.** `AppsRequest::AuthorizePeer { serving_install_id, caller_cid, direction: Serve|Call } -> PeerAuthorized { caller: IhttpFrom{username,cid,app_id,install_id}, until_ms }` or the one refusal `NoHost`. The kernel maps cid to username itself, so the page's peer list is never trusted. It reuses `reaches` + `effective_for` + `may` (`K/command_processor/apps_ihttp.rs:52`, `apps_ihttp_target.rs:33`). The page caches the answer for `min(until_ms, 60 s)` per (caller_cid, install) and evicts the entry on any `AppEvent`/install-change push, so revocation takes effect within 60 s, or at once when the push arrives. Cost: one server round-trip per new caller per minute. The server learns who opened a stream to whom, and when, but never bodies (state this in the consent copy's detail line). No new key material. It fits "servers verify, clients compute" (memory).
- (b) Kernel-signed ML-DSA attestation `{user, cid, install, caps, exp}` that A presents in-band. B could verify offline, but this needs a kernel signing key in the DO (custody plus rotation), an identity field on the wire (against `lib.rs:14`), and revocation lags to `exp`. Only worth it once agent-hosted servers must work while the kernel is unreachable. Defer.
- (c) B trusts its local member list. Refused: stale, and it cannot see A's consent or grants.

**Spoofing/replay/deputy/amplification.** Spoofing: CID comes from the session (#4) and install/app are kernel-stamped (#5); nothing comes from the frame. Replay: Citadel session crypto plus ILM dedupe (UNVERIFIED that the ILM drops duplicate ids after reconnect). B's router also refuses a `RequestHead` whose stream id is ≤ the last one seen for that caller CID, and P2P ids must have bit 63 clear (`RELAY_STREAM_BIT`, `ihttp-wire.ts:28`). Confused deputy: as R4.7, the served handler runs with B's authority and B's caps. An inbound P2P request never grants the handler `net.*`. Amplification: a response is bounded by `MAX_RESPONSE_BODY_BYTES` and by a new manifest `limits.p2p.max_response_bytes`. Credit backpressure exists. The rate check (30/s per caller) runs **before** the kernel query, so a flood cannot become kernel load. The kernel adds its own per-CID limiter on `AuthorizePeer`. Probe resistance: every failure at #5–#7 answers `Cancel{Refused}` after the same code path. Unconsented, not installed and not in audience are indistinguishable to A's app, which sees `Refused::Unavailable("refused")`.

**When the user denies.** At install time `ihttp.p2p.*` may be optional. If the member declines: the call answers `Refused::Ungranted` at once with no frame sent, and serve answers `IhttpServe -> Ungranted` for P2P (relay advertising is unaffected). Manifest `optional:false` + member declines = the app does not mount for that member (existing required-cap path).

**Consent copy** (`UI/src/lib/citadel-apps/capability-copy.ts:49`; per-member prompt in `ConsentPanel.tsx`):
- serve: "Let other members' copies of this app run requests on this device. They talk directly to your device; the workspace server cannot see or filter this traffic. Only members who also installed and allowed it can reach you. You can turn this off at any time in Apps → Installed."
- call: "Let this app send requests directly to other members' devices. The workspace server cannot see or filter this traffic, but it does see who connects to whom and when."
Both prompts appear to every member on first mount (not only the installer) and are revocable per install in `InstalledApps.tsx`.

**Scope/audience interplay.** P2P is possible only between two members who are both inside I's audience and scope, who both consented (A: call, B: serve), who have a registered and connected P2P relationship (the SDK needs `peer_register`), and whose agents are ihttp-capable. Scope addressing (`Address::Scope`) stays relay-only.

## 2. Transport selection in the SDK
No default (PCND): every client names its transport.
```rust
pub enum Transport { P2p, Relay, PreferP2pThenRelay }
pub struct Client { pub to: Address, pub transport: Transport }
impl Client {
    pub fn new(to: Address, transport: Transport) -> Client;            // breaking: was new(to)
    pub fn call<A: 'static>(&self, req: Outbound, f: impl FnOnce(&mut A, Result<Response, Refused>) + 'static) -> CallHandle;
    pub fn call_stream<A: 'static>(&self, req: Outbound, on: impl FnMut(&mut A, ClientEvent) + 'static) -> CallHandle;
}
pub struct CallHandle { stream: u64 }  impl CallHandle { pub fn cancel(self); }  // Cancel{Caller}
pub fn serve<A: 'static>(routes: Vec<Route>, on: ServeOn, h: impl FnMut(&mut A, Request, ResponseWriter) + 'static) -> Pending<()>;
pub struct ServeOn { pub relay: bool, pub p2p: bool }                  // explicit, both required
// fan-out for decentralised compute
pub struct FanoutLimits { pub max_concurrency: u32, pub per_call_ms: u32, pub budget_ms: u32, pub max_total_bytes: u64 }
pub enum Outcome { Ok(Response), Failed(Refused), Skipped /* budget or cancel */ }
pub fn fanout<A: 'static>(targets: Vec<Address>, req: Outbound, t: Transport, l: FanoutLimits,
    each: impl FnMut(&mut A, usize, &Outcome) + 'static,
    done: impl FnOnce(&mut A, Vec<(Address, Outcome, Via)>) + 'static) -> FanoutHandle; // cancel() ends all
```
- `FanoutLimits` are clamped by the host to manifest `limits.p2p { max_fanout_concurrency, max_fanout_bytes, max_fanout_ms }` (new, required when any `ihttp.*` call cap is declared; manifest rule sets in both `apps_manifest_check_parts.rs` and the UI rules, plus cases in `apps/catalogue/fixtures/manifest-cases.json`). Partial failure is normal: `done` always fires once, with every target's outcome. It is pure SDK logic over `call_stream` (`CIS/citadel-app-sdk/src/ihttp/client.rs`), testable with the existing fake `RawAbi`.
- ABI: `calls::IhttpCall { to, frame, transport }` and `IhttpServe { routes, on }` (`CIS/citadel-app-sdk-types/src/calls/ihttp.rs:80-90`). The ABI fixtures, `bindings/AbiConstants.ts` and the UI generated copy are regenerated. `Via` already exists, and responses report it.
- Fallback is gated: `PreferP2pThenRelay` falls back only (i) before the `RequestHead` was accepted (send refused `NotAdvertised`/`NotHosted`/`Session`/no P2P session, or `AuthorizePeer` refused locally), and (ii) only if `ihttp.call` (relay) is effective. Otherwise the call answers `Unavailable("p2p")`. A stream never switches transport mid-way.
- TS ports: `IhttpPort` stays the interface (`UI/src/lib/citadel-apps/host/ports.ts:65`). New `runtime/ihttp-p2p-port.ts` sends `InternalServiceRequest::IhttpSend { cid, peer_cid, frame }` through `AgentLink`, resolves `username → peer_cid` from the agent's peer registry, listens for `IhttpFrameNotification`, and calls `AuthorizePeer` (with cache) for inbound `RequestHead`s. New `runtime/ihttp-transport-router.ts` (pure) picks the port per stream from `frame.transport` and keeps a stream on its port. `host-ports.ts:49` composes relay + p2p. `capabilities.ts:110` declares `ihttp: true` only when the page hosts apps. Add `IhttpFrameNotification` to `CID_ROUTED_NOTIFICATIONS` along with its shape fixture.

## 3. Exists vs gaps
| Layer | Exists | Gap (effort, repo) |
|---|---|---|
| sdk-types | caps, ops `Ihttp=11`, `Caller.via`, `Refused` | p2p caps; `transport` on IhttpCall; `ServeOn`; topic group + ops (S, CIS) |
| guest SDK | `serve`, `Client{call,call_stream}`, credit (`citadel-app-sdk/src/ihttp/*`) | `Transport`, `CallHandle::cancel`, `fanout`, `topic` module (M, CIS) |
| wire | `citadel-ihttp-types` frames, limits, validate | re-export the guest shapes (F5) (S, CIS) |
| agent | `IhttpSend`, envelope, ILM flag, `IhttpFrameNotification`, smuggling refusal | none for v1; an app-topic group create/join helper (§7) (M, CIS) |
| manifest/consent types | `ihttp.serve/call` + routes/targets | p2p caps, `limits.p2p`, `limits.topics`, topic caps (S, parent types) |
| kernel | relay checks (`apps_ihttp.rs`), adverts, withdraw, release-change cancel | `peer_allowed` consent, `SetPeerConsentForMe`, `AuthorizePeer` + limiter, p2p perms (M, parent kernel) |
| UI host | relay port, router, wire translation | p2p port, transport router, inbound authorise cache, routing rule (M–L, UI) |
| UI consent | install ConsentPanel, capability copy | member-level p2p/topic prompt, revoke toggles (M, UI) |
| demo/build/catalogue | sdk-fixtures reproducible build, signature crate | app crate, build+sign script, ephemeral key for tests (M, parent) |
| e2e | p2p helpers, multi-window world | apps install/consent helpers + specs (L, UI integration-tests) |

## 4. Demo app: Citadel Compute Pool (`net.avarok.compute-pool`)
Behaviour. Each instance serves deterministic jobs: `POST /job/primes {lo,hi}` (count primes in range, capped by range size), `POST /job/sha-chain {seed,n}` (n ≤ 1e5) and `GET /health`. A "Run" button splits a job into chunks and `fanout`s them to the peers on the pool topic using `PreferP2pThenRelay`. It verifies one random chunk locally (results are deterministic, so a wrong answer is detectable). It shows the per-peer transport (`via`), latency and bytes. A toggle forces `Relay` or `P2p` to demonstrate each one and its refusal.
Storage: `storage.user` holds the job history (last 50). `storage.scope` holds the pool's aggregate leaderboard (needs `EditContent` on the scope node for writes, `K` R4.5; UNVERIFIED whether the default Member role holds it, so the test must grant it). The topic plane is in §7.
Layout: `apps/first-party/compute-pool/{Cargo.toml, rust-toolchain.toml → ../../sdk-fixtures, src/{lib.rs, jobs.rs (pure, unit-tested), dashboard.rs (canvas draw list), pool.rs}, manifest.json}`. The build uses a new `scripts/build-first-party-apps.mjs`, the same reproducibility rules as `scripts/build-app-fixtures.mjs` (pinned toolchain, path remaps, own target dir, `--check` mode), target `wasm32-unknown-unknown`, and the wasm is committed. Signing uses a small `citadel-app-signature` example binary (`AppSigningKey::from_seed_hex(...).sign(id, version, digests)`, `CIS/citadel-app-signature/src/lib.rs:148`) reading the seed from an env var, never from a file in the repo.
Canvas UI: peer cards (username, transport badge P2P/Relay, RTT, last result), a job queue bar, and a latency sparkline. All are canvas draw commands; the accessibility tree is optional in v1 (R2 Q12).
Manifest (abridged): `audience: Workspace{}`, `scopes: [workspace, node]`, caps `storage.user`, `storage.scope`, `ihttp.serve{routes}`, `ihttp.call{targets:[]}`, `ihttp.p2p.serve{routes}`, `ihttp.p2p.call{targets:[]}`, `group.topic.publish/subscribe{topics:["pool"]}` (all `optional:false` except relay), limits `{memory_pages:64, max_call_rate_per_s:30, close_grace_ms:500, storage_user_bytes:262144, storage_scope_bytes:1048576, p2p:{max_fanout_concurrency:8, max_fanout_bytes:4194304, max_fanout_ms:20000, max_response_bytes:65536}, topics:{max_msg_bytes:4096, max_msgs_per_s:2}}`.
Key: the tests sign with an **ephemeral ML-DSA seed generated per run** (`crypto.randomBytes(32)`), installed via `ListingOffer::Signed` (F6). Nothing secret is committed. A global-catalogue listing needs the first-party key: **OWNER DECISION OD1**.

## 5. End-to-end test plan
New spec `UI/integration-tests/src/tests/apps-compute-pool.test.ts` plus helpers `src/lib/apps.ts` (`installSignedApp`, `consentPeer`, `revokePeer`, `readZoneLog`). It reuses `multi-window-setup.ts` (`openMultiWindowWorld`, `makePeers`), `p2p/registration.ts` (`p2pRegister`, `acceptP2PRequest`), `p2p/connection.ts` (`waitForP2PChannelReady`) and `account.ts` (`createAccount`). It uses two browser contexts, so each user has its own agent socket. A second variant with two tabs in one browser exercises CID routing (F7).
1. Admin A installs the app (workspace scope); A and B each accept the p2p prompts. Assert on the observable dashboard and the zone log, not on toasts (memory: toast assertions never matched).
2. Jobs over P2P: assert `via=p2p`, a correct result, and `tilt logs server` shows **no** `IhttpSend` for the stream (proves the bypass).
3. Forced Relay: `via=relay`; kernel log shows the relay.
4. Denials: B revokes serve → A's call gets `refused` (P2P), and PreferP2p falls back to relay; with the relay cap also not granted → `unavailable:p2p`. A non-member C cannot reach B (same refusal text as the unconsented case).
5. Revocation mid-flight: a long sha-chain stream, B revokes → the stream ends `Cancel{Refused|Closed}` within 60 s; the next call is refused. Uninstall mid-flight → `closed` (existing release-change cancel).
6. Negative controls (each must go red, then be restored with an mtime bump): remove the `AuthorizePeer` check in the p2p port → step 4 passes wrongly; remove `IhttpFrameNotification` from the routing rules → the two-tab variant misroutes; kernel unit tests for every `AuthorizePeer` branch (wrong audience, no consent, blocked, suspended, digest mismatch) with one uniform `NoHost`.
CI: kernel/SDK/host unit tests run anywhere. The e2e spec runs in the parent integration suite on GitHub runners with Docker (agents + server via compose; P2P between two agent containers works today per `hard-disconnect-offline.test.ts`). Local runs only for exploratory work, never concurrent (memory: integration tests share one backend). Use the P2P retry and warmup pattern (MEMORY: PeerConnect timeouts).

## 6. Build streams (non-overlapping files) and order
- S1 CIS types+SDK: `citadel-app-sdk-types/src/{capability.rs,calls/ihttp.rs,calls/topic.rs,ops/mod.rs}`, `citadel-app-sdk/src/{ihttp/*,topic.rs}`, regenerate bindings. **First.**
- S2 parent types+kernel: `citadel-workspace-types/src/{structs.rs,apps_manifest*.rs,apps_protocol.rs}`, `K/apps/{records.rs,rules.rs}`, new `K/command_processor/apps_peer.rs`. After S1 (Capability is re-exported).
- S3 UI host: `UI/src/lib/citadel-apps/runtime/{ihttp-p2p-port.ts,ihttp-transport-router.ts,topic-port.ts,host-ports.ts}`, `multi-instance/routing-rules.ts`, `agent-conversations/capabilities.ts`. After S1 bindings; fakes until S2.
- S4 UI consent: `capability-copy.ts`, `marketplace/{ConsentPanel,InstalledApps}.tsx`, `consent-model.ts`. Parallel with S3.
- S5 demo: `apps/first-party/compute-pool/**`, `scripts/build-first-party-apps.mjs`, signer example. After S1.
- S6 agent topics (§7): `CIS/citadel-internal-service/src/kernel/requests/group/*` app-topic variants. Parallel; protocol change P1 separately.
- S7 e2e: `integration-tests/src/{lib/apps.ts,tests/apps-compute-pool.test.ts}`. Last.
Merge order: S1 → S2 → (S3, S4, S5, S6) → S7. One mega PR per repo (memory). Bottom-up commit order per CLAUDE.md.

## 7. Control plane: group topics over Citadel GroupBroadcast
Verified from code (protocol rev eb9c0b75 is the one locked in both lockfiles; `group_broadcast.rs` is identical to 037a8cf):
- E2E: the server relays `GroupBroadcast::Message` without decrypting (`citadel_proto/.../peer/group_broadcast.rs:604-626`). Clients decrypt with TreeKEM CGKA (`:640-655`). A member without the epoch key gets `MessageDropped`. A CommandHierarchy non-reader is dropped silently.
- Offline: there **is** store-and-forward. `deliver_group_broadcast_signal_to` mails any member whose direct send fails (`citadel_proto/src/proto/session_manager.rs:1906-1965`), and `broadcast_signal_to_group` always passes `mail_if_offline = true` (`:1664`). I found no mailbox cap (`peer/peer_layer.rs:521` stores, `:231` drains; UNVERIFIED that no limit exists elsewhere). For heartbeats this means stale floods on reconnect plus unbounded DO storage. A message mailed under an older epoch is undecryptable after a rekey (dropped).
- Ordering: one sender's messages reach the server in order over its C2S stream and are fanned out sequentially. There is no cross-sender total order (UNVERIFIED beyond this reading). Success is reported only if every direct send worked (`Ok(failed.is_empty())`). There are no per-message acks to the sender.
- Size: no group-message size limit in the agent (`requests/group/message.rs`) or the protocol group layer (UNVERIFIED for the packet layer). So we must impose our own.
- Agent exposure: `GroupCreate{initial_users_to_invite}`, `GroupInvite{peer_cid}`, `GroupRequestJoin`, `GroupMessage{group_key,message}`, leave, end, kick (`citadel-internal-service-types/src/lib.rs:1664-1748`) → `GroupMessageNotification` (CID-routed). A window receives the plaintext of **every** group the session joined. The UI's chat pipeline (`UI/src/lib/group-conversations/*`) binds every group as a conversation.
- Cost: each join or leave is a TreeKEM Commit to all members plus a Welcome (O(log n) path secrets), serialised by the commit gate. Each publish costs N−1 server sends through the DO. The group fan-out happens in the protocol `session_manager`, below the workspace kernel, so the kernel's limiter and relay metering do not see it (UNVERIFIED whether the DO meters these bytes).
- Privacy: the server sees membership, sender, sizes and timing, not content. Apps see the topic member usernames and senders (needed to address P2P), never chat groups.

**Verdict: the two-plane shape is right, with three conditions.**
(1) App topics use **their own groups**, never existing chat groups. Joining a chat group would give the app host every human message in plaintext, and topic traffic would land in chat transcripts.
(2) Topics need a protocol option `MessageGroupOptions.ephemeral` → `mail_if_offline=false` plus a server-side per-group rate and size cap (protocol change P1, M, Citadel-Protocol). Until then, heartbeats are mailboxed.
(3) The chat pipeline must skip app-topic groups. The host records topic keys and group-conversations filters them, or "app topics appear as chats" (memory: features built from one end).
Kernel-relayed pub/sub (`AppsRequest::TopicPublish`, the kernel sees plaintext, simple, metered) is the fallback if P1 is refused: **OD7**.

Capabilities: `group.topic.subscribe` and `group.topic.publish`, each with `topics: [name…]` (≤ 4, `[a-z0-9-]{1,32}`), new import group `Topic = 16`, installer permission `AppInstallAllowGroupTopics`, risk medium. Each member consents separately: "Join this app's '<topic>' channel. Messages there are visible to everyone in the channel (members who installed and allowed this app); the server relays them but cannot read them." Limits come from manifest `limits.topics {max_msg_bytes ≤ 16384, max_msgs_per_s ≤ 4}`, enforced by the host (sender) and, after P1, by the server.
Membership: one Citadel group per (install_id, topic). The group key is stored by the **host** under a reserved kernel KV key `apps/kv/<app>/<scope>/sys/topic/<name>` that apps cannot write (new kernel rule). The first consenting member's agent creates the group. Later members `GroupRequestJoin`, and the owner's host auto-accepts if `AuthorizePeer(direction: Topic)` says the requester is admitted. Gap: joining needs the owner online. `RestoreOwnership` exists in the protocol; transferring ownership to any online consenting member is UNVERIFIED (OD8).
```rust
pub mod topic {
  pub struct Topic { name: String }
  pub fn open<A: 'static>(name: &str, on: impl FnMut(&mut A, TopicEvent) + 'static) -> Pending<Topic>;
  pub enum TopicEvent { Message { from: Caller /* via: Group */, body: Vec<u8> }, Members(Vec<String>), Dropped { from: String } }
  impl Topic { pub fn publish(&self, body: &[u8]) -> Result<(), Refused>; pub fn members(&self) -> Vec<String>; pub fn close(self); }
}
```
(`Via` gains `Group`; `Refused::Limit("topic_rate")`/`("topic_bytes")`.) Compute Pool on both planes: heartbeats `{cap: cores, load}` every 10 s and job announcements `{job_id, kind, chunks}` go on topic `pool`. Workers reply `claim{job_id, chunk}` on the topic. The requester then calls each claimant over P2P ihttp (`fanout`) for the chunk payload and result, and posts a short `done{job_id, digest}` gossip. Bulk data never rides the group.

## 8. Owner decisions (recommendation in brackets)
1. First-party publisher key custody for the global catalogue [ML-DSA seed generated offline, held as an org secret used only by the Deploy run; public key in `FIRST_PARTY_PUBLISHER_KEYS`; tests use ephemeral keys via Signed upload].
2. P2P as two caps `ihttp.p2p.serve`/`ihttp.p2p.call`, with new installer permissions `AppInstallAllowPeerServe`/`AppInstallAllowPeerCall` [yes].
3. v1 P2P same-app only (`targets: []`) [yes; cross-app P2P needs the caller's install on the wire or an attestation].
4. Per-member consent required for p2p and topics even when the installer granted them, plus a per-peer block list [yes].
5. Serving-host authority: kernel `AuthorizePeer` query with a 60 s cache vs a kernel-signed attestation [query].
6. The server learns caller→server stream metadata on P2P: acceptable, and stated in the consent copy [yes].
7. Topics on Citadel GroupBroadcast (needs protocol P1: ephemeral groups plus a server cap) vs kernel-relayed pub/sub [GroupBroadcast with P1; kernel relay only if P1 is declined].
8. Topic group ownership when the creator is offline [transfer to any online consenting member; needs a protocol check].
9. Demo id/name `net.avarok.compute-pool` "Compute Pool", shipped in the catalogue after OD1 [yes].
10. `PreferP2pThenRelay` falls back only before the stream opens, and only with the relay cap [yes].
