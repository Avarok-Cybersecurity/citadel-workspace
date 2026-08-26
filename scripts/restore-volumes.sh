#!/usr/bin/env bash
# Restore Docker volumes from scripts/backup-volumes.sh archives.
#
#   ./scripts/restore-volumes.sh ./backups/server_data-20260826T120000Z.tar.gz
#   ./scripts/restore-volumes.sh ./backups/*.tar.gz
#
# Refuses to run while the services are up. Restoring under a running server
# races its own writes: it reopens files mid-restore and can persist a mixture
# of old and new state, which is worse than either.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <archive.tar.gz> [more archives...]" >&2
  echo "Each archive's volume is taken from its filename: <volume>-<timestamp>.tar.gz" >&2
  exit 1
fi

running="$(docker compose -f "$COMPOSE_FILE" ps --status running --quiet 2>/dev/null | wc -l | tr -d ' ')"
if [ "$running" != "0" ]; then
  echo "ERROR: $running service(s) still running. Stop them first:" >&2
  echo "  docker compose -f $COMPOSE_FILE down" >&2
  echo "Restoring underneath a running server can persist a mix of old and new state." >&2
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

for archive in "$@"; do
  [ -f "$archive" ] || { echo "ERROR: no such archive: $archive" >&2; exit 1; }

  base="$(basename "$archive")"
  vol="${base%%-*}"                      # server_data-2026...tar.gz -> server_data
  full="${PROJECT}_${vol}"

  # Fail before destroying anything if the archive is unreadable.
  if ! tar tzf "$archive" >/dev/null 2>&1; then
    echo "ERROR: $archive is not a readable gzip tar — refusing to wipe $full for it." >&2
    exit 1
  fi

  echo "Restoring $vol from $base"
  docker volume create "$full" >/dev/null
  docker run --rm \
    -v "${full}:/target" \
    -v "$(cd "$(dirname "$archive")" && pwd):/backup:ro" \
    alpine:3 \
    sh -c "rm -rf /target/* /target/..?* /target/.[!.]* 2>/dev/null; tar xzf /backup/${base} -C /target" >/dev/null
  echo "  restored into $full"
done

echo
echo "Restored. Bring the stack back up:"
echo "  docker compose -f $COMPOSE_FILE up -d --wait"
