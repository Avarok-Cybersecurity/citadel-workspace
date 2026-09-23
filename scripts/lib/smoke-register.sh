# shellcheck shell=bash
# Sourced by scripts/smoke-agent.sh once the agent listens on PORT: the agent must parse the
# Register the UI sends, and reject a malformed one, so the check can fail.
    # Speaking WebSocket is not speaking the PROTOCOL.
    #
    # agent-v0.2.0 passes every assertion above -- it runs, it listens, it
    # completes a TLS handshake from the allowed origin and refuses a foreign
    # one -- and is still unusable for anyone who types a hostname as their
    # server address. Its `server_addr` was a `SocketAddr`, the UI sends
    # `citadel.avarok.net:12400`, and the agent rejected the first Register
    # before processing it:
    #
    #   Failed to deserialize WebSocket JSON message: invalid socket address syntax
    #
    # Nothing visible says so. The browser shows "Registration timed out" after
    # thirty seconds, the UI names no cause, and `debugLog` is a no-op in a
    # production bundle -- the agent's own log is the only place the truth
    # appears, and a user does not have it. Only a raw IP worked.
    #
    # So: send the request the UI actually sends, and require the agent to
    # UNDERSTAND it. Not to succeed -- registering against a server that is not
    # there legitimately fails many ways -- only to parse it.
    envelope() { # <server_addr JSON value> <username>
      printf '{"Request":{"Register":{"request_id":"00000000-0000-4000-8000-00000000000%s",' "$3"
      printf '"server_addr":%s,"full_name":"Smoke Probe","username":"%s",' "$1" "$2"
      printf '"proposed_password":[112,114,111,98,101],"connect_after_register":false,'
      printf '"session_security_settings":{"security_level":"Standard","secrecy_mode":"BestEffort",'
      printf '"crypto_params":{"encryption_algorithm":"AES_GCM_256","kem_algorithm":"MlKem","sig_algorithm":"None"},'
      printf '"header_obfuscator_settings":"Disabled"},"server_password":null}}}'
    }
    deserialize_failures() { grep -c "Failed to deserialize" "$WORK/agent.log" 2>/dev/null || echo 0; }

    before="$(deserialize_failures)"
    python3 scripts/lib/ws-send.py local.avarok.net "$PORT" http://localhost:5291 \
      "$(envelope '"citadel.example.net:12400"' smoke_hostname 1)" >/dev/null || {
        echo "::error::could not send a Register frame to the packaged agent" >&2
        tail -20 "$WORK/agent.log" >&2; exit 1; }
    sleep 2
    after="$(deserialize_failures)"
    if [ "$after" != "$before" ]; then
      echo "::error::the agent could not parse a Register carrying a HOSTNAME server address." >&2
      echo "::error::That is the request every user makes. Only a raw IP would work with this build." >&2
      grep "Failed to deserialize" "$WORK/agent.log" | tail -3 >&2
      exit 1
    fi
    echo "  a Register with a hostname server address is understood"

    # The positive control, in the check itself. Everything above is an
    # assertion that a counter did NOT move, and a counter that can never move
    # proves nothing: if the frame never arrived, if the log were elsewhere, if
    # the grep were wrong, the assertion would pass on an agent that
    # understands nothing at all. So send one the agent MUST reject, and require
    # the counter to move.
    before="$(deserialize_failures)"
    python3 scripts/lib/ws-send.py local.avarok.net "$PORT" http://localhost:5291 \
      "$(envelope 12400 smoke_control 2)" >/dev/null || true
    sleep 2
    after="$(deserialize_failures)"
    if [ "$after" = "$before" ]; then
      echo "::error::the control frame -- a Register whose server_addr is a NUMBER -- was not rejected." >&2
      echo "::error::So the check above proves nothing: either the frame is not reaching this agent," >&2
      echo "::error::or its parse failures do not reach $WORK/agent.log." >&2
      exit 1
    fi
    echo "  and a malformed one is rejected, so the check above can fail"
