/**
 * The bytes inside a `PeerMessage`, whichever way they arrived.
 *
 * The agent's JSON encoding gives a `number[]`; a binary frame or a test gives
 * a `Uint8Array`. Both are the same message, and the handler that reads them
 * should not have to care -- it had this branch inline, which is three lines of
 * shape-checking in the middle of a dispatch that is about something else.
 */
export function peerMessageBytes(message: unknown): Uint8Array | null {
  if (Array.isArray(message)) return new Uint8Array(message as number[]);
  // Not `instanceof`: a Uint8Array built in another realm (the WASM client, a
  // worker, jsdom) fails that check while being exactly what it claims to be.
  if (ArrayBuffer.isView(message)) {
    const view: ArrayBufferView = message;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}
