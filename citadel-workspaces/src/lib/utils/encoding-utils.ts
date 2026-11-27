/** A string as the UTF-8 bytes a protocol byte field carries. */
export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** A protocol byte field's UTF-8 bytes as a string. */
export function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * A copy holding exactly these bytes. A view (cbor-x's output, a chunk of a file) keeps its whole
 * underlying buffer: posted to the leader tab, structured clone would copy all of it.
 */
export function ownedBytes(view: Uint8Array): Uint8Array {
  return view.byteOffset === 0 && view.byteLength === view.buffer.byteLength ? view : view.slice();
}

/**
 * Whether a value is a byte field as the WASM client and the workspace codec hand it over: a
 * Uint8Array, from whichever realm made it (WASM glue, a worker, jsdom), so not `instanceof`.
 */
export function isByteArray(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';
}

/**
 * A byte field read back from a record this browser kept: a Uint8Array, or the list of numbers
 * 0..255 a page from before the WASM client handed bytes over as Uint8Array wrote in its place.
 * Null when it is neither. Only for kept records; a live wire value is a Uint8Array or nothing.
 */
export function keptBytes(value: unknown): Uint8Array | null {
  if (isByteArray(value)) return value;
  if (!Array.isArray(value)) return null;
  return value.every((b: unknown): boolean => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= 255) ? Uint8Array.from(value as number[]) : null;
}
