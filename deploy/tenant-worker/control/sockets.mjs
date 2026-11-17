/**
 * The object's side of one tenant socket, before the Citadel node is handed it: every byte in and
 * out reaches the meter, a message over the frame cap closes the socket before the node buffers
 * it, and the connection is released exactly once however the socket ends.
 */

const encoder = new TextEncoder();
const byteLength = (data) => (typeof data === "string" ? encoder.encode(data).byteLength : (data?.byteLength ?? 0));

/** Close code for a message larger than the object accepts (RFC 6455 "message too big"). */
export const FRAME_TOO_LARGE = 1009;

/**
 * Must run BEFORE the node's `accept(server)`: the node's listeners then come after the frame
 * check, and the wasm glue sends with `socket.send(...)` by property lookup
 * (server-wasm/pkg/instance.mjs), so it goes through the wrapper installed here.
 */
export function meterSocket(server, { meter, id, maxFrameBytes, now, onRelease }) {
  const release = () => {
    const record = meter.disconnect(id, now());
    if (record) onRelease(record);
  };
  const send = server.send.bind(server);
  server.send = (data) => {
    meter.outbound(id, byteLength(data));
    return send(data);
  };
  server.addEventListener("message", (event) => {
    const bytes = byteLength(event.data);
    if (bytes > maxFrameBytes) {
      event.stopImmediatePropagation();
      release();
      server.close(FRAME_TOO_LARGE, `a message is at most ${maxFrameBytes} bytes`);
      return;
    }
    meter.inbound(id, bytes);
  });
  server.addEventListener("close", release);
  server.addEventListener("error", release);
}

/**
 * Accepts a new socket for the running `node`: metered from its first byte (meterSocket, so before
 * the node sees it), handed to the node, and its client address `ip` recorded for the admission
 * check (control/admission.mjs). `onIdle()` runs when the last open connection is released.
 * Returns the client half.
 */
export function acceptSocket({ node, signIn, meter, id, maxFrameBytes, ip, now, onIdle }) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  // Frames and bytes per connection and per period (control/meter.mjs). CPU is measured outside
  // the isolate (proof.mjs samples workerd's process CPU at each phase boundary).
  meter.connect(id, now());
  let peer = null;
  meterSocket(server, {
    meter,
    id,
    maxFrameBytes,
    now,
    onRelease: (record) => {
      console.log(`[tenant] connection ${id} closed after ${record.open_ms} ms; ${JSON.stringify(record)}`);
      if (peer !== null) signIn.released(peer);
      if (meter.openCount === 0) onIdle();
    },
  });
  peer = node.accept(server);
  signIn.connected(peer, ip);
  return client;
}
