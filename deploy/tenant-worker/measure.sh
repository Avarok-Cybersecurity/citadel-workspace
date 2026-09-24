#!/usr/bin/env bash
# Run the proof N times against a running `wrangler dev` and report the workerd processes' CPU
# time consumed over those runs, next to an idle baseline of the same length. Spike tooling.
#   ./measure.sh <ws-endpoint> <runs> <requests-per-run>
set -euo pipefail
cd "$(dirname "$0")"
endpoint="$1"; runs="$2"; requests="$3"

cpu_ms() {  # summed CPU time of every workerd process, in ms
  ps -axo time=,command= | awk '/workerd serve/ && !/awk/ {
    n = split($1, p, ":"); s = 0; for (i = 1; i <= n; i++) s = s * 60 + p[i]; t += s
  } END { printf "%d", t * 1000 }'
}

before=$(cpu_ms); t0=$(date +%s)
for i in $(seq 1 "$runs"); do
  node proof.mjs "$endpoint" "$requests" | grep -E '^(PROOF|RESPONSE)' | grep -v "^RESPONSE [1-9]"
done
after=$(cpu_ms); t1=$(date +%s)
elapsed=$((t1 - t0))
sleep "$elapsed"
idle=$(cpu_ms)
echo "MEASURE runs=$runs requests_per_run=$requests wall_s=$elapsed workerd_cpu_ms=$((after - before)) idle_cpu_ms_same_duration=$((idle - after))"
