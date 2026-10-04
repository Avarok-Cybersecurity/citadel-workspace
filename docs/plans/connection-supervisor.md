# Connection supervisor (and the Argon2 sunset)

Status: designed 2026-10-04 at the owner's request ("auto-healing … throughout the
entire session", SBIO-compliant, integrating with what exists). It ships in one release
with the Argon2 removal.

## Goal

Every account the agent hosts keeps data moving across tower switches, Wi‑Fi↔tether
changes, NAT rebinding and path loss, **with or without a window open**. The aim is that
outages are bounded by seconds, not by keepalive timeouts.

## What exists, and where it falls short (map of 2026-10-04)

| Layer | Today | Gap |
|---|---|---|
| C2S detection | SDK `NodeResult::Disconnect` only; the transport is a WebSocket to the tenant DO | Protocol keepalive every 15 min with a 45 min timeout, and no WS ping. A silently dead path can go unnoticed for a long time |
| C2S recovery | `kernel/reconnect`: pure `ReconnectPolicy` (500 ms doubling to 30 s, give up after 600 s); resume token (0.8.8) | No trigger other than an SDK disconnect; no OS network-change input |
| P2P after a C2S drop | The agent tears peers down and tells the UI (`lost_peers`) | **Only the UI leader tab redials.** With no window, nothing redials |
| P2P path | SDK campaign: server relay first, then Direct/TURN, then fall back | Recovery is **bounded** (3 attempts), then `stop_upgrading()` for life. Retries use `UdpMode::Disabled`, so the **UDP channel is lost** (calls) |
| QUIC | Server `migration(true)` | No client `Endpoint::rebind` on a local address change |
| ILM | Resends within ~200 ms of a peer reappearing in `conn.peers` | Correct, but it depends on someone redialling |
| OS signals | None (UI only has `online`/`offline`) | — |

## Design (SDD + SBIO)

### Pure core: `supervisor::core`

A deterministic state machine, one per hosted account. It does no I/O, uses no clock
and spawns no tasks.

```rust
pub enum Input {
    Tick { now: Millis },
    NetworkChanged { now: Millis },                      // interface/address set changed
    ServerProbe { now: Millis, outcome: ProbeOutcome },  // Ok(rtt) | Timeout | Error
    ServerLink { now: Millis, state: LinkState },        // from kernel/reconnect: Up | Reconnecting | Ended
    PeerLost { now: Millis, peer: Cid },
    PeerUp { now: Millis, peer: Cid, path: P2pPath },
    PeerPath { now: Millis, peer: Cid, path: P2pPath },
    DialResult { now: Millis, peer: Cid, outcome: DialOutcome },
    Backlog { peer: Cid, pending: u32 },                 // from the ILM
    Interest { peer: Cid, until: Millis },               // open chat or active call, from windows or the agent
}

pub enum Command {
    ProbeServer,                                    // a fast liveness check of C2S
    ForceReconnect,                                 // hand to kernel/reconnect (don't wait for the 45 min keepalive)
    RebindTransports,                               // QUIC endpoints rebind to the new local address
    DialPeer { peer: Cid },                         // the agent-side PeerConnect, with the session's TURN config
    UpgradePath { peer: Cid, restore_udp: bool },   // re-arm the SDK campaign
    Report(SupervisorEvent),                        // to windows: healing / healed / degraded
}

pub struct Core { /* per-account state: probe deadlines, per-peer backoff, wanted peers */ }
impl Core { pub fn new(policy: SupervisorPolicy) -> Self; pub fn step(&mut self, input: Input) -> Vec<Command>; }
```

**Rules:**
- **Liveness.** Probe every `probe_interval` (15 s). Probe **immediately** on `NetworkChanged`.
  `missed_probes` (2) consecutive timeouts lead to `ForceReconnect`. So a dead path is
  noticed in ≤ 30 s, or ≤ 2 × probe timeout after a network change.
- **Network change.** On a change: `RebindTransports`, then `ProbeServer`. If C2S is
  alive, re-arm `UpgradePath` for every connected peer whose path is `ServerRelay`.
- **Wanted peers** are `Backlog > 0`, or `Interest` not expired, or a P2P connection
  that was up before the drop. Each wanted peer that is not connected gets `DialPeer`
  with per-peer backoff (`dial_backoff`: 1 s doubling to 30 s, jittered from an injected
  seed). Dials happen only while C2S is `Up`.
- **Path healing.** A peer on `ServerRelay` with Interest or Backlog gets
  `UpgradePath { restore_udp: true }`, unbounded but with backoff (`upgrade_backoff`:
  5 s → 5 min). The backoff resets after a route has been stable for `stable_after`.
- **Single dialler.** When the supervisor runs, it is *the* dialler. Windows are told
  so through a capability, so the UI's auto-connect stands down and never duplicates a
  dial.
- **No hidden defaults (PCND).** `SupervisorPolicy` is constructed explicitly by the
  binary from config. The core has no `Default`.

### Ports (traits)

The production adapters live outside the core.

| Port | Production adapter | Test double |
|---|---|---|
| `NetworkWatch` (stream of `NetworkChanged`) | `if-watch` crate (route sockets on macOS, netlink on Linux, IP Helper on Windows); pure Rust | channel the test drives |
| `Clock` + `Timer` | tokio | manual clock |
| `ServerLink` (probe, force reconnect, link-state stream) | SDK keepalive-probe API + `kernel/reconnect` | scripted |
| `PeerDialer` | the existing `requests/peer/connect.rs` path, extracted so the agent can call it without a window request, using the session's last TURN config | scripted |
| `PathControl` (upgrade, rebind) | new SDK APIs (below) | recorded |
| `Backlog` | ILM `HostIo` queue depth per peer | map |
| `Reporter` | the session's `SessionRoute` (all windows) | vec |

The shell (`supervisor::run`) is a thin async loop: select over the ports, call
`core.step`, execute the commands. It contains no decisions.

### SDK changes (Citadel-Protocol)

1. **C2S liveness probe.** `remote.probe_server(cid, timeout)` round-trips a small
   authenticated keepalive now, without waiting for the 15 min schedule. The WS
   transport also answers and sends WebSocket ping/pong.
2. **Re-armable path campaign.** `PeerChannel::upgrade(restore_udp)` restarts the
   campaign after `stop_upgrading()`. A recovery that began with UDP enabled restores
   the UDP channel and reports it, so calls get their datagram path back.
3. **Transport rebind.** `remote.rebind_local()` calls quinn `Endpoint::rebind` on a
   fresh socket for each live QUIC endpoint. Combined with the server's existing
   `migration(true)`, a Direct/TURN QUIC path survives an address change without a
   new handshake where possible.

All three are version-gated where they touch the wire.

### Agent integration

- **Lifetime.** `kernel/supervisor/` is started per hosted account next to the ILM
  host, and is stopped by the same truly-ended paths (`prune_cid_scoped_state`). It
  survives recoverable drops, as #107 established for the ILM.
- **Reconnect.** `kernel/reconnect` stays the owner of C2S reconnects. The supervisor
  only *triggers* it (`ForceReconnect`) and listens to its `LinkState`.
- **Dialing.** The PeerConnect logic is extracted into a function both the request
  handler and `PeerDialer` call (SSOT).
- **Capability.** The new `supervises_p2p` capability makes the UI auto-connect stand
  down for supervised accounts, as `answered_by_agent` does. Windows send `Interest`
  (an open chat or call) instead of dialling.

### UI changes

- With `supervises_p2p`, the auto-connect stops polling and retrying for that
  account. Opening a chat sends `Interest`, and "Send" never waits on a UI dial.
- Show supervisor events in the existing connection status: "Reconnecting…",
  "Relayed", "Direct".

## Argon2 sunset (same release)

Do this after the owner's accounts have upgraded on 0.8.8. **Verify on the server**
that no `Legacy(Argon)` records remain before merging.
- **SDK:** delete the server's Argon2 verifier and the legacy login path. Keep the
  versioned `AuthRecord` and the post-auth upgrade hook, generalised and documented as
  the auth-migration pattern, with a test that a hypothetical `V2` record can be added
  and upgraded through the same hook. Pre-0.12 clients keep the clear "update your app"
  refusal (352).
- **Agent and server:** remove legacy-only paths and config, and the KSF settings the
  server no longer needs. Add a gate that the server WASM build contains no `argon2`
  crate.

## Tests (TDD; every test negative-controlled)

**Core (pure, manual clock):**
- 2 missed probes lead to `ForceReconnect`.
- A network change leads to rebind, then an immediate probe.
- A wanted peer is dialled with backoff, only while Up.
- No dial happens when the capability is off.
- An upgrade re-arms after the budget is spent.
- The stable route resets the backoff.

**Agent integration (the existing `Proxy`):**
- `strand()`, a silent dead path, recovers in ≤ 30 s, not 45 min.
- `sever()` with no window open: the peers are redialled by the agent, and ILM backlog
  is delivered.
- A call's UDP channel comes back after a fallback.

**SDK:**
- Probe semantics.
- Re-arm after `stop_upgrading`, with UDP restored.
- Rebind keeps a Direct QUIC path alive across an address change (loopback alias).

**Live:** Wi‑Fi↔tether flips mid-chat and mid-call on both Macs, under every policy.
