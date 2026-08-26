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

`.env` must set `WORKSPACE_MASTER_PASSWORD`. It has no default, and the server
refuses to start if it is missing or still the `__CHANGE_ME__` placeholder —
two independent checks, in `deploy.sh` and in the binary. Generate one with
`openssl rand -hex 32`.

Optional: `IMAGE_TAG` (defaults to `latest`; pin it to `sha-<commit>` to control
exactly what runs), `WORKSPACE_BIND_ADDR`, `INTERNAL_SERVICE_PORT`, and
`TUNNEL_TOKEN` with `--profile tunnel` to expose it via Cloudflare Tunnel.

The server binds `127.0.0.1` by default. Publishing it means putting a tunnel or
reverse proxy in front, not widening the bind address.

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
