/**
 * Whether two decoded values hold the same data: primitives (bigint included) by value, byte
 * arrays by their bytes, sets by their members, arrays and plain objects field by field. What
 * the editor state is built from (result records, codec values, key sets), nothing else.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  // isView, not instanceof: bytes from a worker or WASM fail instanceof across realms.
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!(ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) || a.byteLength !== b.byteLength) return false;
    const x: Uint8Array = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y: Uint8Array = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return x.every((v: number, i: number): boolean => v === y[i]);
  }
  if (a instanceof Set || b instanceof Set) {
    return a instanceof Set && b instanceof Set && a.size === b.size && [...a].every((v: unknown): boolean => b.has(v));
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v: unknown, i: number): boolean => sameValue(v, b[i]));
  }
  const ka: string[] = Object.keys(a);
  const kb: string[] = Object.keys(b);
  const ra: Readonly<Record<string, unknown>> = a as Readonly<Record<string, unknown>>;
  const rb: Readonly<Record<string, unknown>> = b as Readonly<Record<string, unknown>>;
  return ka.length === kb.length && ka.every((k: string): boolean => Object.prototype.hasOwnProperty.call(rb, k) && sameValue(ra[k], rb[k]));
}
