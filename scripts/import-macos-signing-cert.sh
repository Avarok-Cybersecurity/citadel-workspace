#!/usr/bin/env bash
# Imports the Developer ID certificate into a throwaway keychain and exports SIGN_IDENTITY.
#
#   CERT_P12_BASE64=... CERT_PASSWORD=... scripts/import-macos-signing-cert.sh
#
# For CI: writes SIGN_IDENTITY to $GITHUB_ENV. Used by every job that signs, so the keychain dance
# (partition list, search list) exists once.
#
# The identity is READ FROM THE CERTIFICATE rather than carried in a secret. A hand-typed
# "Developer ID Application: Name (TEAM)" is a second copy of something the .p12 already states,
# and the failure when it drifts is `codesign: no identity found`, which names neither copy.
set -euo pipefail
if [ -z "${CERT_P12_BASE64:-}" ] || [ -z "${CERT_PASSWORD:-}" ]; then
  echo "::error::MACOS_CERT_P12_BASE64 and MACOS_CERT_PASSWORD must both be set."
  echo "  A release must not ship an unsigned macOS binary, so this fails rather"
  echo "  than falling back to the ad-hoc signature Rust's linker produces."
  exit 1
fi
keychain="$RUNNER_TEMP/signing.keychain-db"
kcpass="$(uuidgen)"
security create-keychain -p "$kcpass" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$kcpass" "$keychain"
printf '%s' "$CERT_P12_BASE64" | base64 -d > "$RUNNER_TEMP/cert.p12"
security import "$RUNNER_TEMP/cert.p12" -k "$keychain" -P "$CERT_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security
rm -f "$RUNNER_TEMP/cert.p12"
# Without this, codesign blocks on a GUI prompt no runner can answer.
security set-key-partition-list -S apple-tool:,apple: -k "$kcpass" "$keychain" >/dev/null 2>&1
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
identity="$(security find-identity -v -p codesigning "$keychain" \
  | awk -F'"' '/Developer ID Application/ {print $2; exit}')"
if [ -z "$identity" ]; then
  echo "::error::the .p12 contains no 'Developer ID Application' identity."
  echo "  A 'Mac App Distribution' or 'Apple Development' certificate cannot sign"
  echo "  software distributed outside the App Store. Export the Developer ID one."
  exit 1
fi
echo "SIGN_IDENTITY=$identity" >> "$GITHUB_ENV"
echo "Signing identity: $identity"
