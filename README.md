# Citadel Workspace

A collaborative workspace where every message, file and call is encrypted end to
end with post-quantum cryptography, and traffic travels **directly between
people** rather than through a server that could read it.

Built on the [Citadel Protocol](https://github.com/Avarok-Cybersecurity/Citadel-Protocol).

## What it does

- **Messaging** — direct and group conversations. Messages sent while someone is
  offline are held and delivered when they return.
- **Audio and video calls** — one-to-one and group, encoded in the browser and
  carried over the same encrypted peer channel. No SFU, no TURN server, no third
  party in the media path.
- **File transfer** — files go straight to the people in the conversation,
  without being uploaded to storage in between.
- **Live documents** — several people editing at once, with changes appearing as
  they type.
- **Workspaces, offices and rooms** — a structure teams can map onto how they
  actually work, with permissions that inherit downward.
- **Workspace theming** — an administrator sets the palette and icon everyone
  sees; each person still chooses light or dark for themselves.
- **Installable** — a PWA that installs to the desktop or home screen and loads
  without a connection.

## How it fits together

```
Browser (React + WASM)
   │  WebSocket, localhost only
   ▼
Internal service  ── a LOCAL agent, one per user, that owns protocol connections
   │
   ├─ Citadel P2P (reliable)   → chat, signalling, file transfer
   ├─ Citadel P2P (datagram)   → audio and video frames
   └─ Citadel C2S              → the workspace server: structure, membership, permissions
```

The internal service runs on the user's own machine. The workspace server stores
structure and membership — it never sees message contents, file contents, or
media.

Media is encoded and decoded in the browser with WebCodecs, so calls reach the
platform's hardware encoders. The protocol carries opaque encrypted frames and
never inspects them.

See [ARCHITECTURE.md](ARCHITECTURE.md) for protocol layers and the full message
flow.

## Repository layout

Nested git submodules — commit innermost first (see [CLAUDE.md](CLAUDE.md)):

| Path | What it is |
|------|------------|
| `citadel-workspaces/` | React + TypeScript UI (submodule) |
| `citadel-internal-service/` | Rust internal service, the local agent (submodule) |
| `citadel-internal-service/intersession-layer-messaging/` | Reliable offline-capable messaging (nested submodule) |
| `citadel-workspace-client-ts/` | TypeScript/WASM client bindings |
| `citadel-workspace-server-kernel/` | Rust workspace server |
| `citadel-workspace-types/` | Shared Rust protocol types |

## Running it

```bash
git clone --recurse-submodules https://github.com/Avarok-Cybersecurity/citadel-workspace
cd citadel-workspace
npm ci                                   # from the ROOT: it is an npm workspace

docker compose up -d --build --wait      # or: tilt up
```

The UI is at <http://127.0.0.1:5291>, the internal service on `:12345`, and the
workspace server on `:12349`.

The first account to register initialises the workspace and becomes its
administrator. Everyone after that joins it.

**Code inside a container needs a rebuilt image, not a restart.**
`docker compose restart` reuses what is already in the image, so the container
keeps running old code while the source looks correct — a genuinely confusing
failure. This applies to the Rust services AND to `sync-wasm-clients.sh`, which
is copied into the sync image rather than mounted:

```bash
docker compose build internal-service server sync-wasm-client
docker compose up -d
```

## Tests

```bash
# Rust
cargo test -p citadel-workspace-types -p citadel-workspace-server-kernel
(cd citadel-internal-service && cargo nextest run)

# TypeScript units
(cd citadel-workspaces && npx vitest run)

# End to end — these share ONE backend, so never run two at once.
#
# The suite has TWO runners, and `npx playwright test` is only one of them:
# its testDir is ./src/tests-pw (11 specs). The other 40 are driven by npm
# scripts, which is what CI runs, so the playwright command alone covers well
# under a quarter of the E2E suite.
(cd citadel-workspaces/integration-tests && npx playwright test)   # the 11 ported specs
(cd citadel-workspaces/integration-tests && npm run test:all)      # the npm-script specs
(cd citadel-workspaces/integration-tests && npm run test:login)    # or just one
```

The suite also gates accessibility (axe, zero serious violations), Lighthouse
baselines, PWA installability and offline behaviour, and a landing-page bundle
budget. See [docs/TESTING.md](docs/TESTING.md).

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — protocol layers, P2P message flow, multi-tab coordination
- [docs/](docs/README.md) — deployment, testing, WASM build and sync, roadmap
- [CLAUDE.md](CLAUDE.md) — conventions, commit order across submodules, and the rules agents follow
