# shellcheck shell=bash
# Sourced by scripts/smoke-agent.sh: unpacks ARCHIVE into WORK as a user would, sets BIN,
# and checks the archive carries the README and the binary its mode bit.
case "$ARCHIVE" in
  *.zip)    unzip -q "$ARCHIVE" -d "$WORK"; BIN="$WORK/citadel-agent.exe" ;;
  *.tar.gz) tar -xzf "$ARCHIVE" -C "$WORK"; BIN="$WORK/citadel-agent" ;;
  # Mounted and copied out, as a user drags it out of the window; run from the image it would work
  # even if the copy lost its mode bit, which is the thing being checked.
  # The agent inside the app, which is what the app runs; the app itself is smoke-macos-app.sh's.
  *.dmg)    hdiutil attach -quiet -nobrowse -readonly -mountpoint "$WORK/mnt" "$ARCHIVE"
            ditto "$WORK/mnt/Citadel Agent.app/Contents/MacOS/citadel-agent" "$WORK/citadel-agent"
            hdiutil detach -quiet "$WORK/mnt"; BIN="$WORK/citadel-agent" ;;
  *)        echo "::error::unknown archive type: $ARCHIVE" >&2; exit 1 ;;
esac

[ -f "$BIN" ]            || { echo "::error::archive has no $(basename "$BIN")" >&2; ls -la "$WORK" >&2; exit 1; }
# The app needs no README: it passes the flags itself. Every archive does.
[ -f "$WORK/README.md" ] || [[ "$ARCHIVE" == *.dmg ]] || { echo "::error::archive ships no README; a user gets a bare binary with a required flag and no way to know it" >&2; exit 1; }
# Windows has no executable bit; the check is meaningful only where it exists.
case "$ARCHIVE" in
  *.tar.gz|*.dmg) [ -x "$BIN" ] || { echo "::error::citadel-agent is not executable — packaging dropped the mode bit" >&2; exit 1; } ;;
esac
