# Network topology pathing: path precedence, peer relay, group calls

Status: design, read-only investigation, 2026-10-22. Nothing has been built.

Code paths:
- `P` = `~/.cargo/git/checkouts/citadel-protocol-5ed557508e8a0da8/eb9c0b7`. This is Citadel-Protocol `rev=eb9c0b75`, pinned at `Cargo.toml:56`.
- `W` = `~/avarok/wt/followups-int`.

"(unverified)" marks anything not confirmed in code.

## 0. Summary

Most of the path machinery already exists in the protocol.
- **Path tracking:** every peer connection carries a live `P2pPath` (Direct | Turn | ServerRelay).
- **Bootstrap:** connections start on the server relay and upgrade in the background, with bounded, hysteretic retries.
- **TURN:** RFC 8656 TURN is wired end to end, over Cloudflare Realtime TURN minted by the tenant DO.

What is missing:
1. A **policy** owned by the server. Today a hard-coded per-attempt client choice (`'fallback'`) must match on both peers.
2. A **PeerRelay** path.
3. **Measurement** of which path won and of the bytes carried on each path.
4. A **group-call topology** other than a full mesh.

The biggest cost lever is that calls are a full mesh, and a pair on the server relay has **no UDP channel**. In that case media falls back to the reliable channel through the DO, and the DO meters every byte it receives.

## 1. How a P2P connection is established today

**Order of events**
1. The `PeerChannel` is created and is usable at once on the **server relay**. That traffic is end-to-end sealed; the server proxies it without decrypting.
   - Bootstrap and campaign: `P/citadel_proto/src/proto/peer/p2p_campaign.rs:1-7`.
   - Proxy: `packet_processor/raw_primary_packet.rs:216-299` (`check_proxy`). It forwards by `target_cid` and never decrypts; the endpoint keys are used only at the destination (:296-299).
2. During the Kex Stage1/Stage2 signals, the server stamps `PeerNatInfo` into the signal (`packet_processor/peer/peer_cmd_packet.rs:1202-1233`). It contains:
   - the peer's `NatType`, which the client reported at connect (`session.adjacent_nat_type`);
   - the peer address the server sees (`session.remote_peer`).
3. Both peers compute the same `P2pPlan` (`peer/p2p_path.rs:247-270`): `DirectOnly`, `DirectThenRelay(turn)`, `RelayOnly(turn)` or `ServerOnly`.
   - `direct_impossible` = `!NatType::stun_compatible`. It is true only when both NATs have Unpredictable IP or port translation (`citadel_wire/src/standard/nat_identification.rs:379-393`).
4. **Direct:** the UDP hole punch (`citadel_wire/src/udp_traversal/udp_hole_puncher.rs`).
   - The peers exchange `NatType` (:233-238), then STUN-probe each hole-punch socket for its server-reflexive address (:270).
   - Internal and reflexive candidates go to the peer over the server-relayed stream (:277-298), and from them a candidate pool is built (`hole_punch_config.rs:148-215`).
   - The result is **QUIC over the punched UDP socket**.
   - Timeout: `P2P_CONN_TIMEOUT` 30s (`peer/p2p_conn_handler.rs:650-676`).
5. **TURN**, if the direct attempt fails and a config was supplied: `peer/turn_p2p.rs:107-160`.
   - The lower-CID peer allocates; the other dials the allocation or relays from its own (`relayed_both`).
   - The quinn connection runs over `TurnRelaySocket` (`proto/misc/native_connect.rs:217-252`).
   - Timeout: `RELAY_TIMEOUT` 30s (`turn_p2p.rs:65`). Probes are bounded at 10s and 4s (`turn_rendezvous.rs:19-23`).
6. **Failure:** the connection stays on the server relay.
   - After a P2P route is lost, the protocol retries 3 times, with backoff from 2s up to 60s.
   - A route stable for 300s earns a fresh retry budget. The rendezvous timeout is 30s (`p2p_campaign.rs:55-64`).
   - When the budget is spent the campaign parks, until `PeerChannel::upgrade` re-arms it (`p2p_rearm.rs`, `channel.rs:143`).
   - If both peers' attempts produce a connection, a CID tie-break keeps one of them (`direct_route.rs:1-40`).

**What is observable**
- `P2pPathStatus{path, relayed_both, upgrading, closed}` is a watch channel (`p2p_path.rs:11-57`), exposed by `PeerChannel::path_changes / ensure_direct` (`channel.rs:183-201`).
- The agent forwards it as `PeerPathChangedNotification` (`W/citadel-internal-service/.../kernel/peer_path.rs:1-7`).
- The UI labels the path "direct" / "Relayed via Cloudflare TURN" / "Via workspace server" (`citadel-workspaces/src/lib/ice-servers/path-copy.ts:7-11`).
- Missing: time-to-connect, failure reason, and bytes per path. Reasons appear in log lines only (`p2p_conn_handler.rs:663-705`).

**Where the inputs come from**
- **TURN config:** supplied per attempt by the application through `SetPeerTurnConfig` (`citadel_sdk/src/remote_ext.rs:1133-1170`, `session_manager.rs:1229-1246`), and consumed by the attempt (`peer_cmd_packet.rs:1960`).
  - The UI fetches credentials with `GetIceServers` (`lib/ice-servers/workspace-port.ts:35-73`) and attaches them to PeerConnect/Accept.
  - The policy is hard-coded `'fallback'` (`lib/ice-servers/turn-source.ts:7`).
  - The agent maps it in `kernel/requests/peer/turn.rs:24-95`.
- **Node level:** `NodeBuilder::with_turn_servers` feeds only the WASM ICE list (`session.rs:2665-2686`).
  - `with_stun_servers` silently defaults to Google STUN (`nat_identification.rs:449-452`). That is an implicit default in production code (PCND); the agent sidesteps it by requiring 3 STUN servers (`stun.rs:12-20`).
- **Hosted server:** the server sees **synthetic** 100.64/10 peer addresses (`deploy/tenant-worker/server-wasm/src/lib.rs:155-162`). The hole punch still works, because it relies on STUN-observed reflexive candidates. The TURN permission code adds `server_seen` to its candidate set (`turn_p2p.rs:143`), which is harmless but useless when hosted.
- **Native server:** it has no ICE source, so native deployments never use TURN (`server-kernel/src/lib.rs:774,934`).

## 2. Where the central server carries bytes

| Traffic | Path today | Evidence |
|---|---|---|
| C2S workspace protocol, docs, RE-VFS | always server | — |
| P2P chat and ILM | the P2P channel: server relay until upgraded | agent `requests/message.rs:45-63`, ILM `messenger/mod.rs:1000-1010` |
| P2P file transfer | the peer's virtual connection, so it follows the path | agent `file/upload.rs:798-818` |
| Group messages (GroupBroadcast) | **always** server hub, reliable only; TreeKEM E2E, so the server sees ciphertext only | `group_broadcast.rs:604-628`, fan-out at `session_manager.rs:1724-1752` |
| Call media | per-peer `MediaEndpoint`: UDP channel if one exists; otherwise reliable after `UDP_WAIT` 5s | `citadel_sdk/src/media/mod.rs:5-11`; agent `kernel/media/mod.rs:51` |
| Group calls | **full mesh**: every sender sends to each of the N-1 peers; capped at 8 video / 12 audio | `lib/call/call-manager.ts:178,224-231`; `call-state.ts:118-120` |

On `ServerRelay` "no UDP channel exists" (`p2p_path.rs:19-21`). Server-relayed media therefore runs over TCP or WebSocket, with head-of-line blocking, and each sender's frames cross the DO N-1 times.

**Metering**
- The DO counts every inbound WebSocket byte (`bytes_in`) for each tenant and billing period (`control/sockets.mjs:18-39`, `control/meter.mjs:11-86`). C2S traffic and relayed P2P traffic are not separated.
- Overage is `floor(bytes_in/1e9) - included`. It is billed to Stripe `citadel_relay_gb` at $0.10/GB, on team and business only (`control/monitor.mjs:27-68`, `billing/tiers.json:121-141`).
- Included relay: free 2 GB total; team 20 GB per seat; business 50 GB per seat; trial 2 GB (`tiers.json:14,28,52,153`).
- **TURN bytes are not metered** ("until the SDK RelayGate exists", `tiers.json:114`). They are only gated: free and trial tenants are refused credentials once their included relay is used (`control/ice.mjs:33-39,72`).

## 3. "Who is on the network"

**What the server already has**
- Online sessions and the peer layer.
- Registrations and group membership.
- Each session's NAT model: `NatType` (IP and port translation, ipv6) (`peer_cmd_packet.rs:1211`).
- Every P2P connect signal passes through it, so it already learns who connects to whom and when.
- Natively, the client's public address. Hosted, a synthetic one; the DO maps the synthetic address to the real IP for admission (`server-wasm/src/lib.rs:142-144`).

**What must be added: a `PathReport`** (client to server, on every path change and every 60s while live):
- `{peer_cid, path, relayed_both, rtt_ms, ttc_ms, attempts, failure: enum, bytes_by_class{control,msg,file,media} per path}`;
- plus a periodic `NodeCapacity{uplink_kbps_est, on_battery/metered (unverified per OS), relay_consent, relay_caps}`.

From these the server builds a **connectivity matrix**: edges with path, RTT and recent loss.

**Privacy**
- This metadata is acceptable but must be disclosed. Put it in the privacy and terms text next to telemetry. It is product data, not opt-in telemetry, because the planner needs it. Bytes are counted per class; payloads are never seen.
- IP exposure:
  - A Direct path reveals each peer's IP (internal and reflexive) to the other.
  - TURN `RelayOnly` hides it (`citadel_wire/.../turn_relay/config.rs:147-153`).
  - A PeerRelay forwarder necessarily learns both endpoints' IPs.
- **User setting "relay only, never reveal my IP"** removes Direct and PeerRelay for that user, leaving Turn and then ServerRelay.
  - The UI dropped such a setting because a one-sided RelayOnly times out the pair (`ChatSettingsAdvanced.tsx:16-20`).
  - §4 fixes that: the server computes **one effective plan per pair** and stamps it into Kex, so asymmetry can no longer occur.

## 4. `PathPolicy`: configurable precedence

**Where it lives:** in the protocol, in the Citadel-Protocol repo. The plan is computed there (`plan_p2p`) and must be identical on both peers. The server already intercepts Kex to stamp `PeerNatInfo`, which is the natural place to stamp the effective plan.

```rust
// citadel_types::proto (serde, on the wire)
pub enum PathKind { Direct, PeerRelay, Turn, ServerRelay }
pub struct PathRule { kind: PathKind, enabled: bool, attempt_timeout: Duration, cost_weight: u32,
                      classes: TrafficClasses /* which of control|msg|file|media may use it */ }
pub struct PathPolicy { rules: Vec<PathRule> }   // order = precedence
impl PathPolicy {
  pub fn new(rules: Vec<PathRule>) -> Result<Self, PathPolicyError>; // no Default impl
}
```

**Validation in `new()`:**
- every kind appears exactly once;
- timeouts are within 1–60s;
- ServerRelay must be enabled for `control`, because Kex and signalling ride it;
- at least one enabled rule covers each class, unless the class is explicitly marked `deny`.

**PCND:** there is no `Default`. `NodeBuilder::with_path_policy(PathPolicy)` is **required** when `NodeType::Server`; `build()` errors without it. This is a deliberate SDK API break. Our two construction sites are `server-kernel/src/lib.rs:849` (hosted) and `:972` (native).
- The owner's order becomes an explicit `ServerConfig.path_policy` (kernel.toml) for native, and a host-supplied value for hosted.
- The hosted value comes from the tenant DO's plan (`control/plans.mjs`), giving per-tier and per-tenant overrides.

**Distribution and effective plan**
- The server sends its policy in the connect success, version-gated.
- At Kex it stamps `EffectivePlan = server policy ∩ A's restrictions ∩ B's restrictions ∩ NAT feasibility ∩ TURN availability for the tenant`. It also stamps `forwarder: Option<cid>` for PeerRelay.
- Both peers execute the stamped plan. This replaces the client-chosen `TurnPolicy` (`p2p_path.rs:261`).
- Old peers without the field keep today's `plan_p2p`, so the change is backward compatible.
- **Temporal note:** the server relay stays the bootstrap path (see §1). "ServerRelay last" means steady-state preference plus class gating: for example `media` denied on ServerRelay, so a call shows "connecting" instead of burning DO bytes. Whether to allow that is an owner decision (§7).
- The campaign walks the enabled rules in order, each with its own timeout. This replaces the hard-coded 30s/30s at `p2p_conn_handler.rs:650` and `turn_p2p.rs:65`. Retry and hysteresis stay as they are.

**PeerRelay mechanism (new)**
- Member M holds Direct paths to both A and B. A↔B run their **own end-to-end QUIC** through a `PeerRelaySocket`, a quinn `AsyncUdpSocket`. It mirrors `TurnRelaySocket` (`native_connect.rs:217-252`), so it reuses the existing install path, `P2pRoute`, the tie-breaker and the journal.
- A's datagrams to B travel as QUIC DATAGRAM frames on A↔M, tagged `(flow_id)`. M copies them onto M↔B.
- M sees only A↔B QUIC ciphertext, which is sealed with A↔B keys, plus the flow id. It never sees CIDs inside the payload and holds no keys.
- MTU is reduced by the tag and the outer header, as with `RELAYED_QUIC_MTU`.
- **Authorization:** the server issues a signed `ForwardGrant{flow_id, a, b, m, expires, byte_cap, kbps_cap}` to all three. M forwards only grants it holds, so nobody can use M as an open relay.
- **Consent and fairness:** M opts in per device (explicit setting, no implicit default) and sets caps. The planner never uses on-battery or metered devices (detection unverified). At most k flows per forwarder, and a member's forwarded bytes are reported.
- **Selection:** the planner chooses M by `min(rtt(A,M)+rtt(M,B))`, subject to uplink headroom and consent, preferring the lowest current forward load. Ties are broken by CID.
- An "I can't reach X" report triggers a re-plan.
- **Fallback alternative:** the existing `check_proxy` packet forwarding could run on a peer (its "server" condition generalised). It is simpler but bypasses end-to-end congestion control, so it is not recommended.

**TURN**
- **Credentials:** keep `IceServerSource` minting per member (`kernel/ice_servers.rs:16-82`; hosted `control/ice.mjs`). The server includes a `turn_available` bit in the effective plan so both peers agree. Agent-side fetching of credentials can move later, without changing the protocol.
- **Cost:** each peer reports TURN bytes, ×2 when `relayed_both` (`p2p_path.rs:28-32`). The DO adds them to the same relay quota, as a separate `turn_bytes` counter, reconciled against Cloudflare analytics (unverified whether per-key usage is exposed).
- **Who pays:** the tenant, from the same `relay_gb` pool. Owner decision.

## 5. Group calls: topology planner

**Control plane:** a call is a GroupBroadcast group, using the existing TreeKEM E2E group (`group_broadcast.rs:111-140`). Call state, plan epochs and sender keys ride `GroupBroadcast::Message`, reliable, through the server. These are small payloads.

**Media E2E:** an SFrame-style per-sender key (RFC 9605 shape).
- Each sender generates a key per epoch and distributes it inside the CGKA group message.
- Frames are sealed once by the sender in the browser (WebCodecs output, before `sendMediaFrame`).
- Forwarders, TURN and the server forward ciphertext only.
- On leave the key rotates, triggered by the CGKA epoch.
- This also removes N-1 re-encryptions on the sender. The hop-by-hop Citadel encryption stays underneath.

**Topology by size and reachability**, computed by the server planner from the connectivity matrix and stamped as `CallPlan{epoch, edges, forwarders}`:

| Size | Topology |
|---|---|
| N ≤ 4 | mesh over each pair's best path, under the PathPolicy |
| 5 ≤ N ≤ 12 | **forwarder (SFU-style)** |
| fallback | **server fan-out** |

- **Forwarder:** one member elected by uplink and the count of direct edges, with a second as hot standby. Each sender uploads once to the forwarder, which fans out. Senders whose edge to the forwarder is not Direct reach it by Turn.
- **Server fan-out**, when no forwarder qualifies or under policy: one upload per sender into a server "media group". This needs a new protocol primitive: GroupBroadcast extended with an unreliable media lane, or a reliable lane over the DO's WebSocket. Cost becomes 1× upload in plus N-1 copies out, versus N-1 copies in for the mesh.

**Re-planning**
- Re-plan immediately on join or leave.
- Re-plan on degradation only after a sustained breach (loss > 5% or RTT > 300ms for 10s).
- Minimum dwell time of 30s per plan, with epoch numbers. Peers switch on `epoch` and keep the old edges until the new ones carry media (make-before-break), mirroring `p2p_campaign` hysteresis.
- **Probe protocol:** members measure RTT and loss on their existing P2P channels and report through PathReport. Pairs without a channel are probed only on demand, when the planner needs that edge, to avoid O(N²) connections.

**Difficulty**

| Part | Rating |
|---|---|
| Mesh on the best paths, PathReport, server planner for mesh/forwarder selection, SFrame-style keys over CGKA, forwarder election | straightforward to moderate |
| Forwarder bandwidth adaptation (simulcast/SVC layers per receiver — WebCodecs SVC support per browser unverified), standby failover without audible glitches, a reliable degrade metric | **research-grade** |
| Fan-out from a WASM DO, which has no UDP | **research-grade** |

## 6. Measurement first (before any planner)

**Counters and events**
1. **Protocol** (Citadel-Protocol): a `PathOutcome` event per attempt: `{plan, path_won, relayed_both, ttc_ms, per-stage result: NatIncompatible | PunchTimeout | PunchErr | TurnNoConfig | TurnAllocErr | TurnTimeout | RendezvousTimeout}`, plus `PathBytes` byte counters per path (tx/rx) on `P2pPathCell`. The hook points are the outcome branches at `p2p_conn_handler.rs:661-705`.
2. **Server:** per-pair bytes proxied by `check_proxy` (`raw_primary_packet.rs:216`). This splits the DO's `bytes_in` into C2S and relayed-P2P, and gives the per-class split when the class is tagged.
3. **Agent:** maps 1 into `PathReport` and adds the class: media/file/ILM.
4. **DO:** `meter.mjs` gains `relayed_p2p_bytes`, `turn_bytes_reported`, and `group_fanout_bytes`.

**Export**
- 2 and 4 are server-side metadata, covered by the disclosure, with no opt-in.
- Per-pair detail with peer CIDs goes through the opt-in agent telemetry (`citadel-workspace-types/src/telemetry.rs:42-91`; stored in the tenant DO, 30-day retention). It needs a new structured `metric` entry kind, because today it carries WARN/ERROR log lines only.

**Baseline questions to answer first** (2–4 weeks of production data):
- (a) What fraction of DO `bytes_in` is relayed P2P traffic, by class?
- (b) For server-relayed pairs, why: no TURN config, TURN refused by quota, NAT-incompatible, punch failed, or campaign parked?
- (c) For those pairs, how often does a third online member hold Direct paths to both? That is the PeerRelay potential.
- (d) What is the size distribution of calls?

If (b) is dominated by "no TURN config" or a parked campaign, policy plus TURN fixes most of the cost **without** building PeerRelay or the planner.

## 7. Work plan

| # | Stream | Repo | Effort |
|---|---|---|---|
| 1 | Measurement (§6): PathOutcome/PathBytes; per-pair proxy counter | **Citadel-Protocol** (github.com/Avarok-Cybersecurity/Citadel-Protocol) | M |
| 1 | PathReport, DO meter split, telemetry metric kind | here: agent, kernel, tenant-worker, types | M |
| 2 | `PathPolicy` type, required `with_path_policy`, policy in connect success, `EffectivePlan` stamped at Kex, campaign walks the rules | Citadel-Protocol | M |
| 2 | ServerConfig/kernel.toml `path_policy`; DO plan → hosted policy | kernel, tenant-worker | M |
| 3 | TURN everywhere: native ICE source (coturn REST secret); TURN bytes into quota; drop the UI's hard-coded `'fallback'` | kernel, tenant-worker, UI | S–M |
| 4 | "Never reveal my IP" setting through the effective plan | UI, agent; protocol from #2 | S |
| 5 | PeerRelay: `PeerRelaySocket`, ForwardGrant, consent and caps | Citadel-Protocol (L); planner and consent UI here (M) | L |
| 6 | Call plane: SFrame keys over CGKA, CallPlan via GroupBroadcast, mesh-on-best-path | UI, agent | M |
| 6 | Forwarder/SFU role | agent media pump | L |
| 6 | Server fan-out lane | Citadel-Protocol | L |

**Order:** 1 → 2 → 3/4 → (gate on the baseline) → 6 mesh/keys → 5 → 6 forwarder → 6 fan-out.

**Bumping the protocol:** pin the new rev in the four Cargo.toml locations (avarok-update skill), rebuild the Docker images (`--no-cache`), then run sync-executor.

**What could break**
1. **Plan symmetry:** the peers must agree, today by both computing `plan_p2p` (`p2p_path.rs:247`). The stamped plan must be authoritative and version-gated; a peer that misses the field must keep the old behaviour exactly.
2. **Mixed agent and server versions** during rollout.
3. **Tie-breaker and journal:** PeerRelay must reuse `direct_route::attach` (`direct_route.rs:18`), or messages are lost or duplicated.
4. **Class gating:** denying `media` on ServerRelay changes call behaviour for every NAT-incompatible pair without TURN.
5. **Required `with_path_policy` breaks every SDK server builder**, including SDK tests and examples.
6. **DO CPU and memory** under server fan-out.

**Tests**
- **Pure logic, unit tests:** `PathPolicy::new` validation, `EffectivePlan` intersection, the planner (matrix → CallPlan, hysteresis), and ForwardGrant checks. These are SBIO pure cores; `plan_p2p` is already pure.
- **Deterministic simulated network:** a `DatagramSocket` trait under citadel_wire's hole puncher and quinn's `AsyncUdpSocket` (today it uses tokio `UdpSocket` directly). An in-memory fabric would model the NAT types:
  - endpoint-independent;
  - address-dependent and port-dependent filtering;
  - symmetric with port deltas;
  - loss and latency, on a seeded virtual clock.

  This lets CI run the whole campaign (punch → TURN → PeerRelay → ServerRelay) per NAT pair deterministically. It is large (L): the trait seam is the main cost.
- **Real NAT lab:** reuse `P/docker/peer_to_peer.yml` + `docker/set_nat.sh` (iptables NAT types, netem 100ms), and add a coturn container plus a third peer as forwarder. Run it as a NAT-pair matrix on GitHub-hosted ubuntu runners (privileged docker). Per memory, keep timing-sensitive jobs off the shared Mac.
- **Existing SDK tests to extend:** `turn_relay_p2p.rs`, `relay_pair/`, `relay_first_peer_channel.rs`, `p2p_path_rearm.rs`, `rebind_keeps_the_direct_path.rs`.
- **Production:** opt-in telemetry from dogfood tenants before and after each stream, judged against the §6 baseline.

**Owner decisions needed** (recommendations in brackets)
1. **Class gating on ServerRelay:** may media and files use it? [Per-class policy. Media on ServerRelay allowed on paid tiers only, metered; free gets "can't connect a call" with a clear reason.]
2. **PeerRelay consent:** [Opt-in per device, desktop only, caps of 2 flows / 5 Mbps by default *as UI choices the user confirms*, never on battery. Show the user how much they forwarded.]
3. **TURN cost:** [Count it in the same `relay_gb` quota; native self-hosted servers bring their own coturn.]
4. **Required `with_path_policy`** as an SDK break. [Yes, required for Server, with no Default.]
5. **Owner's order as the hosted policy for all tiers?** [Yes, the same order everywhere; tiers vary only by enabled classes and timeouts.]
6. **Call-size thresholds** for mesh/forwarder and whether to lift the 8/12 caps. [Keep the caps until the forwarder is proven.]
7. **Disclosure wording and placement** of the connection metadata in the terms. [Next to the telemetry terms; no opt-out, because the planner needs it.]
8. **Fix the Google-STUN implicit default** in the SDK (PCND). [Make STUN servers required for Peer nodes, as the agent already does.]
