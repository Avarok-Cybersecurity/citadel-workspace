# Citadel Workspace

A post-quantum-secure, peer-to-peer collaborative workspace built on the
[Citadel Protocol](https://github.com/Avarok-Cybersecurity/Citadel-Protocol).

## Layout

This repository uses nested git submodules:

| Path | What it is |
|------|------------|
| `citadel-workspaces/` | React + TypeScript UI (submodule) |
| `citadel-internal-service/` | Rust internal service — the local agent that owns protocol connections (submodule) |
| `citadel-internal-service/intersession-layer-messaging/` | Reliable offline-capable messaging layer (nested submodule) |
| `citadel-workspace-client-ts/` | TypeScript/WASM client bindings |
| `citadel-workspace-server-kernel/` | Rust workspace server kernel |
| `citadel-workspace-types/` | Shared Rust protocol types |

## Quick start

```bash
git clone --recurse-submodules https://github.com/Avarok-Cybersecurity/citadel-workspace
cd citadel-workspace
npm ci

# bring up server + internal service + UI
docker compose up -d --build --wait     # or: tilt up
```

The UI is served at <http://127.0.0.1:5291>, the internal service on `:12345`,
and the workspace server on `:12349`.

## Tests

```bash
# Rust
cargo test -p citadel-workspace-types -p citadel-workspace-internal-service -p citadel-workspace-server-kernel
(cd citadel-internal-service && cargo nextest run)

# TypeScript unit tests
(cd citadel-workspaces && npx vitest run)

# End-to-end
(cd citadel-workspaces/integration-tests && npx playwright test)
```

See [docs/TESTING.md](docs/TESTING.md) for the full guide.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — system architecture, protocol layers, P2P message flow
- [docs/](docs/README.md) — deployment, testing, WASM build/sync, roadmap and reference docs
- [CLAUDE.md](CLAUDE.md) — conventions and workflow rules for contributors and AI agents
