# Coupons and Citadel Apps: revision 2 (owner decisions folded in)

Supersedes the named sections of `citadel-apps-and-coupons-design.md` (R1); everything not mentioned there stands.

Owner decisions (2026-10-21):
1. Comp/custom coupons are **truly unlimited**.
2. Trials need **no card**.
3. The global app catalogue is a **repo file signed at deploy**.
4. App network: apps reach the network through their **host** (the machine they run on, via the local agent) and/or the **workspace server**; this is the foundation for **internal HTTP over the Citadel protocol**: an `InternalHttpClient` and an `InternalHttpServer` in the SDK. The server kernel offers apps **named storage backends**.
5. Third parties may publish apps. WASM is signed by the publisher and **authenticated by the receiving user** (the installer pins the publisher key).
6. Artifacts may live on GitHub (pinned only), the central server, or any reachable backend, even a user self-hosting for one scope.
7. Every app's metadata has `audience: global | workspace | node | node_tree | users | roles`. The marketplace shows global apps and the user's workspace apps; a listing outside the viewer's audience cannot be enumerated.

Facts verified for this revision:
- The page never speaks the Citadel protocol: it sends `InternalServiceRequest::Message { cid, peer_cid: Option<u64>, message: Vec<u8>, security_level }` to the agent (or the in-page wasm client). `peer_cid = None` reaches the workspace server (the kernel parses the body as `WorkspaceProtocolRequest`); `Some(cid)` reaches a peer over the P2P session (`citadel-workspaces/src/lib/websocket/p2p-message-dispatch.ts`). `SendReliable` is the ILM-backed reliable variant (`citadel-internal-service/src/kernel/requests/send_reliable.rs`); ILM negotiates `PeerCapabilities` per peer and never sends a frame kind a peer has not advertised (`intersession-layer-messaging/src/capabilities.rs`). Internal HTTP rides exactly these: no new socket, no listener.
- The agent already owns a per-account local KV (`LocalDBGetKV/SetKV/DeleteKV/GetAllKV`) and a `DeclareCapabilities` handshake.
- `citadel-workspace-executor` defines `Trust::{FirstParty, Member, Anonymous}` and `Isolation::{None, Process, Machine}`; `execute_with` refuses weak isolation. The app host is an `ExecutionTransport` of this crate (third-party app = `Trust::Anonymous`, Worker = `Isolation::Process`).
- The kernel cannot run app wasm itself (the hosted kernel is wasm inside a Durable Object). An `InternalHttpServer` runs on a member's host (browser worker now, agent process later), never inside the kernel; the kernel provides discovery, relay, re-checks and storage.

## R1. Comp / custom coupons: truly unlimited

Grant shapes (`billing/tiers.json` `coupons.grants[]`) gain a required `unlimited: boolean`. Static codes may never reference an `unlimited: true` grant (catalogue load throws; negative control test). An unlimited grant is reachable only through a dynamic coupon issued by the signed admin tool, so no public repo file and no public code can carry it.

Tenant row: `grant_id TEXT NULL` plus `grant_unlimited INTEGER NOT NULL DEFAULT 0 CHECK (grant_unlimited IN (0,1))`, both set in the same batch that activates the comp tenant. `entitlements(row, now)` reads them, so the 15-minute drift repair (`control/monitor.mjs`) pushes the unlimited entitlements instead of reverting them (`sameEntitlements` compares `unlimited` too). The entitlements object gains `unlimited` (always present) and, when true, every usage limit is explicit JSON `null` ("no limit"): `members_max`, `storage_gb`, `connections_max`, `relay_gb_included`, `secure_links_per_member`, `secure_links_pool`; plus `relay_unmetered: true`. Quota sources (`LinkQuotaSource`, node storage `quotaBytes`, connection admission, relay cut-off) must accept `None`/`null` explicitly. The field is versioned (`entitlements.v = 2`); an object that cannot read a limit logs and ignores it (test: a v1 object given v2 unlimited entitlements neither crashes nor grants).

Ceilings that remain for an unlimited tenant (they protect the shared platform, not the tenant's usage; the admin tool's confirmation says so):
- `max_frame_bytes` 4 MiB (`tiers.json` `metering`);
- the kernel per-CID token bucket (`kernel/rate_limiter.rs`);
- TURN credential minting, 30 per member per hour;
- `workspaces_max: 1` (one object per slug);
- app resource caps (artifact 8 MiB, worker memory, per-request egress caps);
- platform physics: a Durable Object's 128 MB memory and SQLite size; an unlimited tenant that reaches them fails loudly with the existing errors.

Containment of a leaked unlimited code, without a cap:
1. Issue only through `tools/coupon-admin` (ML-DSA-65, admin domain, nonce, 5-minute expiry).
2. `max_redemptions` and `redeem_by` are required at issue (the tool refuses omission; recommend 1 per design partner and <= 30 days).
3. One redemption per slug and per tenant_id; slug creation is Turnstile-gated.
4. `RevokeCoupon{also_revoke_grants:true}` ends the grant on every tenant that used it (`setEntitlements` push); the monitor reconciles any miss.
5. `ListCoupons` / `ListRedemptions` show every unlimited grant and which tenants hold it.
6. Spend alarm, not a cap: the grant shape carries `alarm: { relay_gb_per_period, storage_gb, members }` (each required, `null` = none). The monitor writes a `coupon_events` row `alarm` (once per period per metric) and logs `[monitor] ALARM <slug> <metric> <value>`; nothing is cut. Defaults: relay 500 GB/period, storage 100 GB, members 250.
7. TURN relay is the one unmetered cost that can run; the admin tool's issue confirmation states the account-wide TURN allowance and Realtime list price.

## R2. Trials without a card

Checkout (subscription mode): `subscription_data[trial_period_days]=<days>` (1..`trial_caps.max_days`, hard cap 30), `payment_method_collection=if_required`, `subscription_data[trial_settings][end_behavior][missing_payment_method]=cancel`. Verify the three parameter names against the Stripe API version the Worker pins.

Lifecycle:
- `checkout.session.completed` with `payment_status: no_payment_required` (already treated as paid) -> row active; `customer.subscription.created` with `status: trialing` (already in LIVE) -> plan applied, `stripe_status='trialing'`, `trial_end` stored. `entitlements()` clamps every limit to `trial_caps` (free-tier-sized) while `trial_end !== null && stripe_status !== 'active'`.
- Card added during the trial (the portal allows payment-method update) -> at `trial_end` the subscription becomes `active` -> `customer.subscription.updated` -> clamp lifts.
- No card at `trial_end` -> Stripe cancels -> `customer.subscription.deleted` -> the existing ENDED branch: **downgrade to the free tier, data kept**. `trial_end`/`stripe_status` are cleared in the same change.
- Abuse bound: a trial tenant is free-tier-sized for the whole trial; the trial coupon's `max_redemptions`, one redemption per slug and Turnstile bound how many exist. `trial_will_end` is ignored (no mail).
- UI copy: "14-day trial, no card needed. Afterwards your workspace continues on the Free plan unless you add a payment method."

## R3. Global catalogue: repo file signed at deploy (unchanged from R1).

## R4. App network model

### R4.1 Capabilities and permissions

`AppInstallAllowNetwork` is dropped; these are added (49 permission variants in all). The Member seed holds none of them; Owner/Admin hold all.

| Capability (manifest `cap`) | What it is | Installer must hold | Risk |
|---|---|---|---|
| `net.host` + `hosts` | HTTPS egress from the member's own machine through their local agent (`InternalServiceRequest::AppFetch`); unavailable without an agent | `AppInstallAllowHostNetwork` | high |
| `net.host.private` | adds http:// and private/link-local ranges on the host (company LAN APIs); never the agent port or the page's loopback | `AppInstallAllowPrivateNetwork` | critical |
| `net.server` + `hosts` | HTTPS egress from the workspace server (kernel `EgressFetcher`), metered as `bytes_in`; private ranges never | `AppInstallAllowServerNetwork` | high |
| `ihttp.serve` + `routes` | the app registers an InternalHttpServer reachable over Citadel sessions | `AppInstallAllowInternalServe` | medium |
| `ihttp.call` + `targets` | the app may call InternalHttpServers (its own id by default; others listed) | `AppInstallAllowInternalCall` | medium |

Hosts are explicit only (no wildcards), at most 8.

### R4.2 Hard constraints
- The agent's `127.0.0.1:12345` is never published, proxied or tunnelled: the only new agent request is `AppFetch` (outbound from the agent); nothing listens. A hard-coded deny list in the shared policy crate refuses any fetch target that resolves to the agent's own bind address, `local.avarok.net`, or the page origin, even under `net.host.private` (negative control).
- The page keeps `connect-src 'self'` + loopback agent: apps never fetch from the page; every byte leaves through the agent (host) or the kernel (server). No CSP change; `check-preview-csp-matches-production.mjs` stays green.
- Internal HTTP rides existing authenticated sessions only (P2P session via `Message`/`SendReliable`, or the server session via `WorkspaceProtocolRequest::Apps`).
- Egress is explicit-allow-listed, capability-gated, metered (server: `bytes_in`; host: counted and shown), and SSRF-safe.

### R4.3 SSRF policy (one SSOT)
New pure crate `citadel-app-net-policy` (no I/O; used by the agent, the native kernel and server-wasm): `decide(request, resolved: &[IpAddr], grant) -> Verdict`. Rules: https only (http only with `net.host.private`); host must equal an allow-listed host exactly, ports 443/8443 unless listed as `host:port`; DNS is resolved by the caller and every resolved address is checked: deny 127/8, ::1, 10/8, 172.16/12, 192.168/16, 169.254/16, fe80::/10, fc00::/7, 100.64/10, 0.0.0.0/8, 192.0.0.0/24, 198.18/15, 224/4, ::ffff:0:0/96 mapped forms; with `private` still deny the agent bind address and 169.254.169.254. Redirects: max 3, re-decided per hop, same host only. Methods GET/POST/PUT/DELETE/PATCH/HEAD. Request body <= 4 MiB, response <= 16 MiB and 30 s. Headers allow-listed; no `Host`, `Cookie`, `Authorization` added by the runtime (the app sets its own); no credentials in URLs; 60 requests/min per install per user. The agent resolves then connects to the checked IP (pinning) to defeat DNS rebinding. Every denial answers the same uniform `Policy` refusal before any connection is attempted.

### R4.4 Internal HTTP: InternalHttpServer and InternalHttpClient

Addressing: `ihttp://<app_id>@<who>/<path>`, `<who>` = `user:<username>` or `scope:<scope_key>` (any host currently advertising for that install scope; the kernel picks a connected host or answers `no_host`). An app may only serve under its own `app_id`.

Registration: on `app_init`, an app with `ihttp.serve` calls `ihttp::serve(routes)`; the host runtime sends `AppsRequest::AdvertiseService { install_id, routes_digest, until_ms }` to the kernel (repeated every 60 s while mounted) and, for connected P2P peers, advertises through a new ILM `PeerCapabilities` flag `IHTTP = 0b10`. Unadvertised = unreachable. Routes are method+path patterns, <= 64 per app.

Wire format (CBOR, new crate `citadel-ihttp-types`, ts-rs exported), length-delimited, never textual HTTP/1.1 (no Content-Length/Transfer-Encoding, so no smuggling by construction):
```
IhttpFrame { v: 1, stream: u64, kind: RequestHead{method, path, query, headers, body_len: Option<u64>, app_id, scope_key}
  | ResponseHead{status, headers, body_len} | Body{bytes} | End | Cancel{reason} | Credit{n} }
```
Bodies travel as `Body` chunks <= 64 KiB under credit-based flow control (initial credit 4). Credit is the receiver's buffer space, one chunk per unit; a caller may grant it before the `ResponseHead`, and that credit stands once the head arrives. Limits: path 2 KiB, 32 headers x 1 KiB, request body 4 MiB, response 16 MiB, 8 concurrent streams per caller per server, 64 per server, 30 requests/s per caller. Deadline: open + 30 s, extended by every `Body` or `Credit` to min(now + 30 s, open + 60 s). On the relay, a stream past its deadline is closed at the next relay request after it passes, and both ends are sent `Cancel { Timeout }`. An end that sent `End` may still send `Credit` and `Cancel`.

Mapping onto existing layers:
- **P2P (preferred, end-to-end encrypted; the kernel never sees the body):** each frame is one `SendReliable` message whose body is a new top-level P2P envelope kind `citadel-ihttp/1`; the receiving window's P2P dispatcher routes it to the app host by `app_id`. A legacy peer that did not advertise `IHTTP` is never sent a frame (the rule ILM already enforces). Verify at implementation that a legacy receiver ignores unknown envelope kinds.
- **Server relay (no P2P session, or `scope:` addressing):** `AppsRequest::IhttpSend { to, frame }` -> kernel re-checks -> `AppsResponse::IhttpFrame { from, frame }` pushed to the target session. The kernel sees bodies on this path exactly as it sees group messages; the UI shows `via: relay`.
- The agent needs no new listener.

Auth: identity is the session's, never asserted by the app. Over P2P the serving host learns the peer's CID from the authenticated session; over relay the kernel stamps `from: {username, cid, install_id}` after verifying the caller's install holds `ihttp.call` for the target app id, the caller is inside the serving install's audience and scope, and the serving install is advertised and Active. The serving app receives `IhttpRequest { caller: Caller { username, cid, app_id, install_id, via }, ... }`. No bearer tokens; stream ids are per connection and monotonic (the relay refuses a caller's new id that is not above every id it opened before on that install).

Relay limits in the kernel: each session's `RequestHead`s (30/s) and `AdvertiseService`s (2/s) are counted before anything is read for them, and refused past that with `Limit("ihttp_rate")`. A later frame is checked against the destination it names before the stream's state changes. Every stream the relay opens or closes is logged as one `[APPS-IHTTP]` audit line with `from`, `to`, `app`, `install`, `via`, `bytes`, `ms` and `reason`. Every relayed frame, and every server egress answer, is reported to the kernel's `UsageMeter` port, which counts and logs; it is not wired to any plan's billing.

### R4.5 Storage backends (kernel-side, plus host-local)
All namespaced by (app_id, scope_key[, user|node]) from the install record, never from the call; all inside `storage_gb` except `local`.

| Backend | Cap | Key space | Limits | Installer permission |
|---|---|---|---|---|
| `storage.user` | per user per app+scope KV | `apps/kv/<app>/<scope>/u/<user>/<key>` | 1 MiB; key 256 B; value 256 KiB | AppInstallAllowStorage |
| `storage.scope` | shared per app+scope KV | `.../s/<key>` | 8 MiB | AppInstallAllowStorage (write needs EditContent on the scope node) |
| `storage.node` | per app per node KV | `.../n/<node>/<key>` | 1 MiB per node | AppInstallAllowStorage (write needs EditMdx on the node) |
| `blob` | content-addressed blobs | `apps/blob/<app>/<scope>/<sha256>` | 8 MiB each; 64 MiB per app+scope | AppInstallAllowStorage |
| `files` | the workspace's server file store under `/apps/<app>/<scope>/` | existing file ops | existing ServerCapabilities limits | AppInstallAllowFiles |
| `local` | host-local per app+user (agent LocalDB namespace `app:<app>:<scope>`; IndexedDB fallback) | agent KV | 4 MiB | AppInstallAllowStorage |

Kernel KV and blob writes are decided and made under `APPS_LOCK`: once the lock is held the install is read again, and must still be running, still grant the op to the member at the target, and the member must still hold the backend's permission there; root, namespace and quota come from that read. Every write that grows storage counts toward `storage_gb`, which app storage reads from the node's own backend exactly as RE-VFS does (a Durable Object's `quotaBytes`, through `kernel::limit::storage_quota`; `null` is no limit, an unreadable answer refuses the write); a write that shrinks storage is never refused. The two are not yet summed: app storage counts app bytes, and RE-VFS counts its own, against the same entitlement. Deleting a blob takes `EditContent` on the install's node, as a `storage.scope` write does. Bytes are written only under a record that already names them (an index covering old and new keys before any value, a ledger entry before any chunk), so a write or delete that fails part-way leaves nothing a purge cannot find. Keys under the host's `sys/` prefix are neither written, read nor listed by an app. `set_many` is atomic; `list(prefix, cursor)` pages 100 keys; `AppEvent::StorageChanged{backend,key}` is pushed to mounted instances of the same install.

### R4.6 SDK surface
Rust guest (`citadel-app-sdk`): `storage::{user,scope,node(id),local}() -> Kv {get,set,set_many,delete,list}`, `storage::blob::{put,get,delete}`, `storage::files::{write,read,list}`; `net::{host_fetch, server_fetch, host_fetch_stream}`; `ihttp::{Caller, Request, Handler, ResponseWriter, serve(routes, handler), Client{call, call_stream}, Address::{User{app_id,username}, Scope{app_id,scope_key}}}`. Every call is synchronous from the guest's view (the host blocks the worker on a reply handle; network calls have their own per-request timeout, separate from the 2 s compute budget). `Refused = Ungranted | Unavailable(reason) | Limit(what) | Policy(reason) | Remote(status)`.

TS host ports (`src/lib/citadel-apps/host/ports.ts`, injected; pure dispatcher): `StoragePort`, `BlobPort`, `HostNetPort` (-> agent `AppFetch`; absent without an agent), `ServerNetPort` (-> `AppsRequest::Call{Net}`), `IhttpPort {advertise, send, onFrame}`. `host/ihttp-router.ts` (pure) matches routes, enforces stream limits and credit; tested with fakes.

The lifecycle (start, suspend/resume, the required `app_close(reason)`, the manifest's bounded close grace, and what the host and the server release on every exit path) is `docs/app-lifecycle.md`.

### R4.7 Threat model additions
SSRF (policy crate, resolve-then-pin, deny ranges, same-host redirects, explicit hosts; agent port hard-denied); confused deputy across users (the serving app's calls run with the SERVING user's authority and its own install's caps, never the caller's; the `caller` field is stamped by the session/kernel); impersonation (no app-asserted identity field exists in the wire format); request smuggling (CBOR frames, no HTTP/1.1 parsing); DoS of a serving host (per-caller and per-server limits, credit backpressure, timeouts, kernel per-CID limiter); exfiltration (explicit hosts accepted one by one; no ambient credentials); relay plaintext exposure (P2P preferred; `via: relay` shown); DNS rebinding (pinned connect); port-scanning via error timing (uniform `Policy` refusal before any connection).

### R4.8 Phased delivery impact
- Phase A adds the five network permission variants (49 total), `citadel-app-net-policy` (exhaustive range tests, the agent-port negative control) and `citadel-ihttp-types`.
- Phase D splits: **D1** storage backends (kernel KV/blob/files + agent LocalDB namespace + `local` fallback) and server egress (`EgressFetcher` + policy); **D2** host egress (`InternalServiceRequest::AppFetch`, agent-side policy enforcement, UI port) and internal HTTP (router, P2P envelope kind + ILM flag, kernel `AdvertiseService`/`IhttpSend`, consent copy).
- A citadel-internal-service agent is needed for D (AppFetch, LocalDB namespace, ILM flag, envelope relay) alongside the kernel, SDK and UI agents; a security review runs on D1 and D2 separately.

## Remaining questions and the defaults in force until the owner says otherwise
1. Unlimited grant requires `max_redemptions` and `redeem_by` at issue (1 and 30 days; one code per design partner).
2. Spend-alarm thresholds as above; an alarm is also a `coupon_events` row.
3. Admin signing key separate from the support key.
4. Trial end with no card = downgrade to free, data kept; portal link on the claim screen only.
5. InternalHttpServer hosts: browser worker in D2; agent-hosted apps (wasmtime in the agent) later.
6. Server relay of internal HTTP allowed, with `via: relay` shown; P2P preferred.
7. Host egress not billed; server egress metered as `bytes_in`.
8. `net.host.private` grantable on the hosted product to Owner/Admin only.
9. Storage quotas as in R4.5.
10. Member seed role gets `AppInstall` via role migration v2.
11. Docs seeded as an Active workspace-scope install, transitional glue ABI only under the first-party key.
12. Accessibility tree for canvas apps: optional in v1, required for global listing by Phase E.
13. `RequestInstall`: copy-link in Phase C, requests in Phase E.
14. Coupon preview rate limit 20/hour per hashed IP, kept one hour, stated in the privacy notice.
15. Third-party global listings accepted on CI checks + signature without Avarok reading the source.
