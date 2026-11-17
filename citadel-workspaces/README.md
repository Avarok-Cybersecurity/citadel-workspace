# Citadel Workspace — web client

The React front end for Citadel Workspace: a post-quantum secure, peer-to-peer
collaborative workspace. Chat, file transfer and live documents over end-to-end
encrypted connections.

This directory is a git submodule of
[`citadel-workspace`](https://github.com/Avarok-Cybersecurity/citadel-workspace),
which holds the Rust server kernel, the local agent and the deployment.

## How it fits together

The page you load is **not** what holds your keys. Each person runs a small
local agent on their own machine, and the hosted page talks to it over a
loopback WebSocket:

```
browser (work.avarok.net)
   │  wss://local.avarok.net:12345      ← resolves to 127.0.0.1
   ▼
citadel-agent  (on your machine, holds the ratchets)
   │  Citadel protocol, E2E encrypted
   ▼
workspace server  (citadel.avarok.net:12400)
```

That is why the app asks you to install an agent, and why a shared/hosted agent
would defeat the point — it would hold every user's ratchet keys.

## Running it

The submodule is not built on its own. From the **parent** repository:

```sh
docker compose up -d --build --wait   # or: tilt up
```

The UI is served on port 5291 with hot reloading, inside the `ui` container.

## Checks

Run from the parent repository, which owns the gate suite:

```sh
SKIP_WASM_BUILD=1 node scripts/preflight.mjs
```

Locally scoped checks live in `scripts/` here — PWA installability, offline
behaviour, the update path, Lighthouse budgets and the bundle budget:

```sh
npm run build
node scripts/check-pwa-installable.mjs
node scripts/check-lighthouse.mjs
```

## Conventions

- **Strict TypeScript.** Every declaration states its type and every function
  its return type; `check-explicit-types.mjs` enforces it with no baseline left.
- **CIDs are `bigint`**, converted to string only for display, React keys and
  logging. Never in a function signature, a `Map` key or a serialisation
  boundary.
- **Files stay under 250 lines.** `check-file-length.mjs` holds a ratchet of
  pre-existing exemptions; an exemption is a ceiling, not a licence.
- **Colours come from semantic tokens**, never hex literals in class strings —
  a workspace administrator can repaint the whole palette at runtime.

## Branding

The brand kit is `assets/brand/` in the parent repository, and it is the only
source: everything the UI takes from it is written by the parent's
`scripts/sync-brand-kit.mjs` and checked byte for byte by
`scripts/check-brand-kit-is-synced.mjs`. That covers the `public/` icons,
favicon and social card, the manifest's kit fields
(`src/pwa/kit-manifest.generated.ts`) and the lockups' outlined paths
(`src/components/brand/artwork/*.generated.ts`). Never edit those by hand.

`CitadelLogo` draws a lockup (`horizontal`, `stacked`, `wordmark`, `mark`)
with its clear space, and refuses a size under the guidelines' floors; the
mark switches to the compact cut under 32 px. Colours come from
`src/styles/brand-tokens.css`, deliberately separate from the design tokens
in `src/index.css`: the logo must not inherit a workspace's palette, and it
takes the `-ondark` values exactly when `.dark` is on the root.
