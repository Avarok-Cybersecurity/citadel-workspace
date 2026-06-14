# Citadel Workspace Server — Production Deployment Analysis

> **Date**: March 3, 2026  
> **Status**: Analysis only — no changes implemented yet

## Summary

The current setup is strictly a development environment. The single most critical issue is that **all user data is stored in-memory and lost on every restart**. Switching to the existing `Filesystem` backend is a trivial code change.

---

## Critical: In-Memory Backend

Both the workspace server and internal service are hardcoded to `BackendType::InMemory`:

| Service | File | Line |
|---------|------|------|
| Workspace Server | `citadel-workspace-server-kernel/src/lib.rs` | L416-417 |
| Internal Service | `citadel-workspace-internal-service/src/main.rs` | L23 |

### What exists but isn't used

- `ServerConfig` already has `backend: Option<String>` — defined but **never read**
- `BackendType::Filesystem(path)` exists in `citadel_sdk` and is used in 5 existing tests
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
- **workspace-server (Citadel C2S, :12349)** — still binds `0.0.0.0` (its
  `bind_addr` lives in `docker/workspace-server/kernel.toml`, shared with
  dev). The Citadel protocol is end-to-end encrypted, so this is lower risk
  than the plaintext WS, but it remains an unguarded attack surface.
  **Remaining work:** make the server bind host configurable (env or a
  prod-specific `kernel.toml`) and bind it to `127.0.0.1` in production.
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

## Existing Remote Deployment

Two scripts exist for deploying to `avarok2` (51.81.107.44):

| Script | Purpose |
|--------|---------|
| `update-avarok-server.sh` | Pull, rebuild, run server with `--restart unless-stopped` |
| `restart-remote-server.sh` | Same + copy custom `kernel.toml` + verify port access |

Both deploy **only the workspace server** — no internal-service or UI. Neither provisions persistent storage.
