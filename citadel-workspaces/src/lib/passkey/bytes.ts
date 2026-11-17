/**
 * Byte helpers for the passkey envelope.
 *
 * `Bytes` is pinned to an ArrayBuffer backing because WebCrypto's BufferSource
 * refuses a SharedArrayBuffer-backed view, and every value here ends up there.
 * `copyBytes` is how a view from anywhere else (cbor-x, a WebAuthn response, a
 * jsdom realm) becomes one: `instanceof Uint8Array` is false across realms, so
 * the check is `ArrayBuffer.isView`.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

export function copyBytes(view: ArrayBufferView | ArrayBuffer): Bytes {
  if (view instanceof ArrayBuffer) return new Uint8Array(view.slice(0));
  const source: Uint8Array = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const out: Bytes = new Uint8Array(source.byteLength);
  out.set(source);
  return out;
}

export function isBytes(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

export function utf8(text: string): Bytes {
  return copyBytes(new TextEncoder().encode(text));
}

export function fromUtf8(bytes: Bytes): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function randomBytes(length: number): Bytes {
  const out: Bytes = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary: string = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff: number = 0;
  for (let i: number = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
