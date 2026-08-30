#!/usr/bin/env bash
# Back up the Docker volumes that hold state you cannot regenerate.
#
# There is no server-side key escrow, by design. A user's account keys live in
# the internal-service volume and nowhere else, so losing it does not mean
# "restore from the server" — it means that identity is gone and the user
# re-registers as a new person. That is the whole reason this script exists, and
# why docs/UPGRADING.md tells you to run it before an upgrade.
#
#   ./scripts/backup-volumes.sh                 # production volumes
#   COMPOSE_FILE=docker-compose.local.yml ./scripts/backup-volumes.sh
#   BACKUP_DIR=/mnt/backups ./scripts/backup-volumes.sh
#
# Restore with scripts/restore-volumes.sh, which refuses to run while the
# services are up — restoring under a running server races its own writes.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
# Outside the checkout by default. The deploy host runs `git pull` in this
# working tree, and commit.sh runs `git add --all` -- so an archive of the
# key material sitting in ./backups is one command away from being committed.
BACKUP_DIR="${BACKUP_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/citadel-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: no such compose file: $COMPOSE_FILE" >&2
  exit 1
fi

# Read the volume names out of the compose file rather than hardcoding them, so
# a volume added later is backed up without anyone remembering to edit this.
# `while read`, not `mapfile`: macOS ships bash 3.2, where mapfile does not
# exist, and an operator there would have seen "mapfile: command not found"
# followed by a zero-volume run.
VOLUMES=()
while IFS= read -r v; do
  [ -n "$v" ] && VOLUMES+=("$v")
done < <(
  awk '/^volumes:/{f=1;next} /^[a-z]+:/{f=0} f && /^  [a-z_][A-Za-z0-9_-]*:/{gsub(/[ :]/,"");print}' "$COMPOSE_FILE"
)

if [ "${#VOLUMES[@]}" -eq 0 ]; then
  echo "ERROR: no volumes found in $COMPOSE_FILE — refusing to report success having backed up nothing." >&2
  exit 1
fi

# Ask Compose, do not guess. Compose names volumes after the PROJECT name,
# which it normalises (lowercased, invalid characters stripped) and which
# COMPOSE_PROJECT_NAME overrides -- none of which basename(pwd) knows. It
# happens to match in a checkout named exactly like the project, which is why
# this survived. deploy.sh already does it correctly; this is that lookup.
PROJECT="$(docker compose -f "$COMPOSE_FILE" config --format json 2>/dev/null | jq -r '.name // empty')"
if [ -z "$PROJECT" ]; then
  PROJECT="$(basename "$(pwd)")"
  echo "WARNING: could not read the compose project name; falling back to '$PROJECT'." >&2
fi
mkdir -p "$BACKUP_DIR"
echo "Backing up ${#VOLUMES[@]} volume(s) from $COMPOSE_FILE to $BACKUP_DIR"

ARCHIVED=0
for vol in "${VOLUMES[@]}"; do
  full="${PROJECT}_${vol}"
  if ! docker volume inspect "$full" >/dev/null 2>&1; then
    echo "  skip $vol (no volume named $full on this host)" >&2
    continue
  fi
  out="${BACKUP_DIR}/${vol}-${STAMP}.tar.gz"
  # Alpine + tar in a throwaway container: no assumption about what is installed
  # on the host, and it works identically on Linux and macOS.
  docker run --rm \
    -v "${full}:/source:ro" \
    -v "$(cd "$BACKUP_DIR" && pwd):/backup" \
    alpine:3 \
    tar czf "/backup/$(basename "$out")" -C /source . >/dev/null
  echo "  $vol -> $out ($(du -h "$out" | cut -f1))"
  ARCHIVED=$((ARCHIVED + 1))
done

# Exit non-zero when nothing was captured. The guard above checks that volumes
# were declared in the compose file, not that any were archived -- so with the
# wrong project name, or the wrong COMPOSE_FILE for this host, every volume was
# skipped and the script still printed "Done." and exited 0.
#
# That matters more here than anywhere else in the repo: UPGRADING.md tells the
# operator to run this before every upgrade precisely because there is no
# server-side key escrow, so a user's account keys live in these volumes and
# nowhere else.
if [ "$ARCHIVED" -eq 0 ]; then
  echo >&2
  echo "ERROR: archived 0 of ${#VOLUMES[@]} volume(s) -- nothing was backed up." >&2
  echo "  project name: $PROJECT" >&2
  echo "  compose file: $COMPOSE_FILE" >&2
  echo >&2
  echo "If this is the local stack, point at its compose file:" >&2
  echo "  COMPOSE_FILE=docker-compose.local.yml $0" >&2
  exit 1
fi

echo
echo "Done. Verify a backup is readable before relying on it:"
echo "  tar tzf ${BACKUP_DIR}/<file>.tar.gz | head"
