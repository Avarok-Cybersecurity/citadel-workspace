#!/usr/bin/env bash
# citadel-agent-launch.json, the release asset a tarball's updating agent reads to learn what a
# new version must be started with, is what the packaged launcher starts the agent with: the
# same flags, the same values (scripts/lib/agent-settings.py launch-asset).
#
# Each property is asserted against the real Info.plist and launcher template, and a new
# required setting added to the template must reach the asset without touching anything else;
# that is the forward path the asset exists for.
set -uo pipefail
cd "$(dirname "$0")/.."
LIB=scripts/lib/agent-settings.py
PLIST=apps/macos-agent/Info.plist
TEMPLATE=packaging/linux/citadel-agent-launch.in
fails=0
ok() { echo "  ok: $1"; }
fail() { echo "  FAIL: $1"; fails=$((fails+1)); }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

python3 "$LIB" "$PLIST" launch-asset "$TEMPLATE" > "$work/asset.json" || fail "the asset was not written"
python3 "$LIB" "$PLIST" render "$TEMPLATE" > "$work/launcher"
idle="$(python3 "$LIB" "$PLIST" get CitadelAgentIdentityUnlockIdleSecs)"

# Every setting is the launcher's `--flag 'value'`, the format is 1, and --bind is not offered.
python3 - "$work/asset.json" "$work/launcher" "$idle" <<'PY' && ok "the asset is the launcher's flags and values" || fail "the asset is not the launcher's"
import json, sys
asset = json.load(open(sys.argv[1]))
launcher = open(sys.argv[2]).read()
assert set(asset) == {"v", "settings"} and asset["v"] == 1, asset
settings = asset["settings"]
assert settings.get("--identity-unlock-idle-secs") == sys.argv[3], settings
assert "--bind" not in settings, settings
for flag, value in settings.items():
    assert f"{flag} '{value}'" in launcher, (flag, value)
PY

# The forward path: one more required setting in the template, and it is in the asset.
python3 - "$TEMPLATE" "$work/next.in" <<'PY'
import sys
text = open(sys.argv[1]).read()
tail = '  "$@"\n'
assert text.endswith(tail), "the launcher no longer ends with its pass-through line"
open(sys.argv[2], "w").write(text[: -len(tail)] + "  --a-new-setting '@CitadelAgentIdentityUnlockIdleSecs@' \\\n" + tail)
PY
grep -q -- "--a-new-setting" "$work/next.in" || fail "the test could not add a setting to the template"
python3 "$LIB" "$PLIST" launch-asset "$work/next.in" | grep -q "\"--a-new-setting\":\"$idle\"" \
  && ok "a setting added to the launcher reaches the asset" || fail "a setting added to the launcher is missing from the asset"

printf '%s\n' "exec x \\" "  --x '@NoSuchKey@' \\" '  "$@"' > "$work/unknown.in"
python3 "$LIB" "$PLIST" launch-asset "$work/unknown.in" >/dev/null 2>&1 \
  && fail "a template naming an unknown key was accepted" || ok "refused a template naming an unknown key"
printf '%s\n' 'exec x "$@"' > "$work/none.in"
python3 "$LIB" "$PLIST" launch-asset "$work/none.in" >/dev/null 2>&1 \
  && fail "a template with no settings was accepted" || ok "refused a template with no settings"

[ "$fails" -eq 0 ] || { echo "$fails failed"; exit 1; }
echo "all passed"
