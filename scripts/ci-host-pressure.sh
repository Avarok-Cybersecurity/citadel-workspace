#!/usr/bin/env bash
# What the runner VM itself was doing while a CI step ran.
#
#   ci-host-pressure.sh sample <seconds>   one line every <seconds>, forever
#   ci-host-pressure.sh report             one full snapshot, for a failure dump
#
# Two integration legs (runs 36841197969 and 36874090292) died inside `Start
# Services` with no log at all. Both were cancelled at the 55-minute job budget
# and then took exactly five MORE minutes to end, which is the server giving up
# on a runner that never acknowledged the cancel; neither left a log blob. A
# runner that cannot answer a cancel is a starved VM (memory, disk, or a wedged
# docker daemon), not a hung test -- and nothing recorded which.
#
# `sample` runs in the background of the step that builds the stack, so the
# step's own log carries the trend into whatever happens next. `report` is for
# the failure dump: the kernel's OOM lines are the one record that says a
# compiler was killed rather than slow.
set -uo pipefail

kib_field() {
  awk -v key="$1" '$1 == key":" { print int($2 / 1024) }' /proc/meminfo
}

sample_line() {
  local avail swap_total swap_free disk docker_disk
  avail=$(kib_field MemAvailable)
  swap_total=$(kib_field SwapTotal)
  swap_free=$(kib_field SwapFree)
  disk=$(df -BM --output=avail / 2>/dev/null | tail -1 | tr -d ' ')
  docker_disk=$(df -BM --output=avail /var/lib/docker 2>/dev/null | tail -1 | tr -d ' ')
  echo "[host-pressure] $(date -u +%H:%M:%S) mem_avail=${avail}M" \
    "swap_used=$((swap_total - swap_free))M load=$(cut -d' ' -f1-3 /proc/loadavg)" \
    "disk_avail=${disk} docker_disk_avail=${docker_disk:-n/a}" \
    "top_rss=$(ps -eo rss=,comm= --sort=-rss | head -1 | awk '{ printf "%s:%dM", $2, $1 / 1024 }')"
}

case "${1:-}" in
  sample)
    interval="${2:?usage: ci-host-pressure.sh sample <seconds>}"
    while true; do
      sample_line
      sleep "$interval"
    done
    ;;
  report)
    echo "=== host: memory ==="
    free -m
    echo "=== host: disk ==="
    df -h / /var/lib/docker 2>/dev/null || df -h /
    echo "=== host: load ==="
    uptime
    echo "=== host: largest processes by RSS ==="
    ps -eo pid=,rss=,etime=,args= --sort=-rss | head -15 | cut -c1-200
    echo "=== host: kernel OOM kills ==="
    # Captured, not piped to `tail || echo`: tail exits 0 on empty input, so
    # that form would never say "none" and an empty section would look cut off.
    if ! oom=$(sudo -n dmesg -T 2>&1); then
      echo "(dmesg unreadable: ${oom})"
    elif oom=$(grep -iE "out of memory|oom-kill|killed process" <<<"$oom"); then
      tail -20 <<<"$oom"
    else
      echo "(none recorded)"
    fi
    echo "=== host: containers ==="
    docker ps -a --format '{{.Names}}\t{{.Status}}' 2>&1 | head -20
    ;;
  *)
    echo "usage: ci-host-pressure.sh sample <seconds> | report" >&2
    exit 2
    ;;
esac
