# Installing Citadel Workspace

Three different things are called "installing", and picking the wrong one is the
most common way to lose an afternoon. Start here.

| You want to… | Use | What you get |
|---|---|---|
| **Use** the workspace | `docker-compose.local.yml` | The agent that holds your keys, plus the UI. Point it at someone's server. |
| **Host** a workspace others join | `docker-compose.production.yml` | The shared server, an agent, and the UI. Persistent data. |
| **Develop** on it | `docker-compose.yml` (the README quickstart) | Everything built from source, in-memory, **ephemeral**. |

The development stack is the one the README documents, and it is deliberately
ephemeral: accounts vanish on reload. If you follow the README expecting a usable
workspace, that is what goes wrong.

## Prerequisites

- Docker and Docker Compose.
- For the **development** stack only: Rust, Node 20 or newer, and a `git clone
  --recurse-submodules` (or `git submodule update --init --recursive` after the
  fact — nested submodules, and a plain clone leaves them empty).

Nothing is built for the local or production paths; both pull prebuilt images.

## Using the workspace

```bash
docker login ghcr.io -u <your-github-username>
docker compose -f docker-compose.local.yml pull
docker compose -f docker-compose.local.yml up -d
open http://localhost:8080
```

Then enter the workspace server's address at the login screen.

`docker login` is one-time. The password it wants is **not** your GitHub
password — these are private org packages, so it needs a Personal Access Token
with the `read:packages` scope and nothing else
(<https://github.com/settings/tokens>, classic). A token scoped that way can pull
these images and do nothing else.

**The agent runs on your machine on purpose.** It holds your ratchet keys and
does the crypto; a browser cannot. That is what makes messages and file
transfers end-to-end encrypted — nobody else's machine ever holds your keys.
It is also why `agent_data` matters: see the backup note below.

## Hosting a workspace

```bash
cp .env.example .env          # then edit it
docker compose -f docker-compose.production.yml up -d --wait
```

`.env` must set **two** variables. Both have no default, and the stack will not
come up without them — `--wait` fails while you look for a reason.

`WORKSPACE_MASTER_PASSWORD`. The server refuses to start if it is missing or
still the `__CHANGE_ME__` placeholder — two independent checks, in `deploy.sh`
and in the binary. Generate one with `openssl rand -hex 32`.

`INTERNAL_SERVICE_ALLOWED_ORIGINS`. The comma-separated list of origins the UI
is served from, e.g. `https://work.example.com`. The agent exits at startup
without it, because an agent that accepts any origin can be driven by any page
the user happens to visit. Pass `*` on a development box only.

`./deploy.sh` checks both before it starts anything, and reports which one is
missing. `docker compose … up -d --wait` does not.

Optional: `IMAGE_TAG` (defaults to `latest`; pin it to `sha-<commit>` to control
exactly what runs), `WORKSPACE_BIND_ADDR`, `INTERNAL_SERVICE_PORT`, and
`TUNNEL_TOKEN` with `--profile tunnel` to expose it via Cloudflare Tunnel.

### Claiming the workspace

Bring the stack up, register an account, and initialize the workspace with
`WORKSPACE_MASTER_PASSWORD` when the app asks for it. That is what makes you the
administrator; nothing else does.

Do this before anyone else can reach the port, but note that being first is no
longer what grants ownership. On the production compose file
`WORKSPACE_ALLOW_FIRST_CONNECT_ADMIN` is `0`, so a fresh workspace has no
administrator until somebody presents the master password. Registration has no
invite gate, so if the first account to connect were promoted automatically —
as it is on the dev stack, where the same variable is `1` — a stranger who found
the port before you did would own your workspace.

**If remote people will use this workspace, set `WORKSPACE_BIND_ADDR=0.0.0.0:12349`
in `.env` and open that port on your firewall.**

The server binds `127.0.0.1` by default, which is correct only when everyone
using it is on the same machine. Each user runs their own local agent, and that
agent dials your server directly over the Citadel protocol — so unlike an
ordinary web app, there is nothing a tunnel or HTTP reverse proxy can do here.
The tunnel profile publishes the **UI** on `:8080`; it carries no route to
`:12349` and could not carry the raw protocol if it did.

This paragraph used to say to put a tunnel or proxy in front "not widening the
bind address", which left every remote user with connection refused and pointed
away from the one line that fixes it.

### Back up before you upgrade

```bash
# Production stack (the default):
./scripts/backup-volumes.sh

# Local stack — you MUST name its compose file, or none of your volumes match:
COMPOSE_FILE=docker-compose.local.yml ./scripts/backup-volumes.sh
```

Archives land in `~/.local/share/citadel-backups` (override with `BACKUP_DIR`),
deliberately outside the checkout. The script exits non-zero if it archived
nothing, so a wrong compose file fails loudly instead of reporting success over
an empty backup.

There is **no server-side key escrow, by design**. Account keys live in the
agent's volume and nowhere else, so losing it does not mean "restore from the
server" — that identity is gone and the user re-registers as somebody new.

See [UPGRADING.md](./UPGRADING.md) for upgrades, rollbacks and restores.

## Developing

The README quickstart. Accounts and workspaces are held in memory and are lost on
every reload — that is the dev contract, not a bug.
