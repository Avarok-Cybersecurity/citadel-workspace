# Citadel Workspace Server — Production Deployment Analysis

> **Date**: March 3, 2026 (original analysis)  
> **Status**: ✅ Backend selection now IMPLEMENTED by this PR. The sections
> below are retained as historical context; see "Backend Selection (now
> implemented)" for the current behavior.

## Summary

This was originally a development-only setup whose single most critical issue
was that **all user data was stored in-memory and lost on every restart**. That
is now resolved: both services select their backend from env vars, and the
production compose runs them on the `Filesystem` backend.

---

## Backend Selection (now implemented)

Both services choose their backend at startup; in-memory remains the dev
default (ephemeral `tilt` runs) and `filesystem` is selected in production:

| Service | Env vars | Production value |
|---------|----------|------------------|
| Workspace Server | `WORKSPACE_BACKEND` / `WORKSPACE_DATA_DIR` | `filesystem` → `/data/server` |
| Internal Service | `INTERNAL_SERVICE_BACKEND` / `INTERNAL_SERVICE_DATA_DIR` | `filesystem` → `/data/internal-service` |

`docker-compose.production.yml` sets these, and both services persist to named
volumes. The internal service logs a loud startup warning if it falls back to
in-memory (which disables file transfer).

### Historical: what the in-memory analysis found

Before this PR, both services were hardcoded to `BackendType::InMemory`:

- `ServerConfig` had `backend: Option<String>` defined but never read (now read,
  with the env override taking precedence)
- `BackendType::Filesystem(path)` exists in `citadel_sdk` and was already used
  in 5 tests
- The `"filesystem"` argument is just a directory path where the SDK stores data

### Tests using Filesystem backend

| Test File | Test Name |
|-----------|-----------|
| `tests/file_transfer.rs` | `test_internal_service_standard_file_transfer_c2s` |
| `tests/file_transfer.rs` | `test_internal_service_c2s_revfs` |
| `tests/intra_kernel.rs` | `test_intra_kernel_send_file` |
| `tests/intra_kernel.rs` | `test_intra_kernel_revfs` |
| `tests/service.rs` | `test_internal_service_peer_with_psk_negative_case` (ignored, unrelated reason) |

> **Note**: These tests set `Filesystem` on the internal-service side only. The server side in tests uses `EmptyKernel` with the SDK default backend.

### Switchover (1-line change per service)

**Workspace Server** (`lib.rs:416-417`):
```diff
-    // Always use in-memory backend for now
-    let backend_type_for_node_builder = BackendType::InMemory;
+    let backend_type_for_node_builder = match &config.backend {
+        Some(path) => BackendType::Filesystem(path.into()),
+        None => BackendType::InMemory,
+    };
```

**Internal Service** (`main.rs:23`):
```diff
-        .with_backend(BackendType::InMemory) // TODO: parameterize this in the opts
+        .with_backend(BackendType::Filesystem("/data/citadel".into()))
```

**kernel.toml**:
```toml
backend = "/data/citadel-server"
```

**docker-compose.yml** (add persistent volume):
```yaml
server:
  volumes:
    - server_data:/data/citadel-server
```

---

## Prioritized Action Items

### P0 — Must Fix

| Item | Difficulty | Files |
|------|-----------|-------|
| Switch backends InMemory → Filesystem | Trivial (1-line each) | `lib.rs`, `main.rs`, `kernel.toml`, `docker-compose.yml` |

### P1 — Should Fix

| Item | Difficulty | Details |
|------|-----------|---------|
| Add restart policies to compose | Trivial | Add `restart: unless-stopped` to server and internal-service. The standalone deployment scripts already do this. |
| Production UI build stage | Medium | UI Dockerfile only has a `dev` stage running Vite dev server. Add `prod` stage: `npm run build` → serve with nginx. |

### Network Exposure (host networking) — IMPORTANT

Every service runs with `network_mode: host`, which is required so the
co-located `cloudflared` process can reach the origins over loopback. The
catch: a service that binds `0.0.0.0` under host networking is reachable on
**all** host interfaces — including any public IP — which bypasses the
Cloudflare TLS/Access boundary entirely (an attacker can hit
`ws://<host-ip>:12345` and `http://<host-ip>:8080` directly).

- **internal-service (WebSocket control plane, :12345)** — now binds
  `127.0.0.1` in production via `INTERNAL_SERVICE_BIND_HOST=127.0.0.1`
  (`docker-compose.production.yml`). cloudflared/nginx still reach it over
  loopback; the public interface no longer exposes it. Override only if your
  ingress reaches it over a non-loopback interface, and add a host firewall.
- **nginx UI (:8080)** — intentionally reachable by cloudflared over
  loopback; serves only the static SPA with a restrictive CSP. Low risk, but
  a host firewall blocking :8080 publicly is still recommended.
- **workspace-server (Citadel C2S, :12349)** — binds `127.0.0.1` in
  production via `WORKSPACE_BIND_ADDR` (`docker-compose.production.yml`, and
  the same value in `publish-images.yml`). The kernel reads that env var and
  falls back to `kernel.toml`'s `bind_addr` — still `0.0.0.0:12349`, which is
  what dev wants and why the file is shared.

  Set `WORKSPACE_BIND_ADDR=0.0.0.0:12349` only for a deployment where remote
  clients reach this server directly rather than through the co-located
  ingress; the Citadel protocol is end-to-end encrypted, so a public bind is
  by design in that mode, but pair it with a host firewall.
- **Mandatory regardless:** run a host firewall (ufw / cloud security group)
  that allows only Cloudflare ingress and blocks `8080`/`12345`/`12349` from
  the public internet. Host networking means Docker's own port mapping does
  not isolate these.

### P2 — Investigate

| Item | Question |
|------|----------|
| TLS for browser path | Does citadel protocol encryption cover the browser ↔ internal-service WebSocket, or does it need WSS? |
| Password hashing | How does `AsyncWorkspaceServerKernel` store the master password? The old (commented out) code stored it as plain text. |

### Fine As-Is

| Item | Why |
|------|-----|
| `network_mode: host` | Required so cloudflared can reach origins over loopback; avoids NAT issues for citadel protocol. **But** see "Network Exposure" above — services must bind loopback and/or sit behind a host firewall, not rely on host networking for isolation. |
| Resource limits (2G/2CPU) | Reasonable defaults, tune after deployment |
| Logging (stdout) | Standard for Docker; pipe to aggregator as needed |
| `.env` security | Already gitignored; env vars are standard Docker secrets approach |
| Monitoring/backups | Operational concerns post-deployment |

---

## Current Architecture

```
                    ┌─────────────────┐
                    │  Reverse Proxy   │  (needed for production)
                    │ (nginx/caddy)    │
                    │  TLS termination │
                    └────┬───────┬────┘
                         │       │
              HTTPS/WSS  │       │  HTTPS
                    ┌────▼───┐ ┌─▼──────────┐
                    │ Int.   │ │   Static    │
                    │Service │ │   UI        │
                    │:12345  │ │(nginx/CDN)  │
                    └────┬───┘ └────────────┘
                         │
                    ┌────▼───────┐
                    │  Workspace  │
                    │  Server     │
                    │  :12349     │
                    │  ┌────────┐ │
                    │  │ Data   │ │ ◄── Persistent volume
                    │  │ Volume │ │
                    │  └────────┘ │
                    └─────────────┘
```

## Audio and video calls

Calls are peer to peer. There is no SFU, no TURN server and no media relay — the
workspace server never sees a frame — so what they need from a deployment is
different from what messaging needs.

**A datagram path between peers.** Peer connections are established with
`UdpMode::Enabled`, and media rides that channel. Media deliberately does not
fall back to the reliable channel: on a reliable ordered transport there is no
such thing as a lost packet, so congestion becomes unbounded latency instead,
and a call running seconds behind is worse than one that dropped a frame.

If UDP cannot be negotiated between two peers, messaging still works and only
calling is lost. The client says so explicitly rather than appearing to connect
and carrying nothing.

Practical consequences:

- Peers behind symmetric NAT or a UDP-blocking firewall may fail to establish
  the datagram path. Nothing needs to be opened on the SERVER for this; it is a
  property of the two clients' networks.
- No media ports need to be exposed on the workspace server. It carries call
  SIGNALLING inside ordinary messages, and nothing else.

**Browser requirements.** Encoding and decoding happen in the browser via
WebCodecs, which is the only route to hardware encoders. The client probes
support at runtime and disables the call buttons with the reason when it is
missing, so an unsupported browser degrades to a working messaging client rather
than a broken call.

**Group calls are a full mesh**, capped at 8 participants with video and 12
audio-only. Each participant uploads one stream per peer, so the practical limit
is uplink bandwidth rather than server capacity. Above the cap the UI refuses
with an explanation instead of starting a call that would collapse.

**Membership matters.** A room's callable roster comes from its members.
Registering an account does not make someone a member of any domain, so a
brand-new room has nobody to call until members are added.

## Existing Remote Deployment

The deployment on `avarok2` lives at **`/srv/citadel-tenants/avarok`** — compose
project `avarok`, holding `deploy.sh`, `docker-compose.production.yml`, `.env`,
the loopback certificate pair, and the tenant provisioning scripts.

`~/development/citadel-workspace-server` is a stale source checkout on the same
host. It has no `deploy.sh` in it. Both operator scripts defaulted to it, so
both failed with `./deploy.sh: No such file or directory` for a deploy that was
otherwise correct.

`deploy.sh` on the host is the deploy. It reads `.env`, refuses a
`__CHANGE_ME__` master password before touching anything, pulls prebuilt images
from GHCR, verifies every image came from the same commit, and restarts
services sequentially without touching the data volumes. It deploys the whole
stack, not just the workspace server, and the data volumes persist across
deploys.

| Script | Purpose |
|--------|---------|
| `update-avarok-server.sh` | SSH wrapper: checks `deploy.sh` is there, runs it, confirms the port. Flags pass straight through (`--no-pull`, `--tunnel`). |

`AVAROK_SSH_HOST` and `AVAROK_REMOTE_DIR` override the host and path.

**The server's port comes from `WORKSPACE_BIND_ADDR` in the host's `.env`** — it
is 12400 on avarok2, not the 12349 of the dev stack. Both scripts hardcoded
12349 and so reported a closed port on a server that was serving. Read the port
from that file; do not assume the dev value.

`restart-remote-server.sh` is gone. Its one distinct job was uploading a
`kernel.toml` to `$REMOTE_DIR/docker/workspace-server/`, and neither half of
that exists any more: the deployment directory has no `docker/` tree, and
`docker-compose.production.yml` mounts no kernel config — the file is baked into
the image and production is configured through `.env`. Everything else it did
was a second copy of `update-avarok-server.sh`.

### The UI half, which `deploy.sh` does not currently manage

Measured on the host, because none of it was written down and all of it matters
for the next deploy:

```
internet → nginx :443  (/etc/nginx/sites-available/work.avarok.net.conf,
                        Let's Encrypt cert for work.avarok.net)
         → 127.0.0.1:8099
         → the citadel-ui container  (bridge network, 8099->8080)
```

There is **no cloudflared**, despite this compose file carrying a profile for
one. The public edge is that host nginx.

Three divergences to reconcile deliberately, not one at a time:

1. **The HOST's `docker-compose.production.yml` declares only `server`.** That
   is why `deploy.sh` prints "Skipping ui" and why the container currently
   serving the site is an ad-hoc `docker run` outside compose — image
   `citadel-workspace-ui:loopback-3078d2f1`, built by hand from a branch that
   was never merged. Nothing in the tree can reproduce it, which is how the
   loopback support in round 679 came to exist in a comment and in no file.
2. **`127.0.0.1:8080` on that host is already bound by an unrelated process.**
   A `network_mode: host` UI would collide with it while nginx kept proxying to
   8099, where nothing would answer. The service in this repo is therefore
   bridge with `127.0.0.1:${UI_PORT:-8080}:8080`, and this host sets
   `UI_PORT=8099` in its `.env`.

   The port is a variable and not a literal because hard-coding 8099 made the
   shared compose file describe avarok2 and nobody else: CI's "Smoke Test -
   Services Start" waits on `http://localhost:8080/` and timed out. A
   deployment-specific value belongs in that deployment's `.env`.
3. **`LOOPBACK_AGENT_ORIGIN` must be in the host's `.env`**
   (`wss://local.avarok.net:12345`). The running container has it; the compose
   file in this repo passes it through, and `deploy.sh` refuses to deploy a
   `ui` service without it. Empty means the page ships an empty agent meta tag
   and a `connect-src 'self'` that forbids the agent — it loads, looks correct,
   and can open no socket.

   **Added to the host on 2026-09-07**, because it was NOT there: the `.env`
   carried `WORKSPACE_MASTER_PASSWORD`, `INTERNAL_SERVICE_ALLOWED_ORIGINS`,
   `INTERNAL_SERVICE_BIND_HOST`, `INTERNAL_SERVICE_PORT`, `WORKSPACE_BIND_ADDR`
   and `IMAGE_TAG`, and nothing else. The value the running container carries
   reached it through `docker run -e`, not from that file, so the first
   compose-managed deploy would have aborted on the guard — which is the guard
   working, and a better outcome than the alternative. The value now in `.env`
   was verified equal to the one the live container is running, and a timestamped
   backup of the previous file sits beside it.

After any UI deploy, check the two things that fail silently:

```bash
curl -sI https://work.avarok.net/ | grep -i content-security-policy   # must name wss://local.avarok.net:12345
curl -s  https://work.avarok.net/ | grep -o 'citadel-loopback-agent[^>]*'  # must have a non-empty content
```

Then the behaviour, not just the headers:

```bash
node scripts/prove-users-can-talk.mjs --origin https://work.avarok.net \
                                      --server citadel.avarok.net:12400 --users 3
```
