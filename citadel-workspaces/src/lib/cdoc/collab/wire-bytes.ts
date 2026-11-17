/**
 * The workspace protocol carries bytes as JSON number arrays (`Vec<u8>` through serde_json),
 * so every update, snapshot and awareness record crosses this boundary in both directions.
 * Each result owns its whole buffer, as the cdoc worker's transfer list requires.
 */
export function toWire(bytes: Uint8Array): number[] {
  return Array.from(bytes);
}

export function fromWire(numbers: readonly number[]): Uint8Array {
  return Uint8Array.from(numbers);
}
