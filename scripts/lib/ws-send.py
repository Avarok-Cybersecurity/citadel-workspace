"""Open a real WebSocket to the agent over TLS and send one request frame.

Used by scripts/smoke-agent.sh to prove a PACKAGED agent understands the
protocol the UI speaks, not merely that it completes a handshake.

curl can perform the upgrade but cannot send a frame, and the whole point is the
frame: agent-v0.2.0 handshakes perfectly and then rejects the first Register the
UI sends, because its `server_addr` was still a `SocketAddr` and the UI sends a
hostname. That failure is invisible from outside -- the browser shows a 30-second
"Registration timed out" and the agent's own log is the only place the cause
appears.

No dependencies: the release runners have python3 and nothing else is guaranteed.

Usage: ws-send.py <sni-host> <port> <origin> <json-payload>
Prints a one-word result and exits 0 if the frame was sent, 2 if the handshake
was refused.
"""
import os
import socket
import ssl
import struct
import sys

host, port, origin, payload = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]

context = ssl.create_default_context()
connection = socket.create_connection(("127.0.0.1", port), timeout=15)
sock = context.wrap_socket(connection, server_hostname=host)

sock.sendall(
    (
        f"GET / HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Version: 13\r\n"
        f"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
        f"Origin: {origin}\r\n\r\n"
    ).encode()
)

head = b""
while b"\r\n\r\n" not in head:
    chunk = sock.recv(4096)
    if not chunk:
        break
    head += chunk
status = head.split(b"\r\n", 1)[0].decode(errors="replace")
if " 101 " not in status:
    print(f"handshake-refused: {status}")
    sys.exit(2)

# A client frame MUST be masked (RFC 6455 §5.3); an unmasked one is a protocol
# error and the agent would close the connection instead of parsing it, which
# would look exactly like the rejection this check is hunting for.
body = payload.encode()
mask = os.urandom(4)
masked = bytes(byte ^ mask[i % 4] for i, byte in enumerate(body))
length = len(body)
if length < 126:
    header = struct.pack("!BB", 0x81, 0x80 | length)
elif length < (1 << 16):
    header = struct.pack("!BBH", 0x81, 0x80 | 126, length)
else:
    header = struct.pack("!BBQ", 0x81, 0x80 | 127, length)
sock.sendall(header + mask + masked)

# Read whatever comes back, but do not assert on it: a Register against an
# unreachable server legitimately answers many ways, and the assertion that
# matters is made by the caller against the agent's log.
sock.settimeout(8)
try:
    sock.recv(8192)
except Exception:
    pass
sock.close()
print("sent")
