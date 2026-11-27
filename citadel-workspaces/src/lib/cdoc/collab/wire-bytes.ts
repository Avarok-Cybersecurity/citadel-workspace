/**
 * The workspace protocol carries bytes as Uint8Array on the page (the codec writes them as the
 * JSON number arrays serde reads), so every update, snapshot and awareness record crosses this
 * boundary in both directions. Each result is a copy that owns its whole buffer, as the cdoc
 * worker's transfer list requires: transferring it never detaches the payload it came from.
 */
export function toWire(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}

export function fromWire(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}
