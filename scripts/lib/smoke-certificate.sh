# shellcheck shell=bash
# Sourced by scripts/smoke-agent.sh once the agent listens on PORT: the expiry of the
# certificate built into it.
    # The built-in certificate must not be near expiry.
    #
    # This binary SERVES TLS for the loopback name a hosted page dials, using a
    # certificate compiled into it. When that certificate expires, every copy of
    # this release stops working at the same moment: the browser refuses the
    # socket, the page cannot reach the user's own agent, and there is NO
    # server-side remedy -- every user must download a new binary. A release cut
    # a week before expiry is a release that breaks a week later.
    #
    # 30 days is a floor, not a target. Let's Encrypt issues for 90, so a build
    # from a fresh certificate starts near 89; this fires only when one has been
    # left unrenewed for two months.
    MIN_CERT_DAYS="${MIN_CERT_DAYS:-30}"
    CERT_END="$(echo | openssl s_client -connect "127.0.0.1:$PORT" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
    if [ -n "$CERT_END" ]; then
      DAYS="$(CERT_END="$CERT_END" python3 -c '
import os, datetime
end = datetime.datetime.strptime(os.environ["CERT_END"].strip(), "%b %d %H:%M:%S %Y %Z")
end = end.replace(tzinfo=datetime.timezone.utc)
print((end - datetime.datetime.now(datetime.timezone.utc)).days)
')"
      if [ "$DAYS" -lt "$MIN_CERT_DAYS" ]; then
        echo "::error::the built-in certificate expires in ${DAYS} days (< ${MIN_CERT_DAYS})." >&2
        echo "  Every user of this release loses TLS at that moment and needs a new binary." >&2
        echo "  Renew the certificate and rebuild before publishing." >&2
        exit 1
      fi
      echo "  built-in certificate valid for ${DAYS} more days"
    else
      # Not fatal: a --no-tls or plaintext build legitimately serves none. Said
      # out loud, because silence would hide the check never running at all.
      echo "  (no TLS certificate served on this port -- expiry not checked)"
    fi
