#!/usr/bin/env bash
# Notarises a macOS artefact, staples the ticket where one can be stapled, and proves both.
#
#   NOTARY_KEY_ID=... NOTARY_ISSUER_ID=... NOTARY_KEY_P8_BASE64=... \
#     scripts/notarise-macos.sh <artefact.dmg|.app|binary> [covered-binary ...]
#
# The key comes from exactly one of NOTARY_KEY_P8_BASE64 (CI, the org secret) or NOTARY_KEY_FILE
# (an operator's machine). There is no fallback that quietly skips: signed but un-notarised is
# refused by Gatekeeper, so a release that skipped this would look fixed and behave the same.
#
# Each covered-binary is code INSIDE the artefact that also ships on its own (the agent in the
# .tar.gz). Apple notarises nested code along with its container, so one submission covers both;
# this checks that it did, rather than assuming it.
set -euo pipefail

ARTEFACT="${1:?usage: notarise-macos.sh <artefact> [covered-binary ...]}"
shift
[ -e "$ARTEFACT" ] || { echo "notarise-macos: no such artefact: $ARTEFACT" >&2; exit 1; }
: "${NOTARY_KEY_ID:?NOTARY_KEY_ID must be set}"
: "${NOTARY_ISSUER_ID:?NOTARY_ISSUER_ID must be set}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
if [ -n "${NOTARY_KEY_P8_BASE64:-}" ] && [ -n "${NOTARY_KEY_FILE:-}" ]; then
  echo "notarise-macos: set NOTARY_KEY_P8_BASE64 or NOTARY_KEY_FILE, not both" >&2; exit 1
elif [ -n "${NOTARY_KEY_P8_BASE64:-}" ]; then
  key="$work/notary.p8"
  printf '%s' "$NOTARY_KEY_P8_BASE64" | base64 -d > "$key"
elif [ -n "${NOTARY_KEY_FILE:-}" ]; then
  key="$NOTARY_KEY_FILE"
else
  echo "notarise-macos: set NOTARY_KEY_P8_BASE64 or NOTARY_KEY_FILE" >&2; exit 1
fi

# notarytool takes .zip, .pkg or .dmg -- never a bare binary -- so a binary is zipped for submission.
case "$ARTEFACT" in
  *.dmg|*.pkg) upload="$ARTEFACT"; staple=1 ;;
  # A bundle goes zipped with its folder name kept, and takes a staple like an image does.
  *.app) upload="$work/notarize.zip"; ditto -c -k --keepParent "$ARTEFACT" "$upload"; staple=1 ;;
  *) upload="$work/notarize.zip"; ditto -c -k "$ARTEFACT" "$upload"; staple=0 ;;
esac

set +e
out="$(xcrun notarytool submit "$upload" --key "$key" --key-id "$NOTARY_KEY_ID" \
  --issuer "$NOTARY_ISSUER_ID" --wait --timeout 30m 2>&1)"
rc=$?
set -e
echo "$out"
if [ "$rc" -ne 0 ] || ! printf '%s' "$out" | grep -q "status: Accepted"; then
  id="$(printf '%s' "$out" | awk '/id:/ {print $2; exit}')"
  echo "::error::notarisation did not return Accepted." >&2
  [ -n "$id" ] && xcrun notarytool log "$id" --key "$key" --key-id "$NOTARY_KEY_ID" \
    --issuer "$NOTARY_ISSUER_ID" >&2 || true
  exit 1
fi

if [ "$staple" = 1 ]; then
  xcrun stapler staple "$ARTEFACT"
  xcrun stapler validate "$ARTEFACT"
fi

# Apple's ticket service can take a few seconds to answer for a ticket it has just issued.
notarised() {
  for _ in $(seq 1 12); do
    codesign --verify --check-notarization -R='notarized' "$1" >/dev/null 2>&1 && return 0
    sleep 5
  done
  return 1
}
for code in "$ARTEFACT" "$@"; do
  notarised "$code" || { echo "::error::$code is not notarised after an Accepted submission" >&2; exit 1; }
  echo "notarised: $code"
done
