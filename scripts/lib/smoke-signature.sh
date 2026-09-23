# shellcheck shell=bash
# Sourced by scripts/smoke-agent.sh once the agent listens: the Developer ID signature
# and hardened runtime of a macOS BIN.
    # A macOS binary must be Developer-ID signed with the hardened runtime.
    #
    # Rust's linker produces an ad-hoc signature, which `spctl -a -t exec`
    # rejects: a Finder double-click gets "the developer cannot be verified".
    # Terminal execution of a quarantined ad-hoc binary still works today, which
    # is why this went unnoticed -- Apple's tolerance, not a guarantee.
    #
    # Checked HERE because this script already runs against the real release
    # artefact, so an unsigned binary cannot be published even if the signing
    # step is later moved, disabled, or silently skipped for want of a secret.
    #
    # Only on macOS, and only for a Mach-O: codesign does not exist elsewhere,
    # and the Linux and Windows assets are not Apple's to assess.
    if [ "$(uname -s)" = "Darwin" ] && printf '%s' "$DESC" | grep -q "Mach-O"; then
      if ! codesign --verify --strict "$BIN" 2>/dev/null; then
        echo "::error::$ARCHIVE contains a binary whose signature does not verify." >&2
        exit 1
      fi
      # No `exit` in the awk: it closes the pipe while codesign is still
      # writing, codesign dies on SIGPIPE, and `set -o pipefail` turns that into
      # exit 141 -- which reads as a FAILED CHECK on a correctly signed binary.
      # The first run of this gate against a signed, notarised build did exactly
      # that. `head -1` takes the first line without shutting the writer down. `|| true`: an
      # ad-hoc binary has no Authority line, and grep's exit 1 killed the run before the error below.
      CODESIGN_OUT="$(codesign -dv --verbose=4 "$BIN" 2>&1 || true)"
      AUTHORITY="$(printf '%s\n' "$CODESIGN_OUT" | grep '^Authority=' | head -1 | cut -d= -f2- || true)"
      case "$AUTHORITY" in
        "Developer ID Application"*) echo "  signed by: $AUTHORITY" ;;
        *)
          echo "::error::$ARCHIVE is not signed with a Developer ID Application certificate." >&2
          echo "  Authority: ${AUTHORITY:-<none: ad-hoc or unsigned>}" >&2
          echo "  Gatekeeper refuses this on a machine that downloaded it through a browser." >&2
          exit 1 ;;
      esac
      # Hardened runtime, without which notarisation is refused outright.
      if ! printf '%s\n' "$CODESIGN_OUT" | grep -q "flags=.*runtime"; then
        echo "::error::$ARCHIVE is signed WITHOUT the hardened runtime (--options runtime)." >&2
        echo "  Apple rejects notarisation for this, so the binary would ship signed and" >&2
        echo "  still be refused." >&2
        exit 1
      fi
      echo "  hardened runtime: on"
    fi
