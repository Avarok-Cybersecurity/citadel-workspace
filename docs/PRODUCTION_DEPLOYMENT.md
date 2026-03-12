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

### P2 — Investigate

| Item | Question |
|------|----------|
| TLS for browser path | Does citadel protocol encryption cover the browser ↔ internal-service WebSocket, or does it need WSS? |
| Password hashing | How does `AsyncWorkspaceServerKernel` store the master password? The old (commented out) code stored it as plain text. |

### Fine As-Is

| Item | Why |
|------|-----|
| `network_mode: host` | Fine for single-host deploys; avoids NAT issues for citadel protocol |
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
