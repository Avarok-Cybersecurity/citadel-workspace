/** Convert string to number[] suitable for protocol message payloads. */
export function stringToBytes(str: string): number[] {
  return Array.from(new TextEncoder().encode(str));
}

/** Convert number[] or Uint8Array from protocol messages back to string. */
export function bytesToString(bytes: number[] | Uint8Array): string {
  const arr: Uint8Array<ArrayBufferLike> = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new TextDecoder().decode(arr);
}
